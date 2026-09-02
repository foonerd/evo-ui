//! Framework reverse-proxy.
//!
//! Owns the upstream HTTPS + WebSocket client used to forward
//! `/api/v1/*` and `/api/v1/ws` traffic from the operator's
//! browser (which only ever speaks plain HTTP to this runtime
//! on port 80) to the framework's HTTPS substrate on
//! loopback. Two transport flavours:
//!
//! - **HTTP proxy** for REST wire ops. The upstream URL is
//!   `https://127.0.0.1:<framework_https_port>/api/v1/...`;
//!   rustls trusts the framework's device-CA loaded from
//!   `/var/lib/evo/https/https/ca.crt`. SNI is set to
//!   `localhost` because the framework's leaf cert SAN
//!   includes `localhost` and `127.0.0.1`. The original
//!   client's IP is injected via `X-Forwarded-For` so the
//!   framework's trusted-proxy classifier can apply
//!   LAN-origin admission against the operator's real
//!   address (not the loopback peer).
//!
//! - **WebSocket upgrade proxy** for the `/api/v1/ws`
//!   surface. We open the upstream WS handshake directly
//!   via `tokio-tungstenite::client_async` over a rustls
//!   TLS stream, then bridge the client's hyper-upgraded
//!   raw stream to the upstream's WebSocket stream by
//!   pumping bytes (transparent at the wire level — no
//!   per-frame parsing).

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::{Method, Request, Response, StatusCode, Uri};
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use std::fs;
use std::io;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

/// Reverse-proxy client to the framework's loopback HTTPS
/// substrate.
#[derive(Clone)]
pub struct FrameworkProxy {
    upstream_host: String,
    upstream_port: u16,
    rustls_connector: TlsConnector,
}

/// Body type used in proxy responses. Boxed dynamically so
/// the routing layer can return any body kind from this
/// module + the routing layer's own types.
pub type ProxyBody = http_body_util::combinators::BoxBody<Bytes, hyper::Error>;

/// Convert an in-memory byte slice into a [`ProxyBody`].
pub fn bytes_body(bytes: impl Into<Bytes>) -> ProxyBody {
    Full::new(bytes.into())
        .map_err(|never: std::convert::Infallible| match never {})
        .boxed()
}

impl FrameworkProxy {
    /// Build a proxy client. Loads the device-CA from
    /// `ca_path` as the only trust root for upstream TLS.
    pub fn new(upstream_host: String, upstream_port: u16, ca_path: &Path) -> io::Result<Self> {
        let ca_pem = fs::read(ca_path).map_err(|e| {
            io::Error::new(
                e.kind(),
                format!("device-CA read at {}: {e}", ca_path.display()),
            )
        })?;
        Self::from_ca_pem(
            upstream_host,
            upstream_port,
            &ca_pem,
            &ca_path.display().to_string(),
        )
    }

    /// Build a proxy client from already-read CA-bundle bytes.
    /// Split out of [`new`] so the hot-reload watcher can rebuild
    /// from the exact bytes it fingerprinted (no re-read race) and
    /// so both paths share one trust-root construction. `origin` is
    /// a human label for the bytes' source, used only in errors.
    pub fn from_ca_pem(
        upstream_host: String,
        upstream_port: u16,
        ca_pem: &[u8],
        origin: &str,
    ) -> io::Result<Self> {
        let mut roots = RootCertStore::empty();
        let mut reader = io::Cursor::new(ca_pem);
        for cert in rustls_pemfile::certs(&mut reader) {
            let cert = cert.map_err(|e| {
                io::Error::new(io::ErrorKind::InvalidData, format!("device-CA parse: {e}"))
            })?;
            roots.add(cert).map_err(|e| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("device-CA install: {e}"),
                )
            })?;
        }
        if roots.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("device-CA at {origin} contained no certificates"),
            ));
        }
        let client_config = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let rustls_connector = TlsConnector::from(Arc::new(client_config));
        Ok(Self {
            upstream_host,
            upstream_port,
            rustls_connector,
        })
    }

    /// SNI hostname used on the upstream TLS handshake.
    /// Pinned to `localhost` because the framework's leaf
    /// cert's SAN matches `localhost` + `127.0.0.1`.
    fn upstream_sni(&self) -> ServerName<'static> {
        ServerName::try_from("localhost").expect("localhost is a valid DNS name")
    }

    /// Open an authenticated TLS stream to the framework's
    /// loopback HTTPS listener.
    async fn open_tls(&self) -> io::Result<tokio_rustls::client::TlsStream<TcpStream>> {
        let tcp = TcpStream::connect((self.upstream_host.as_str(), self.upstream_port)).await?;
        let sni = self.upstream_sni();
        self.rustls_connector.connect(sni, tcp).await
    }

    /// Forward a non-WebSocket HTTP request to the framework.
    ///
    /// The upstream URL preserves the original path + query.
    /// The original client's IP is injected as
    /// `X-Forwarded-For` so the framework's trusted-proxy
    /// classifier sees the operator's real address.
    pub async fn proxy_http(
        &self,
        req: Request<Incoming>,
        peer_ip: IpAddr,
    ) -> Result<Response<ProxyBody>, ProxyError> {
        let (parts, body) = req.into_parts();
        let path_and_query = parts
            .uri
            .path_and_query()
            .map(|p| p.as_str().to_string())
            .unwrap_or_else(|| parts.uri.path().to_string());

        // Buffer the request body. Wire ops are small (JSON);
        // this is bounded by the framework's own body limits.
        let body_bytes = body
            .collect()
            .await
            .map_err(|e| ProxyError::ReadBody(e.to_string()))?
            .to_bytes();

        // Open the upstream TLS connection and send the
        // request over HTTP/1.1 manually. Using
        // `hyper_util::client::legacy::Client` with a custom
        // connector pinned to loopback works too, but the
        // direct approach keeps the dependency surface tight
        // and gives explicit control over the upstream Host
        // header.
        let mut tls = self.open_tls().await.map_err(ProxyError::UpstreamConnect)?;

        // Build the upstream request bytes.
        let mut head = format!("{} {} HTTP/1.1\r\n", parts.method.as_str(), path_and_query);
        // Host header — required by the framework's axum
        // listener. Use loopback + port so the upstream sees
        // a consistent value.
        head.push_str(&format!(
            "Host: {}:{}\r\n",
            self.upstream_host, self.upstream_port
        ));
        // Forward all client headers EXCEPT hop-by-hop +
        // ones we control explicitly.
        for (name, value) in parts.headers.iter() {
            let n = name.as_str().to_ascii_lowercase();
            if matches!(
                n.as_str(),
                "host"
                    | "connection"
                    | "keep-alive"
                    | "proxy-authenticate"
                    | "proxy-authorization"
                    | "te"
                    | "trailers"
                    | "transfer-encoding"
                    | "upgrade"
                    | "content-length"
                    | "x-forwarded-for"
            ) {
                continue;
            }
            if let Ok(v) = value.to_str() {
                head.push_str(&format!("{}: {}\r\n", name.as_str(), v));
            }
        }
        // Inject X-Forwarded-For with the operator's real IP.
        head.push_str(&format!("X-Forwarded-For: {peer_ip}\r\n"));
        head.push_str(&format!("Content-Length: {}\r\n", body_bytes.len()));
        head.push_str("Connection: close\r\n");
        head.push_str("\r\n");

        tls.write_all(head.as_bytes())
            .await
            .map_err(ProxyError::UpstreamWrite)?;
        if !body_bytes.is_empty() {
            tls.write_all(&body_bytes)
                .await
                .map_err(ProxyError::UpstreamWrite)?;
        }
        tls.flush().await.map_err(ProxyError::UpstreamWrite)?;

        // Read the upstream response into memory. Same
        // size-bounded justification as the request body.
        let mut buf = Vec::with_capacity(8 * 1024);
        tls.read_to_end(&mut buf)
            .await
            .map_err(ProxyError::UpstreamRead)?;

        parse_http_response(&buf).ok_or(ProxyError::Malformed)
    }

    /// Originate a plugin `request` wire op to the framework over the
    /// loopback TLS connection, anonymously. The framework trusts the
    /// loopback proxy origin and `audio.spectrum.set_demand` carries no
    /// capability gate (verified on-rig), so no bearer is presented.
    /// Used by the settings bridge so a UI knob that drives a device
    /// producer (the spectrum demand) actually reaches the device rather
    /// than only toggling the browser. Returns the DECODED wire-op
    /// response body (the framework wraps it as `{payload_b64: ...}`;
    /// this un-wraps it), so callers can validate what the plugin
    /// actually did - NOT just that the HTTP transport returned 2xx. A
    /// 2xx whose body is an `{error: ...}` envelope (no responder /
    /// plugin not yet admitted) maps to `Err(NotApplied)` (retryable).
    pub async fn originate_request(
        &self,
        shelf: &str,
        request_type: &str,
        inner_payload: &serde_json::Value,
    ) -> Result<serde_json::Value, ProxyError> {
        let payload_b64 = base64_encode(inner_payload.to_string().as_bytes());
        let body = serde_json::json!({
            "shelf": shelf,
            "request_type": request_type,
            "payload_b64": payload_b64,
        });
        let body_bytes =
            serde_json::to_vec(&body).map_err(|e| ProxyError::ReadBody(e.to_string()))?;

        let mut tls = self.open_tls().await.map_err(ProxyError::UpstreamConnect)?;
        let mut head = String::new();
        head.push_str("POST /api/v1/request HTTP/1.1\r\n");
        head.push_str(&format!(
            "Host: {}:{}\r\n",
            self.upstream_host, self.upstream_port
        ));
        head.push_str("Content-Type: application/json\r\n");
        head.push_str(&format!("Content-Length: {}\r\n", body_bytes.len()));
        head.push_str("Connection: close\r\n\r\n");
        tls.write_all(head.as_bytes())
            .await
            .map_err(ProxyError::UpstreamWrite)?;
        tls.write_all(&body_bytes)
            .await
            .map_err(ProxyError::UpstreamWrite)?;
        tls.flush().await.map_err(ProxyError::UpstreamWrite)?;

        let mut buf = Vec::with_capacity(4096);
        tls.read_to_end(&mut buf)
            .await
            .map_err(ProxyError::UpstreamRead)?;

        // Split head/body from the raw response ourselves so we can read
        // the body (parse_http_response wraps it into a streaming Body).
        let split = buf
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or(ProxyError::Malformed)?;
        let head = std::str::from_utf8(&buf[..split]).map_err(|_| ProxyError::Malformed)?;
        let status: u16 = head
            .lines()
            .next()
            .and_then(|l| l.split(' ').nth(1))
            .and_then(|s| s.parse().ok())
            .ok_or(ProxyError::Malformed)?;
        if !(200..300).contains(&status) {
            return Err(ProxyError::UpstreamRead(io::Error::other(format!(
                "framework returned status {status}"
            ))));
        }
        let body = &buf[split + 4..];
        // Body is a small JSON wire-op response. Parse directly; if the
        // transport framed it (chunked), fall back to the outermost { .. }.
        let outer: serde_json::Value = serde_json::from_slice(body)
            .ok()
            .or_else(|| {
                let s = body.iter().position(|&b| b == b'{')?;
                let e = body.iter().rposition(|&b| b == b'}')?;
                serde_json::from_slice(&body[s..=e]).ok()
            })
            .ok_or(ProxyError::Malformed)?;
        // Application error envelope over a 2xx transport => not applied.
        if let Some(err) = outer.get("error") {
            return Err(ProxyError::NotApplied(err.to_string()));
        }
        // Success bodies wrap the wire-op result as base64; un-wrap it.
        if let Some(b64) = outer.get("payload_b64").and_then(|v| v.as_str()) {
            let decoded = base64_decode(b64).ok_or(ProxyError::Malformed)?;
            return serde_json::from_slice(&decoded).map_err(|_| ProxyError::Malformed);
        }
        Ok(outer)
    }

    /// Open the upstream WebSocket and bridge to the
    /// client-side hyper-upgraded stream. The framework's
    /// `/api/v1/ws` endpoint validates auth + capability on
    /// the upgrade itself; the proxy just opens the same
    /// upgrade with the operator's `X-Forwarded-For` and
    /// pumps bytes both ways once both sides are connected.
    pub async fn proxy_ws_upgrade(
        &self,
        req: Request<Incoming>,
        peer_ip: IpAddr,
    ) -> Result<Response<ProxyBody>, ProxyError> {
        let (mut parts, _body) = req.into_parts();
        // Capture the upgrade future BEFORE destructuring
        // further. hyper installs `OnUpgrade` as a Parts
        // extension during the connection lifecycle; the
        // future resolves to the upgraded stream after we
        // send the 101 response below.
        let on_upgrade = parts
            .extensions
            .remove::<hyper::upgrade::OnUpgrade>()
            .ok_or(ProxyError::BadUpgrade("no OnUpgrade extension"))?;

        // Validate the client's upgrade headers + capture the
        // Sec-WebSocket-Key so we can compute the matching
        // Sec-WebSocket-Accept.
        let ws_key = parts
            .headers
            .get("sec-websocket-key")
            .and_then(|v| v.to_str().ok())
            .ok_or(ProxyError::BadUpgrade("missing Sec-WebSocket-Key"))?
            .to_string();

        // Open the upstream WS handshake. We do this BEFORE
        // sending 101 back to the client so we can surface
        // the upstream's status code directly on any failure.
        let mut tls = self.open_tls().await.map_err(ProxyError::UpstreamConnect)?;
        let upstream_key = generate_upstream_ws_key();
        let upstream_handshake = build_upstream_ws_handshake(
            &self.upstream_host,
            self.upstream_port,
            parts
                .uri
                .path_and_query()
                .map(|p| p.as_str())
                .unwrap_or("/api/v1/ws"),
            &upstream_key,
            peer_ip,
            &parts.headers,
        );
        tls.write_all(upstream_handshake.as_bytes())
            .await
            .map_err(ProxyError::UpstreamWrite)?;
        tls.flush().await.map_err(ProxyError::UpstreamWrite)?;

        // Read upstream response headers (one full
        // \r\n\r\n-terminated head). Bounded by 16 KiB.
        let mut head_buf = Vec::with_capacity(2048);
        let mut tmp = [0u8; 1];
        loop {
            let n = tls.read(&mut tmp).await.map_err(ProxyError::UpstreamRead)?;
            if n == 0 {
                return Err(ProxyError::UpstreamClosedEarly);
            }
            head_buf.push(tmp[0]);
            if head_buf.len() > 16 * 1024 {
                return Err(ProxyError::Malformed);
            }
            if head_buf.ends_with(b"\r\n\r\n") {
                break;
            }
        }
        let upstream_resp = parse_http_response(&head_buf).ok_or(ProxyError::Malformed)?;
        if upstream_resp.status() != StatusCode::SWITCHING_PROTOCOLS {
            // Surface the framework's status (e.g. 401) to
            // the client so the operator sees the real
            // refusal reason rather than a generic proxy
            // failure.
            return Ok(upstream_resp);
        }

        // Build the 101 response we send to the client. The
        // body is empty; hyper will hand us back the upgraded
        // stream on `hyper::upgrade::on(req)` after the
        // response writer flushes.
        let accept = compute_sec_websocket_accept(&ws_key);
        let mut response = Response::builder()
            .status(StatusCode::SWITCHING_PROTOCOLS)
            .header("connection", "upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-accept", accept);

        // Preserve subprotocol negotiation if the upstream
        // selected one (the framework's bearer-subprotocol
        // path uses this).
        if let Some(sp) = upstream_resp
            .headers()
            .get("sec-websocket-protocol")
            .cloned()
        {
            response = response.header("sec-websocket-protocol", sp);
        }

        // Spawn the byte-pump task. The client upgrade
        // resolves AFTER hyper writes the 101 response;
        // the task awaits the future and then forwards
        // bytes between the upgraded client stream and the
        // already-handshaked upstream TLS stream.
        tokio::spawn(pump_after_upgrade(on_upgrade, tls));

        response
            .body(bytes_body(Bytes::new()))
            .map_err(|e| ProxyError::ResponseBuild(e.to_string()))
    }
}

/// Compute the `Sec-WebSocket-Accept` header value from a
/// client-supplied `Sec-WebSocket-Key`, per the WebSocket
/// protocol (RFC 6455 §4.2.2): SHA-1(key + GUID) base64-
/// encoded.
fn compute_sec_websocket_accept(key: &str) -> String {
    // Implemented inline to avoid a separate sha1 + base64
    // crate dep — the framework's WS endpoint does the
    // same computation upstream, we just mirror it.
    const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let combined = format!("{key}{GUID}");
    let digest = sha1_digest(combined.as_bytes());
    base64_encode(&digest)
}

/// Tiny SHA-1 implementation. SHA-1 is broken for crypto but
/// is what the WS handshake spec mandates; this is wire
/// compatibility, not security.
fn sha1_digest(message: &[u8]) -> [u8; 20] {
    let mut state: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut padded = message.to_vec();
    let len_bits = (message.len() as u64).wrapping_mul(8);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&len_bits.to_be_bytes());

    for chunk in padded.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            let b0 = chunk[i * 4] as u32;
            let b1 = chunk[i * 4 + 1] as u32;
            let b2 = chunk[i * 4 + 2] as u32;
            let b3 = chunk[i * 4 + 3] as u32;
            w[i] = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) =
            (state[0], state[1], state[2], state[3], state[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e);
    }

    let mut out = [0u8; 20];
    for (i, word) in state.iter().enumerate() {
        out[i * 4..(i + 1) * 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// Base64 standard alphabet encoder (no padding-free
/// variants). Sufficient for the small `Sec-WebSocket-Accept`
/// value (28 chars output for a 20-byte digest).
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let b0 = bytes[i] as u32;
        let b1 = bytes[i + 1] as u32;
        let b2 = bytes[i + 2] as u32;
        let v = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((v >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((v >> 12) & 0x3F) as usize] as char);
        out.push(ALPHABET[((v >> 6) & 0x3F) as usize] as char);
        out.push(ALPHABET[(v & 0x3F) as usize] as char);
        i += 3;
    }
    let rem = bytes.len() - i;
    if rem == 1 {
        let v = (bytes[i] as u32) << 16;
        out.push(ALPHABET[((v >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((v >> 12) & 0x3F) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let v = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(ALPHABET[((v >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((v >> 12) & 0x3F) as usize] as char);
        out.push(ALPHABET[((v >> 6) & 0x3F) as usize] as char);
        out.push('=');
    }
    out
}

/// Decode standard base64 (with or without `=` padding). Returns
/// `None` on any invalid character. Used to read the framework's
/// `payload_b64`-wrapped wire-op response bodies.
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc = 0u32;
    let mut n = 0u32;
    for &c in s.as_bytes() {
        if c == b'=' || c == b'\r' || c == b'\n' {
            continue;
        }
        acc = (acc << 6) | val(c)?;
        n += 6;
        if n >= 8 {
            n -= 8;
            out.push((acc >> n) as u8);
        }
    }
    Some(out)
}

/// Generate a fresh `Sec-WebSocket-Key` (16 random bytes
/// base64-encoded) for the upstream handshake. The framework
/// only uses the key shape, not its contents, so a
/// time-derived value is sufficient.
fn generate_upstream_ws_key() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let mut bytes = [0u8; 16];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = ((nanos.wrapping_mul((i as u64) + 1)) & 0xff) as u8;
    }
    base64_encode(&bytes)
}

/// Assemble the upstream WebSocket upgrade request line +
/// headers. Includes the operator's `X-Forwarded-For` and
/// forwards every client header except hop-by-hop ones.
fn build_upstream_ws_handshake(
    host: &str,
    port: u16,
    path: &str,
    key: &str,
    peer_ip: IpAddr,
    client_headers: &hyper::HeaderMap,
) -> String {
    let mut out = format!("GET {path} HTTP/1.1\r\n");
    out.push_str(&format!("Host: {host}:{port}\r\n"));
    out.push_str("Connection: Upgrade\r\n");
    out.push_str("Upgrade: websocket\r\n");
    out.push_str("Sec-WebSocket-Version: 13\r\n");
    out.push_str(&format!("Sec-WebSocket-Key: {key}\r\n"));
    out.push_str(&format!("X-Forwarded-For: {peer_ip}\r\n"));
    // Forward Sec-WebSocket-Protocol (bearer subprotocol
    // path used by external API consumers) + Authorization
    // header (Bearer-header path).
    for header_name in ["sec-websocket-protocol", "authorization"] {
        if let Some(v) = client_headers.get(header_name) {
            if let Ok(s) = v.to_str() {
                out.push_str(&format!("{header_name}: {s}\r\n"));
            }
        }
    }
    out.push_str("\r\n");
    out
}

/// After hyper sends 101 to the client, this task pumps
/// bytes between the client's upgraded duplex and the
/// upstream's TLS stream.
///
/// LIVENESS CONTRACT (2026-07-18): the framework's WS endpoint
/// pings every 15s and reaps a peer after 30s of silence. Those
/// pings traverse this pump as ordinary bytes, so a dead browser
/// client surfaces as a write error here within one ping interval
/// (killed process => immediate RST), copy_bidirectional shuts the
/// upstream down, and the framework releases any single-holder
/// role (user_interaction_responder) the session held. Verified
/// end to end through this proxy on the bench. Residual gap:
/// a silent network partition (cable pull) is bounded by the OS
/// TCP retransmit timeout rather than 30s; if that ever matters,
/// enable TCP keepalive on both sockets (needs socket2).
///
/// Uses `tokio::io::copy_bidirectional` so that when EITHER
/// peer closes its end (the browser tab unloads, or the
/// framework drops the subscription), the EOF on one
/// reader triggers `shutdown()` on the opposite writer,
/// propagating the close. Previously the pump ran two
/// `tokio::io::copy` futures in a `select!` and silently
/// dropped the loser, leaving the upstream WS connection
/// alive after a client close - which the framework saw
/// as a permanently-subscribed consumer of every fan-out
/// happening (notably the 30Hz spectrum subject), one new
/// leaked subscription per browser tab the operator ever
/// opened. Verified on the rigs: 8-10 upstream WS sessions
/// vs a single open UI tab, evo-device-audio at 20-55%
/// CPU when it should be near-idle.
async fn pump_after_upgrade(
    on_upgrade: hyper::upgrade::OnUpgrade,
    mut upstream: tokio_rustls::client::TlsStream<TcpStream>,
) {
    let client_upgraded = match on_upgrade.await {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!(error = %e, "client WS upgrade failed");
            return;
        }
    };
    let mut client_io = hyper_util::rt::TokioIo::new(client_upgraded);
    match tokio::io::copy_bidirectional(&mut client_io, &mut upstream).await {
        Ok((to_upstream, to_client)) => {
            tracing::debug!(to_upstream, to_client, "ws pump ended cleanly");
        }
        Err(e) => {
            tracing::debug!(error = %e, "ws pump ended with error");
        }
    }
    // Best-effort shutdown on whichever side did not initiate
    // the close - copy_bidirectional already calls shutdown on
    // the opposing writer when one reader hits EOF, but on
    // some error paths the upstream half may still be open.
    // A second shutdown is idempotent + cheap.
    let _ = upstream.shutdown().await;
}

/// Parse a raw HTTP/1.1 response (response line + headers +
/// body) into a `hyper::Response`. The framework's responses
/// are small JSON; we read the whole thing into memory and
/// pass it through.
fn parse_http_response(bytes: &[u8]) -> Option<Response<ProxyBody>> {
    // Find the header/body split.
    let split = bytes.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&bytes[..split]).ok()?;
    let body_start = split + 4;
    let body_bytes = Bytes::copy_from_slice(&bytes[body_start..]);

    let mut lines = head.split("\r\n");
    let status_line = lines.next()?;
    let mut sl_parts = status_line.splitn(3, ' ');
    let _version = sl_parts.next()?;
    let status_code: u16 = sl_parts.next()?.parse().ok()?;
    let _reason = sl_parts.next().unwrap_or("");

    let mut builder = Response::builder().status(status_code);
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, ':');
        let name = parts.next()?.trim();
        let value = parts.next()?.trim();
        // Strip hop-by-hop headers — the operator's browser
        // is the next hop, not the framework's loopback peer.
        let lname = name.to_ascii_lowercase();
        if matches!(
            lname.as_str(),
            "connection"
                | "keep-alive"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailers"
                | "transfer-encoding"
                | "upgrade"
                | "content-length"
        ) {
            continue;
        }
        builder = builder.header(name, value);
    }
    // Recompute Content-Length from the buffered body.
    builder = builder.header("content-length", body_bytes.len());
    builder.body(bytes_body(body_bytes)).ok()
}

/// Errors raised by [`FrameworkProxy`] operations.
#[derive(Debug)]
pub enum ProxyError {
    /// Failed to open the upstream TLS connection.
    UpstreamConnect(io::Error),
    /// Failed to write the upstream request.
    UpstreamWrite(io::Error),
    /// Failed to read the upstream response.
    UpstreamRead(io::Error),
    /// Upstream closed before sending the full handshake.
    UpstreamClosedEarly,
    /// Failed to read the inbound request body.
    ReadBody(String),
    /// Malformed upstream response head.
    Malformed,
    /// Client upgrade request was not a valid WebSocket
    /// upgrade.
    BadUpgrade(&'static str),
    /// Failed to build the proxy response.
    ResponseBuild(String),
    /// The framework returned HTTP 2xx but the wire-op body was an
    /// error/not-applied envelope (e.g. no responder, plugin not yet
    /// admitted, application error). RETRYABLE - the request did not
    /// take effect even though the transport succeeded.
    NotApplied(String),
}

impl std::fmt::Display for ProxyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UpstreamConnect(e) => write!(f, "upstream connect failed: {e}"),
            Self::UpstreamWrite(e) => write!(f, "upstream write failed: {e}"),
            Self::UpstreamRead(e) => write!(f, "upstream read failed: {e}"),
            Self::UpstreamClosedEarly => f.write_str("upstream closed during handshake"),
            Self::ReadBody(e) => write!(f, "read request body failed: {e}"),
            Self::Malformed => f.write_str("malformed upstream response"),
            Self::BadUpgrade(reason) => write!(f, "bad WS upgrade: {reason}"),
            Self::ResponseBuild(e) => write!(f, "response build failed: {e}"),
            Self::NotApplied(detail) => {
                write!(f, "wire-op not applied (2xx but error body): {detail}")
            }
        }
    }
}

impl std::error::Error for ProxyError {}

/// Treat a proxy error as a `502 Bad Gateway` response so the
/// operator's browser sees a clean failure mode rather than
/// a connection reset.
pub fn proxy_error_response(err: ProxyError) -> Response<ProxyBody> {
    let msg = format!("upstream proxy failed: {err}");
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header("content-type", "text/plain; charset=utf-8")
        .body(bytes_body(Bytes::from(msg)))
        .expect("502 builder")
}

/// True when the request is a WebSocket upgrade request for
/// the framework's `/api/v1/ws` path.
pub fn is_framework_ws_upgrade(req: &Request<Incoming>) -> bool {
    if req.method() != Method::GET {
        return false;
    }
    if req.uri().path() != "/api/v1/ws" {
        return false;
    }
    is_upgrade_request(req)
}

/// True when the request carries the standard WebSocket
/// upgrade headers.
fn is_upgrade_request<B>(req: &Request<B>) -> bool {
    fn hv_contains_token(value: Option<&hyper::header::HeaderValue>, token: &str) -> bool {
        match value.and_then(|v| v.to_str().ok()) {
            Some(s) => s.split(',').any(|p| p.trim().eq_ignore_ascii_case(token)),
            None => false,
        }
    }
    hv_contains_token(req.headers().get("connection"), "upgrade")
        && hv_contains_token(req.headers().get("upgrade"), "websocket")
}

/// True when the request targets a framework HTTP wire-op
/// path (`/api/v1/*` minus the WS upgrade).
pub fn is_framework_http(uri: &Uri) -> bool {
    let path = uri.path();
    path == "/api/v1" || path.starts_with("/api/v1/")
}

#[cfg(test)]
mod applied_decode_tests {
    use super::base64_decode;

    // Mirrors the real terminus set_demand SUCCESS body: the outer wire-op
    // response wraps the result as base64. Validation reads applied.enabled
    // from the DECODED inner payload, so this decode path is load-bearing.
    #[test]
    fn payload_b64_decodes_to_applied_envelope() {
        // {"applied":{"bins":256,"channels":2,"enabled":true,
        //   "rate_hz_target":30,"updated_at_ms":1,"v":1},"v":1}
        let inner = serde_json::json!({
            "applied": {
                "bins": 256, "channels": 2, "enabled": true,
                "rate_hz_target": 30, "updated_at_ms": 1u64, "v": 1
            },
            "v": 1
        });
        let raw = serde_json::to_vec(&inner).unwrap();
        let b64 = super::base64_encode(&raw);
        let decoded = base64_decode(&b64).expect("valid base64");
        let round: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(
            round
                .get("applied")
                .and_then(|a| a.get("enabled"))
                .and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn base64_decode_rejects_invalid_and_accepts_padding_and_newlines() {
        assert!(base64_decode("@@@@").is_none());
        // "hi" -> aGk= ; tolerate wrapped whitespace + padding.
        assert_eq!(base64_decode("aG\r\nk=").unwrap(), b"hi");
    }
}
