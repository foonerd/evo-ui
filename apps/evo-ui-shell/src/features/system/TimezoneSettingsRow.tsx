// TimezoneSettingsRow - the device's time zone on the System group, next
// to the language row.
//
// On open it reads the zone in force and the zones a set would apply,
// once each. A failed read names no zone and gives no picker - a line says
// what could not be read. Choosing a name from the device's list sends the
// set once; while it waits on the device the row is busy and sends nothing.
// The answer is the zone shown. A household lock paints the locked line and
// opens the one household door; any other refusal is shown as given.

import { useEffect, useState } from "preact/hooks";
import { useSystemTimezone } from "./useSystemTimezone";
import { timezoneSetPayload } from "./timezone";
import { EvoSelect } from "../../components/EvoSelect";
import { isHouseholdLocked } from "../../runtime/authz-classify";
import { useHouseholdModal } from "../household/HouseholdModalHost";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";

export function TimezoneSettingsRow() {
  useLocale();
  const { getTimezone, listTimezones, setTimezone } = useSystemTimezone();
  // The one household door (null without a host, e.g. designer / tests:
  // then the line alone says what happened).
  const household = useHouseholdModal();
  const [zone, setZone] = useState<string | null>(null);
  const [zoneUnread, setZoneUnread] = useState<boolean>(false);
  const [zones, setZones] = useState<string[] | null>(null);
  const [listUnread, setListUnread] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const g = await getTimezone();
      if (cancelled) return;
      if (g.ok) {
        setZone(g.value);
      } else {
        setZoneUnread(true);
      }
    })();
    void (async () => {
      const l = await listTimezones();
      if (cancelled) return;
      if (l.ok) {
        setZones(l.value);
      } else {
        setListUnread(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Read once when the row opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChoose = async (name: string): Promise<void> => {
    if (busy) return;
    if (timezoneSetPayload(name, zones) === null) return;
    setNote(null);
    setBusy(true);
    const r = await setTimezone(name, zones);
    setBusy(false);
    if (r.ok) {
      setZone(r.value);
      setZoneUnread(false);
      return;
    }
    if (isHouseholdLocked(r)) {
      // Locked, not refused: the household line, and the door that can
      // resolve it.
      setNote(t("household.locked.body"));
      if (household !== null) household.open();
      return;
    }
    setNote(r.message);
  };

  return (
    <div className="settings-row">
      <span className="settings-label-text">{t("settings.timezone.title")}</span>
      <p className="feature-description settings-help">
        {zone !== null ? zone : zoneUnread ? t("settings.timezone.unread") : t("settings.unknown")}
      </p>
      {zones === null ? (
        listUnread ? (
          <p className="feature-description settings-help" role="status">
            {t("settings.timezone.listUnread")}
          </p>
        ) : null
      ) : (
        <EvoSelect
          ariaLabel={t("settings.timezone.title")}
          value={zone !== null && zones.includes(zone) ? zone : ""}
          disabled={busy}
          options={[
            ...(zone !== null && zones.includes(zone) ? [] : [{ value: "", label: t("settings.timezone.choose") }]),
            ...zones.map((z) => ({ value: z, label: z }))
          ]}
          onChange={(v) => void onChoose(v)}
        />
      )}
      <p className="feature-description settings-help">{t("settings.timezone.help")}</p>
      {busy ? (
        <p className="feature-description settings-help" role="status">{t("settings.timezone.setting")}</p>
      ) : null}
      {note !== null ? (
        <p className="feature-description settings-help" role="alert">{note}</p>
      ) : null}
    </div>
  );
}
