import { ActionForm } from "@/components/forms/ActionForm";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/forms/Fields";
import { saveServiceAction } from "@/lib/actions/admin";
import { serviceCategories, currencies, type ServiceRow } from "@/lib/domain";
import type { Dict } from "@/lib/i18n";
import { formMessages } from "@/lib/validation/messages";
import type { Locale } from "@/lib/i18n/config";

export function ServiceForm({ dict, locale, service }: { dict: Dict; locale: Locale; service?: ServiceRow | null }) {
  const t = dict.admin.servicesPage;
  const price = service?.price === null || service?.price === undefined ? "" : String(Number(service.price));
  return (
    <ActionForm action={saveServiceAction} messages={formMessages(dict)} submitLabel={dict.common.save} pendingLabel={dict.common.loading} className="space-y-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={service?.id ?? ""} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="slug" label={t.slug} ltr required defaultValue={service?.slug} hint={t.slugHelp} maxLength={60} />
        <SelectField name="category" label={t.category} required defaultValue={service?.category ?? "visa"} options={serviceCategories.map((c) => ({ value: c, label: dict.categories[c] }))} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <TextField name="titleAr" label={t.titleAr} required defaultValue={service?.title_ar} maxLength={120} />
        <TextField name="titleFr" label={t.titleFr} required defaultValue={service?.title_fr} maxLength={120} />
        <TextField name="titleEn" label={t.titleEn} required defaultValue={service?.title_en} maxLength={120} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <TextAreaField name="descAr" label={t.descAr} defaultValue={service?.description_ar} rows={4} maxLength={1000} />
        <TextAreaField name="descFr" label={t.descFr} defaultValue={service?.description_fr} rows={4} maxLength={1000} />
        <TextAreaField name="descEn" label={t.descEn} defaultValue={service?.description_en} rows={4} maxLength={1000} />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField name="price" label={t.price} inputMode="decimal" ltr defaultValue={price} />
        <SelectField name="currency" label={t.currency} required defaultValue={service?.currency ?? "DZD"} options={currencies.map((c) => ({ value: c, label: c }))} />
        <TextField name="sortOrder" label={t.sortOrder} inputMode="numeric" ltr defaultValue={String(service?.sort_order ?? 0)} />
      </div>
      <CheckboxField name="isActive" label={t.active} defaultChecked={service?.is_active ?? true} />
    </ActionForm>
  );
}
