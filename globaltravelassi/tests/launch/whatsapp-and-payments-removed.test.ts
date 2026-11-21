import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

vi.mock("server-only", () => ({}));

const ROOT = resolve(__dirname, "../..");

describe("WhatsApp links", () => {
  it("build a click-to-chat link with digits only and an encoded prefilled message", async () => {
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = "+8485462510";
    vi.resetModules();
    const { whatsappLink } = await import("@/lib/config");
    expect(whatsappLink()).toBe("https://wa.me/8485462510");
    expect(whatsappLink("Hello, GTA-2611-ABC123")).toBe("https://wa.me/8485462510?text=Hello%2C%20GTA-2611-ABC123");
  });

  it("return nothing when no number is configured, so no broken link is shown", async () => {
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = "";
    vi.resetModules();
    const { whatsappLink } = await import("@/lib/config");
    expect(whatsappLink("hi")).toBeNull();
  });
});

describe("payment workflow is removed from the application", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
    });
  }
  const code = ["app", "components", "lib", "middleware.ts"]
    .flatMap((p) => (existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isDirectory() ? files(join(ROOT, p)) : [join(ROOT, p)]))
    .filter((f) => existsSync(f) && !f.includes(`${join("lib", "ai")}`));

  it("has no payment page, payment component or payment action", () => {
    expect(existsSync(join(ROOT, "app/[locale]/admin/payments"))).toBe(false);
    expect(existsSync(join(ROOT, "components/payments"))).toBe(false);
    expect(existsSync(join(ROOT, "lib/actions/payments.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "lib/payments"))).toBe(false);
  });

  it("calls no payment database function and imports no payment module", () => {
    const offenders: string[] = [];
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      if (/decide_payment|submit_payment_evidence|record_manual_payment|save_payment_method|set_manual_payment_status|from\(["']payments["']\)|from\(["']payment_method_settings["']\)|lib\/payments|actions\/payments|PaymentPanel/.test(text)) {
        offenders.push(relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the public and customer copy no longer offers payment (no 'how do I pay' answer)", () => {
    for (const l of ["en", "fr", "ar"]) {
      const text = readFileSync(join(ROOT, `lib/i18n/${l}.ts`), "utf8");
      expect(text).not.toMatch(/How do I pay|Comment payer|كيف أدفع/);
    }
  });
});
