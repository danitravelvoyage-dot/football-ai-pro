"use client";

import { useState } from "react";
import { ADMIN_THEME_COOKIE, type AdminTheme } from "@/lib/admin-theme";

/**
 * Light / dark switch for the admin area. The choice is applied at once and remembered in a preference cookie that
 * the admin layout reads, so the next page renders in the same theme without a flash. No personal data is stored.
 */
export function ThemeToggle({ initial, labels }: { initial: AdminTheme; labels: { label: string; light: string; dark: string } }) {
  const [theme, setTheme] = useState<AdminTheme>(initial);

  function choose(next: AdminTheme) {
    setTheme(next);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${ADMIN_THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${secure}`;
    document.querySelector("[data-admin-root]")?.setAttribute("data-theme", next);
  }

  return (
    <div role="group" aria-label={labels.label} className="inline-flex rounded-full border border-navy-200 bg-white p-1">
      {(["light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => choose(option)}
          className={
            theme === option
              ? "min-h-9 rounded-full bg-navy-900 px-4 text-sm font-semibold text-white"
              : "min-h-9 rounded-full px-4 text-sm font-semibold text-navy-700 hover:text-gold-600"
          }
        >
          {option === "light" ? labels.light : labels.dark}
        </button>
      ))}
    </div>
  );
}
