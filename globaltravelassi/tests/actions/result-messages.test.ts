import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formMessages } from "@/lib/validation/messages";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { fr } from "@/lib/i18n/fr";

/**
 * A result code without a message falls back to the generic error text, and a successful action would then show
 * "something went wrong" in a green box. Every code the customer-launch actions return must have its own message.
 * Codes listed here are given a message by the page that uses the action instead.
 */
const PAGE_OVERRIDES = new Set(["protected_records", "files_remaining"]);
const LAUNCH_ACTIONS = ["admin", "applications", "documents", "auth"];

function codesIn(file: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(`../../lib/actions/${file}.ts`, import.meta.url)), "utf8");
  return [...new Set([...source.matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]))];
}

describe("action result messages", () => {
  for (const file of LAUNCH_ACTIONS) {
    it(`every result code of lib/actions/${file}.ts has a message in every language`, () => {
      for (const dict of [en, fr, ar]) {
        const messages = formMessages(dict);
        const missing = codesIn(file).filter((code) => !PAGE_OVERRIDES.has(code) && !(code in messages));
        expect(missing).toEqual([]);
      }
    });
  }
});
