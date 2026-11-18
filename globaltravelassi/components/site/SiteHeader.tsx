import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import { Logo } from "@/components/ui";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { signOutAction } from "@/lib/actions/auth";

export function SiteHeader({ locale, dict, signedIn }: { locale: Locale; dict: Dict; signedIn: boolean }) {
  const links = [
    { href: `/${locale}`, label: dict.nav.home },
    { href: `/${locale}/services`, label: dict.nav.services },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-navy-950/85 text-white backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href={`/${locale}`} className="shrink-0" aria-label={dict.brand.name}>
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-white/85 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="transition hover:text-gold-300">
              {l.label}
            </Link>
          ))}
          {signedIn && (
            <Link href={`/${locale}/dashboard`} className="transition hover:text-gold-300">
              {dict.nav.dashboard}
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <LanguageSwitcher current={locale} label={dict.nav.language} />
          </div>
          <details className="group md:hidden">
            <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-white/20 text-white marker:hidden [&::-webkit-details-marker]:hidden" aria-label={dict.nav.menu}>
              <span className="block h-0.5 w-5 bg-current shadow-[0_-6px_0_currentColor,0_6px_0_currentColor]" aria-hidden />
            </summary>
            <div className="absolute inset-x-0 top-16 border-t border-white/10 bg-navy-950 px-4 pb-6 pt-4 shadow-2xl">
              <div className="mb-4 flex justify-center"><LanguageSwitcher current={locale} label={dict.nav.language} /></div>
              <ul className="space-y-1 text-base">
                {links.map((l) => (
                  <li key={l.href}><Link href={l.href} className="block rounded-xl px-3 py-3 hover:bg-white/5">{l.label}</Link></li>
                ))}
                {signedIn ? (
                  <>
                    <li><Link href={`/${locale}/dashboard`} className="block rounded-xl px-3 py-3 hover:bg-white/5">{dict.nav.dashboard}</Link></li>
                    <li>
                      <form action={signOutAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <button className="block w-full rounded-xl px-3 py-3 text-start hover:bg-white/5">{dict.nav.logout}</button>
                      </form>
                    </li>
                  </>
                ) : (
                  <li><Link href={`/${locale}/auth/login`} className="block rounded-xl px-3 py-3 hover:bg-white/5">{dict.nav.login}</Link></li>
                )}
              </ul>
            </div>
          </details>
          <div className="hidden items-center gap-2 md:flex">
            {signedIn ? (
              <>
                <Link href={`/${locale}/dashboard`} className="rounded-full px-4 py-2 text-sm font-semibold text-white/90 hover:text-gold-300">{dict.nav.dashboard}</Link>
                <form action={signOutAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <button className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold hover:border-gold-400 hover:text-gold-300">{dict.nav.logout}</button>
                </form>
              </>
            ) : (
              <Link href={`/${locale}/auth/login`} className="rounded-full px-4 py-2 text-sm font-semibold text-white/90 hover:text-gold-300">{dict.nav.login}</Link>
            )}
            <Link href={`/${locale}/apply`} className="rounded-full bg-gradient-to-b from-gold-400 to-gold-500 px-5 py-2.5 text-sm font-semibold text-navy-950 shadow-lg shadow-gold-500/20 transition hover:-translate-y-0.5">
              {dict.nav.apply}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
