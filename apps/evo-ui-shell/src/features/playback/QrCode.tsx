// On-device QR of a source URL - generated locally, works offline. Drawn
// on a fixed white field regardless of theme so it stays scannable in dark
// mode (scanners want dark modules on a light ground).

import qrcode from "qrcode-generator";

export function QrCode({ url, size = 92 }: { url: string; size?: number }) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const src = qr.createDataURL(4, 2);
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        imageRendering: "pixelated",
        background: "#fff",
        padding: "6px",
        borderRadius: "6px"
      }}
    />
  );
}
