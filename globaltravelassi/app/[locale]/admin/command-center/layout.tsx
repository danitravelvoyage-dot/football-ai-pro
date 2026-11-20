import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { CommandSubNav, type SubNavItem } from "@/components/admin/command-center/SubNav";

export default async function CommandCenterLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const base = `/${locale}/admin/command-center`;

  const items: SubNavItem[] = [
    { href: base, label: t.navOverview, exact: true },
    { href: `${base}/coo`, label: t.navCoo },
    { href: `${base}/agents`, label: t.navAgents },
    { href: `${base}/tasks`, label: t.navTasks },
    { href: `${base}/approvals`, label: t.navApprovals },
    { href: `${base}/audit`, label: t.navAudit },
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">{t.title}</h1>
        <p className="max-w-3xl text-navy-600">{t.subtitle}</p>
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-600">{t.realDataOnly}</p>
      </header>
      <CommandSubNav items={items} label={t.title} />
      {children}
    </div>
  );
}
