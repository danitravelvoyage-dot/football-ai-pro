import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyCustomer, retryFailedEmails, isValidRecipient, type EmailDeps, type EmailStore, type QueuedEmail } from "@/lib/email/service";
import type { EmailTransport, OutgoingEmail } from "@/lib/email/transport";
import type { CustomerEmailKind } from "@/lib/email/kinds";

vi.mock("server-only", () => ({}));

const APP = "3f1c2a4e-1111-4222-8333-444455556666";

/** An in-memory stand-in for the database log, with the same rules: one row per dedupe key, sent is final. */
class MemoryStore implements EmailStore {
  rows = new Map<string, QueuedEmail & { key: string; dbStatus: string; attempts: number; error: string | null }>();
  recipient = "amina@example.test";
  failRecord = false;
  async enqueue(kind: CustomerEmailKind, subjectId: string) {
    const key = `${kind}:${subjectId}`;
    if ([...this.rows.values()].some((r) => r.key === key)) return null;
    const id = `e${this.rows.size + 1}`;
    const row = { id, key, kind, recipient: this.recipient, locale: "fr", status: "pending" as const, dbStatus: "pending", attempts: 0, error: null,
      data: { reference: "GTA-1", application_id: APP, customer_name: "Amina", service_title_ar: "", service_title_fr: "Conseil", service_title_en: "Consulting" } };
    this.rows.set(id, row);
    return row;
  }
  async record(id: string, status: "sent" | "failed" | "skipped", error: string | null) {
    if (this.failRecord) throw new Error("db down");
    const row = this.rows.get(id)!;
    if (row.dbStatus !== "pending") throw new Error("not waiting");
    row.dbStatus = status;
    row.error = error;
    row.attempts += 1;
  }
  async claimRetry(id: string) {
    const row = this.rows.get(id);
    if (!row || row.dbStatus !== "failed" || row.attempts >= 5) return null;
    row.dbStatus = "pending";
    return row;
  }
}

class RecordingTransport implements EmailTransport {
  sent: OutgoingEmail[] = [];
  next: { ok: true; messageId: string } | { ok: false; error: string } = { ok: true, messageId: "<m1@test>" };
  throws = false;
  async send(email: OutgoingEmail) {
    if (this.throws) throw new Error("boom with secret password=hunter2");
    this.sent.push(email);
    return this.next;
  }
}

let store: MemoryStore;
let transport: RecordingTransport;
let logs: string[];
const deps = (over: Partial<EmailDeps> = {}): EmailDeps => ({ store, transport, siteUrl: "https://www.example.test", brand: "GLOBALTRAVELASSI", log: (m) => logs.push(m), ...over });

beforeEach(() => {
  store = new MemoryStore();
  transport = new RecordingTransport();
  logs = [];
});

describe("delivery", () => {
  it("sends once to the recipient the store resolved, in the request's language, and records it as sent", async () => {
    expect(await notifyCustomer("application_received", APP, deps())).toBe("sent");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.to).toBe("amina@example.test");
    expect(transport.sent[0]!.subject).toContain("Nous avons reçu");
    expect([...store.rows.values()][0]!.dbStatus).toBe("sent");
  });

  it("never sends the same email twice: a second trigger for the same record is a duplicate", async () => {
    await notifyCustomer("document_review_result", "p1", deps());
    expect(await notifyCustomer("document_review_result", "p1", deps())).toBe("duplicate");
    expect(transport.sent).toHaveLength(1);
  });

  it("records a skipped email, never a sent one, when delivery is off or not configured", async () => {
    expect(await notifyCustomer("application_received", APP, deps({ transport: null }))).toBe("skipped");
    const row = [...store.rows.values()][0]!;
    expect(row.dbStatus).toBe("skipped");
    expect(row.error).toBe("not_configured");
  });

  it("refuses an invalid recipient without contacting the mail server", async () => {
    store.recipient = "not-an-address\r\nBcc: x@evil.test";
    expect(await notifyCustomer("application_received", APP, deps())).toBe("skipped");
    expect(transport.sent).toHaveLength(0);
    expect([...store.rows.values()][0]!.error).toBe("invalid_recipient");
  });

  it("records a failure with a short code, without the provider's message", async () => {
    transport.next = { ok: false, error: "auth_failed" };
    expect(await notifyCustomer("application_received", APP, deps())).toBe("failed");
    expect([...store.rows.values()][0]!.error).toBe("auth_failed");
  });

  it("survives a transport that throws, and does not log the error text", async () => {
    transport.throws = true;
    expect(await notifyCustomer("application_received", APP, deps())).toBe("failed");
    expect([...store.rows.values()][0]!.error).toBe("send_failed");
    expect(logs.join(" ")).not.toContain("hunter2");
  });

  it("never throws when the database cannot queue or record (the customer's action is not affected)", async () => {
    const broken: EmailStore = { enqueue: async () => { throw new Error("x"); }, record: async () => { throw new Error("x"); }, claimRetry: async () => null };
    await expect(notifyCustomer("application_received", APP, deps({ store: broken }))).resolves.toBe("error");
    store.failRecord = true;
    await expect(notifyCustomer("application_received", APP, deps())).resolves.toBe("sent");
    expect(logs.some((l) => l.includes("not recorded"))).toBe(true);
  });

  it("does not log the recipient address", async () => {
    transport.next = { ok: false, error: "timeout" };
    await notifyCustomer("application_received", APP, deps());
    expect(logs.join(" ")).not.toContain("amina@example.test");
  });
});

describe("retry", () => {
  it("retries only failed emails, and a concurrent second retry sends nothing", async () => {
    transport.next = { ok: false, error: "timeout" };
    await notifyCustomer("application_received", APP, deps());
    await notifyCustomer("document_upload_confirmed", "d1", deps({ transport: null })); // skipped: not retryable
    transport.next = { ok: true, messageId: "<m2@test>" };
    const ids = [...store.rows.keys()];
    const [a, b] = await Promise.all([retryFailedEmails(ids, deps()), retryFailedEmails(ids, deps())]);
    expect(a.sent + b.sent).toBe(1);
    expect(transport.sent).toHaveLength(2); // the first failed attempt, then one retry
    expect(store.rows.get("e1")!.dbStatus).toBe("sent");
    expect(store.rows.get("e2")!.dbStatus).toBe("skipped");
  });

  it("stops after five attempts", async () => {
    transport.next = { ok: false, error: "timeout" };
    await notifyCustomer("application_received", APP, deps());
    for (let i = 0; i < 10; i++) await retryFailedEmails(["e1"], deps());
    expect(store.rows.get("e1")!.attempts).toBe(5);
  });
});

describe("recipient check", () => {
  it("accepts a plain address and refuses lists, display names and header breaks", () => {
    expect(isValidRecipient("a.b@example.dz")).toBe(true);
    for (const bad of ["", "a@b", "a@b.c, x@y.z", "Name <a@b.co>", "a@b.co\nBcc: x@y.z", "a;b@c.de"]) expect(isValidRecipient(bad), bad).toBe(false);
  });
});
