export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-64 animate-pulse rounded bg-ink-800" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-ink-800/70" />)}</div>
      <div className="h-72 animate-pulse rounded-xl bg-ink-800/50" />
    </div>
  );
}
