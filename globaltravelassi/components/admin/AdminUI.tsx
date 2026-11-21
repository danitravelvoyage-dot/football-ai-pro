import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

export function AdminNav({ locale, dict, current }: { locale: Locale; dict: Dict; current: string }) {
  const items = [
    { key: "overview", href: `/${locale}/admin`, label: dict.admin.overview },
    { key: "command-center", href: `/${locale}/admin/command-center`, label: dict.commandCenter.title },
    { key: "customers", href: `/${locale}/admin/customers`, label: dict.admin.customers },
    { key: "applications", href: `/${locale}/admin/applications`, label: dict.admin.applications },
    { key: "services", href: `/${locale}/admin/services`, label: dict.admin.services },
    { key: "payments", href: `/${locale}/admin/payments`, label: dict.manualPayments.navPayments },
    { key: "reports", href: `/${locale}/admin/reports`, label: dict.admin.reports },
  ];
  return (
    <nav aria-label={dict.admin.title} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={current === item.key ? "page" : undefined}
          className={cx(
            "shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition lg:rounded-2xl",
            current === item.key ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-800 hover:bg-navy-100 lg:bg-transparent",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-3xl border border-navy-100 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold text-navy-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-navy-500">{hint}</p>}
    </div>
  );
}

export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-navy-100 bg-white p-5 shadow-sm sm:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-navy-900 sm:text-2xl">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Responsive table: scrolls inside its own box on small screens, never the whole page. */
export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-navy-100">
      <table className="w-full min-w-[40rem] text-start text-sm">
        <thead className="bg-navy-50 text-xs uppercase tracking-wider text-navy-600">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-start font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100 bg-white">{children}</tbody>
      </table>
    </div>
  );
}

export function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-navy-700">{label}</span><span className="font-semibold text-navy-900">{value}</span></div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-navy-50">
        <div className="h-full rounded-full bg-gradient-to-r from-gold-400 to-gold-600" style={{ width: `${value > 0 ? width : 0}%` }} />
      </div>
    </div>
  );
}
