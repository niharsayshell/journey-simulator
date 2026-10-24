"use client";
import { RequireAuth } from "@/components/auth";
import { AppShell } from "@/components/shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
