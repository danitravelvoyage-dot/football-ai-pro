import { getDictionary, isLocale, type Locale } from "@/lib/i18n";
import { emailText, type EmailCopy } from "./copy";
import type { CustomerEmailKind, EmailTemplateData } from "./kinds";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Removes line breaks and control characters, so a value can never start a new header line in the subject. */
function oneLine(value: string, max = 200): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function copyFor(kind: CustomerEmailKind, data: EmailTemplateData, locale: Locale): EmailCopy {
  const copies = emailText[locale].copy;
  if (kind === "document_review_result") return data.verified ? copies.document_review_ok : copies.document_review_not_ok;
  return copies[kind];
}

/** Link to the request in the customer's account. Only a well-formed request id and an http(s) site address are used. */
export function requestUrl(siteUrl: string, locale: Locale, applicationId: string): string | null {
  if (!UUID.test(applicationId)) return null;
  let base: URL;
  try {
    base = new URL(siteUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  return new URL(`/${locale}/dashboard/requests/${applicationId}`, base.origin).toString();
}

/**
 * Builds the subject, HTML and plain-text body of a customer email. Every value from the database is escaped. Arabic
 * emails are laid out right to left. The layout is a single 600px column that shrinks on phones.
 */
export function renderCustomerEmail(kind: CustomerEmailKind, rawLocale: string, data: EmailTemplateData, siteUrl: string, brand: string): RenderedEmail {
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ar";
  const dict = getDictionary(locale);
  const { chrome } = emailText[locale];
  const copy = copyFor(kind, data, locale);
  const rtl = locale === "ar";

  const service = (locale === "ar" ? data.service_title_ar : locale === "fr" ? data.service_title_fr : data.service_title_en) || data.service_title_en || "";
  const statusLabel = data.status ? (dict.statuses as Record<string, string>)[data.status] ?? "" : "";
  const docLabel = data.doc_type ? (dict.docTypes as Record<string, string>)[data.doc_type] ?? "" : "";
  const name = oneLine(data.customer_name || "", 120);
  const reference = oneLine(data.reference || "", 40);

  const values = { name, ref: reference, service: oneLine(service, 120), status: statusLabel, doc: docLabel };
  const subject = oneLine(`${fill(copy.subject, values)} · ${brand}`, 180);
  const heading = fill(copy.heading, values);
  const paragraphs = copy.body.map((p) => fill(p, values));
  const greeting = fill(chrome.greeting, values);
  const message = (data.message ?? "").trim().slice(0, 500);
  const link = requestUrl(siteUrl, locale, data.application_id);

  const details: [string, string][] = [[chrome.reference, reference]];
  if (service) details.push([chrome.service, values.service]);
  if (statusLabel) details.push([chrome.status, statusLabel]);
  if (docLabel) details.push([chrome.document, docLabel]);

  // ---- plain text ----
  const text = [
    greeting,
    "",
    heading,
    "",
    ...paragraphs,
    "",
    ...details.map(([k, v]) => `${k}: ${v}`),
    ...(message ? ["", `${chrome.teamMessage}:`, message] : []),
    ...(link ? ["", `${chrome.cta}: ${link}`] : []),
    "",
    "—",
    chrome.automatic,
    chrome.security,
    `${brand} · ${chrome.brandLine}`,
  ].join("\n");

  // ---- HTML ----
  const align = rtl ? "right" : "left";
  const font = rtl ? "Tahoma, 'Segoe UI', Arial, sans-serif" : "'Segoe UI', Helvetica, Arial, sans-serif";
  const e = escapeHtml;
  const rows = details
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#5b6b86;font-size:14px;width:40%;text-align:${align}">${e(k)}</td><td style="padding:6px 0;color:#0b1b3a;font-size:14px;font-weight:600;text-align:${align}" dir="auto">${e(v)}</td></tr>`)
    .join("");
  const messageBlock = message
    ? `<tr><td style="padding:8px 32px 0"><div style="border-${rtl ? "right" : "left"}:4px solid #c9a24a;background:#faf6ea;padding:12px 16px;border-radius:8px"><p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#7a5d17;text-align:${align}">${e(chrome.teamMessage)}</p><p style="margin:0;font-size:15px;line-height:1.6;color:#0b1b3a;white-space:pre-line;text-align:${align}" dir="auto">${e(message)}</p></div></td></tr>`
    : "";
  const button = link
    ? `<tr><td style="padding:24px 32px 8px;text-align:${align}"><a href="${e(link)}" style="display:inline-block;background:#0b1b3a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px">${e(chrome.cta)}</a></td></tr>`
    : "";

  const html = `<!doctype html>
<html lang="${locale}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
<style>@media (max-width:620px){.gta-card{width:100%!important;border-radius:0!important}.gta-pad{padding-left:20px!important;padding-right:20px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:${font}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f6;padding:24px 0">
<tr><td align="center">
<table role="presentation" class="gta-card" width="600" cellspacing="0" cellpadding="0" dir="${rtl ? "rtl" : "ltr"}" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td class="gta-pad" style="background:#0b1b3a;padding:20px 32px;text-align:${align}"><p style="margin:0;color:#c9a24a;font-size:18px;font-weight:700;letter-spacing:1px">${e(brand)}</p><p style="margin:4px 0 0;color:#c7d0e0;font-size:13px">${e(chrome.brandLine)}</p></td></tr>
<tr><td class="gta-pad" style="padding:28px 32px 0;text-align:${align}"><p style="margin:0 0 12px;font-size:15px;color:#0b1b3a" dir="auto">${e(greeting)}</p><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0b1b3a">${e(heading)}</h1>${paragraphs.map((p) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#243656">${e(p)}</p>`).join("")}</td></tr>
<tr><td class="gta-pad" style="padding:12px 32px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e3e8f0;border-bottom:1px solid #e3e8f0">${rows}</table></td></tr>
${messageBlock}
${button}
<tr><td class="gta-pad" style="padding:24px 32px 28px;text-align:${align}"><p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#6b7a93">${e(chrome.automatic)}</p><p style="margin:0;font-size:12px;line-height:1.5;color:#6b7a93">${e(chrome.security)}</p></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
