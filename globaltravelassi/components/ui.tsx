import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Section({ children, className, id, dark }: { children: ReactNode; className?: string; id?: string; dark?: boolean }) {
  return (
    <section id={id} className={cx("py-16 sm:py-24", dark ? "bg-navy-900 text-white" : "bg-white text-navy-900", className)}>
      {children}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, subtitle, dark, align = "start" }: {
  eyebrow?: string; title: string; subtitle?: string; dark?: boolean; align?: "start" | "center";
}) {
  return (
    <div className={cx("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-gold-500">{eyebrow}</p>}
      <h2 className={cx("font-display text-3xl font-semibold leading-tight sm:text-4xl", dark ? "text-white" : "text-navy-900")}>{title}</h2>
      <span className="gold-rule mt-5 block h-px w-16" aria-hidden />
      {subtitle && <p className={cx("mt-5 text-base leading-relaxed sm:text-lg", dark ? "text-navy-100" : "text-navy-600")}>{subtitle}</p>}
    </div>
  );
}

type ButtonVariant = "gold" | "navy" | "outline" | "ghost" | "whatsapp";
const buttonBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-base font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-300/60 disabled:cursor-not-allowed disabled:opacity-60";
const buttonVariants: Record<ButtonVariant, string> = {
  gold: "bg-gradient-to-b from-gold-400 to-gold-500 text-navy-950 shadow-lg shadow-gold-500/20 hover:-translate-y-0.5 hover:shadow-gold-400/40",
  navy: "bg-navy-800 text-white hover:bg-navy-700 hover:-translate-y-0.5",
  outline: "border border-gold-400/70 text-gold-300 hover:bg-gold-400/10",
  ghost: "text-navy-700 hover:bg-navy-50",
  whatsapp: "bg-[#25D366] text-white hover:bg-[#1ebe5a] hover:-translate-y-0.5",
};

export function buttonClass(variant: ButtonVariant = "gold", extra?: string) {
  return cx(buttonBase, buttonVariants[variant], extra);
}

export function ButtonLink({ href, variant = "gold", children, className, external }: {
  href: string; variant?: ButtonVariant; children: ReactNode; className?: string; external?: boolean;
}) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass(variant, className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className, tone = "light" }: { children: ReactNode; className?: string; tone?: "light" | "dark" }) {
  return (
    <div
      className={cx(
        "rounded-3xl border p-6 shadow-sm sm:p-8",
        tone === "light" ? "border-navy-100 bg-white" : "border-white/10 bg-white/[0.04] text-white backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  neutral: "bg-navy-50 text-navy-700 ring-navy-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-300",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-300",
  danger: "bg-rose-50 text-rose-800 ring-rose-300",
  gold: "bg-gold-100 text-gold-600 ring-gold-300",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function Alert({ tone, children }: { tone: "success" | "error" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
    error: "border-rose-300 bg-rose-50 text-rose-900",
    info: "border-sky-300 bg-sky-50 text-sky-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-2xl border px-4 py-3 text-sm leading-relaxed", styles)}>
      {children}
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <svg width="34" height="28" viewBox="0 0 34 28" aria-hidden className="shrink-0 text-gold-400">
        <path d="M1 27 V15 A8 8 0 0 1 17 15 V27 M17 27 V15 A8 8 0 0 1 33 15 V27" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M0 27 H34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="leading-none">
        <span className="block font-display text-[15px] font-semibold tracking-[0.16em] sm:text-base">GLOBALTRAVELASSI</span>
        {!compact && <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.35em] text-gold-400">VISORA</span>}
      </span>
    </span>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-navy-200 bg-navy-50/50 px-6 py-12 text-center">
      <p className="font-display text-xl text-navy-900">{title}</p>
      {text && <p className="mx-auto mt-2 max-w-md text-sm text-navy-600">{text}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
