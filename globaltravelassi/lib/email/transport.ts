import "server-only";
import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config";

/**
 * The only module that sends email. It talks to the SMTP server the owner configures (any provider, including a free
 * mailbox with SMTP access). Errors are reduced to a short code: the provider's message can contain addresses or
 * server details, so it is never stored or shown.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<SendResult>;
}

export function deliveryErrorCode(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  const responseCode = typeof error === "object" && error && "responseCode" in error ? Number((error as { responseCode: unknown }).responseCode) : 0;
  if (code === "EAUTH") return "auth_failed";
  if (code === "ETIMEDOUT") return "timeout";
  if (code === "EENVELOPE" || (responseCode >= 550 && responseCode <= 553)) return "recipient_rejected";
  if (["ECONNECTION", "ESOCKET", "ECONNREFUSED", "EDNS", "ECONNRESET", "ETLS"].includes(code)) return "connection_failed";
  if (responseCode >= 400 && responseCode < 500) return "temporary_failure";
  return "send_failed";
}

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Port 587: refuse to send unless the server upgrades to TLS.
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(email) {
      try {
        const info = await transporter.sendMail({
          from: config.from,
          to: email.to,
          replyTo: config.replyTo ?? undefined,
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers: { "Auto-Submitted": "auto-generated" },
        });
        return { ok: true, messageId: String(info.messageId ?? "").slice(0, 200) };
      } catch (error) {
        return { ok: false, error: deliveryErrorCode(error) };
      }
    },
  };
}
