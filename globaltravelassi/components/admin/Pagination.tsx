import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import { pageHref, type PageInfo } from "@/lib/pagination";

/** Previous / next links for an admin list. Filters stay in the links; nothing renders for a single page. */
export function Pagination({ info, basePath, params, dict }: {
  info: PageInfo;
  basePath: string;
  params: Record<string, string | undefined>;
  dict: Dict;
}) {
  const t = dict.adminUi;
  const summary = info.total > 0 ? `${info.from}–${info.to} ${t.of} ${info.total} ${t.results}` : `0 ${t.results}`;
  if (info.pages <= 1) return <p className="mt-4 text-xs text-navy-500">{summary}</p>;
  const linkClass = "inline-flex min-h-11 items-center rounded-full border border-navy-200 px-5 py-2 text-sm font-semibold text-navy-800 hover:border-gold-500 hover:text-gold-600";
  const disabledClass = "inline-flex min-h-11 items-center rounded-full border border-navy-100 px-5 py-2 text-sm font-semibold text-navy-300";
  return (
    <nav aria-label={`${t.page} ${info.page} ${t.of} ${info.pages}`} className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-navy-500">{summary}</p>
      <div className="flex items-center gap-3">
        {info.page > 1 ? (
          <Link href={pageHref(basePath, params, info.page - 1)} rel="prev" className={linkClass}>{t.previous}</Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>{t.previous}</span>
        )}
        <span className="text-sm text-navy-700">{t.page} {info.page} {t.of} {info.pages}</span>
        {info.page < info.pages ? (
          <Link href={pageHref(basePath, params, info.page + 1)} rel="next" className={linkClass}>{t.next}</Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>{t.next}</span>
        )}
      </div>
    </nav>
  );
}
