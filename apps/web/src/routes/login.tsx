import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  Alert,
  PasswordInput,
  PrimaryButton,
  TextInput,
} from "~/components/form";
import { authClient } from "~/lib/auth-client";
import { invalidateSession } from "~/lib/session";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.needsSetup) throw redirect({ to: "/setup" });
    if (context.auth) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
        rememberMe: true,
      });

      if (result.error) {
        setError(
          result.error.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : (result.error.message ?? "Unable to sign in"),
        );
        return;
      }

      invalidateSession();
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch {
      setError("Cannot reach the API. Is it running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col justify-center px-4 py-20">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Use the email and password your admin gave you.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {error ? <Alert>{error}</Alert> : null}

          <TextInput
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />

          <PasswordInput
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••-••••-••••-••••"
          />

          <PrimaryButton type="submit" loading={submitting} className="w-full">
            Sign in
          </PrimaryButton>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Forgot your password? Ask an admin to reset it.
      </p>
    </main>
  );
}
