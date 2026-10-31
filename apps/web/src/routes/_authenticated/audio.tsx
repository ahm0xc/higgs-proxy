import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { AudioPromptBar } from "~/components/audio-prompt-bar";
import { LockedFeature } from "~/components/locked-feature";

export const Route = createFileRoute("/_authenticated/audio")({
  component: AudioPage,
});

function AudioPage() {
  const { auth } = Route.useRouteContext();

  if (!auth.capabilities.audio) return <LockedFeature feature="audio" />;

  return <Studio />;
}

function Studio() {
  // TODO: POST to the API once `generate create` is wired up; until then the
  // bar surfaces the error under the script instead of silently doing nothing.
  const generate = useCallback(async () => {
    throw new Error(
      "Audio generation isn't connected yet — the prompt bar is ready for the CLI create endpoint.",
    );
  }, []);

  return (
    <main className="w-full pt-4 pb-56">
      <div className="mb-3 flex items-center justify-between gap-3 px-4 sm:px-6">
        <div>
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Audio generation
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Text to speech
          </p>
        </div>
      </div>

      <EmptyState />
      <AudioPromptBar onSubmit={generate} />
    </main>
  );
}

function EmptyState() {
  return (
    <div className="mx-4 mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center sm:mx-6 dark:border-zinc-700 dark:bg-zinc-900">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="size-6"
        >
          <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
        </svg>
      </span>
      <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        No audio yet
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Write a script below, pick a voice, and your first generation will
        appear here.
      </p>
    </div>
  );
}
