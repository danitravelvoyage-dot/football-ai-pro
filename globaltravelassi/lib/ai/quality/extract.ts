import type { Claim } from "./types";

/** Pulls text and claims out of an agent output, by output kind. Unknown shapes yield nothing rather than guessing. */
export function textsOf(outputKind: string, output: unknown): { path: string; text: string }[] {
  const o = (output ?? {}) as Record<string, unknown>;
  const out: { path: string; text: string }[] = [];
  const pushAll = (list: unknown, path: string, fields: string[]) => {
    if (!Array.isArray(list)) return;
    list.forEach((item, i) => {
      for (const f of fields) {
        const v = (item as Record<string, unknown>)?.[f];
        if (typeof v === "string") out.push({ path: `${path}[${i}].${f}`, text: v });
      }
    });
  };
  if (outputKind === "research") pushAll(o.findings, "findings", ["insight", "evidence"]);
  if (outputKind === "content") pushAll(o.drafts, "drafts", ["text"]);
  if (outputKind === "strategy") pushAll(o.campaigns, "campaigns", ["goal", "rationale"]);
  if (outputKind === "visa") pushAll(o.requirements, "requirements", ["item"]);
  if (outputKind === "analytics") {
    pushAll(o.metrics, "metrics", ["name"]);
    if (Array.isArray(o.insights)) o.insights.forEach((t, i) => typeof t === "string" && out.push({ path: `insights[${i}]`, text: t }));
  }
  return out;
}

export function claimsOf(producer: string, outputKind: string, output: unknown): Claim[] {
  const o = (output ?? {}) as Record<string, unknown>;
  const claims: Claim[] = [];
  if (outputKind === "research" && Array.isArray(o.findings)) {
    o.findings.forEach((f, i) => {
      const item = f as { insight?: string; confidence?: Claim["confidence"]; sources?: string[] };
      const sources = item.sources ?? [];
      claims.push({
        key: `finding:${(item.insight ?? "").trim().toLowerCase()}`,
        producer,
        category: "general",
        confidence: item.confidence ?? null,
        sourceUrl: sources[0] ?? null,
        checkedAt: null,
        official: false,
        path: `findings[${i}]`,
      });
    });
  }
  if (outputKind === "visa" && Array.isArray(o.requirements)) {
    o.requirements.forEach((r, i) => {
      const item = r as { destination?: string; item?: string; source_url?: string; last_checked?: string; verified_by_official_source?: boolean };
      claims.push({
        key: `visa:${item.destination ?? ""}|${(item.item ?? "").trim().toLowerCase()}`,
        producer,
        category: "visa",
        confidence: "high",
        sourceUrl: item.source_url ?? null,
        checkedAt: item.last_checked ?? null,
        official: item.verified_by_official_source === true,
        path: `requirements[${i}]`,
        value: item.item,
      });
    });
  }
  if (outputKind === "analytics" && Array.isArray(o.metrics)) {
    o.metrics.forEach((m, i) => {
      const metric = m as { name?: string; value?: number; period?: string };
      claims.push({
        key: `metric:${metric.name ?? ""}|${metric.period ?? ""}`,
        producer,
        category: "analytics",
        confidence: "high",
        sourceUrl: null,
        checkedAt: null,
        official: false,
        path: `metrics[${i}]`,
        value: metric.value,
      });
    });
  }
  return claims;
}
