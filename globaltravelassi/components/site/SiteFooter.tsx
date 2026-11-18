import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import { Logo } from "@/components/ui";
import { whatsappLink } from "@/lib/config";

export function SiteFooter({ locale, dict }: { locale: Locale; dict: Dict }) {
  const wa = whatsappLink();
  return (
    <footer className="border-t border-navy-100 bg-navy-950 text-navy-200">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-navy-300">{dict.brand.tagline}</p>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-white">{dict.footer.contact}</p>
          <p className="mt-3 text-navy-300">{dict.footer.address}</p>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-gold-300 hover:text-gold-400">
              {dict.footer.whatsapp} →
            </a>
          )}
        </div>
        <div className="text-sm">
          <p className="font-semibold text-white">{dict.footer.legal}</p>
          <ul className="mt-3 space-y-2 text-navy-300">
            <li><Link href={`/${locale}/privacy`} className="hover:text-gold-300">{dict.privacy.title}</Link></li>
            <li><Link href={`/${locale}/services`} className="hover:text-gold-300">{dict.nav.services}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-4 py-6 text-center text-xs leading-relaxed text-navy-400 sm:px-6">
        <p className="mx-auto max-w-3xl">{dict.home.disclaimer}</p>
        <p className="mt-3">© {new Date().getFullYear()} VISORA · {dict.footer.rights}</p>
      </div>
    </footer>
  );
}
