/**
 * The one motion cue every in-flight request gets, next to the label that
 * already says what is happening. Uses `currentColor` so it always matches
 * the text it sits beside, and collapses to a static ring under the sitewide
 * `prefers-reduced-motion` rule in globals.css.
 */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 shrink-0 animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
