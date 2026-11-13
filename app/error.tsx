"use client";
import { useI18n } from "@/components/I18nProvider";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel mx-auto max-w-md p-8 text-center" role="alert">
      <p className="text-sm text-slate-200">{t("common.error")}</p>
      <button className="btn btn-primary mt-6" onClick={reset}>{t("common.retry")}</button>
    </div>
  );
}
