import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { updatePasswordAction } from "@/lib/actions/auth";
import { getCurrentUser, loginPath } from "@/lib/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextField } from "@/components/forms/Fields";
import { Card } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const dict = getDictionary(isLocale(raw) ? raw : "ar");
  return { title: dict.auth.resetTitle, robots: { index: false, follow: false } };
}

export default async function UpdatePasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  // Only reachable after the reset link has created a session.
  if (!(await getCurrentUser())) redirect(loginPath(locale));
  return (
    <Card>
      <h1 className="font-display text-3xl font-semibold text-navy-900">{dict.auth.resetTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">{dict.auth.resetSubtitle}</p>
      <div className="mt-6">
        <ActionForm action={updatePasswordAction} messages={formMessages(dict)} submitLabel={dict.auth.resetSubmit} pendingLabel={dict.common.loading} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          <TextField name="password" label={dict.auth.password} type="password" ltr autoComplete="new-password" required hint={dict.auth.passwordHint} />
          <TextField name="confirmPassword" label={dict.auth.confirmPassword} type="password" ltr autoComplete="new-password" required />
        </ActionForm>
      </div>
    </Card>
  );
}
