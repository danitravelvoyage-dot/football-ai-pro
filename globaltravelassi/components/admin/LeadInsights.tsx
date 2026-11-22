import type { Dict } from "@/lib/i18n";
import type { DocumentChecklist, LeadTier, Qualification, QualificationReason } from "@/lib/crm/insights";
import { Badge } from "@/components/ui";
import { Bar } from "@/components/admin/AdminUI";

const TIER_TONE: Record<LeadTier, "success" | "warning" | "neutral" | "info"> = {
  high: "success",
  medium: "warning",
  low: "neutral",
  closed: "info",
};

/** Reasons that count for the request; the rest are gaps the team can help close. */
const POSITIVE: ReadonlySet<QualificationReason> = new Set([
  "travel_soon", "travel_planned", "passport_uploaded", "documents_complete", "documents_not_needed", "whatsapp_given", "history_given", "contacted",
]);

export function PriorityBadge({ tier, dict }: { tier: LeadTier; dict: Dict }) {
  return <Badge tone={TIER_TONE[tier]}>{dict.insights.tiers[tier]}</Badge>;
}

export function QualificationSummary({ qualification: q, dict }: { qualification: Qualification; dict: Dict }) {
  const t = dict.insights;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-navy-700">{t.priority}:</span>
        <PriorityBadge tier={q.tier} dict={dict} />
        {q.followUpDue && <Badge tone="warning">{t.followUpDue}</Badge>}
      </div>
      {q.tier !== "closed" && <Bar value={q.score} max={100} label={`${t.score} (%)`} />}
      <div className="rounded-2xl bg-navy-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{t.nextActionTitle}</p>
        <p className="mt-1 font-semibold text-navy-900">{t.nextActions[q.nextAction]}</p>
      </div>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {q.reasons.map((r) => (
          <li key={r} className="flex items-start gap-2">
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${POSITIVE.has(r) ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="text-navy-800">{t.reasons[r]}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-navy-500">{t.qualificationNote}</p>
    </div>
  );
}

const STATE_TONE = { verified: "success", uploaded: "warning", missing: "danger" } as const;

export function ChecklistList({ checklist, dict }: { checklist: DocumentChecklist; dict: Dict }) {
  const t = dict.insights;
  const labels = dict.docTypes as Record<string, string>;
  if (checklist.items.length === 0) return <p className="text-sm text-navy-600">{t.checklistEmpty}</p>;
  return (
    <ul className="divide-y divide-navy-100">
      {checklist.items.map((item) => (
        <li key={item.type} className="flex items-center justify-between gap-3 py-3 text-sm">
          <span className="font-medium text-navy-900">{labels[item.type] ?? item.type}</span>
          <Badge tone={STATE_TONE[item.state]}>{t.itemStates[item.state]}</Badge>
        </li>
      ))}
    </ul>
  );
}
