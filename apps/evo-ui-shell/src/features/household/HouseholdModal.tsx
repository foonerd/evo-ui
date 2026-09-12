// HouseholdModal - THE one household-protection modal (glass + browser).
//
// It is not a route and not a QR/Pair screen. It rides the shared attention
// layer on the dialog band, so it portals over the shell with the player
// chrome LIVE underneath (music keeps playing). First paint (chosen:false)
// is guarded - no ESC, no backdrop dismiss - because the operator must
// choose; opened from the Settings door it is dismissible.
//
// The four levels + the group marks under each come from the wire catalog;
// the operator words are fixed. Saving dispatches household_protection_set
// through transport.dispatch, so a widening set the framework gates raises
// the ONE operator-password card (StepUpHost) and retries with the token.
// This modal never mints or holds a bearer and never opens Pair.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { ShieldCheck, Lock, X } from "lucide-preact";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { groupsForLevel, type HouseholdLevel } from "./household-protection";
import { levelWord, groupWord } from "./household-copy";
import type { HouseholdProtection } from "./useHouseholdProtection";

export interface HouseholdModalProps {
  hh: HouseholdProtection;
  /** Manual open (Settings door) is dismissible; the first-paint gate is
   *  not - only choosing a level resolves it. */
  dismissible: boolean;
  onClose: () => void;
}

export function HouseholdModal({
  hh,
  dismissible,
  onClose
}: HouseholdModalProps): JSX.Element | null {
  useLocale();
  const snap = hh.snapshot;
  // Seed the selection from the current level; the operator's in-flight pick
  // is not yanked by a happening while the modal is open (remount re-seeds).
  const [selected, setSelected] = useState<HouseholdLevel>(snap?.level ?? "open");

  // The host only mounts this once the snapshot has loaded; never paint an
  // empty guarded modal.
  if (snap === null) return null;

  const save = async (): Promise<void> => {
    const r = await hh.set({ level: selected, lend: snap.lend });
    if (r.ok) onClose();
  };
  const startLend = async (): Promise<void> => {
    const r = await hh.set({ level: snap.level, lend: true });
    if (r.ok) onClose();
  };
  const stopLend = async (): Promise<void> => {
    // Unlock: lend:false, level omitted, so the Framework restores prior_level.
    const r = await hh.unlock();
    if (r.ok) onClose();
  };

  return (
    <AttentionOverlay
      band="dialog"
      className="evo-modal-root"
      role="dialog"
      ariaLabel={t("household.title")}
      onDismiss={dismissible ? onClose : undefined}
      dismissOnBackdrop={dismissible}
    >
      <div className="evo-modal-card household-card" role="document">
        <div className="evo-modal-head">
          <h4 className="evo-modal-title">
            <ShieldCheck size={18} aria-hidden /> {t("household.title")}
          </h4>
          {dismissible ? (
            <button
              type="button"
              className="evo-modal-close"
              onClick={onClose}
              aria-label={t("dialog.close")}
              title={t("dialog.close")}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>

        <p className="evo-modal-body">{t("household.intro")}</p>

        <ul
          className="household-levels"
          role="radiogroup"
          aria-label={t("household.title")}
        >
          {snap.catalog.levels.map((lvl) => {
            const isSel = lvl.id === selected;
            const marks = groupsForLevel(snap.catalog, lvl.id);
            return (
              <li key={lvl.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  className={
                    isSel
                      ? "household-level household-level-selected"
                      : "household-level"
                  }
                  onClick={() => setSelected(lvl.id)}
                  disabled={hh.busy}
                >
                  <span className="household-level-word">
                    {levelWord(lvl.id)}
                  </span>
                  <span className="household-level-marks">
                    {marks.length === 0 ? (
                      t("household.locksNothing")
                    ) : (
                      <>
                        <span className="household-locks-label">
                          {t("household.locksLabel")}
                        </span>
                        {marks.map((g) => (
                          <span key={g} className="household-mark">
                            {groupWord(g)}
                          </span>
                        ))}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {hh.error !== null ? (
          <div className="audio-options-setter-error" role="alert">
            <span>{hh.error}</span>
          </div>
        ) : null}

        <div className="evo-modal-actions">
          {dismissible ? (
            <button
              type="button"
              className="evo-modal-button evo-modal-button-secondary"
              onClick={onClose}
              disabled={hh.busy}
            >
              {t("dialog.cancel")}
            </button>
          ) : null}
          <button
            type="button"
            className="evo-modal-button evo-modal-button-primary"
            onClick={() => void save()}
            disabled={hh.busy}
          >
            {t("household.save")}
          </button>
        </div>

        <div className="household-lend">
          {snap.lend ? (
            <>
              <p className="household-lend-on">
                <Lock size={14} aria-hidden /> {t("household.lend.on")}
              </p>
              <button
                type="button"
                className="settings-link-button"
                onClick={() => void stopLend()}
                disabled={hh.busy}
              >
                {t("household.lend.stop")}
              </button>
            </>
          ) : (
            <>
              <p className="evo-modal-hint">{t("household.lend.hint")}</p>
              <button
                type="button"
                className="settings-link-button"
                onClick={() => void startLend()}
                disabled={hh.busy}
              >
                {t("household.lend.start")}
              </button>
            </>
          )}
        </div>
      </div>
    </AttentionOverlay>
  );
}
