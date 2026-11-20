import { describe, it, expect } from "vitest";
import { assertNoPersonalData, PersonalDataError } from "@/lib/ai/security/personal-data";
import { redact } from "@/lib/ai/logging";

describe("personal data guard", () => {
  it("blocks email addresses and phone numbers in values", () => {
    expect(() => assertNoPersonalData({ note: "contact amina@example.dz" })).toThrow(PersonalDataError);
    expect(() => assertNoPersonalData({ note: "call +213555123456" })).toThrow(PersonalDataError);
    expect(() => assertNoPersonalData({ note: "0555 123 456" })).not.toThrow();
  });

  it("blocks personal field names at any depth", () => {
    expect(() => assertNoPersonalData({ rows: [{ full_name: "Amina" }] })).toThrow(PersonalDataError);
    expect(() => assertNoPersonalData({ upstream: [{ output: { email: "x" } }] })).toThrow(PersonalDataError);
    expect(() => assertNoPersonalData({ storage_path: "a/b/c.pdf" })).toThrow(PersonalDataError);
  });

  it("blocks customer document fields", () => {
    expect(() => assertNoPersonalData({ documents: [] })).toThrow(PersonalDataError);
  });

  it("allows aggregate counts", () => {
    expect(() => assertNoPersonalData({ aggregates: [{ status: "new", count: 12 }] })).not.toThrow();
  });
});

describe("log redaction", () => {
  it("never prints secret-looking fields", () => {
    const out = redact({ providerId: "x", AI_HOSTED_API_KEY: "sk-123", authorization: "Bearer abc", taskId: "t1" });
    expect(out.AI_HOSTED_API_KEY).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.taskId).toBe("t1");
  });
});
