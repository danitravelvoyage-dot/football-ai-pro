import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import { selfServicePaymentMethods } from "@/lib/domain";
import { loadPaymentMethodSettings } from "@/lib/payments/load";
import { saveMethodSettingsAction } from "@/lib/actions/payments";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextAreaField, TextField } from "@/components/forms/Fields";
import { Panel } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Payment methods", robots: { index: false, follow: false } };

export default async function AdminPaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const mp = dict.manualPayments;
  const messages = {
    ...formMessages(dict),
    saved: mp.saved,
    forbidden: mp.forbidden,
    invalid_input: mp.invalid,
    instructions_required: mp.instructionsRequired,
    unauthorized: mp.unauthorized,
    generic: mp.generic,
  };
  const settings = await loadPaymentMethodSettings();
  const byMethod = new Map(settings.map((s) => [s.method, s]));

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{mp.adminHint}</p>
      {selfServicePaymentMethods.map((method) => {
        const s = byMethod.get(method);
        return (
          <Panel key={method} title={dict.paymentMethods[method]}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Badge tone={s?.enabled ? "success" : "neutral"}>{s?.enabled ? mp.enabled : "—"}</Badge>
            </div>
            <ActionForm action={saveMethodSettingsAction} messages={messages} submitLabel={mp.saveMethod} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-5">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="method" value={method} />
              <label className="flex items-center gap-3 text-sm font-semibold text-navy-900">
                <input type="checkbox" name="enabled" value="on" defaultChecked={s?.enabled ?? false} className="h-4 w-4" />
                {mp.enabled}
              </label>
              <TextAreaField name="instructionsFr" label={mp.instrFr} rows={4} maxLength={2000} defaultValue={s?.instructions_fr ?? ""} />
              <TextAreaField name="instructionsEn" label={mp.instrEn} rows={4} maxLength={2000} defaultValue={s?.instructions_en ?? ""} />
              <TextAreaField name="instructionsAr" label={mp.instrAr} rows={4} maxLength={2000} defaultValue={s?.instructions_ar ?? ""} />
              <TextField name="reason" label={mp.reasonLabel} required maxLength={500} />
            </ActionForm>
          </Panel>
        );
      })}
    </>
  );
}
