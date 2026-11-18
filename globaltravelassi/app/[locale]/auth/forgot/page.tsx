import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { requestPasswordResetAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextField } from "@/components/forms/Fields";
import { Card } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const dict = getDictionary(isLocale(raw) ? raw : "ar");
  return { title: dict.auth.forgotTitle, robots: { index: false, follow: false } };
}

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  return (
    <Card>
      <h1 className="font-display text-3xl font-semibold text-navy-900">{dict.auth.forgotTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">{dict.auth.forgotSubtitle}</p>
      <div className="mt-6">
        <ActionForm action={requestPasswordResetAction} messages={formMessages(dict)} submitLabel={dict.auth.forgotSubmit} pendingLabel={dict.common.loading} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          <TextField name="email" label={dict.auth.email} type="email" ltr autoComplete="email" required inputMode="email" />
        </ActionForm>
      </div>
    </Card>
  );
}
