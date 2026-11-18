import Link from "next/link";
import type { ServiceRow } from "@/lib/domain";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import { applyHref, serviceDescription, servicePrice, serviceTitle } from "@/lib/catalog";
import { Badge } from "@/components/ui";

export function ServiceCard({ service, dict, locale, source }: { service: ServiceRow; dict: Dict; locale: Locale; source?: string | null }) {
  const price = servicePrice(service, dict, locale);
  const hasPrice = service.price !== null && service.price !== "";
  return (
    <article className="group flex h-full flex-col rounded-3xl border border-navy-100 bg-white p-7 shadow-sm transition duration-500 hover:-translate-y-1 hover:border-gold-300 hover:shadow-xl hover:shadow-navy-900/10">
      <Badge tone="gold">{dict.categories[service.category]}</Badge>
      <h3 className="mt-5 font-display text-2xl font-semibold leading-snug text-navy-900">{serviceTitle(service, locale)}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-navy-600">{serviceDescription(service, locale)}</p>
      <div className="mt-6 flex items-center justify-between gap-4 border-t border-navy-100 pt-5">
        <p className={hasPrice ? "font-semibold text-navy-900" : "text-sm text-navy-500"}>
          {hasPrice && <span className="me-1 text-xs font-normal text-navy-500">{dict.services.priceFrom}</span>}
          {price}
        </p>
        <Link href={applyHref(locale, { service: service.slug, source })} className="text-sm font-semibold text-navy-800 transition group-hover:text-gold-600">
          {dict.services.cta} →
        </Link>
      </div>
    </article>
  );
}
