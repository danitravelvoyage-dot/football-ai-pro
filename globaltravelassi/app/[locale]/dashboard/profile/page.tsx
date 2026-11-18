import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { requireCustomer } from "@/lib/auth";
import { formMessages } from "@/lib/validation/messages";
import { updateProfileAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextField } from "@/components/forms/Fields";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "My profile", robots: { index: false, follow: false } };

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const { profile } = await requireCustomer(locale, `/${locale}/dashboard/profile`);
  return (
    <Card className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold text-navy-900">{dict.dashboard.profileTitle}</h1>
      <div className="mt-8 space-y-5">
        <div>
          <p className="text-sm font-semibold text-navy-800">{dict.dashboard.profileEmail}</p>
          <p className="mt-2 rounded-2xl bg-navy-50 px-4 py-3 text-base text-navy-700" dir="ltr">{profile.email}</p>
        </div>
        <ActionForm action={updateProfileAction} messages={formMessages(dict)} submitLabel={dict.common.save} pendingLabel={dict.common.loading} className="space-y-5">
          <input type="hidden" name="locale" value={locale} />
          <TextField name="fullName" label={dict.auth.fullName} defaultValue={profile.full_name} autoComplete="name" required maxLength={120} />
          <TextField name="whatsapp" label={dict.auth.whatsapp} type="tel" ltr inputMode="tel" defaultValue={profile.whatsapp} autoComplete="tel" required hint={dict.apply.hints.whatsapp} />
        </ActionForm>
      </div>
    </Card>
  );
}
