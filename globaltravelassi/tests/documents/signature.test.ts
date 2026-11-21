import { describe, it, expect } from "vitest";
import { detectDocumentMime, declaredTypeMatches } from "@/lib/documents/signature";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("document signatures", () => {
  it("recognises PDF, JPEG and PNG from their first bytes", () => {
    expect(detectDocumentMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(detectDocumentMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectDocumentMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });

  it("refuses anything else, including HTML or a script renamed to .pdf", () => {
    expect(detectDocumentMime(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(detectDocumentMime(new TextEncoder().encode("MZ\x90\x00"))).toBeNull();
  });

  it("refuses a file too short to show a signature", () => {
    expect(detectDocumentMime(bytes(0x25, 0x50))).toBeNull();
    expect(detectDocumentMime(new Uint8Array(0))).toBeNull();
  });

  it("accepts a file only when its content matches the declared type", () => {
    const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
    expect(declaredTypeMatches(pdf, "application/pdf")).toBe(true);
    expect(declaredTypeMatches(pdf, "image/png")).toBe(false);
    expect(declaredTypeMatches(bytes(0xff, 0xd8, 0xff), "application/pdf")).toBe(false);
  });
});
