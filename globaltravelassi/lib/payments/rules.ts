import { selfServicePaymentMethods, type SelfServicePaymentMethod } from "@/lib/domain";

/**
 * Manual payment rules shared by the screens and the server actions. The database checks the same rules again in
 * submit_payment_evidence(); these checks only explain a refusal before the request is sent.
 */

export const PROOF_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** A request can take a proof only while it is approved, or while its proof is waiting. */
export function isOpenForPayment(status: string): boolean {
  return status === "approved" || status === "payment_pending";
}

/** Folder that holds a request's proofs: <user id>/<request id>/. The storage policy checks the first segment. */
export function proofFolder(userId: string, applicationId: string): string {
  return `${userId}/${applicationId}/`;
}

/** A safe, unique path for a new proof inside the request folder. The file name is cleaned; the id keeps it unique. */
export function proofPathFor(userId: string, applicationId: string, fileName: string, uniqueId: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_").replace(/^\.+/, "").slice(-100) || "proof";
  return `${proofFolder(userId, applicationId)}payment-${uniqueId}-${safe}`;
}

export type ProofProblem = "invalid_file" | "invalid_path";

/** The same checks the database makes, so a refusal can be explained before the request is sent. */
export function checkProof(input: { userId: string; applicationId: string; path: string; mime: string; size: number }): { ok: true } | { ok: false; code: ProofProblem } {
  if (!(PROOF_MIME_TYPES as readonly string[]).includes(input.mime)) return { ok: false, code: "invalid_file" };
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > PROOF_MAX_BYTES) return { ok: false, code: "invalid_file" };
  // A proof lives in the request folder and carries the payment marker, which is how unsubmitted proofs are found.
  if (!input.path.startsWith(proofFolder(input.userId, input.applicationId) + "payment-")) return { ok: false, code: "invalid_path" };
  return { ok: true };
}

/** The message a customer reads when a proof is rejected: 3 to 500 characters, required for a rejection. */
export function rejectionMessageIsValid(message: string): boolean {
  const m = message.trim();
  return m.length >= REASON_MIN && m.length <= REASON_MAX;
}

export function isSelfServiceMethod(value: string): value is SelfServicePaymentMethod {
  return (selfServicePaymentMethods as readonly string[]).includes(value);
}

export interface MethodSetting {
  method: string;
  enabled: boolean;
  instructions_fr: string;
  instructions_en: string;
  instructions_ar: string;
}

/**
 * The methods a client sees: enabled, self-service, and with instructions in every language. A method that is enabled
 * without complete instructions is not offered, whatever the stored flag says.
 */
export function offeredMethods(settings: MethodSetting[], locale: "fr" | "en" | "ar"): { method: SelfServicePaymentMethod; instructions: string }[] {
  const pick = (s: MethodSetting) => (locale === "fr" ? s.instructions_fr : locale === "en" ? s.instructions_en : s.instructions_ar);
  return settings
    .filter((s): s is MethodSetting & { method: SelfServicePaymentMethod } => isSelfServiceMethod(s.method) && s.enabled)
    .filter((s) => [s.instructions_fr, s.instructions_en, s.instructions_ar].every((t) => t.trim().length > 0))
    .map((s) => ({ method: s.method, instructions: pick(s) }));
}

/** Only a payment waiting for review can be decided, and only once. */
export function isDecidable(paymentStatus: string): boolean {
  return paymentStatus === "pending_review";
}

export function reasonIsValid(reason: string): boolean {
  const r = reason.trim();
  return r.length >= REASON_MIN && r.length <= REASON_MAX;
}
