export interface ComplianceRule {
  id: string;
  severity: "warning" | "blocking";
  pattern: RegExp;
  explanation: string;
}

/** Deterministic rules run on every draft. They do not depend on a model. */
/**
 * Word boundaries use Unicode lookarounds: JavaScript's \b only understands ASCII letters,
 * so it would never match Arabic words.
 */
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";

export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: "guaranteed-outcome",
    severity: "blocking",
    pattern: new RegExp(
      `${WORD_START}(garanti\\p{L}*|guarantee[ds]?|100\\s?%|sans\\s+risque|visa\\s+assur\\p{L}*|assured\\s+visa|نضمن|مضمون\\p{L}*)${WORD_END}`,
      "iu",
    ),
    explanation: "Promises a guaranteed outcome.",
  },
  {
    id: "fake-urgency",
    severity: "blocking",
    pattern: new RegExp(`${WORD_START}(dernière\\s+chance|last\\s+chance|plus\\s+que\\s+\\d+\\s+places|أخر\\s+فرصة|آخر\\s+فرصة)`, "iu"),
    explanation: "Uses fake urgency.",
  },
  {
    id: "unverified-availability",
    severity: "blocking",
    pattern: new RegExp(
      `${WORD_START}(disponibles?|available|متوفر\\p{L}*|متاح\\p{L}*)\\s+(dans|in|خلال|après|بعد)\\s+\\d+\\s+(jours?|days?|أيام|يوم)${WORD_END}`,
      "iu",
    ),
    explanation: "States an appointment availability window that must be verified against the official calendar.",
  },
  {
    id: "invented-testimonial",
    severity: "warning",
    pattern: new RegExp(`${WORD_START}(témoignage\\s+de|testimonial\\s+from|شهادة\\s+عميل)`, "iu"),
    explanation: "Refers to a testimonial. Only real, approved testimonials may be used.",
  },
];

export interface ComplianceFlag {
  rule: string;
  excerpt: string;
  severity: "info" | "warning" | "blocking";
}

export function checkCompliance(text: string): { verdict: "pass" | "fail"; flags: ComplianceFlag[] } {
  const flags: ComplianceFlag[] = [];
  for (const rule of COMPLIANCE_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      flags.push({ rule: rule.id, excerpt: match[0].slice(0, 120), severity: rule.severity });
    }
  }
  const blocked = flags.some((f) => f.severity === "blocking");
  return { verdict: blocked ? "fail" : "pass", flags };
}
