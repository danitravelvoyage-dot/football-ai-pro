import { normalizeStatus, type ApplicationStatus } from "@/lib/domain";
import type { Dict } from "@/lib/i18n";
import { Badge } from "@/components/ui";

const tone: Record<ApplicationStatus, "neutral" | "info" | "warning" | "success" | "danger" | "gold"> = {
  new: "info",
  in_review: "gold",
  documents_required: "warning",
  submitted: "info",
  approved: "success",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export function StatusBadge({ status, dict }: { status: string; dict: Dict }) {
  const s = normalizeStatus(status);
  return <Badge tone={tone[s]}>{dict.statuses[s]}</Badge>;
}
