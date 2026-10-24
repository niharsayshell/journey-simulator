import * as React from "react";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/lib/api";

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: "info" | "error" | "success" | "warning";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[variant];
  const Icon = variant === "success" ? CheckCircle2 : variant === "info" ? Info : AlertCircle;
  return (
    <div role={variant === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3 text-sm", styles, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="break-words">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorAlert({ error, title = "Something went wrong" }: { error: unknown; title?: string }) {
  if (!error) return null;
  const e = error as ApiError;
  const issues = e.issues ?? [];
  return (
    <Alert variant="error" title={title}>
      <p>{e.message ?? String(error)}</p>
      {issues.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {issues.map((i, n) => (
            <li key={n}>
              {i.path && <code className="text-xs">{i.path}</code>} {i.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center", className)}>
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      {Icon && <Icon className="size-8 text-muted-foreground" />}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function NotImplemented({ feature, phase }: { feature: string; phase: string }) {
  return (
    <Alert variant="warning" title={`${feature} — not yet implemented`}>
      This feature is planned for {phase}. It is shown here so you can see what is coming; it does not do anything yet.
    </Alert>
  );
}
