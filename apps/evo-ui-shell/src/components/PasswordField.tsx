// PasswordField - a password input with a show/hide reveal toggle.
// One component so every credential field in the shell has the same
// affordance (operators asked for "show" on all password fields).

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { Eye, EyeOff } from "lucide-preact";
import { t } from "../runtime/i18n";

export function PasswordField({
  value,
  onInput,
  onKeyDown,
  className,
  placeholder,
  ariaLabel,
  autofocus,
  disabled
}: {
  value: string;
  onInput: (v: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  autofocus?: boolean;
  disabled?: boolean;
}): JSX.Element {
  const [reveal, setReveal] = useState(false);
  return (
    <span className="password-field">
      <input
        className={className}
        type={reveal ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autofocus={autofocus}
        disabled={disabled}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => onKeyDown?.(e as unknown as KeyboardEvent)}
      />
      <button
        type="button"
        className="password-reveal-button"
        aria-label={reveal ? t("password.hide") : t("password.show")}
        aria-pressed={reveal}
        disabled={disabled}
        onClick={() => setReveal((r) => !r)}
      >
        {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );
}
