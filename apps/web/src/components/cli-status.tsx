import type { HiggsfieldStatus } from "api";

import type { CliStatusState } from "~/hooks/use-cli-status";

type DisplayStatus = HiggsfieldStatus | "loading" | "unreachable";

const statusMeta: Record<
  DisplayStatus,
  { label: string; dot: string; text: string; ping: boolean }
> = {
  loading: {
    label: "checking",
    dot: "bg-zinc-400",
    text: "text-zinc-600 dark:text-zinc-300",
    ping: false,
  },
  healthy: {
    label: "healthy",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    ping: true,
  },
  cli_not_installed: {
    label: "no CLI",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-400",
    ping: false,
  },
  unauthenticated: {
    label: "signed out",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    ping: false,
  },
  out_of_credits: {
    label: "no credits",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    ping: false,
  },
  error: {
    label: "error",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-400",
    ping: false,
  },
  unreachable: {
    label: "unreachable",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-400",
    ping: false,
  },
};

function formatCredits(credits: number) {
  return Math.floor(credits).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

export function CliStatus({
  status,
  refresh,
}: {
  status: CliStatusState;
  refresh: (force?: boolean) => void;
}) {
  const displayStatus: DisplayStatus =
    status.state === "loading"
      ? "loading"
      : status.state === "request_failed"
        ? "unreachable"
        : status.data.status;

  const meta = statusMeta[displayStatus];

  let title = "Checking the Higgsfield CLI status…";

  if (status.state === "ready") {
    const details = [
      status.data.message,
      status.data.cli?.version ? `v${status.data.cli.version}` : null,
      status.data.account?.credits !== undefined
        ? `${formatCredits(status.data.account.credits)} credits`
        : null,
    ].filter(Boolean);

    title = `${details.join(" · ")} — click to re-check`;
  } else if (status.state === "request_failed") {
    title = `Cannot reach the API: ${status.error}`;
  }

  return (
    <button
      type="button"
      onClick={() => void refresh(true)}
      className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wider uppercase transition-colors hover:border-zinc-300 hover:bg-zinc-200/70 sm:px-3 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
      title={title}
      aria-label={`CLI status: ${meta.label}`}
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {meta.ping ? (
          <span
            className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${meta.dot}`}
          />
        ) : null}
        <span
          className={`relative inline-flex size-2 rounded-full ${meta.dot}`}
        />
      </span>
      <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">
        CLI
      </span>
      <span
        aria-hidden
        className="hidden text-zinc-400 sm:inline dark:text-zinc-600"
      >
        •
      </span>
      <span className={`hidden sm:inline ${meta.text}`}>{meta.label}</span>
    </button>
  );
}
