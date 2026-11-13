"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TZ_COOKIE } from "@/lib/i18n";
import { setCookie } from "./LanguageSwitcher";

/** On first visit, store the browser's timezone in a cookie so server-rendered "today" matches the user. */
export function TimezoneSync({ hasCookie }: { hasCookie: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (hasCookie) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        setCookie(TZ_COOKIE, tz);
        router.refresh();
      }
    } catch {
      /* keep UTC */
    }
  }, [hasCookie, router]);
  return null;
}
