import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, formatDate, countryName, type Locale } from "@/lib/i18n";
import { requireCustomer } from "@/lib/auth";
import { getMyApplications } from "@/lib/queries";
import { serviceTitle } from "@/lib/catalog";
import { Alert, ButtonLink, Card, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata: Metadata = { title: "My requests", robots: { index: false, follow: false } };

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; password?: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { profile } = await requireCustomer(locale, `/${locale}/dashboard`);
  const { error, password } = await searchParams;
  const requests = await getMyApplications();

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">{dict.dashboard.title}</h1>
        <p className="text-navy-600">{dict.dashboard.subtitle}</p>
        {profile.full_name && <p className="text-sm text-navy-500">{profile.full_name} · {profile.email}</p>}
      </div>
      {error === "denied" && <Alert tone="error">{dict.admin.denied}</Alert>}
      {password === "updated" && <Alert tone="success">{dict.auth.resetDone}</Alert>}

      {requests.length === 0 ? (
        <EmptyState
          title={dict.dashboard.empty}
          action={<ButtonLink href={`/${locale}/apply`}>{dict.dashboard.emptyCta}</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-5 md:grid-cols-2">
          {requests.map((r) => (
            <li key={r.id}>
              <Card className="flex h-full flex-col gap-5 transition hover:border-gold-300 hover:shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-navy-500">{dict.dashboard.reference}</p>
                    <p className="mt-1 font-mono text-lg font-semibold text-navy-900">{r.reference}</p>
                  </div>
                  <StatusBadge status={r.status} dict={dict} />
                </div>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-navy-500">{dict.dashboard.service}</dt>
                    <dd className="mt-1 font-semibold text-navy-900">{r.services ? serviceTitle(r.services, locale) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-navy-500">{dict.dashboard.travelDate}</dt>
                    <dd className="mt-1 font-semibold text-navy-900">{formatDate(r.travel_date, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-navy-500">{dict.apply.fields.destinationCountry}</dt>
                    <dd className="mt-1 font-semibold text-navy-900">{countryName(r.destination_country, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-navy-500">{dict.admin.detail.submitted}</dt>
                    <dd className="mt-1 font-semibold text-navy-900">{formatDate(r.created_at, locale)}</dd>
                  </div>
                </dl>
                <div className="mt-auto">
                  <Link href={`/${locale}/dashboard/requests/${r.id}`} className="inline-flex items-center gap-2 font-semibold text-navy-800 hover:text-gold-600">
                    {dict.dashboard.open} →
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
