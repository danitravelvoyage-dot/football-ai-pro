import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { signUpAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextField } from "@/components/forms/Fields";
import { Alert, Card } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const dict = getDictionary(isLocale(raw) ? raw : "ar");
  return { title: dict.auth.registerTitle, robots: { index: false, follow: false } };
}

export default async function RegisterPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { next } = await searchParams;
  const loginHref = `/${locale}/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <Card>
      <h1 className="font-display text-3xl font-semibold text-navy-900">{dict.auth.registerTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">{dict.auth.registerSubtitle}</p>
      <div className="mt-6">
        <ActionForm action={signUpAction} messages={formMessages(dict)} submitLabel={dict.auth.registerSubmit} pendingLabel={dict.common.loading} className="space-y-5" resetOnSuccess>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="next" value={next ?? ""} />
          <TextField name="fullName" label={dict.auth.fullName} autoComplete="name" required maxLength={120} />
          <TextField name="whatsapp" label={dict.auth.whatsapp} type="tel" ltr inputMode="tel" autoComplete="tel" required hint={dict.apply.hints.whatsapp} />
          <TextField name="email" label={dict.auth.email} type="email" ltr autoComplete="email" required inputMode="email" />
          <TextField name="password" label={dict.auth.password} type="password" ltr autoComplete="new-password" required hint={dict.auth.passwordHint} />
          <TextField name="confirmPassword" label={dict.auth.confirmPassword} type="password" ltr autoComplete="new-password" required />
        </ActionForm>
      </div>
      <p className="mt-8 border-t border-navy-100 pt-6 text-center text-sm text-navy-600">
        {dict.auth.haveAccount}{" "}
        <Link href={loginHref} className="font-semibold text-gold-600 hover:text-gold-500">{dict.auth.signIn}</Link>
      </p>
      <Alert tone="info">{dict.auth.checkEmail}</Alert>
    </Card>
  );
}
