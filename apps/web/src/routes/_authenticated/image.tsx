import { createFileRoute } from "@tanstack/react-router";

import { LockedFeature } from "~/components/locked-feature";

export const Route = createFileRoute("/_authenticated/image")({
  component: ImagePage,
});

function ImagePage() {
  const { auth } = Route.useRouteContext();

  if (!auth.capabilities.image) return <LockedFeature feature="image" />;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Image generation
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Generation is not wired up yet. This page is gated by your account's
        image capability.
      </p>
    </main>
  );
}
