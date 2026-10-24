import { Badge } from "./ui/badge";

const RUN: Record<string, "success" | "destructive" | "warning" | "info" | "secondary"> = {
  PASSED: "success",
  COMPLETED: "success",
  VERIFIED: "success",
  ATTESTED: "success",
  FAILED: "destructive",
  TIMED_OUT: "destructive",
  RUNNING: "info",
  DISPATCHED: "secondary",
  QUEUED: "secondary",
  PENDING: "warning",
  CANCELLING: "warning",
  CANCELLED: "secondary",
  SKIPPED: "secondary",
  REVOKED: "secondary",
};

const LABELS: Record<string, string> = { ATTESTED: "authorized (self-declared)", VERIFIED: "verified" };

export function StatusBadge({ status }: { status: string }) {
  if (LABELS[status]) return <Badge variant={RUN[status] ?? "outline"}>{LABELS[status]}</Badge>;
  return (
    <Badge variant={RUN[status] ?? "outline"}>
      {status === "RUNNING" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  if (!category) return null;
  const v = category === "ASSERTION" ? "warning" : category === "SECURITY" ? "destructive" : category === "CANCELLED" ? "secondary" : "outline";
  return <Badge variant={v}>{category.replace(/_/g, " ").toLowerCase()}</Badge>;
}
