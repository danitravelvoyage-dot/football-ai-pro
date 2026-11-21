import "server-only";

/**
 * Email settings, read from server-only environment variables. Values are never logged or returned to a page: only
 * the NAMES of missing variables are reported. Delivery is off unless EMAIL_DELIVERY_ENABLED is exactly "true", so a
 * development or staging copy with SMTP settings does not email real customers by accident.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  replyTo: string | null;
}

export type EmailConfigResult =
  | { ok: true; config: SmtpConfig }
  | { ok: false; reason: "disabled" | "not_configured"; missing: string[] };

const HEADER_SAFE = /^[^\r\n]+$/;
const ADDRESS = /[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+/;

export function readEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfigResult {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"] as const;
  const missing: string[] = required.filter((name) => !(env[name] ?? "").trim());
  const port = Number((env.SMTP_PORT ?? "587").trim() || "587");
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push("SMTP_PORT");
  const from = (env.EMAIL_FROM ?? "").trim();
  if (from && (!HEADER_SAFE.test(from) || !ADDRESS.test(from))) missing.push("EMAIL_FROM");
  const replyTo = (env.EMAIL_REPLY_TO ?? "").trim();
  if (replyTo && (!HEADER_SAFE.test(replyTo) || !ADDRESS.test(replyTo))) missing.push("EMAIL_REPLY_TO");

  if ((env.EMAIL_DELIVERY_ENABLED ?? "").trim() !== "true") return { ok: false, reason: "disabled", missing };
  if (missing.length) return { ok: false, reason: "not_configured", missing };
  return {
    ok: true,
    config: {
      host: env.SMTP_HOST!.trim(),
      port,
      secure: (env.SMTP_SECURE ?? "").trim() === "true" || port === 465,
      user: env.SMTP_USER!.trim(),
      password: env.SMTP_PASSWORD!,
      from,
      replyTo: replyTo || null,
    },
  };
}
