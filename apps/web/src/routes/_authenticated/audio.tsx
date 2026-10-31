import { Avatar } from "@heroui/react/avatar";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AudioPrompt } from "~/components/audio-prompt-bar";
import { AudioPromptBar } from "~/components/audio-prompt-bar";
import { LockedFeature } from "~/components/locked-feature";
import { avatarUrlFor } from "~/components/user-menu";
import type { AudioGeneration, AudioGenerationStatus } from "~/lib/audio-api";
import {
  audioDownloadUrl,
  audioPlaybackUrl,
  createAudioGeneration,
  listAudioGenerations,
} from "~/lib/audio-api";
import { buildAudioParams, getAudioModel } from "~/lib/audio-models";
import {
  decodePeaks,
  durationOf,
  fallbackPeaks,
  initialsFor,
} from "~/lib/waveform";

export const Route = createFileRoute("/_authenticated/audio")({
  component: AudioPage,
});

function AudioPage() {
  const { auth } = Route.useRouteContext();

  if (!auth.capabilities.audio) return <LockedFeature feature="audio" />;

  return <Studio />;
}

const STATUS_LABEL: Record<AudioGenerationStatus, string> = {
  queued: "Queued",
  processing: "Generating",
  completed: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatCredits(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

function Studio() {
  const [generations, setGenerations] = useState<AudioGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  // One shared audio element, so starting a card stops whatever was playing.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setError(null);

    try {
      const result = await listAudioGenerations();
      setGenerations(result.audio);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load audio",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is still rendering. The API refreshes each pending
  // job from the CLI before answering, so this also picks up completed files.
  const hasPending = generations.some(
    (item) => item.status === "queued" || item.status === "processing",
  );

  useEffect(() => {
    if (!hasPending) return;

    const timer = setInterval(() => {
      void listAudioGenerations()
        .then((result) => setGenerations(result.audio))
        .catch(() => {
          // A failed poll is transient; the next tick retries.
        });
    }, 3000);

    return () => clearInterval(timer);
  }, [hasPending]);

  // Create the shared player once.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    function onTime() {
      setElapsed(audio.currentTime);
    }

    function onDuration() {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    }

    function onEnded() {
      setPlaying(false);
      setElapsed(0);
    }

    function onPause() {
      setPlaying(false);
    }

    function onPlay() {
      setPlaying(true);
    }

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audioRef.current = null;
    };
  }, []);

  // Decode real waveforms for finished generations, once each.
  useEffect(() => {
    let alive = true;

    for (const item of generations) {
      if (item.status !== "completed" || peaks[item.id]) continue;

      const url = audioPlaybackUrl(item.id);

      void decodePeaks(url).then((result) => {
        if (!alive || !result) return;

        setPeaks((current) =>
          current[item.id] ? current : { ...current, [item.id]: result },
        );

        const seconds = durationOf(url);

        if (seconds) {
          setDurations((current) =>
            current[item.id] === seconds
              ? current
              : { ...current, [item.id]: seconds },
          );
        }
      });
    }

    return () => {
      alive = false;
    };
  }, [generations, peaks]);

  function toggle(item: AudioGeneration) {
    const audio = audioRef.current;

    if (!audio) return;

    if (activeId === item.id && playing) {
      audio.pause();
      return;
    }

    if (activeId !== item.id) {
      audio.pause();
      setElapsed(0);
      setDuration(0);
      audio.src = audioPlaybackUrl(item.id);
      setActiveId(item.id);
    } else if (audio.ended) {
      audio.currentTime = 0;
    }

    void audio.play().catch(() => setPlaying(false));
  }

  function seek(fraction: number) {
    const audio = audioRef.current;

    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }

    audio.currentTime = fraction * audio.duration;
    setElapsed(audio.currentTime);
  }

  const generate = useCallback(async (prompt: AudioPrompt) => {
    const result = await createAudioGeneration({
      model: prompt.model,
      prompt: prompt.prompt,
      params: buildAudioParams({
        model: prompt.model,
        variant: prompt.variant,
        voice: prompt.voice,
        extras: prompt.extras,
      }),
      ...(prompt.voice ? { voiceName: prompt.voice.name } : {}),
    });

    setGenerations((current) => [
      ...result.audio,
      ...current.filter(
        (item) => !result.audio.some((added) => added.id === item.id),
      ),
    ]);
  }, []);

  const retry = useCallback(async (item: AudioGeneration) => {
    setRetrying(item.id);
    setError(null);

    try {
      const result = await createAudioGeneration({
        model: item.model,
        prompt: item.prompt,
        params: item.params ?? {},
        ...(item.voiceName ? { voiceName: item.voiceName } : {}),
      });

      setGenerations((current) => [
        ...result.audio,
        ...current.filter(
          (entry) => !result.audio.some((added) => added.id === entry.id),
        ),
      ]);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Could not retry the generation.",
      );
    } finally {
      setRetrying(null);
    }
  }, []);

  return (
    <main className="w-full pt-4 pb-56">
      {error ? (
        <div className="mx-auto mt-4 flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex w-full items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <SkeletonList />
      ) : generations.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <div className="mx-auto mt-4 grid w-full max-w-5xl grid-cols-1 gap-3 px-4 sm:px-6 xl:grid-cols-2">
          {generations.map((item) => (
            <AudioCard
              key={item.id}
              item={item}
              active={activeId === item.id}
              playing={activeId === item.id && playing}
              elapsed={activeId === item.id ? elapsed : 0}
              duration={activeId === item.id ? duration : 0}
              trackDuration={durations[item.id] ?? item.durationSeconds ?? 0}
              peaks={peaks[item.id] ?? fallbackPeaks(item.id)}
              retrying={retrying === item.id}
              onToggle={() => toggle(item)}
              onSeek={seek}
              onRetry={() => void retry(item)}
            />
          ))}
        </div>
      )}

      <AudioPromptBar onSubmit={generate} />
    </main>
  );
}

function SkeletonList() {
  return (
    <div className="mx-auto mt-4 grid w-full max-w-5xl grid-cols-1 gap-3 px-4 sm:px-6 xl:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="rounded-2xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center gap-3">
            <div className="size-9 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
          <div className="mt-3 h-8 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-10 w-full max-w-5xl px-4 sm:px-6">
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
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
    </div>
  );
}

function StatusBadge({ status }: { status: AudioGenerationStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {status === "processing" || status === "queued" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
      ) : status === "failed" || status === "cancelled" ? (
        <span className="size-1.5 rounded-full bg-red-400" />
      ) : (
        <span className="size-1.5 rounded-full bg-emerald-400" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3.5 translate-x-px"
    >
      <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3.5"
    >
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5M5 16.5v1.5a2 2 0 002 2h10a2 2 0 002-2v-1.5" />
    </svg>
  );
}

/**
 * Saves the file through the API's attachment endpoint. Fetching a blob keeps
 * the browser from opening the audio in a tab, and the proxy avoids the
 * provider CDN's missing CORS headers.
 */
async function saveAudio(id: string) {
  const response = await fetch(audioDownloadUrl(id), {
    credentials: "include",
  });

  if (!response.ok) throw new Error("Could not download the audio");

  const disposition = response.headers.get("content-disposition") ?? "";
  const filename =
    /filename="?([^";]+)"?/.exec(disposition)?.[1] ??
    `higgs-${id.slice(0, 8)}.mp3`;

  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Give the browser a beat to start writing before dropping the blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/**
 * The engine that actually rendered the audio. Text to Speech V2 wraps several
 * providers, so its model name says nothing useful; other models are their own
 * engine.
 */
function engineLabel(item: AudioGeneration) {
  if (item.variant) {
    const model = getAudioModel(item.model);
    const option = model.variants?.options.find(
      (entry) => entry.value === item.variant,
    );

    return option?.label ?? item.variant;
  }

  return item.modelName;
}

function AudioCard({
  item,
  active,
  playing,
  elapsed,
  duration,
  trackDuration,
  peaks,
  retrying,
  onToggle,
  onSeek,
  onRetry,
}: {
  item: AudioGeneration;
  active: boolean;
  playing: boolean;
  elapsed: number;
  duration: number;
  trackDuration: number;
  peaks: number[];
  retrying: boolean;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  onRetry: () => void;
}) {
  const completed = item.status === "completed";
  const pending = item.status === "queued" || item.status === "processing";
  const failed = item.status === "failed" || item.status === "cancelled";
  const progress =
    active && duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
  const playedBars = Math.round(progress * peaks.length);
  const name = item.voiceName ?? item.voiceId ?? "Unknown voice";

  return (
    <article className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <Avatar size="sm" className="size-9 shrink-0">
          <Avatar.Image
            src={
              item.voiceThumbnailUrl ?? avatarUrlFor(item.voiceId ?? item.id)
            }
            alt=""
          />
          <Avatar.Fallback>{initialsFor(name)}</Avatar.Fallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {name}
                </p>
                <span
                  title={item.modelName}
                  className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  {engineLabel(item)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                {formatDate(item.createdAt)}
                {item.creditsCost !== null
                  ? ` · ${formatCredits(item.creditsCost)} ${
                      item.creditsCost === 1 ? "credit" : "credits"
                    }`
                  : ""}
              </p>
            </div>
            {item.status !== "completed" ? (
              <StatusBadge status={item.status} />
            ) : null}
          </div>

          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {item.prompt}
          </p>
        </div>
      </div>

      {completed ? (
        <div className="mt-3 flex items-center gap-2.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pause audio" : "Play audio"}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            type="button"
            aria-label="Seek in audio"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const fraction = (event.clientX - rect.left) / rect.width;

              if (active) {
                onSeek(Math.min(1, Math.max(0, fraction)));
              } else {
                onToggle();
              }
            }}
            className="flex h-8 min-w-0 flex-1 items-center gap-[2px] outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 dark:focus-visible:ring-zinc-100/40"
          >
            {peaks.map((peak, index) => (
              <span
                key={index}
                style={{ height: `${Math.round(peak * 100)}%` }}
                className={`min-w-px flex-1 rounded-full transition-colors ${
                  index < playedBars
                    ? "bg-zinc-900 dark:bg-zinc-100"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              />
            ))}
          </button>

          <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums dark:text-zinc-500">
            {active
              ? `${formatTime(elapsed)} / ${formatTime(trackDuration || duration)}`
              : formatTime(trackDuration)}
          </span>

          <button
            type="button"
            onClick={() => {
              void saveAudio(item.id).catch(() => {
                window.open(audioPlaybackUrl(item.id), "_blank", "noreferrer");
              });
            }}
            aria-label="Download audio"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <DownloadIcon />
          </button>
        </div>
      ) : pending ? (
        <div className="mt-3 flex items-center gap-2.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <div className="shimmer relative size-8 shrink-0 overflow-hidden rounded-full" />
          <div className="shimmer relative h-6 min-w-0 flex-1 overflow-hidden rounded-full" />
          <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
            {STATUS_LABEL[item.status]}…
          </span>
        </div>
      ) : failed ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <p className="min-w-0 truncate text-[11px] text-rose-600 dark:text-rose-300">
            {item.error ?? "The provider rejected this generation."}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="shrink-0 rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
