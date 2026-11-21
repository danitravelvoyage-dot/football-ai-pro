/**
 * File signature check for uploaded documents. The browser's MIME type is only a claim: the first bytes decide what the
 * file is. Only PDF, JPEG and PNG are accepted, and the type stored is the one the bytes show, never the one declared.
 */
export type DocumentMime = "application/pdf" | "image/jpeg" | "image/png";

const SIGNATURES: { mime: DocumentMime; bytes: number[] }[] = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** The type the leading bytes show, or null when none of the accepted signatures match. */
export function detectDocumentMime(head: Uint8Array): DocumentMime | null {
  for (const sig of SIGNATURES) {
    if (head.length >= sig.bytes.length && sig.bytes.every((b, i) => head[i] === b)) return sig.mime;
  }
  return null;
}

/** True only when the bytes show the type the upload declared. */
export function declaredTypeMatches(head: Uint8Array, declared: string): boolean {
  return detectDocumentMime(head) === declared;
}
