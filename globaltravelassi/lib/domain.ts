// Single source of truth for enumerations. The database CHECK constraints use the same values.
export const applicationStatuses = [
  "new", "in_review", "documents_required", "submitted", "approved", "rejected", "completed", "cancelled", "payment_pending",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

export const employmentStatuses = ["employed", "self_employed", "student", "unemployed", "retired", "other"] as const;
export type EmploymentStatus = (typeof employmentStatuses)[number];

export const documentTypes = [
  "passport", "photo", "bank_statement", "employment_letter", "invitation_letter",
  "hotel_booking", "flight_booking", "civil_status", "other",
] as const;
export type DocumentType = (typeof documentTypes)[number];

export const paymentMethods = ["cash", "bank_transfer", "ccp", "baridimob", "other", "usdt", "redotpay"] as const;

/** The methods a client can choose. Each one is offered only when the owner enables it, with instructions. */
export const selfServicePaymentMethods = ["usdt", "baridimob", "redotpay"] as const;
export type SelfServicePaymentMethod = (typeof selfServicePaymentMethods)[number];
export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentStatuses = ["pending", "received", "cancelled", "pending_review", "rejected"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export const currencies = ["DZD", "EUR", "USD"] as const;
export type Currency = (typeof currencies)[number];

export const serviceCategories = ["visa", "appointment", "e_visa", "transit", "european_trip", "consultation"] as const;
export type ServiceCategory = (typeof serviceCategories)[number];

/** Statuses in which the customer may still add or remove documents. */
export const documentsEditableStatuses: readonly ApplicationStatus[] = ["new", "documents_required"];

export interface ServiceRow {
  id: string;
  slug: string;
  category: ServiceCategory;
  title_ar: string;
  title_fr: string;
  title_en: string;
  description_ar: string;
  description_fr: string;
  description_en: string;
  price: string | number | null;
  currency: Currency;
  is_active: boolean;
  sort_order: number;
}

export interface ApplicationRow {
  id: string;
  reference: string;
  user_id: string;
  service_id: string;
  full_name: string;
  email: string;
  whatsapp: string;
  nationality: string;
  country_of_residence: string;
  destination_country: string;
  travel_date: string | null;
  employment_status: EmploymentStatus;
  previous_travel_history: string;
  additional_info: string;
  status: ApplicationStatus;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  application_id: string;
  user_id: string;
  doc_type: DocumentType;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  verified: boolean;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  application_id: string;
  amount: string | number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  note: string;
  received_at: string | null;
  created_at: string;
  /** Owner-side fields. Legacy and owner-recorded payments have none; customers never receive these (see customer_payments). */
  evidence_path?: string | null;
  submitted_at?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  decision_reason?: string | null;
  customer_visible_rejection_message?: string | null;
}

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  whatsapp: string;
  role: "customer" | "admin";
  is_active: boolean;
  created_at: string;
}

export interface EventRow {
  id: string;
  application_id: string;
  kind: "created" | "status" | "document" | "payment";
  to_status: ApplicationStatus | null;
  message: string;
  created_at: string;
}

export interface NoteRow {
  id: string;
  application_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}
