import { describe, expect, it } from "vitest";
import { DOCUMENT_CHECKLIST, documentChecklist, qualifyLead, type QualificationInput } from "@/lib/crm/insights";
import { serviceCategories, documentTypes } from "@/lib/domain";

const NOW = new Date("2026-11-22T12:00:00Z");
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

const base: QualificationInput = {
  status: "new",
  travel_date: null,
  whatsapp: "",
  previous_travel_history: "",
  last_contacted_at: null,
  created_at: hoursAgo(1),
  category: "visa",
  documents: [],
};

describe("document checklist", () => {
  it("has a list for every service category, using only known document types", () => {
    expect(Object.keys(DOCUMENT_CHECKLIST).sort()).toEqual([...serviceCategories].sort());
    for (const list of Object.values(DOCUMENT_CHECKLIST)) {
      for (const type of list) expect(documentTypes).toContain(type);
    }
  });

  it("marks each usual document as verified, uploaded or missing", () => {
    const c = documentChecklist("visa", [
      { doc_type: "passport", verified: true },
      { doc_type: "photo", verified: false },
      { doc_type: "other", verified: true },
    ]);
    expect(c.items.find((i) => i.type === "passport")?.state).toBe("verified");
    expect(c.items.find((i) => i.type === "photo")?.state).toBe("uploaded");
    expect(c.missing).toEqual(["bank_statement", "employment_letter", "flight_booking", "hotel_booking"]);
    expect(c.coverage).toBe("partial");
  });

  it("a verified copy wins over an unverified one of the same type", () => {
    const c = documentChecklist("appointment", [
      { doc_type: "passport", verified: false },
      { doc_type: "passport", verified: true },
    ]);
    expect(c.items).toEqual([{ type: "passport", state: "verified" }]);
    expect(c.coverage).toBe("complete");
  });

  it("services that need no documents are not applicable, and unknown categories have an empty list", () => {
    expect(documentChecklist("itinerary", []).coverage).toBe("not_applicable");
    expect(documentChecklist(null, []).coverage).toBe("not_applicable");
    expect(documentChecklist("e_visa", []).coverage).toBe("none");
  });
});

describe("lead qualification", () => {
  it("a closed request is closed, with no follow-up and no action", () => {
    for (const status of ["rejected", "completed", "cancelled"]) {
      const q = qualifyLead({ ...base, status, created_at: hoursAgo(500) }, NOW);
      expect(q).toMatchObject({ tier: "closed", score: 0, followUpDue: false, nextAction: "none", reasons: ["closed"] });
    }
  });

  it("a ready request scores high and only needs a review", () => {
    const q = qualifyLead(
      {
        ...base,
        status: "in_review",
        travel_date: daysFromNow(30),
        whatsapp: "0000000002",
        previous_travel_history: "France 2023",
        last_contacted_at: hoursAgo(24),
        documents: DOCUMENT_CHECKLIST.visa.map((doc_type) => ({ doc_type, verified: false })),
      },
      NOW,
    );
    expect(q.score).toBe(100);
    expect(q.tier).toBe("high");
    expect(q.nextAction).toBe("review");
    expect(q.followUpDue).toBe(false);
    expect(q.reasons).toEqual(["travel_soon", "passport_uploaded", "documents_complete", "whatsapp_given", "history_given", "contacted"]);
  });

  it("an empty request scores low and asks for a first contact once two days have passed", () => {
    const fresh = qualifyLead({ ...base, created_at: hoursAgo(10) }, NOW);
    expect(fresh.tier).toBe("low");
    expect(fresh.followUpDue).toBe(false);
    expect(fresh.nextAction).toBe("contact");

    const old = qualifyLead({ ...base, created_at: hoursAgo(49) }, NOW);
    expect(old.followUpDue).toBe(true);
    expect(old.nextAction).toBe("contact");
    expect(old.reasons).toEqual(["travel_unknown", "passport_missing", "documents_none", "not_contacted"]);
  });

  it("asks for missing documents once the customer has been contacted", () => {
    const q = qualifyLead({ ...base, travel_date: daysFromNow(120), last_contacted_at: hoursAgo(5), documents: [{ doc_type: "passport", verified: true }] }, NOW);
    expect(q.nextAction).toBe("request_documents");
    expect(q.reasons).toContain("travel_planned");
    expect(q.reasons).toContain("documents_partial");
  });

  it("an open request last contacted more than seven days ago is due again", () => {
    const q = qualifyLead({ ...base, status: "documents_required", last_contacted_at: hoursAgo(8 * 24), created_at: hoursAgo(20 * 24) }, NOW);
    expect(q.followUpDue).toBe(true);
    expect(q.nextAction).toBe("contact");
  });

  it("a travel date in the past asks the team to confirm the date first", () => {
    const q = qualifyLead({ ...base, travel_date: daysFromNow(-3), last_contacted_at: hoursAgo(2) }, NOW);
    expect(q.reasons[0]).toBe("travel_passed");
    expect(q.nextAction).toBe("confirm_date");
  });

  it("services without a document checklist are not penalised", () => {
    const q = qualifyLead({ ...base, category: "itinerary", travel_date: daysFromNow(10), whatsapp: "x", previous_travel_history: "y" }, NOW);
    expect(q.reasons).toContain("documents_not_needed");
    expect(q.score).toBe(100);
  });

  it("ignores nationality, residence, employment and income: they are never scored", () => {
    const one = qualifyLead({ ...base, ...{ nationality: "DZ", country_of_residence: "DZ", employment_status: "unemployed", income: 0 } } as QualificationInput, NOW);
    const two = qualifyLead({ ...base, ...{ nationality: "FR", country_of_residence: "FR", employment_status: "employed", income: 99999 } } as QualificationInput, NOW);
    expect(one).toEqual(two);
  });

  it("is deterministic: the same input gives the same result", () => {
    const input = { ...base, travel_date: daysFromNow(45), documents: [{ doc_type: "photo", verified: false }] };
    expect(qualifyLead(input, NOW)).toEqual(qualifyLead(input, NOW));
  });
});
