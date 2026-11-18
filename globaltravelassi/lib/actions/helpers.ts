import "server-only";
import type { ZodError, ZodTypeAny, z } from "zod";
import { isLocale, type Locale, defaultLocale } from "@/lib/i18n/config";
import type { ActionState } from "./types";

export type ParseResult<S extends ZodTypeAny> = { ok: true; data: z.output<S> } | { ok: false; state: ActionState };

/** Runs a schema and converts the first error per field into a message code. */
export function parseWith<S extends ZodTypeAny>(schema: S, input: unknown): ParseResult<S> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, state: { ok: false, code: "invalid_input", fieldErrors: fieldErrorsOf(result.error) } };
}

export function fieldErrorsOf(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

export function localeFrom(formData: FormData): Locale {
  const value = String(formData.get("locale") ?? "");
  return isLocale(value) ? value : defaultLocale;
}

/** Only allow same-site relative paths (prevents open redirects). */
export function safeNext(next: string | null | undefined, locale: Locale, fallback = `/${locale}/dashboard`): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
