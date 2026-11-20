import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { loadProfile } from "@/lib/ai/command-center/memory-load";
import { ownerId } from "@/lib/actions/ai";
import { saveBusinessEntryAction } from "@/lib/actions/memory";
import { ActionForm } from "@/components/forms/ActionForm";
import { TextAreaField } from "@/components/forms/Fields";
import { formMessages } from "@/lib/validation/messages";
import { Badge } from "@/components/ui";
import { Panel } from "@/components/admin/AdminUI";
import { LoadState } from "@/components/admin/command-center/Parts";

export const metadata: Metadata = { title: "Business profile", robots: { index: false, follow: false } };

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const dict = getDictionary(locale);
  const t = dict.commandCenter;
  const m = t.memoryUi;
  const messages = { ...formMessages(dict), saved: m.saved, forbidden: m.errorForbidden, invalid_input: m.errorInvalid, version_conflict: m.errorConflict, unauthorized: m.errorUnauthorized, generic: m.errorGeneric };

  const owner = await ownerId();
  if (!owner) return <p className="text-sm text-rose-800">{m.unauthorized}</p>;
  const state = await loadProfile();
  if (state.status !== "ok") return <LoadState kind={state.status} dict={dict} />;

  return (
    <>
      <p className="text-sm leading-relaxed text-navy-600">{m.profileHint}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {state.profile.map((item) => {
          const label = m.keyLabels[item.key.slice("company.".length) as keyof typeof m.keyLabels];
          return (
            <Panel key={item.key} title={label}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Badge tone={item.present ? "success" : "warning"}>{item.present ? `${m.entryVersion} ${item.version}` : m.missing}</Badge>
              </div>
              {item.present && item.text ? (
                <p className="mb-4 whitespace-pre-line text-sm leading-relaxed text-navy-800">{item.text}</p>
              ) : (
                <p className="mb-4 text-sm text-navy-500">{m.missing}</p>
              )}
              <ActionForm action={saveBusinessEntryAction} messages={messages} submitLabel={m.editEntry} pendingLabel={dict.common.loading} submitVariant="navy" className="grid gap-4">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="key" value={item.key} />
                <input type="hidden" name="expectedVersion" value={String(item.version ?? 0)} />
                <TextAreaField name="text" label={label} required rows={3} maxLength={2000} defaultValue={item.text ?? ""} />
              </ActionForm>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
