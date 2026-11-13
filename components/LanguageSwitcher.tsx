"use client";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

export function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      className="btn px-2.5 py-1.5"
      aria-label={`${t("nav.language")}: ${next === "ar" ? "العربية" : "English"}`}
      disabled={pending}
      onClick={() => {
        setCookie(LOCALE_COOKIE, next);
        start(() => router.refresh());
      }}
    >
      <Languages className="h-4 w-4" aria-hidden />
      <span className="text-xs font-semibold">{next === "ar" ? "العربية" : "English"}</span>
    </button>
  );
}
