"use client";
import clsx from "clsx";
import {
  Activity, BarChart3, BookOpen, CalendarDays, Coins, History, LayoutDashboard, Menu, Settings, Shield, Trophy, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useI18n } from "./I18nProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";

const ITEMS = [
  { href: "/", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/matches", key: "nav.today", icon: CalendarDays },
  { href: "/markets", key: "nav.markets", icon: BarChart3 },
  { href: "/value", key: "nav.value", icon: Coins },
  { href: "/teams", key: "nav.teams", icon: Shield },
  { href: "/leagues", key: "nav.leagues", icon: Trophy },
  { href: "/history", key: "nav.history", icon: History },
  { href: "/methodology", key: "nav.methodology", icon: BookOpen },
  { href: "/settings", key: "nav.settings", icon: Settings },
] as const;

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="FOOTBALL AI PRO">
      <span className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 shadow-glow">
        <Activity className="h-5 w-5 text-emerald-400" aria-hidden />
      </span>
      <span className="leading-tight" dir="ltr">
        <span className="block text-sm font-bold tracking-[0.18em] text-white">FOOTBALL</span>
        <span className="block text-[11px] font-semibold tracking-[0.3em] text-emerald-400">AI PRO</span>
      </span>
    </Link>
  );
}

function Links({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  const path = usePathname();
  return (
    <ul className="space-y-1">
      {ITEMS.map(({ href, key, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30" : "text-slate-400 hover:bg-ink-800 hover:text-slate-100",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {t(key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-line bg-ink-900/70 px-4 py-5 backdrop-blur lg:flex">
      <Logo />
      <nav className="mt-8 flex-1" aria-label="Main">
        <Links />
      </nav>
      <LanguageSwitcher />
    </aside>
  );
}

export function TopBar() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-ink-950/85 px-4 py-3 backdrop-blur lg:hidden">
      <Logo />
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <button className="btn px-2.5 py-1.5" aria-label={t("nav.menu")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav className="absolute inset-x-0 top-full border-b border-line bg-ink-900 px-4 py-3 shadow-2xl" aria-label="Main">
          <Links onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </header>
  );
}
