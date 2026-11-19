export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[60svh] flex-col items-center justify-center gap-5 px-4">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden className="size-14 animate-pulse text-champagne-400">
        <circle cx="24" cy="24" r="22.25" stroke="currentColor" strokeWidth="1.25" opacity="0.45" />
        <path d="M13 37V23a11 11 0 0 1 22 0v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="24" cy="18.5" r="1.9" fill="currentColor" />
      </svg>
      <span className="sr-only">Loading</span>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-mist-200">
        <div className="h-full w-1/2 animate-[shimmer_1.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-champagne-400 to-transparent" />
      </div>
    </div>
  );
}
