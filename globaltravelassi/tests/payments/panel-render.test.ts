import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { getDictionary, type Locale } from "@/lib/i18n";
import { offeredMethods, type MethodSetting } from "@/lib/payments/rules";
import { selfServicePaymentMethods } from "@/lib/domain";

/**
 * Renders the customer's payment panel for every method in every language, without a browser. It shows what the page
 * would send to the visitor: the instructions in the visitor's language and the labels for each step.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({}) }));
vi.mock("@/lib/actions/payments", () => ({ submitPaymentEvidenceAction: async () => ({ ok: true, code: "submitted" }) }));

// The component is compiled with the classic JSX transform, which expects React in scope (Next provides it in the app).
(globalThis as unknown as { React: typeof React }).React = React;
const { PaymentPanel } = await import("@/components/payments/PaymentPanel");

const LOCALES: Locale[] = ["fr", "en", "ar"];
const INSTR: Record<Locale, string> = { fr: "Envoyez à l’adresse indiquée", en: "Send to the address shown", ar: "أرسل إلى العنوان المعروض" };

const settingsFor = (method: string): MethodSetting[] => [
  { method, enabled: true, instructions_fr: `FR ${method} ${INSTR.fr}`, instructions_en: `EN ${method} ${INSTR.en}`, instructions_ar: `AR ${method} ${INSTR.ar}` },
];

function render(locale: Locale, method: string) {
  const dict = getDictionary(locale);
  const offered = offeredMethods(settingsFor(method), locale).map((m) => ({ method: m.method, label: dict.paymentMethods[m.method], instructions: m.instructions }));
  return renderToString(
    createElement(PaymentPanel, {
      applicationId: "00000000-0000-0000-0000-0000000000d1",
      userId: "00000000-0000-0000-0000-0000000000b1",
      amountText: "15 000 DZD",
      methods: offered,
      labels: dict.manualPayments,
    }),
  );
}

describe("customer payment panel, every method in every language", () => {
  for (const locale of LOCALES) {
    for (const method of selfServicePaymentMethods) {
      it(`${method} / ${locale}: shows the method, its instructions in ${locale}, and the amount`, () => {
        const dict = getDictionary(locale);
        const html = render(locale, method);
        expect(html).toContain(dict.paymentMethods[method]);
        expect(html).toContain(`${locale.toUpperCase()} ${method}`);
        expect(html).toContain(dict.manualPayments.instructions);
        expect(html).toContain(dict.manualPayments.price);
        expect(html).toContain("15 000 DZD");
        expect(html).toContain(dict.manualPayments.proofLabel);
      });
    }
  }

  it("shows only the instructions of the visitor's language", () => {
    const html = render("ar", "usdt");
    expect(html).toContain("AR usdt");
    expect(html).not.toContain("FR usdt");
    expect(html).not.toContain("EN usdt");
  });

  it("the three languages carry different labels for every step, so none is left in another language", () => {
    for (const key of ["price", "upload", "proofHint", "waiting", "submitted"] as const) {
      const values = LOCALES.map((l) => getDictionary(l).manualPayments[key]);
      expect(new Set(values).size).toBe(3);
      expect(values.every((v) => v.trim().length > 0)).toBe(true);
    }
  });

  it("says so when no method is offered, instead of showing an empty upload", () => {
    const dict = getDictionary("en");
    const html = renderToString(
      createElement(PaymentPanel, {
        applicationId: "00000000-0000-0000-0000-0000000000d1",
        userId: "00000000-0000-0000-0000-0000000000b1",
        amountText: "15 000 DZD",
        methods: [],
        labels: dict.manualPayments,
      }),
    );
    expect(html).toContain(dict.manualPayments.noMethods);
    expect(html).not.toContain(dict.manualPayments.proofLabel);
  });
});
