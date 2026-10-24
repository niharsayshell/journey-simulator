"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Paginated, Project } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { QuickStart } from "@/components/quick-start";

export default function ProjectsPage() {
  const router = useRouter();
  const { data, error, isLoading } = useApi<Paginated<Project>>("/projects?limit=100");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api<{ project: Project }>("/projects", { method: "POST", body: { name, description: description || undefined } });
      router.push(`/projects/${res.project.id}/domains`);
    } catch (err) {
      setSaveError(err);
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Projects" description="Each project has its own authorized websites, scenarios, profiles and history." />
      <QuickStart className="mb-6" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="p-0">
            {isLoading && <Spinner />}
            <div className="p-4">
              <ErrorAlert error={error} />
            </div>
            {data && data.items.length === 0 && (
              <div className="p-4 pt-0">
                <EmptyState icon={FolderKanban} title="No projects yet" description="Create one using the form." />
              </div>
            )}
            {data && data.items.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Your role</TH>
                    <TH>Domains</TH>
                    <TH>Scenarios</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((p) => (
                    <TR key={p.id}>
                      <TD>
                        <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                      </TD>
                      <TD>
                        <Badge variant="secondary">{p.role.toLowerCase()}</Badge>
                      </TD>
                      <TD>{p._count?.domains ?? 0}</TD>
                      <TD>{p._count?.scenarios ?? 0}</TD>
                      <TD className="text-muted-foreground">{formatDate(p.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Empty project</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-4">
              <Field label="Name" htmlFor="pname">
                <Input id="pname" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop QA" />
              </Field>
              <Field label="Description" htmlFor="pdesc">
                <Textarea id="pdesc" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
              </Field>
              <ErrorAlert error={saveError} title="Could not create project" />
              <Button type="submit" loading={saving} className="w-full">
                Create project
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
