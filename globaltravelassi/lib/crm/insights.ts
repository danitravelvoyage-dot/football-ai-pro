import type { ApplicationStatus, DocumentType, ServiceCategory } from "@/lib/domain";

/**
 * Lead qualification and document checklist for a service request. Deterministic rules on the request's own data:
 * no model, no network, no database. The same inputs always give the same result, and every result lists its reasons.
 *
 * Fairness rule: only readiness signals are scored (travel date, documents, contact details, contact state).
 * Nationality, country of residence, employment and income are never scored, so customers are not ranked on who
 * they are.
 */

// ---------- Document checklist -------------------------------------------------

/**
 * Documents usually requested for each kind of service. This is a working checklist for the team, not an official
 * list: the consulate, the airline or the authority decides, and the team confirms the exact list for each file.
 */
export const DOCUMENT_CHECKLIST: Record<ServiceCategory, readonly DocumentType[]> = {
  visa: ["passport", "photo", "bank_statement", "employment_letter", "flight_booking", "hotel_booking"],
  appointment: ["passport"],
  e_visa: ["passport", "photo"],
  transit: ["passport", "flight_booking"],
  booking: ["passport"],
  itinerary: [],
  consultation: [],
  european_trip: ["passport", "photo"],
};

export type ChecklistItemState = "verified" | "uploaded" | "missing";
export type ChecklistCoverage = "complete" | "partial" | "none" | "not_applicable";

export interface ChecklistItem {
  type: DocumentType;
  state: ChecklistItemState;
}

export interface DocumentChecklist {
  items: ChecklistItem[];
  missing: DocumentType[];
  coverage: ChecklistCoverage;
}

export interface DocumentSummary {
  doc_type: DocumentType | string;
  verified: boolean;
}

export function documentChecklist(category: ServiceCategory | null | undefined, documents: readonly DocumentSummary[]): DocumentChecklist {
  const required = category ? DOCUMENT_CHECKLIST[category] ?? [] : [];
  const items: ChecklistItem[] = required.map((type) => {
    const ofType = documents.filter((d) => d.doc_type === type);
    const state: ChecklistItemState = ofType.some((d) => d.verified) ? "verified" : ofType.length > 0 ? "uploaded" : "missing";
    return { type, state };
  });
  const missing = items.filter((i) => i.state === "missing").map((i) => i.type);
  const coverage: ChecklistCoverage =
    items.length === 0 ? "not_applicable" : missing.length === 0 ? "complete" : missing.length === items.length ? "none" : "partial";
  return { items, missing, coverage };
}

// ---------- Lead qualification -------------------------------------------------

export const CLOSED_STATUSES: readonly ApplicationStatus[] = ["rejected", "completed", "cancelled"];

export type LeadTier = "high" | "medium" | "low" | "closed";

export type QualificationReason =
  | "travel_soon"
  | "travel_planned"
  | "travel_far"
  | "travel_unknown"
  | "travel_passed"
  | "passport_uploaded"
  | "passport_missing"
  | "documents_complete"
  | "documents_partial"
  | "documents_none"
  | "documents_not_needed"
  | "whatsapp_given"
  | "history_given"
  | "contacted"
  | "not_contacted"
  | "closed";

export type NextAction = "none" | "confirm_date" | "contact" | "request_documents" | "review";

export interface QualificationInput {
  status: ApplicationStatus | string;
  travel_date: string | null;
  whatsapp: string | null;
  previous_travel_history: string | null;
  last_contacted_at: string | null;
  created_at: string;
  category: ServiceCategory | null | undefined;
  documents: readonly DocumentSummary[];
}

export interface Qualification {
  tier: LeadTier;
  /** 0 to 100: the share of the readiness points this request has. */
  score: number;
  reasons: QualificationReason[];
  followUpDue: boolean;
  nextAction: NextAction;
  checklist: DocumentChecklist;
}

const DAY_MS = 86_400_000;
const MAX_POINTS = 9;
/** A request nobody has contacted after this long is due for follow-up. */
export const FIRST_CONTACT_DUE_MS = 2 * DAY_MS;
/** An open request whose last contact is older than this is due for follow-up. */
export const RECONTACT_DUE_MS = 7 * DAY_MS;

function travelSignal(travelDate: string | null, now: Date): { reason: QualificationReason; points: number } {
  if (!travelDate) return { reason: "travel_unknown", points: 0 };
  const when = Date.parse(`${travelDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(when)) return { reason: "travel_unknown", points: 0 };
  const days = Math.floor((when - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY_MS);
  if (days < 0) return { reason: "travel_passed", points: 0 };
  if (days <= 90) return { reason: "travel_soon", points: 3 };
  if (days <= 180) return { reason: "travel_planned", points: 2 };
  return { reason: "travel_far", points: 1 };
}

export function qualifyLead(input: QualificationInput, now: Date): Qualification {
  const checklist = documentChecklist(input.category, input.documents);

  if ((CLOSED_STATUSES as readonly string[]).includes(input.status)) {
    return { tier: "closed", score: 0, reasons: ["closed"], followUpDue: false, nextAction: "none", checklist };
  }

  const reasons: QualificationReason[] = [];
  let points = 0;

  const travel = travelSignal(input.travel_date, now);
  reasons.push(travel.reason);
  points += travel.points;

  if (checklist.coverage === "not_applicable") {
    reasons.push("documents_not_needed");
    points += 4;
  } else {
    const needsPassport = checklist.items.some((i) => i.type === "passport");
    const hasPassport = checklist.items.some((i) => i.type === "passport" && i.state !== "missing");
    if (needsPassport) {
      reasons.push(hasPassport ? "passport_uploaded" : "passport_missing");
      if (hasPassport) points += 2;
    } else {
      points += 2;
    }
    const coverageReason: Record<Exclude<ChecklistCoverage, "not_applicable">, QualificationReason> = {
      complete: "documents_complete",
      partial: "documents_partial",
      none: "documents_none",
    };
    reasons.push(coverageReason[checklist.coverage]);
    points += checklist.coverage === "complete" ? 2 : checklist.coverage === "partial" ? 1 : 0;
  }

  if (input.whatsapp && input.whatsapp.trim()) {
    reasons.push("whatsapp_given");
    points += 1;
  }
  if (input.previous_travel_history && input.previous_travel_history.trim()) {
    reasons.push("history_given");
    points += 1;
  }

  const createdMs = Date.parse(input.created_at);
  const lastContactMs = input.last_contacted_at ? Date.parse(input.last_contacted_at) : null;
  reasons.push(lastContactMs === null ? "not_contacted" : "contacted");
  const followUpDue =
    lastContactMs === null
      ? !Number.isNaN(createdMs) && now.getTime() - createdMs >= FIRST_CONTACT_DUE_MS
      : now.getTime() - lastContactMs >= RECONTACT_DUE_MS;

  const score = Math.round((points / MAX_POINTS) * 100);
  const tier: LeadTier = score >= 67 ? "high" : score >= 34 ? "medium" : "low";

  const nextAction: NextAction =
    travel.reason === "travel_passed"
      ? "confirm_date"
      : lastContactMs === null || followUpDue
        ? "contact"
        : checklist.missing.length > 0
          ? "request_documents"
          : "review";

  return { tier, score, reasons, followUpDue, nextAction, checklist };
}
