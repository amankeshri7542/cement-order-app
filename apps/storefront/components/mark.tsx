/** Three starter bars on a slab: the sariya left on the roof for the next floor. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="currentColor">
      <path d="M3 24h26v5H3zM14.4 24V4.7l3.2-2.2V24zM5.7 24V12.3H2.6V9.4h6.3V24zM23.1 24V9.4h6.3v2.9h-3.1V24z" />
    </svg>
  );
}
