import type { ApplicationStatus } from "@/lib/domain";

/** Every transactional email the site sends to a customer. Authentication emails are sent by Supabase Auth instead. */
export const customerEmailKinds = [
  "application_received",
  "application_status_updated",
  "additional_documents_requested",
  "application_approved",
  "application_rejected",
  "document_upload_confirmed",
  "document_review_result",
] as const;
export type CustomerEmailKind = (typeof customerEmailKinds)[number];

/** Kinds the customer's own action triggers. Every other kind follows a decision by the owner. */
export const customerTriggeredKinds: readonly CustomerEmailKind[] = ["application_received", "document_upload_confirmed"];

/**
 * The email for a status change the owner made. A request set back to "new" sends nothing. Every other status has
 * one email: the three decisions have their own, the rest share the general update.
 */
export function statusEmailKind(status: ApplicationStatus): CustomerEmailKind | null {
  if (status === "documents_required") return "additional_documents_requested";
  if (status === "approved") return "application_approved";
  if (status === "rejected") return "application_rejected";
  if (status === "new") return null;
  return "application_status_updated";
}

/**
 * The data stored with a queued email. The database builds it from customer-visible fields only (see migration 0021):
 * never internal notes, the owner's internal reason, file paths or the owner's identity.
 */
export interface EmailTemplateData {
  reference: string;
  application_id: string;
  customer_name: string;
  service_title_ar: string;
  service_title_fr: string;
  service_title_en: string;
  status?: string;
  /** Text the owner wrote for the customer: a status message, or the message for a rejected proof. */
  message?: string;
  doc_type?: string;
  verified?: boolean;
}
