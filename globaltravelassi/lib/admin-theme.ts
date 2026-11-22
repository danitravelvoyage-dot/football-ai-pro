/** Admin dashboard theme preference. A cookie with no personal data, read on the server to avoid a flash. */
export const ADMIN_THEME_COOKIE = "gta_admin_theme";

export type AdminTheme = "light" | "dark";

/** Anything other than exactly "dark" is the light theme. */
export function parseAdminTheme(value: string | undefined | null): AdminTheme {
  return value === "dark" ? "dark" : "light";
}
