/**
 * Golden vectors for the canonical JSON contract (lib/ai/approvals/payload.ts). The expected text is written by
 * hand from the contract. The database test runs the same inputs through migration 0007. The fingerprint
 * values were computed independently with Python hashlib, not with the code under test.
 */
export const CANONICAL_VECTORS: { name: string; value: unknown; expected: string }[] = [
  { name: "null", value: null, expected: "null" },
  { name: "true", value: true, expected: "true" },
  { name: "false", value: false, expected: "false" },
  { name: "empty object", value: {}, expected: "{}" },
  { name: "empty array", value: [], expected: "[]" },
  { name: "quote and backslash", value: 'a"b\\c', expected: '"a\\"b\\\\c"' },
  { name: "control characters", value: "\u0001\b\t\n\f\r", expected: '"\\u0001\\b\\t\\n\\f\\r"' },
  { name: "slash is not escaped", value: "a/b", expected: '"a/b"' },
  {
    name: "nested keys are sorted at every level",
    value: { b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } },
    expected: '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
  },
  {
    name: "keys sort by UTF-8 bytes",
    value: { "\u{1F600}": 1, "é": 2, Z: 3, a: 4 },
    expected: '{"Z":3,"a":4,"é":2,"\u{1F600}":1}',
  },
  { name: "numbers: zero, negative zero, decimals, large", value: [0, -0, 1.5, -2, 100.25, 1e20, 0.000001], expected: "[0,0,1.5,-2,100.25,100000000000000000000,0.000001]" },
  { name: "undefined object values are omitted", value: { a: undefined, b: 1 }, expected: '{"b":1}' },
  { name: "undefined array items become null", value: [undefined, 1], expected: "[null,1]" },
  { name: "arabic text is written as is", value: { text: "مرحبا" }, expected: '{"text":"مرحبا"}' },
  { name: "array order is kept", value: [{ b: 1 }, { a: 2 }], expected: '[{"b":1},{"a":2}]' },
];

/** Values the contract refuses. Both backends must refuse each one. */
export const CANONICAL_REFUSALS: { name: string; value: unknown; database: boolean }[] = [
  { name: "NaN", value: Number.NaN, database: false },
  { name: "Infinity", value: Number.POSITIVE_INFINITY, database: false },
  { name: "1e21 (exponent form)", value: 1e21, database: true },
  { name: "1e-7 (exponent form)", value: 1e-7, database: true },
  { name: "lone surrogate", value: "\ud800", database: false },
];

/** Fingerprint golden value, computed independently with Python hashlib over the text below. */
export const FINGERPRINT_VECTOR = {
  actionClass: "external_publish",
  taskId: "11111111-1111-4111-8111-111111111111",
  preview: { text: "Hello", n: 1 },
  expected: "9d18a901c8c22f3f026723348723c25413f67c204b4a6ab6df37ff5ed8ca41a3",
};
