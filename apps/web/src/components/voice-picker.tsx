import { Avatar } from "@heroui/react/avatar";
import { Input } from "@heroui/react/input";
import { Spinner } from "@heroui/react/spinner";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { avatarUrlFor } from "~/components/user-menu";

import type { AudioVoiceRef, VoiceType } from "~/lib/audio-models";
import { previewSentenceFor } from "~/lib/audio-models";
import type { VoicePreview, VoicePreviewStatus } from "~/lib/audio-api";
import { requestVoicePreview, voicePreviewAudioUrl } from "~/lib/audio-api";
import { decodePeaks, fallbackPeaks, initialsFor } from "~/lib/waveform";

export interface VoiceOption {
  id: string;
  type: VoiceType;
  name: string;
  /** Small line under the name: "Cloned", "Preset", or a language code. */
  hint: string;
  /** TTS model that renders the preview; Text to Speech V2 by default. */
  previewModel?: string;
}

export interface VoicePickerProps {
  value: AudioVoiceRef | null;
  options: VoiceOption[];
  onChange: (voice: AudioVoiceRef | null) => void;
  /** "library" groups into Cloned + Preset; "fixed" is one voice set. */
  source: "library" | "fixed";
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const POLL_INTERVAL_MS = 2_500;
const POLL_ATTEMPTS = 24;

interface PreviewState {
  status: "loading" | VoicePreviewStatus;
  sentence: string;
  url: string | null;
  error: string | null;
}

/** Survives popover close/reopen so a finished sample is not re-requested. */
const previewCache = new Map<string, PreviewState>();

function keyOf(voice: Pick<VoiceOption, "id" | "type"> | AudioVoiceRef) {
  return `${voice.type}:${voice.id}`;
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-3 translate-x-px"
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
      className="size-3"
    >
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="size-4 shrink-0"
    >
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-3.5 shrink-0 text-zinc-400 dark:text-zinc-500"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  );
}

/**
 * Custom voice picker for the audio dock: one big popover with searchable
 * voice cards, cloned voices first, and a cached spoken sample per voice.
 */
export function VoicePicker({
  value,
  options,
  onChange,
  source,
  loading = false,
  error = null,
  onRetry,
}: VoicePickerProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, PreviewState>>(() =>
    Object.fromEntries(previewCache),
  );
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inflightRef = useRef(new Map<string, Promise<string | null>>());
  const cancelledRef = useRef(false);
  const activeKeyRef = useRef<string | null>(null);
  const searchId = useId();

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (option: VoiceOption) =>
      needle
        ? `${option.name} ${option.hint}`.toLowerCase().includes(needle)
        : true;

    if (source === "fixed") {
      return [
        {
          label: "Voices",
          items: options.filter(matches),
        },
      ];
    }

    const cloned = options
      .filter((option) => option.type === "element")
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(matches);
    const presets = options
      .filter((option) => option.type === "preset")
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(matches);

    return [
      { label: "Cloned voices", items: cloned },
      { label: "Preset voices", items: presets },
    ];
  }, [options, query, source]);

  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const selectedKey = value ? keyOf(value) : null;
  const activePreview = activeKey ? previews[activeKey] : undefined;
  const activeOption = activeKey
    ? options.find((option) => keyOf(option) === activeKey)
    : undefined;

  // Keep the popover on screen when the window resizes while it is open.
  useEffect(() => {
    if (!open) return;

    function reposition() {
      setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    }

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  // Outside click / Escape close. Search gets focus on open.
  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => searchRef.current?.focus());

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (
        target &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // One shared audio element: starting a preview stops the previous one.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    function onTime() {
      const duration = audio.duration;

      setProgress(
        Number.isFinite(duration) && duration > 0
          ? audio.currentTime / duration
          : 0,
      );
    }

    function onEnded() {
      setPlaying(false);
      setProgress(0);
    }

    function onPause() {
      setPlaying(false);
    }

    function onPlay() {
      setPlaying(true);
    }

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);

    return () => {
      cancelledRef.current = true;
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audioRef.current = null;
    };
  }, []);

  // Pause (and reset the shared progress) whenever the popover closes.
  useEffect(() => {
    if (open) return;

    audioRef.current?.pause();
    setPlaying(false);
    setProgress(0);
  }, [open]);

  function storePreview(key: string, state: PreviewState) {
    previewCache.set(key, state);
    setPreviews((current) => ({ ...current, [key]: state }));
  }

  function ensurePeaks(url: string) {
    void decodePeaks(url).then((result) => {
      if (result && !cancelledRef.current) {
        setPeaks((current) =>
          current[url] ? current : { ...current, [url]: result },
        );
      }
    });
  }

  async function pollPreview(
    option: VoiceOption,
    retry: boolean,
  ): Promise<string | null> {
    const key = keyOf(option);
    const sentence =
      previewCache.get(key)?.sentence || previewSentenceFor(option.id);

    storePreview(key, { status: "loading", sentence, url: null, error: null });

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      if (cancelledRef.current) return null;

      let preview: VoicePreview;

      try {
        preview = await requestVoicePreview({
          voiceId: option.id,
          voiceType: option.type,
          voiceName: option.name,
          ...(option.previewModel ? { model: option.previewModel } : {}),
          ...(retry && attempt === 0 ? { retry: true } : {}),
        });
      } catch (caught) {
        if (cancelledRef.current) return null;

        storePreview(key, {
          status: "failed",
          sentence,
          url: null,
          error:
            caught instanceof Error
              ? caught.message
              : "Could not prepare the preview.",
        });

        return null;
      }

      if (cancelledRef.current) return null;

      if (preview.status === "completed" && preview.url) {
        const url = voicePreviewAudioUrl(preview.url);

        storePreview(key, {
          status: "completed",
          sentence: preview.sentence,
          url,
          error: null,
        });
        ensurePeaks(url);

        return url;
      }

      if (preview.status === "failed" || preview.status === "cancelled") {
        storePreview(key, {
          status: preview.status,
          sentence: preview.sentence,
          url: null,
          error: preview.error ?? "This voice could not be previewed.",
        });

        return null;
      }

      storePreview(key, {
        status: preview.status,
        sentence: preview.sentence,
        url: null,
        error: null,
      });

      if (attempt < POLL_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }

    if (!cancelledRef.current) {
      storePreview(key, {
        status: "failed",
        sentence: previewCache.get(key)?.sentence || sentence,
        url: null,
        error: "The preview is taking too long. Try again.",
      });
    }

    return null;
  }

  function ensurePreview(
    option: VoiceOption,
    retry = false,
  ): Promise<string | null> {
    const key = keyOf(option);
    const cached = previewCache.get(key);

    if (!retry && cached?.url) {
      ensurePeaks(cached.url);
      return Promise.resolve(cached.url);
    }

    const running = inflightRef.current.get(key);

    if (running && !retry) return running;

    const promise = pollPreview(option, retry).finally(() => {
      if (inflightRef.current.get(key) === promise) {
        inflightRef.current.delete(key);
      }
    });

    inflightRef.current.set(key, promise);

    return promise;
  }

  function setActive(key: string) {
    activeKeyRef.current = key;
    setActiveKey(key);
  }

  async function playOption(option: VoiceOption, retry = false) {
    const key = keyOf(option);
    const audio = audioRef.current;

    if (!audio) return;

    if (!retry && activeKeyRef.current === key && playing) {
      audio.pause();
      return;
    }

    if (activeKeyRef.current !== key) {
      audio.pause();
      setProgress(0);
    }

    setActive(key);

    const cached = retry ? undefined : previewCache.get(key);
    const isRetry =
      retry || cached?.status === "failed" || cached?.status === "cancelled";

    if (isRetry) {
      previewCache.delete(key);
      inflightRef.current.delete(key);
      setPreviews((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }

    const url =
      (!isRetry ? cached?.url : null) ?? (await ensurePreview(option, isRetry));

    if (!url || cancelledRef.current || activeKeyRef.current !== key) return;

    ensurePeaks(url);

    if (audio.src !== url) {
      audio.src = url;
    } else {
      audio.currentTime = 0;
    }

    void audio.play().catch(() => setPlaying(false));
  }

  function retryPreview(option: VoiceOption) {
    void playOption(option, true);
  }

  function choose(option: VoiceOption) {
    onChange({ id: option.id, type: option.type, name: option.name });
    setOpen(false);
  }

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }

    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setQuery("");
    setOpen(true);
  }

  const width =
    typeof window === "undefined" ? 560 : Math.min(560, window.innerWidth - 32);
  const left =
    rect === null
      ? 16
      : Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
  const bottom =
    rect === null
      ? 96
      : Math.min(window.innerHeight - 16, window.innerHeight - rect.top + 8);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleOpen}
        className="flex h-9 min-h-9 w-auto max-w-52 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <WaveIcon />
        <span className="max-w-32 truncate">
          {value ? value.name : "Choose a voice"}
        </span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Choose a voice"
              style={{ position: "fixed", left, bottom, width }}
              className="z-50 flex max-h-[min(70vh,36rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/60"
            >
              <div className="border-b border-zinc-200/80 p-3 dark:border-zinc-800">
                <label htmlFor={searchId} className="sr-only">
                  Search voices
                </label>
                <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-2.5 dark:bg-zinc-800">
                  <SearchIcon />
                  <Input
                    ref={searchRef}
                    id={searchId}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search voices"
                    className="h-9 w-full min-w-0 rounded-none border-0 bg-transparent px-0 py-0 text-xs shadow-none outline-none hover:bg-transparent focus:bg-transparent focus:shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:outline-none data-[focus-visible=true]:ring-0 data-[focused=true]:ring-0"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="shrink-0 rounded px-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-500 dark:text-zinc-400">
                    <Spinner size="sm" color="current" />
                    Loading voices…
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    <p className="max-w-xs text-rose-600 dark:text-rose-300">
                      {error}
                    </p>
                    {onRetry ? (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Try again
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {total === 0 ? (
                      <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                        No voices match “{query.trim()}”
                      </p>
                    ) : (
                      groups.map((group) =>
                        group.items.length === 0 ? null : (
                          <section key={group.label} className="mb-2 last:mb-0">
                            <h3 className="px-1.5 py-1 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                              {group.label}
                            </h3>
                            <div
                              role="listbox"
                              aria-label={group.label}
                              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                            >
                              {group.items.map((option) => (
                                <VoiceCard
                                  key={keyOf(option)}
                                  option={option}
                                  selected={selectedKey === keyOf(option)}
                                  preview={previews[keyOf(option)]}
                                  peaks={
                                    previews[keyOf(option)]?.url
                                      ? peaks[previews[keyOf(option)]!.url!]
                                      : undefined
                                  }
                                  isActive={activeKey === keyOf(option)}
                                  playing={
                                    activeKey === keyOf(option) && playing
                                  }
                                  progress={
                                    activeKey === keyOf(option) ? progress : 0
                                  }
                                  onSelect={() => choose(option)}
                                  onPlay={() => void playOption(option)}
                                />
                              ))}
                            </div>
                          </section>
                        ),
                      )
                    )}
                  </>
                )}
              </div>

              {activePreview && activeOption ? (
                <div className="border-t border-zinc-200/80 px-3 py-2.5 dark:border-zinc-800">
                  {activePreview.status === "failed" ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] text-rose-600 dark:text-rose-300">
                        {activePreview.error ?? "Preview failed."}
                      </p>
                      <button
                        type="button"
                        onClick={() => retryPreview(activeOption)}
                        className="shrink-0 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Retry
                      </button>
                    </div>
                  ) : activePreview.url ? (
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">
                        {activePreview.sentence}
                      </span>
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      <Spinner size="sm" color="current" />
                      <span className="truncate">
                        Generating preview
                        {activePreview.sentence
                          ? ` — “${activePreview.sentence}”`
                          : "…"}
                      </span>
                    </p>
                  )}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function VoiceCard({
  option,
  selected,
  preview,
  peaks,
  isActive,
  playing,
  progress,
  onSelect,
  onPlay,
}: {
  option: VoiceOption;
  selected: boolean;
  preview: PreviewState | undefined;
  peaks: number[] | undefined;
  isActive: boolean;
  playing: boolean;
  progress: number;
  onSelect: () => void;
  onPlay: () => void;
}) {
  const key = keyOf(option);
  const generating =
    preview?.status === "loading" ||
    preview?.status === "queued" ||
    preview?.status === "processing";
  const failed =
    preview?.status === "failed" || preview?.status === "cancelled";
  const bars = peaks ?? fallbackPeaks(key);
  const playedBars = Math.round(progress * bars.length);
  const active = isActive && playing;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group flex cursor-pointer flex-col gap-2.5 rounded-xl border p-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 dark:focus-visible:ring-zinc-100/40 ${
        selected
          ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800/80"
          : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700/80 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Avatar size="sm" className="size-9 shrink-0">
          <Avatar.Image src={avatarUrlFor(option.id)} alt="" />
          <Avatar.Fallback>{initialsFor(option.name)}</Avatar.Fallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {option.name}
          </span>
          <span className="block truncate text-[10px] tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
            {option.hint}
          </span>
        </span>
        {selected ? (
          <span className="shrink-0 text-zinc-900 dark:text-zinc-100">
            <CheckIcon />
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          aria-label={
            active
              ? `Pause preview of ${option.name}`
              : `Play preview of ${option.name}`
          }
          className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-colors ${
            active
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          }`}
        >
          {generating ? (
            <Spinner size="sm" color="current" />
          ) : active ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
        </button>

        <div
          aria-hidden="true"
          title={
            generating
              ? "Generating preview…"
              : failed
                ? "Preview failed"
                : "Voice preview"
          }
          className={`flex h-7 flex-1 items-center gap-[2px] ${
            generating ? "animate-pulse" : ""
          } ${failed ? "opacity-40" : ""}`}
        >
          {bars.map((peak, index) => (
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
        </div>
      </div>
    </div>
  );
}
