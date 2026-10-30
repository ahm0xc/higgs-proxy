import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  Alert,
  PasswordInput,
  PrimaryButton,
  TextInput,
} from "~/components/form";
import { requestJson } from "~/lib/request";
import { invalidateSession, rememberNeedsSetup } from "~/lib/session";

export const Route = createFileRoute("/setup")({
  beforeLoad: ({ context }) => {
    if (!context.needsSetup) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

const MIN_PASSWORD_LENGTH = 8;

function SetupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);

    try {
      await requestJson("/setup", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      rememberNeedsSetup(false);
      invalidateSession();
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create the admin account",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col justify-center px-4 py-20">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create the admin account
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This instance has no users yet. The account you create here is the
          admin, and it is the only sign-up this instance will ever accept.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {error ? <Alert>{error}</Alert> : null}

          <TextInput
            label="Name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
          />

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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          />

          <PasswordInput
            label="Confirm password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />

          <PrimaryButton type="submit" loading={submitting} className="w-full">
            Create admin and sign in
          </PrimaryButton>
        </form>
      </div>
    </main>
  );
}
