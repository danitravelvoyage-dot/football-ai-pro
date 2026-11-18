import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { signInAction } from "@/lib/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextField } from "@/components/forms/Fields";
import { Alert, Card, ButtonLink } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const dict = getDictionary(isLocale(raw) ? raw : "ar");
  return { title: dict.auth.loginTitle, robots: { index: false, follow: false } };
}

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string; error?: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { next, error } = await searchParams;
  const user = await getCurrentUser();
  const forgotHref = `/${locale}/auth/forgot`;
  const registerHref = `/${locale}/auth/register${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <Card>
      <h1 className="font-display text-3xl font-semibold text-navy-900">{dict.auth.loginTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">{dict.auth.loginSubtitle}</p>
      <div className="mt-6 space-y-4">
        {error === "expired" && <Alert tone="error">{dict.auth.errors.expired}</Alert>}
        {error === "disabled" && <Alert tone="error">{dict.auth.errors.disabled}</Alert>}
        {user && !error && <Alert tone="info">{dict.nav.dashboard} · <Link className="font-semibold underline" href={`/${locale}/dashboard`}>{dict.nav.dashboard}</Link></Alert>}
      </div>
      <div className="mt-6">
        <ActionForm action={signInAction} messages={formMessages(dict)} submitLabel={dict.auth.loginSubmit} pendingLabel={dict.common.loading} submitVariant="navy" className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="next" value={next ?? ""} />
          <TextField name="email" label={dict.auth.email} type="email" ltr autoComplete="email" required inputMode="email" />
          <TextField name="password" label={dict.auth.password} type="password" ltr autoComplete="current-password" required />
          <div className="flex justify-end">
            <Link href={forgotHref} className="text-sm font-semibold text-gold-600 hover:text-gold-500">{dict.auth.forgot}</Link>
          </div>
        </ActionForm>
      </div>
      <div className="mt-8 border-t border-navy-100 pt-6 text-center text-sm text-navy-600">
        <p>{dict.auth.noAccount}</p>
        <ButtonLink href={registerHref} variant="ghost" className="mt-2 w-full sm:w-auto">{dict.auth.createAccount}</ButtonLink>
      </div>
    </Card>
  );
}
