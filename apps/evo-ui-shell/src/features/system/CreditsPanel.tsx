// Settings > About > Credits - curated legal / attribution registry.
//
// The formal home for provider licenses and terms. Every online provider
// that can supply metadata or artwork on this device is listed here with
// its license and a reference to its terms, so the widgets carry only a
// light "Source: name" + QR while the legal detail lives in one auditable
// place. Row order: QR (left), then the type block (provider, what it
// provides, license), then the URL as text. References obey the same
// kiosk-safe attribution mode - QR by default, a live link only off-kiosk
// - so a fullscreen browser is never stranded.
//
// NOT LEGAL ADVICE: the license labels and terms URLs below are curated
// and should be verified against each provider's current terms.

import { ExternalLink } from "lucide-preact";
import { useLocale } from "../../runtime/use-locale";
import { t } from "../../runtime/i18n";
import { attributionMode } from "../playback/attribution-mode";
import { QrCode } from "../playback/QrCode";

interface Credit {
  provider: string;
  provides: string;
  license: string;
  url: string;
  keyed: boolean;
}

const CREDITS: ReadonlyArray<Credit> = [
  { provider: "MusicBrainz", provides: "Metadata, credits, provenance", license: "CC0 1.0", url: "https://musicbrainz.org/doc/About/Data_License", keyed: false },
  { provider: "Wikipedia", provides: "Artist bios, album notes", license: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/", keyed: false },
  { provider: "Wikidata", provides: "Facts", license: "CC0 1.0", url: "https://www.wikidata.org/wiki/Wikidata:Licensing", keyed: false },
  { provider: "Cover Art Archive", provides: "Album artwork", license: "Cover Art Archive terms", url: "https://coverartarchive.org", keyed: false },
  { provider: "iTunes (Apple)", provides: "Album artwork fallback", license: "Apple Media Services terms", url: "https://www.apple.com/legal/internet-services/itunes/", keyed: false },
  { provider: "LRCLIB", provides: "Lyrics", license: "LRCLIB terms", url: "https://lrclib.net", keyed: false },
  { provider: "TheAudioDB", provides: "Bios, artwork", license: "TheAudioDB terms", url: "https://www.theaudiodb.com", keyed: false },
  { provider: "Deezer", provides: "Artist images", license: "Deezer terms", url: "https://developers.deezer.com/termsofuse", keyed: false },
  { provider: "Last.fm", provides: "Artist bios, album notes", license: "Last.fm API Terms of Service", url: "https://www.last.fm/api/tos", keyed: true },
  { provider: "Discogs", provides: "Album notes, credits", license: "Discogs Terms of Use", url: "https://www.discogs.com/developers", keyed: true },
  { provider: "Genius", provides: "Lyrics annotations", license: "Genius API terms", url: "https://genius.com/api-clients", keyed: true },
  { provider: "fanart.tv", provides: "Artist artwork", license: "fanart.tv terms", url: "https://fanart.tv", keyed: true }
];

export function CreditsPanel() {
  useLocale();
  const mode = attributionMode();
  return (
    <div className="credits-panel">
      <h4 className="credits-title">{t("settings.about.credits.title")}</h4>
      <p className="feature-description">{t("settings.about.credits.intro")}</p>
      <ul className="credits-list">
        {[...CREDITS]
          .sort((a, b) =>
            a.provider.localeCompare(b.provider, undefined, {
              sensitivity: "base"
            })
          )
          .map((c) => (
          <li key={c.provider} className="credit-row">
            {mode === "qr" ? <QrCode url={c.url} size={78} /> : null}
            <div className="credit-col">
              <div className="credit-head">
                <span className="credit-provider">{c.provider}</span>
                <span
                  className={
                    c.keyed ? "credit-badge credit-badge-keyed" : "credit-badge"
                  }
                >
                  {c.keyed
                    ? t("settings.about.credits.keyed")
                    : t("settings.about.credits.keyless")}
                </span>
              </div>
              <span className="credit-provides">{c.provides}</span>
              <span className="credit-license">{c.license}</span>
              {mode === "link" ? (
                <a
                  className="contextual-source-link credit-url"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink size={12} />
                  {c.url}
                </a>
              ) : (
                <span className="credit-url">{c.url}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
