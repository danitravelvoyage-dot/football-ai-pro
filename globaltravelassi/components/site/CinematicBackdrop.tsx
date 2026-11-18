/**
 * Layered navy backdrop: drifting gold light, a fine vignette and an arched-bridge silhouette
 * inspired by the Old Bridge of Mostar. Pure CSS/SVG: no image downloads, so it loads instantly.
 */
export function CinematicBackdrop({ variant = "hero" }: { variant?: "hero" | "band" }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-navy-950 via-navy-900 to-navy-800" />
      <div className="light-drift absolute -top-1/4 start-1/2 h-[140%] w-[140%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(217,183,106,0.22)_0%,rgba(217,183,106,0.06)_38%,transparent_65%)] rtl:translate-x-1/2" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />
      <svg
        className={`arch-draw absolute inset-x-0 bottom-0 w-full text-gold-400/35 ${variant === "hero" ? "h-40 sm:h-56" : "h-32 sm:h-44"}`}
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M0 220 V150 Q90 40 180 150 T360 150 T540 150 T720 150 T900 150 T1080 150 T1260 150 T1440 150 V220 Z"
          fill="rgba(5,13,27,0.75)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M0 176 H1440" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(5,13,27,0.7)_100%)]" />
    </div>
  );
}
