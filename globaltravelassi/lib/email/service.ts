import { customerEmailKinds, type CustomerEmailKind, type EmailTemplateData } from "./kinds";
import { renderCustomerEmail } from "./templates";
import type { EmailTransport } from "./transport";

/**
 * Customer email delivery. Order of work, for one email:
 *  1. queue it in the database, which computes the dedupe key, the recipient and the content (a duplicate stops here);
 *  2. check the recipient;
 *  3. if delivery is off or not configured, record it as skipped (never as sent);
 *  4. send it, then record sent or failed with a short error code.
 * Nothing here throws: an email problem never undoes or blocks the customer's or the owner's action.
 */

export interface QueuedEmail {
  id: string;
  kind: CustomerEmailKind;
  recipient: string;
  locale: string;
  data: EmailTemplateData;
  /** "skipped" when the database already refused the recipient. */
  status: "pending" | "skipped";
}

export interface EmailStore {
  /** Queues the email about one record. Returns null when it was already queued. */
  enqueue(kind: CustomerEmailKind, subjectId: string): Promise<QueuedEmail | null>;
  record(id: string, status: "sent" | "failed" | "skipped", error: string | null, messageId: string | null): Promise<void>;
  /** Takes a failed email for another attempt; null when another caller took it or it is not retryable. */
  claimRetry(id: string): Promise<QueuedEmail | null>;
}

export interface EmailDeps {
  store: EmailStore;
  /** Null when delivery is off or the mail server is not configured. */
  transport: EmailTransport | null;
  siteUrl: string;
  brand: string;
  log?: (message: string) => void;
}

export type DeliveryOutcome = "sent" | "failed" | "skipped" | "duplicate" | "error";

const RECIPIENT = /^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$/;

export function isValidRecipient(value: string): boolean {
  return value.length <= 254 && RECIPIENT.test(value) && !/[\r\n]/.test(value);
}

export function isCustomerEmailKind(value: string): value is CustomerEmailKind {
  return (customerEmailKinds as readonly string[]).includes(value);
}

async function safeRecord(deps: EmailDeps, email: QueuedEmail, status: "sent" | "failed" | "skipped", error: string | null, messageId: string | null): Promise<boolean> {
  try {
    await deps.store.record(email.id, status, error, messageId);
    return true;
  } catch {
    // The email stays "pending" in the log: the owner sees an unknown outcome instead of a false one.
    deps.log?.(`customer email ${email.kind}: delivery result not recorded`);
    return false;
  }
}

/** Sends one queued email and records the result. */
export async function deliverQueued(email: QueuedEmail, deps: EmailDeps): Promise<DeliveryOutcome> {
  if (email.status === "skipped") return "skipped";
  if (!isValidRecipient(email.recipient)) {
    await safeRecord(deps, email, "skipped", "invalid_recipient", null);
    return "skipped";
  }
  if (!deps.transport) {
    await safeRecord(deps, email, "skipped", "not_configured", null);
    return "skipped";
  }
  let rendered;
  try {
    rendered = renderCustomerEmail(email.kind, email.locale, email.data, deps.siteUrl, deps.brand);
  } catch {
    await safeRecord(deps, email, "failed", "render_failed", null);
    return "failed";
  }
  let result: Awaited<ReturnType<EmailTransport["send"]>>;
  try {
    result = await deps.transport.send({ to: email.recipient, ...rendered });
  } catch {
    result = { ok: false, error: "send_failed" };
  }
  if (result.ok) {
    await safeRecord(deps, email, "sent", null, result.messageId);
    return "sent";
  }
  deps.log?.(`customer email ${email.kind}: ${result.error}`);
  await safeRecord(deps, email, "failed", result.error, null);
  return "failed";
}

/** Queues and sends the email of `kind` about one record (a request, an event, a payment or a document). */
export async function notifyCustomer(kind: CustomerEmailKind, subjectId: string, deps: EmailDeps): Promise<DeliveryOutcome> {
  let queued: QueuedEmail | null;
  try {
    queued = await deps.store.enqueue(kind, subjectId);
  } catch {
    deps.log?.(`customer email ${kind}: not queued`);
    return "error";
  }
  if (!queued) return "duplicate";
  return deliverQueued(queued, deps);
}

/** Owner: another attempt for each failed email. Returns how many were sent and how many failed again. */
export async function retryFailedEmails(ids: string[], deps: EmailDeps): Promise<{ sent: number; failed: number; skipped: number }> {
  const totals = { sent: 0, failed: 0, skipped: 0 };
  for (const id of ids) {
    let claimed: QueuedEmail | null = null;
    try {
      claimed = await deps.store.claimRetry(id);
    } catch {
      claimed = null;
    }
    if (!claimed) continue;
    const outcome = await deliverQueued(claimed, deps);
    if (outcome === "sent") totals.sent += 1;
    else if (outcome === "skipped") totals.skipped += 1;
    else totals.failed += 1;
  }
  return totals;
}
