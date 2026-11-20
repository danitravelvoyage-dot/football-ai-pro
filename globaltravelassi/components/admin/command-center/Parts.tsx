import { Alert, Badge } from "@/components/ui";
import type { Dict } from "@/lib/i18n";
import type { TaskStatus } from "@/lib/ai/types";
import { statusTone, type BadgeTone } from "@/lib/ai/command-center/view";

export function TaskBadge({ status, dict }: { status: TaskStatus; dict: Dict }) {
  return <Badge tone={statusTone(status) as BadgeTone}>{dict.commandCenter.statusLabels[status]}</Badge>;
}

/** Shown instead of data when the AI tables are missing or unreadable. Never shows raw database errors. */
export function LoadState({ kind, dict }: { kind: "not_installed" | "error"; dict: Dict }) {
  const t = dict.commandCenter;
  return <Alert tone="warning">{kind === "not_installed" ? t.notInstalled : t.loadError}</Alert>;
}

/** Small label/value pair used inside cards. */
export function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</dt>
      <dd className="mt-1 font-semibold text-navy-900">{value}</dd>
    </div>
  );
}
