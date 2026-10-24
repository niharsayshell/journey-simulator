"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { mutate } from "swr";
import { Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ErrorAlert } from "@/components/ui/feedback";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api(`/auth/${mode}`, { method: "POST", body: mode === "login" ? { email, password } : { email, password, name } });
      // Drop cached responses from before sign-in (e.g. the 401 for /auth/me).
      await mutate(() => true, undefined, { revalidate: false });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Workflow className="size-5" />
        </span>
        <CardTitle className="text-xl">{mode === "login" ? "Sign in to Journey Simulator" : "Create your account"}</CardTitle>
        <CardDescription>Test user journeys on websites you own or are authorized to test.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {mode === "register" && (
            <Field label="Name" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="password" hint={mode === "register" ? "At least 10 characters." : undefined}>
            <Input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Field>
          <ErrorAlert error={error} title={mode === "login" ? "Sign-in failed" : "Registration failed"} />
          <Button type="submit" className="w-full" loading={loading}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-background to-sky-50 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
