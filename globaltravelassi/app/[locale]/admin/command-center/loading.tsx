export default function CommandCenterLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4 py-10 text-start">
      <div className="h-6 w-1/3 animate-pulse rounded-full bg-navy-100" />
      <div className="h-32 animate-pulse rounded-2xl bg-navy-50" />
      <div className="h-32 animate-pulse rounded-2xl bg-navy-50" />
    </div>
  );
}
