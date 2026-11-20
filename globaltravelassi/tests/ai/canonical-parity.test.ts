import { describe, it, expect } from "vitest";
import { canonicalJson, payloadFingerprint } from "@/lib/ai/approvals/payload";
import { CANONICAL_VECTORS, CANONICAL_REFUSALS, FINGERPRINT_VECTOR } from "../fixtures/canonical-vectors";

describe("canonical JSON contract (TypeScript side)", () => {
  for (const v of CANONICAL_VECTORS) {
    it(`matches the golden text: ${v.name}`, () => {
      expect(canonicalJson(v.value)).toBe(v.expected);
    });
  }

  for (const r of CANONICAL_REFUSALS) {
    it(`refuses: ${r.name}`, () => {
      expect(() => canonicalJson(r.value)).toThrow();
    });
  }

  it("matches the golden fingerprint", () => {
    expect(payloadFingerprint({ actionClass: FINGERPRINT_VECTOR.actionClass, taskId: FINGERPRINT_VECTOR.taskId, preview: FINGERPRINT_VECTOR.preview })).toBe(FINGERPRINT_VECTOR.expected);
  });

  it("any change to the payload changes the fingerprint", () => {
    const base = { actionClass: "external_publish", taskId: FINGERPRINT_VECTOR.taskId, preview: { text: "Hello", n: 1 } };
    const same = payloadFingerprint(base);
    expect(payloadFingerprint({ ...base, preview: { text: "Hello", n: 2 } })).not.toBe(same);
    expect(payloadFingerprint({ ...base, preview: { text: "Hello", n: 1, extra: null } })).not.toBe(same);
    expect(payloadFingerprint({ ...base, preview: { text: "hello", n: 1 } })).not.toBe(same);
    expect(payloadFingerprint({ ...base, taskId: "22222222-2222-4222-8222-222222222222" })).not.toBe(same);
    expect(payloadFingerprint({ ...base, actionClass: "external_send_message" })).not.toBe(same);
  });

  it("key order in the input does not change the fingerprint", () => {
    const a = payloadFingerprint({ actionClass: "external_publish", taskId: FINGERPRINT_VECTOR.taskId, preview: { x: 1, y: { p: 1, q: 2 } } });
    const b = payloadFingerprint({ actionClass: "external_publish", taskId: FINGERPRINT_VECTOR.taskId, preview: { y: { q: 2, p: 1 }, x: 1 } });
    expect(a).toBe(b);
  });
});
