import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, countryName, type Locale } from "@/lib/i18n";
import { countryCodes } from "@/lib/countries";
import { employmentStatuses } from "@/lib/domain";
import { requireCustomer } from "@/lib/auth";
import { getActiveServices, getServiceBySlug } from "@/lib/queries";
import { formMessages } from "@/lib/validation/messages";
import { createApplicationAction } from "@/lib/actions/applications";
import { serviceTitle } from "@/lib/catalog";
import { ActionForm } from "@/components/forms/ActionForm";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { Alert, Container, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = { title: "Start your request", robots: { index: false, follow: false } };

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ service?: string; utm_source?: string }>;
}) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { service: slug, utm_source: source } = await searchParams;
  const selected = slug ? await getServiceBySlug(slug) : null;
  await requireCustomer(locale, `/${locale}/apply${slug ? `?service=${encodeURIComponent(slug)}` : ""}`);

  const services = await getActiveServices();
  const countries = countryCodes
    .map((code) => ({ value: code, label: countryName(code, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const employment = employmentStatuses.map((value) => ({ value, label: dict.employment[value] }));
  const serviceOptions = services.map((s) => ({ value: s.id, label: serviceTitle(s, locale) }));
  // One token per form render: a double submit reuses it, and the server returns the first request (see the action).
  const submissionToken = crypto.randomUUID();

  return (
    <Section className="pt-12 sm:pt-16">
      <Container className="max-w-3xl">
        <SectionHeading eyebrow={dict.nav.apply} title={dict.apply.title} subtitle={dict.apply.subtitle} />
        <div className="mt-10 rounded-[2rem] border border-navy-100 bg-white p-6 shadow-xl shadow-navy-900/5 sm:p-10">
          {services.length === 0 ? (
            <Alert tone="info">{dict.apply.noServices}</Alert>
          ) : (
            <ActionForm
              action={createApplicationAction}
              messages={formMessages(dict)}
              submitLabel={dict.apply.submit}
              pendingLabel={dict.apply.submitting}
              className="space-y-10"
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="source" value={source ?? ""} />
              <input type="hidden" name="submissionToken" value={submissionToken} />
              {/* Honeypot: hidden from people and from screen readers. Bots that fill it are ignored. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Website
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>

              <fieldset className="space-y-5">
                <legend className="mb-4 font-display text-xl text-navy-900">{dict.apply.sections.personal}</legend>
                <TextField name="fullName" label={dict.apply.fields.fullName} autoComplete="name" required maxLength={120} />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField name="email" label={dict.apply.fields.email} type="email" ltr autoComplete="email" required inputMode="email" />
                  <TextField name="whatsapp" label={dict.apply.fields.whatsapp} type="tel" ltr inputMode="tel" autoComplete="tel" required hint={dict.apply.hints.whatsapp} />
                </div>
                <div className="grid gap-5 sm:grid-cols-3">
                  <SelectField name="nationality" label={dict.apply.fields.nationality} options={countries} placeholder={dict.common.none} required />
                  <SelectField name="countryOfResidence" label={dict.apply.fields.countryOfResidence} options={countries} placeholder={dict.common.none} required defaultValue="DZ" />
                  <SelectField name="destinationCountry" label={dict.apply.fields.destinationCountry} options={countries} placeholder={dict.common.none} required />
                </div>
              </fieldset>

              <fieldset className="space-y-5">
                <legend className="mb-4 font-display text-xl text-navy-900">{dict.apply.sections.travel}</legend>
                <div className="grid gap-5 sm:grid-cols-2">
                  <SelectField name="serviceId" label={dict.apply.fields.service} options={serviceOptions} placeholder={dict.apply.fields.selectService} required defaultValue={selected ? services.find((s) => s.slug === selected.slug)?.id : undefined} />
                  <TextField name="travelDate" label={dict.apply.fields.travelDate} type="date" ltr min={new Date().toISOString().slice(0, 10)} />
                </div>
                <SelectField name="employmentStatus" label={dict.apply.fields.employmentStatus} options={employment} placeholder={dict.common.none} required />
                <TextAreaField name="previousTravelHistory" label={dict.apply.fields.previousTravelHistory} hint={dict.apply.hints.previousTravel} rows={3} maxLength={2000} />
              </fieldset>

              <fieldset className="space-y-5">
                <legend className="mb-2 font-display text-xl text-navy-900">{dict.apply.sections.additional}</legend>
                <TextAreaField name="additionalInfo" label={dict.apply.fields.additionalInfo} hint={dict.apply.hints.additional} rows={4} maxLength={2000} />
                <Alert tone="info">{dict.apply.hints.documents}</Alert>
              </fieldset>

              <div className="space-y-3 rounded-2xl bg-navy-50/70 p-5 text-sm leading-relaxed text-navy-700">
                <p>{dict.apply.privacyNotice}</p>
                <p>
                  <Link href={`/${locale}/privacy`} className="font-semibold text-gold-700 underline">{dict.legal.privacyLabel}</Link>
                  {" · "}
                  <Link href={`/${locale}/terms`} className="font-semibold text-gold-700 underline">{dict.legal.termsLabel}</Link>
                </p>
              </div>
              <CheckboxField name="consent" required label={dict.apply.consent} />
            </ActionForm>
          )}
        </div>
      </Container>
    </Section>
  );
}
