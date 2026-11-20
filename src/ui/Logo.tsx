/** The castle of the speeltuin with its name, as on burchttercleeff.nl. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img src="/icon.svg" alt="" width={40} height={40} className="h-10 w-10 rounded-lg" />
      <span className="text-lg font-bold tracking-[0.18em] text-ink">BURCHT TER CLEEFF</span>
    </span>
  );
}
