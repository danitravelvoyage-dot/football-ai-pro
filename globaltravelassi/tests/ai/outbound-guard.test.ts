import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A regression guard for the zero-cost, no-external-action rules. It reads the source, not the running system:
 *  - only the modules listed here may make network requests;
 *  - the competitor reader only sends GET requests;
 *  - no messaging, email or payment client is imported anywhere in the platform.
 * Adding a new outbound call fails this test until the call is reviewed and listed.
 */

const ROOT = resolve(__dirname, "../..");
const SOURCE_DIRS = ["lib", "app", "components"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const sources = SOURCE_DIRS.flatMap((d) => files(join(ROOT, d))).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));

/** Modules allowed to make a network request, and why. */
const NETWORK_ALLOWLIST: Record<string, string> = {
  "lib/ai/llm/openai-compatible.ts": "model provider adapter: calls only the baseUrl the owner configures; local or free by default",
  "lib/ai/services.ts": "competitor reader wrapper: public GET requests through fetchPublicPage",
  "lib/ai/competitors/fetch.ts": "public page reader: GET only, robots.txt checked, no redirects",
};

const REQUEST_PATTERN = /\b(fetch|fetchFn|fetchImpl)\s*\(|\baxios\b|\bhttps?\.request\b|\bXMLHttpRequest\b|\bsendBeacon\b/;

describe("outbound requests", () => {
  it("only allowlisted modules make network requests", () => {
    const offenders = sources.filter((s) => REQUEST_PATTERN.test(s.text) && !(s.path in NETWORK_ALLOWLIST)).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("every allowlisted module still makes a request, so the list cannot go stale", () => {
    for (const path of Object.keys(NETWORK_ALLOWLIST)) {
      const source = sources.find((s) => s.path === path);
      expect(source, path).toBeDefined();
      expect(REQUEST_PATTERN.test(source!.text), path).toBe(true);
    }
  });

  it("the competitor reader never sends anything but GET, and never follows redirects", () => {
    const text = sources.find((s) => s.path === "lib/ai/competitors/fetch.ts")!.text;
    expect(text).not.toMatch(/method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    expect(text).toContain('redirect: "manual"');
  });

  it("the model adapter sends its request only to the configured base URL", () => {
    const text = sources.find((s) => s.path === "lib/ai/llm/openai-compatible.ts")!.text;
    expect(text).toMatch(/this\.options\.baseUrl[\s\S]*\/chat\/completions/);
    expect(text).not.toMatch(/https?:\/\/[a-z0-9.-]+\.(com|io|dz|fr|net)/i);
  });
});

/**
 * Customer transactional email, authorized by the owner: SMTP through nodemailer, to the customer's own account address,
 * off unless EMAIL_DELIVERY_ENABLED=true. Only these modules may mention SMTP or nodemailer, and the AI layer may not
 * import the email module at all.
 */
const EMAIL_ALLOWLIST: Record<string, string> = {
  "lib/email/transport.ts": "the only module that sends email: SMTP server configured by the owner",
  "lib/email/config.ts": "reads the SMTP settings (names only are ever reported)",
};

describe("messaging, email and payment", () => {
  it("no messaging, email or payment client is referenced outside the customer email transport", () => {
    const pattern = /\b(twilio|nodemailer|sendgrid|mailgun|smtp|whatsapp-web|wa-automate|baileys|stripe|paypal|chargily|cmi\.|sendmail)\b/i;
    const offenders = sources.filter((s) => pattern.test(s.text) && !(s.path in EMAIL_ALLOWLIST)).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("the email transport uses nothing but nodemailer: no messaging or payment client", () => {
    // sendMail() is nodemailer's own method; the local "sendmail" binary transport is what stays forbidden.
    const pattern = /\b(twilio|sendgrid|mailgun|whatsapp-web|wa-automate|baileys|stripe|paypal|chargily)\b|sendmail\s*:/i;
    for (const path of Object.keys(EMAIL_ALLOWLIST)) {
      const source = sources.find((s) => s.path === path);
      expect(source, path).toBeDefined();
      expect(pattern.test(source!.text), path).toBe(false);
    }
  });

  it("the AI layer never imports the customer email module", () => {
    const offenders = sources.filter((s) => s.path.startsWith("lib/ai/") && /from\s+["'](@\/lib\/email|\.\.\/+email)/.test(s.text)).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it("no package that sends messages or moves money is in the dependencies, except the authorized SMTP client", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => n !== "nodemailer" && n !== "@types/nodemailer");
    const banned = names.filter((n) => /twilio|sendgrid|nodemailer|mailgun|stripe|paypal|whatsapp|baileys/i.test(n));
    expect(banned).toEqual([]);
  });
});

describe("external actions stay behind approval", () => {
  it("the only code that marks an external action as issued is the approval service", () => {
    const hits = sources.filter((s) => /markExecuted\s*\(/.test(s.text)).map((s) => s.path);
    expect(hits.sort()).toEqual(["lib/ai/approvals.ts", "lib/ai/orchestration/store.ts", "lib/ai/store/supabase-store.ts"].sort());
  });
});
