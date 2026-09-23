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
// This modal never mints or holds a bearer. A session with no bearer is
// refused before any dispatch (the hook's pair-first refusal); the modal
// then offers the EXISTING pair door in place - never a second password
// card - and Save is asked again once the bearer is stored.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { ShieldCheck, Lock, X } from "lucide-preact";
import { AttentionOverlay } from "../../components/AttentionLayer";
import { t } from "../../runtime/i18n";
import { useLocale } from "../../runtime/use-locale";
import { groupsForLevel, type HouseholdLevel } from "./household-protection";
import { levelWord, groupWord } from "./household-copy";
import { PairDeviceFlow } from "../pairing/PairDeviceFlow";
import type { HouseholdProtection, HouseholdSetResult } from "./useHouseholdProtection";

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
  // The hook refused the last write locally (no stored bearer): offer the
  // existing pair door. Cleared by a write that was not refused that way.
  const [needsPair, setNeedsPair] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

  // The host only mounts this once the snapshot has loaded; never paint an
  // empty guarded modal.
  if (snap === null) return null;

  const settle = (r: HouseholdSetResult): void => {
    if (r.ok) {
      setNeedsPair(false);
      onClose();
      return;
    }
    setNeedsPair(r.pairRequired === true);
  };
  const save = async (): Promise<void> => {
    settle(await hh.set({ level: selected, lend: snap.lend }));
  };
  const startLend = async (): Promise<void> => {
    settle(await hh.set({ level: snap.level, lend: true }));
  };
  const stopLend = async (): Promise<void> => {
    // Unlock: lend:false, level omitted, so the Framework restores prior_level.
    settle(await hh.unlock());
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
            {needsPair ? (
              <button
                type="button"
                className="settings-link-button"
                onClick={() => setPairOpen(true)}
              >
                {t("pairing.settings.label")}
              </button>
            ) : null}
          </div>
        ) : null}
        {pairOpen ? (
          // The one existing pair door, in place: the stored bearer then
          // rides the bearer bus into every socket; the operator presses
          // Save again. Not a second password card.
          <PairDeviceFlow
            onClose={() => setPairOpen(false)}
            onPaired={() => {
              // Paired: the door closes and the pair-first line goes with
              // it. No save, no dispatch - the operator presses Save.
              setPairOpen(false);
              setNeedsPair(false);
              hh.clearPairFirst();
            }}
          />
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
