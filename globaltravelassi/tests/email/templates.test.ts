import { describe, it, expect } from "vitest";
import { renderCustomerEmail, requestUrl, escapeHtml } from "@/lib/email/templates";
import { emailText } from "@/lib/email/copy";
import { customerEmailKinds, statusEmailKind, type EmailTemplateData } from "@/lib/email/kinds";
import { applicationStatuses } from "@/lib/domain";

const APP = "3f1c2a4e-1111-4222-8333-444455556666";
const SITE = "https://www.example.test";
const base: EmailTemplateData = {
  reference: "GTA-2611-ABC123",
  application_id: APP,
  customer_name: "Amina",
  service_title_ar: "استشارات التأشيرة",
  service_title_fr: "Conseil visa",
  service_title_en: "Visa consulting",
};
const sample: Record<string, Partial<EmailTemplateData>> = {
  application_status_updated: { status: "in_review", message: "We started the review." },
  additional_documents_requested: { status: "documents_required", message: "Please add a bank statement." },
  application_approved: { status: "approved" },
  application_rejected: { status: "rejected", message: "The file is incomplete." },
  document_upload_confirmed: { doc_type: "passport" },
  document_review_result: { doc_type: "passport", verified: true },
};

describe("customer email templates", () => {
  for (const kind of customerEmailKinds) {
    for (const locale of ["ar", "fr", "en"] as const) {
      it(`renders ${kind} in ${locale} with subject, HTML, text, reference and link`, () => {
        const out = renderCustomerEmail(kind, locale, { ...base, ...sample[kind] }, SITE, "GLOBALTRAVELASSI");
        expect(out.subject).toContain(base.reference);
        expect(out.subject).not.toMatch(/[\r\n]/);
        expect(out.html).toContain(`lang="${locale}"`);
        expect(out.html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
        expect(out.html).toContain(`${SITE}/${locale}/dashboard/requests/${APP}`);
        expect(out.text).toContain(`${SITE}/${locale}/dashboard/requests/${APP}`);
        expect(out.html).toContain('name="viewport"');
        expect(out.text).not.toMatch(/\{(name|ref|service|status|amount|method|doc)\}/);
        expect(out.html).not.toMatch(/\{(name|ref|service|status|amount|method|doc)\}/);
      });
    }
  }

  it("uses the language of the request, with its service title and status label", () => {
    const fr = renderCustomerEmail("application_status_updated", "fr", { ...base, status: "in_review" }, SITE, "B");
    expect(fr.text).toContain("Conseil visa");
    expect(fr.text).toContain("En cours d’examen");
    const ar = renderCustomerEmail("application_status_updated", "ar", { ...base, status: "in_review" }, SITE, "B");
    expect(ar.text).toContain("استشارات التأشيرة");
    expect(ar.text).toContain("قيد المراجعة");
    expect(ar.html).toContain('text-align:right');
  });

  it("falls back to Arabic for an unknown language", () => {
    const out = renderCustomerEmail("application_received", "de", base, SITE, "B");
    expect(out.html).toContain('lang="ar"');
  });

  it("escapes every value from the database, so a name or a message cannot inject markup", () => {
    const evil = { ...base, customer_name: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>"' };
    const out = renderCustomerEmail("application_rejected", "en", { ...evil, status: "rejected" }, SITE, "B");
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<img");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("keeps a header-breaking reference or name out of the subject line", () => {
    const out = renderCustomerEmail("application_received", "en", { ...base, reference: "GTA\r\nBcc: x@evil.test" }, SITE, "B");
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("shows only customer-visible fields: extra internal fields passed by mistake are ignored", () => {
    const leaky = { ...base, status: "rejected", decision_reason: "INTERNAL-REASON", note: "INTERNAL-NOTE", evidence_path: "u/a/payment-x.pdf" } as EmailTemplateData;
    const out = renderCustomerEmail("application_rejected", "en", leaky, SITE, "B");
    for (const secret of ["INTERNAL-REASON", "INTERNAL-NOTE", "payment-x.pdf"]) {
      expect(out.html).not.toContain(secret);
      expect(out.text).not.toContain(secret);
    }
  });


  it("picks the accepted or the needs-attention wording for a document review", () => {
    const ok = renderCustomerEmail("document_review_result", "en", { ...base, doc_type: "passport", verified: true }, SITE, "B");
    const no = renderCustomerEmail("document_review_result", "en", { ...base, doc_type: "passport", verified: false }, SITE, "B");
    expect(ok.subject).toMatch(/checked/);
    expect(no.subject).toMatch(/attention/);
  });

  it("builds the request link only from a valid id and an http(s) site address", () => {
    expect(requestUrl(SITE, "en", "not-an-id")).toBeNull();
    expect(requestUrl("javascript:alert(1)", "en", APP)).toBeNull();
    expect(requestUrl("https://www.example.test/some/path", "fr", APP)).toBe(`https://www.example.test/fr/dashboard/requests/${APP}`);
    const out = renderCustomerEmail("application_received", "en", { ...base, application_id: "x" }, SITE, "B");
    expect(out.html).not.toContain("/dashboard/requests/");
  });

  it("has the same wording keys in every language", () => {
    const keys = (l: "ar" | "fr" | "en") => JSON.stringify([Object.keys(emailText[l].chrome).sort(), Object.keys(emailText[l].copy).sort()]);
    expect(keys("fr")).toBe(keys("en"));
    expect(keys("ar")).toBe(keys("en"));
  });

  it("escapeHtml covers the five HTML special characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("which email a status change sends", () => {
  it("maps each status the owner can set", () => {
    expect(statusEmailKind("documents_required")).toBe("additional_documents_requested");
    expect(statusEmailKind("approved")).toBe("application_approved");
    expect(statusEmailKind("rejected")).toBe("application_rejected");
    for (const s of ["in_review", "submitted", "completed", "cancelled"] as const) expect(statusEmailKind(s)).toBe("application_status_updated");
    expect(statusEmailKind("new")).toBeNull();
    expect(applicationStatuses.length).toBe(8);
  });
});
