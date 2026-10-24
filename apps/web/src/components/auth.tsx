"use client";
import { createContext, useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApi } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { Spinner } from "./ui/feedback";

const AuthContext = createContext<{ user: User; refresh: () => void } | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <RequireAuth>");
  return ctx;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, error, isLoading, mutate } = useApi<{ user: User }>("/auth/me", { shouldRetryOnError: false });
  const unauthenticated = (error as { status?: number } | undefined)?.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (isLoading || unauthenticated) return <Spinner label="Checking your session…" className="h-screen" />;
  if (error || !data)
    return (
      <div className="flex h-screen items-center justify-center p-6 text-sm text-destructive">
        Could not reach the API: {(error as Error)?.message ?? "unknown error"}. Is the API server running?
      </div>
    );
  return <AuthContext.Provider value={{ user: data.user, refresh: () => void mutate() }}>{children}</AuthContext.Provider>;
}
