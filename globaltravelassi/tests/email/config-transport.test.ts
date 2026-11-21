import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const nm = vi.hoisted(() => ({ options: null as Record<string, unknown> | null, mail: null as Record<string, unknown> | null, error: null as unknown }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      nm.options = options;
      return {
        sendMail: async (mail: Record<string, unknown>) => {
          nm.mail = mail;
          if (nm.error) throw nm.error;
          return { messageId: "<abc@test>" };
        },
      };
    },
  },
}));

const { readEmailConfig } = await import("@/lib/email/config");
const { createSmtpTransport, deliveryErrorCode } = await import("@/lib/email/transport");

const full = {
  EMAIL_DELIVERY_ENABLED: "true",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "user@example.test",
  SMTP_PASSWORD: "s3cret-value",
  EMAIL_FROM: "GLOBALTRAVELASSI <no-reply@example.test>",
};

beforeEach(() => {
  nm.options = null;
  nm.mail = null;
  nm.error = null;
});

describe("email configuration", () => {
  it("is off unless EMAIL_DELIVERY_ENABLED is exactly true", () => {
    expect(readEmailConfig({ ...full, EMAIL_DELIVERY_ENABLED: "" })).toMatchObject({ ok: false, reason: "disabled" });
    expect(readEmailConfig({ ...full, EMAIL_DELIVERY_ENABLED: "yes" })).toMatchObject({ ok: false, reason: "disabled" });
    expect(readEmailConfig({})).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("reports the NAMES of missing variables, never a value", () => {
    const result = readEmailConfig({ ...full, SMTP_PASSWORD: "", SMTP_HOST: "" });
    expect(result).toEqual({ ok: false, reason: "not_configured", missing: ["SMTP_HOST", "SMTP_PASSWORD"] });
    expect(JSON.stringify(readEmailConfig({ ...full, SMTP_HOST: "" }))).not.toContain("s3cret-value");
  });

  it("refuses a sender or reply-to address that could add a header", () => {
    expect(readEmailConfig({ ...full, EMAIL_FROM: "a@b.co\r\nBcc: x@evil.test" })).toMatchObject({ ok: false, missing: ["EMAIL_FROM"] });
    expect(readEmailConfig({ ...full, EMAIL_REPLY_TO: "nope" })).toMatchObject({ ok: false, missing: ["EMAIL_REPLY_TO"] });
    expect(readEmailConfig({ ...full, SMTP_PORT: "99999" })).toMatchObject({ ok: false, missing: ["SMTP_PORT"] });
  });

  it("uses implicit TLS on port 465 and STARTTLS otherwise", () => {
    const tls = readEmailConfig({ ...full, SMTP_PORT: "465" });
    expect(tls.ok && tls.config.secure).toBe(true);
    const starttls = readEmailConfig(full);
    expect(starttls.ok && starttls.config.secure).toBe(false);
  });
});

describe("SMTP transport", () => {
  it("requires TLS on port 587, sets timeouts, and sends text and HTML with the configured sender", async () => {
    const cfg = readEmailConfig(full);
    if (!cfg.ok) throw new Error("config");
    const result = await createSmtpTransport(cfg.config).send({ to: "amina@example.test", subject: "S", html: "<p>H</p>", text: "T" });
    expect(result).toEqual({ ok: true, messageId: "<abc@test>" });
    expect(nm.options).toMatchObject({ host: "smtp.example.test", port: 587, secure: false, requireTLS: true, tls: { minVersion: "TLSv1.2" } });
    expect(nm.options!.connectionTimeout).toBe(10_000);
    expect(nm.mail).toMatchObject({ from: full.EMAIL_FROM, to: "amina@example.test", subject: "S", text: "T", html: "<p>H</p>" });
  });

  it("returns a short code on failure, never the provider's message", async () => {
    const cfg = readEmailConfig(full);
    if (!cfg.ok) throw new Error("config");
    nm.error = Object.assign(new Error("535 auth failed for user@example.test with s3cret-value"), { code: "EAUTH" });
    const result = await createSmtpTransport(cfg.config).send({ to: "a@b.co", subject: "S", html: "H", text: "T" });
    expect(result).toEqual({ ok: false, error: "auth_failed" });
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("maps provider errors to codes", () => {
    expect(deliveryErrorCode({ code: "ETIMEDOUT" })).toBe("timeout");
    expect(deliveryErrorCode({ code: "ECONNECTION" })).toBe("connection_failed");
    expect(deliveryErrorCode({ code: "EENVELOPE" })).toBe("recipient_rejected");
    expect(deliveryErrorCode({ responseCode: 550 })).toBe("recipient_rejected");
    expect(deliveryErrorCode({ responseCode: 451 })).toBe("temporary_failure");
    expect(deliveryErrorCode(new Error("x"))).toBe("send_failed");
  });
});
