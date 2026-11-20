import { checkCompliance } from "../workflows/compliance-rules";
import type { Claim, Dimension, QualityIssue, Severity } from "./types";

const FACTUAL: ReadonlyArray<Claim["category"]> = ["visa", "finance", "compliance"];
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /\p{Script=Latin}/u;
const PLACEHOLDER = /\b(mock|lorem|todo|tbd)\b/i;
const BRAND = /(guaranteed (visa|approval)|100\s?% (approval|success)|instant visa|no need to apply)/i;

export function issue(code: string, dimension: Dimension, severity: Severity, path: string): QualityIssue {
  return { code, dimension, severity, path };
}

/** Missing required data: an empty text where content is expected. */
export function completenessChecks(texts: { path: string; text: string }[]): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const t of texts) {
    if (t.text.trim().length === 0) out.push(issue("missing_data", "completeness", "blocking", t.path));
    else if (PLACEHOLDER.test(t.text)) out.push(issue("placeholder_content", "completeness", "warning", t.path));
  }
  return out;
}

/** The same text produced twice in one output. */
export function duplicateChecks(texts: { path: string; text: string }[]): QualityIssue[] {
  const seen = new Map<string, string>();
  const out: QualityIssue[] = [];
  for (const t of texts) {
    const key = t.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (key.length < 8) continue;
    if (seen.has(key)) out.push(issue("duplicate_content", "completeness", "warning", t.path));
    else seen.set(key, t.path);
  }
  return out;
}

/** The text must be in the script of the requested language. Arabic requests need Arabic script. */
export function languageChecks(texts: { path: string; text: string }[], language: "ar" | "fr" | "en"): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const t of texts) {
    const arabic = [...t.text].filter((c) => ARABIC.test(c)).length;
    const latin = [...t.text].filter((c) => LATIN.test(c)).length;
    const letters = arabic + latin;
    if (letters < 20) continue;
    if (language === "ar" && arabic / letters < 0.5) out.push(issue("language_mismatch", "completeness", "warning", t.path));
    if (language !== "ar" && arabic / letters > 0.2) out.push(issue("language_mismatch", "completeness", "warning", t.path));
  }
  return out;
}

/** Brand promises the business must never make. */
export function brandChecks(texts: { path: string; text: string }[]): QualityIssue[] {
  return texts.filter((t) => BRAND.test(t.text)).map((t) => issue("brand_violation", "policy_compliance", "blocking", t.path));
}

/** The deterministic compliance rules from the existing compliance agent, run on every text. */
export function policyChecks(texts: { path: string; text: string }[]): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const t of texts) {
    const verdict = checkCompliance(t.text);
    for (const flag of verdict.flags) {
      out.push(issue(`policy_${flag.rule}`, "policy_compliance", flag.severity === "blocking" ? "blocking" : "warning", t.path));
    }
  }
  return out;
}

/**
 * Claims judged against their evidence.
 * - No source: a medium or high confidence claim is unsupported. A factual category without an official source
 *   cannot be verified, which needs a human decision. A low confidence claim is only flagged as uncertain.
 * - Source present: an official source is required for factual categories. Old or undated sources are stale.
 */
export function factualChecks(claims: Claim[], opts: { allowlist: string[]; now: Date; maxSourceAgeDays: number }): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const c of claims) {
    const factual = FACTUAL.includes(c.category);
    if (!c.sourceUrl) {
      if (factual) out.push(issue("unverifiable_claim", "source_reliability", "critical", c.path));
      else if (c.confidence === "medium" || c.confidence === "high") out.push(issue("unsupported_claim", "factual_support", "blocking", c.path));
      else out.push(issue("uncertain_claim", "factual_support", "info", c.path));
      continue;
    }
    const host = hostOf(c.sourceUrl);
    if (!host) {
      out.push(issue("invalid_source_url", "source_reliability", factual ? "critical" : "blocking", c.path));
      continue;
    }
    const official = c.official && opts.allowlist.includes(host);
    if (factual && !official) out.push(issue("unverifiable_claim", "source_reliability", "critical", c.path));
    if (!c.checkedAt || Number.isNaN(Date.parse(c.checkedAt))) {
      out.push(issue("undated_source", "source_reliability", factual ? "blocking" : "warning", c.path));
      continue;
    }
    const ageDays = (opts.now.getTime() - Date.parse(c.checkedAt)) / 86_400_000;
    if (ageDays > opts.maxSourceAgeDays) out.push(issue("stale_source", "source_reliability", factual ? "blocking" : "warning", c.path));
  }
  return out;
}

/** Two producers give different values for the same claim key. Factual conflicts are critical. */
export function contradictionChecks(claims: Claim[]): QualityIssue[] {
  const byKey = new Map<string, Claim[]>();
  for (const c of claims) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const out: QualityIssue[] = [];
  for (const group of byKey.values()) {
    const producers = new Set(group.map((c) => c.producer));
    if (producers.size < 2) continue;
    const values = new Set(group.map((c) => JSON.stringify(c.value ?? null)));
    if (values.size < 2) continue;
    const factual = group.some((c) => FACTUAL.includes(c.category));
    out.push(issue("conflicting_claims", "factual_support", factual ? "critical" : "warning", group[0]!.path));
  }
  return out;
}

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}
