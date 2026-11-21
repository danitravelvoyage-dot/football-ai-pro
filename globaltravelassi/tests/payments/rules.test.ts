import { describe, it, expect } from "vitest";
import { checkProof, isDecidable, isOpenForPayment, offeredMethods, proofFolder, proofPathFor, reasonIsValid, rejectionMessageIsValid, PROOF_MAX_BYTES } from "@/lib/payments/rules";

const USER = "00000000-0000-0000-0000-0000000000b1";
const APP = "00000000-0000-0000-0000-0000000000d1";
const full = (method: string, enabled: boolean, text = "Instructions") => ({
  method,
  enabled,
  instructions_fr: text,
  instructions_en: text,
  instructions_ar: text,
});

describe("request status", () => {
  it("only an approved request, or one with a proof waiting, is open for payment", () => {
    expect(isOpenForPayment("approved")).toBe(true);
    expect(isOpenForPayment("payment_pending")).toBe(true);
    for (const s of ["new", "in_review", "documents_required", "submitted", "rejected", "completed", "cancelled"]) {
      expect(isOpenForPayment(s)).toBe(false);
    }
  });
});

describe("proof file", () => {
  it("the path is inside the request's folder, and the file name is cleaned", () => {
    const path = proofPathFor(USER, APP, "../evil name?.pdf", "abc");
    expect(path.startsWith(proofFolder(USER, APP))).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain(" ");
    expect(path.endsWith("evil_name_.pdf")).toBe(true);
  });

  it("accepts a PDF, JPEG or PNG inside the folder, up to 10 MB", () => {
    const path = `${proofFolder(USER, APP)}payment-1.pdf`;
    expect(checkProof({ userId: USER, applicationId: APP, path, mime: "application/pdf", size: 1000 })).toEqual({ ok: true });
    expect(checkProof({ userId: USER, applicationId: APP, path, mime: "image/png", size: PROOF_MAX_BYTES })).toEqual({ ok: true });
  });

  it("refuses another type, an empty or oversized file, and a path outside the folder", () => {
    const path = `${proofFolder(USER, APP)}payment-1.pdf`;
    expect(checkProof({ userId: USER, applicationId: APP, path, mime: "image/gif", size: 1000 })).toEqual({ ok: false, code: "invalid_file" });
    expect(checkProof({ userId: USER, applicationId: APP, path, mime: "application/pdf", size: 0 })).toEqual({ ok: false, code: "invalid_file" });
    expect(checkProof({ userId: USER, applicationId: APP, path, mime: "application/pdf", size: PROOF_MAX_BYTES + 1 })).toEqual({ ok: false, code: "invalid_file" });
    expect(checkProof({ userId: USER, applicationId: APP, path: `other/${APP}/x.pdf`, mime: "application/pdf", size: 10 })).toEqual({ ok: false, code: "invalid_path" });
    // A document that is not a payment proof is not accepted as one.
    expect(checkProof({ userId: USER, applicationId: APP, path: `${proofFolder(USER, APP)}passport.pdf`, mime: "application/pdf", size: 10 })).toEqual({ ok: false, code: "invalid_path" });
  });
});

describe("methods offered to a client", () => {
  it("offers only enabled, self-service methods that have instructions in all three languages", () => {
    const settings = [
      full("usdt", true, "USDT wallet"),
      full("baridimob", false, "BaridiMob"),
      { ...full("redotpay", true), instructions_ar: "" },
      full("cash", true),
    ];
    expect(offeredMethods(settings, "en")).toEqual([{ method: "usdt", instructions: "USDT wallet" }]);
  });

  it("shows the instructions in the visitor's language", () => {
    const settings = [{ method: "usdt", enabled: true, instructions_fr: "FR", instructions_en: "EN", instructions_ar: "AR" }];
    expect(offeredMethods(settings, "fr")[0]?.instructions).toBe("FR");
    expect(offeredMethods(settings, "ar")[0]?.instructions).toBe("AR");
  });
});

describe("the owner's decision", () => {
  it("only a payment waiting for review can be decided", () => {
    expect(isDecidable("pending_review")).toBe(true);
    for (const s of ["received", "rejected", "pending", "cancelled"]) expect(isDecidable(s)).toBe(false);
  });

  it("a rejection needs a message the customer can read, of 3 to 500 characters", () => {
    expect(rejectionMessageIsValid("  no  ")).toBe(false);
    expect(rejectionMessageIsValid("The amount on the proof is lower than the price.")).toBe(true);
    expect(rejectionMessageIsValid("x".repeat(501))).toBe(false);
  });

  it("a reason needs 3 to 500 characters once trimmed", () => {
    expect(reasonIsValid("  ok  ")).toBe(false);
    expect(reasonIsValid("Funds seen")).toBe(true);
    expect(reasonIsValid("x".repeat(501))).toBe(false);
  });
});
