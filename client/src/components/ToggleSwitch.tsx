interface Props {
  on: boolean;
  /** Track color while on — defaults to red, matching this app's existing
   * recording-indicator color language (the ⏺ marker, the recording ring
   * around an avatar, etc.). Override for a toggle representing something
   * other than "recording". */
  activeColorClassName?: string;
}

/**
 * Purely presentational — a `<span>`, not a `<button>` of its own. The
 * actual click target and accessible label are whatever row already wraps
 * it (see CreatorOptionsMenu's Record now/Stop recording row); nesting a
 * real interactive control in here would mean a button inside a button.
 */
export default function ToggleSwitch({ on, activeColorClassName = "bg-red-600" }: Props) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        on ? activeColorClassName : "bg-base-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 ${
          on ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}
