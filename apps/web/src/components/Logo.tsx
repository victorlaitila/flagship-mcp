/** The Flagship brand mark: one request splitting into an on and an off variant. Neutral parts use currentColor. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <path d="M7 16h5c5 0 5-7 10-7M12 16c5 0 5 7 10 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="6" cy="16" r="3.5" fill="currentColor" />
      <circle cx="25" cy="9" r="3.75" className="fill-on" />
      <circle cx="25" cy="23" r="3" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
    </svg>
  );
}
