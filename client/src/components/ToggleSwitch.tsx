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
        // 2px inset from the track on all four sides, confirmed via actual
        // getBoundingClientRect() measurement (not just the math): track is
        // 36x20px, knob is 16x16px, so "on" needs an 18px translate (not on
        // Tailwind's own scale) to land symmetric with "off"'s 2px — the
        // original translate-x-4 (16px) left a lopsided 4px gap on the
        // right against 2px on the left. Separately, no `shadow` here on
        // purpose: Tailwind's default shadow casts down-and-right, so even
        // with the box itself perfectly centered, the shadow's own visible
        // blur made the bottom read as flush/no-gap against the track —
        // confirmed by the measured geometry being symmetric while it still
        // *looked* uneven. A flat knob avoids that illusion entirely.
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-150 ${
          on ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}
