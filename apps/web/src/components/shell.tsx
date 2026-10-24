"use client";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { mutate } from "swr";
import {
  Activity,
  FolderKanban,
  Globe,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MonitorSmartphone,
  Network,
  Settings,
  ShieldCheck,
  UserRoundCog,
  Workflow,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "./auth";

function NavLink({ href, icon: Icon, children, exact }: { href: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-white/10 font-medium text-white" : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ projectId?: string }>();
  const projectId = params.projectId;
  const { data: projectData } = useApi<{ project: Project }>(projectId ? `/projects/${projectId}` : null);
  const [open, setOpen] = useState(false);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }

  const base = projectId ? `/projects/${projectId}` : "";
  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground">
      <Link href="/dashboard" className="flex items-center gap-2 px-1 text-white">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
          <Workflow className="size-4" />
        </span>
        <span className="font-semibold leading-tight">
          Journey
          <br />
          <span className="text-xs font-normal text-sidebar-foreground/70">Simulator</span>
        </span>
      </Link>

      <nav className="space-y-1" onClick={() => setOpen(false)}>
        <NavLink href="/dashboard" icon={LayoutDashboard} exact>
          Dashboard
        </NavLink>
        <NavLink href="/projects" icon={FolderKanban} exact>
          Projects
        </NavLink>
      </nav>

      {projectId && (
        <nav className="space-y-1" onClick={() => setOpen(false)} aria-label="Project">
          <p className="truncate px-2.5 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            {projectData?.project.name ?? "Project"}
          </p>
          <NavLink href={base} icon={Activity} exact>
            Overview
          </NavLink>
          <NavLink href={`${base}/domains`} icon={ShieldCheck}>
            Website authorization
          </NavLink>
          <NavLink href={`${base}/scenarios`} icon={ListChecks}>
            Scenarios
          </NavLink>
          <NavLink href={`${base}/batches`} icon={Globe}>
            Executions
          </NavLink>
          <NavLink href={`${base}/browser-profiles`} icon={MonitorSmartphone}>
            Browser profiles
          </NavLink>
          <NavLink href={`${base}/session-profiles`} icon={UserRoundCog}>
            Session profiles
          </NavLink>
          <NavLink href={`${base}/proxies`} icon={Network}>
            Proxy profiles
          </NavLink>
          <NavLink href={`${base}/settings`} icon={Settings}>
            Project settings
          </NavLink>
        </nav>
      )}

      <div className="mt-auto space-y-1 border-t border-white/10 pt-4">
        <NavLink href="/settings" icon={Settings} exact>
          Application settings
        </NavLink>
        <div className="flex items-center justify-between gap-2 px-2.5 pt-2">
          <span className="truncate text-xs text-sidebar-foreground/70" title={user.email}>
            {user.email}
          </span>
          <button onClick={logout} className="rounded p-1 text-sidebar-foreground/70 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen">{sidebar}</aside>
      <div className="flex items-center justify-between border-b bg-sidebar px-4 py-2 text-white lg:hidden">
        <span className="font-semibold">Journey Simulator</span>
        <button onClick={() => setOpen(true)} aria-label="Open navigation" className="p-1">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-2 z-10 p-1 text-white" aria-label="Close navigation">
              <X className="size-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
