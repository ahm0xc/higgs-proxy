import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { Slider } from "@heroui/react/slider";
import { Spinner } from "@heroui/react/spinner";
import { TextArea } from "@heroui/react/textarea";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { VoicePicker } from "~/components/voice-picker";
import type { VoiceOption } from "~/components/voice-picker";
import type {
  AudioModel,
  AudioModelExtra,
  AudioVoiceRef,
  VoiceType,
} from "~/lib/audio-models";
import {
  AUDIO_MODELS,
  buildAudioParams,
  charLimitOf,
  DEFAULT_AUDIO_MODEL_ID,
  defaultExtrasOf,
  getAudioModel,
  sanitizeExtras,
  voiceLabel,
  voiceLanguage,
} from "~/lib/audio-models";
import type { AudioVoice } from "~/lib/audio-api";
import { estimateAudioCost, listVoices } from "~/lib/audio-api";

export interface AudioPrompt {
  model: string;
  prompt: string;
  /** Engine, for models that wrap several providers. */
  variant?: string;
  voice: AudioVoiceRef | null;
  extras: Record<string, string>;
}

export interface AudioPromptBarProps {
  onSubmit: (prompt: AudioPrompt) => void | Promise<void>;
  className?: string;
}

function ArrowUpIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
    </svg>
  );
}

function SlidersIcon() {
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
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

/** Compact pill look for HeroUI's select trigger inside the dock. */
const triggerPill =
  "h-9 min-h-9 w-auto max-w-52 gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-none transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

const popoverPanel =
  "z-50 rounded-2xl border border-zinc-200 bg-white p-1 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40";

const itemClasses =
  "rounded-lg px-2 py-1.5 text-xs text-zinc-600 data-[hovered=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 dark:text-zinc-300 dark:data-[hovered=true]:bg-zinc-800 dark:data-[selected=true]:text-zinc-50";

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/** Single-value HeroUI select rendered as one of the bar's pills. */
function PillSelect({
  label,
  value,
  options,
  onChange,
  valueContent,
  className = "w-40",
  isDisabled,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  valueContent?: React.ReactNode;
  className?: string;
  isDisabled?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      className="w-auto"
      value={value}
      isDisabled={isDisabled}
      onChange={(key) => {
        if (key != null) onChange(String(key));
      }}
    >
      <Select.Trigger className={triggerPill}>
        <Select.Value className="truncate whitespace-nowrap">
          {valueContent}
        </Select.Value>
      </Select.Trigger>
      <Select.Popover
        placement="top"
        className={`${popoverPanel} ${className}`}
      >
        <ListBox aria-label={label} items={options}>
          {(option) => (
            <ListBox.Item
              id={option.value}
              textValue={option.label}
              className={itemClasses}
            >
              <span className="flex-1 truncate">{option.label}</span>
              {option.hint ? (
                <span className="shrink-0 text-[10px] tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                  {option.hint}
                </span>
              ) : null}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/**
 * Floating prompt dock for the audio page. Covers what the CLI accepts for
 * text-to-speech models: the script, the voice (preset or cloned), the engine
 * for models that wrap several providers, and the model-specific params
 * (language, speed, pitch, format, sample rate, ...).
 */
export function AudioPromptBar({
  onSubmit,
  className = "",
}: AudioPromptBarProps) {
  const [storedSettings] = useState(readStoredSettings);
  const initialModel = getAudioModel(
    storedSettings?.modelId ?? DEFAULT_AUDIO_MODEL_ID,
  );

  const [modelId, setModelId] = useState(initialModel.id);
  const model = getAudioModel(modelId);

  const [prompt, setPrompt] = useState("");
  const [variant, setVariant] = useState(
    storedSettings?.variant ?? initialModel.variants?.defaultValue,
  );
  const [extras, setExtras] = useState<Record<string, string>>(
    storedSettings?.extras ?? defaultExtrasOf(initialModel),
  );
  const [voice, setVoice] = useState<AudioVoiceRef | null>(
    initialModel.voice.source === "fixed"
      ? fixedVoiceRef(initialModel, storedSettings?.voice?.id)
      : (storedSettings?.voice ?? null),
  );

  const [voices, setVoices] = useState<AudioVoice[] | null>(null);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [costLoading, setCostLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptId = useId();

  const limit = charLimitOf(model, variant);
  const overLimit = limit !== null && prompt.length > limit;
  const nearLimit = limit !== null && prompt.length >= limit * 0.9;

  // Grow with the script, up to a few lines, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;

    if (!el) return;

    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 164)}px`;
  }, [prompt]);

  function loadVoices() {
    setVoicesError(null);
    setVoicesLoading(true);
    listVoices(true)
      .then((result) => setVoices(result))
      .catch((error) => {
        setVoicesError(
          error instanceof Error ? error.message : "Could not load voices",
        );
      })
      .finally(() => setVoicesLoading(false));
  }

  // The voice library is shared by all models, so it is loaded once on mount.
  useEffect(() => {
    let alive = true;

    listVoices()
      .then((result) => {
        if (alive) setVoices(result);
      })
      .catch((error) => {
        if (!alive) return;
        setVoicesError(
          error instanceof Error ? error.message : "Could not load voices",
        );
      })
      .finally(() => {
        if (alive) setVoicesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  // Adopt a sensible default once the library arrives, unless the restored
  // voice is still present.
  useEffect(() => {
    if (!voices || model.voice.source !== "library") return;

    setVoice((current) => {
      if (current) {
        const found = voices.find(
          (entry) => entry.id === current.id && entry.type === current.type,
        );

        if (found) return { id: found.id, type: found.type, name: found.name };
      }

      if (!model.voice.required && !current) return null;

      const fallback =
        voices.find((entry) => entry.type === "preset") ?? voices[0];

      return fallback
        ? { id: fallback.id, type: fallback.type, name: fallback.name }
        : null;
    });
  }, [voices, model.voice.source, model.voice.required]);

  // Estimated credits for the current script and settings.
  useEffect(() => {
    if (prompt.trim().length === 0) {
      setCost(null);
      setCostLoading(false);
      return;
    }

    const controller = new AbortController();
    setCostLoading(true);

    const timer = setTimeout(() => {
      estimateAudioCost(
        {
          model: model.id,
          prompt,
          params: buildAudioParams({ model: model.id, variant, voice, extras }),
        },
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) setCost(result.credits);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCost(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCostLoading(false);
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [model.id, prompt, variant, voice, extras]);

  // Remember the last configuration between visits, like the image bar.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          modelId: model.id,
          variant,
          extras,
          voice,
        } satisfies StoredAudioSettings),
      );
    } catch {
      // Storage may be unavailable (private mode); remembering is best effort.
    }
  }, [model.id, variant, extras, voice]);

  const voiceChoices = useMemo<VoiceOption[]>(() => {
    if (model.voice.source === "fixed") {
      return (model.voice.fixedOptions ?? []).map((option) => ({
        id: option,
        type: "preset" as const,
        name: voiceLabel(option),
        hint: voiceLanguage(option) ?? "Preset",
        previewModel: "inworld_text_to_speech",
      }));
    }

    return (voices ?? []).map((entry) => ({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      hint: entry.type === "element" ? "Cloned" : "Preset",
    }));
  }, [model.voice.source, model.voice.fixedOptions, voices]);

  const settingsExtras = (model.extras ?? []).filter((extra) => !extra.pill);
  const pillExtras = (model.extras ?? []).filter((extra) => extra.pill);

  const missingVoice = model.voice.required && voice === null;
  const canSubmit =
    !busy && !missingVoice && prompt.trim().length > 0 && !overLimit;

  function applyModel(nextId: string) {
    const next = getAudioModel(nextId);

    setModelId(next.id);
    setVariant(next.variants?.defaultValue);
    setExtras(defaultExtrasOf(next));
    setVoice(
      next.voice.source === "fixed"
        ? fixedVoiceRef(next)
        : next.voice.required
          ? defaultLibraryVoice(voices)
          : null,
    );
  }

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setNotice(null);

    try {
      await onSubmit({
        model: model.id,
        prompt: prompt.trim(),
        ...(model.variants ? { variant } : {}),
        voice,
        extras,
      });
      setPrompt("");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not start the generation.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-4 sm:pb-6 ${className}`}
    >
      <div className="pointer-events-auto w-full max-w-3xl px-4 sm:px-6">
        <div className="relative rounded-3xl border border-zinc-200/80 bg-white/90 p-2 shadow-[0_18px_50px_-18px_rgba(24,24,27,0.35)] backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:shadow-black/60">
          {notice ? (
            <div
              role="alert"
              className="mx-1 mt-1 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-rose-500" />
              <span>{notice}</span>
            </div>
          ) : null}

          <label htmlFor={promptId} className="sr-only">
            {model.promptLabel}
          </label>
          <TextArea
            id={promptId}
            ref={textareaRef}
            aria-label={model.promptLabel}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={model.promptPlaceholder}
            className="max-h-[164px] min-h-0 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed text-zinc-900 shadow-none placeholder:text-zinc-400 focus:bg-transparent focus:shadow-none focus:ring-0 dark:bg-transparent dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />

          <div className="flex items-end gap-2 px-0.5 pb-0.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <Select
                aria-label="Model"
                className="w-auto"
                value={model.id}
                onChange={(key) => {
                  if (key != null) applyModel(String(key));
                }}
              >
                <Select.Trigger className={triggerPill}>
                  <Select.Value className="truncate whitespace-nowrap">
                    {model.name}
                  </Select.Value>
                </Select.Trigger>
                <Select.Popover
                  placement="top start"
                  className={`${popoverPanel} w-72 max-w-[calc(100vw-2rem)]`}
                >
                  <ListBox aria-label="Audio models" items={AUDIO_MODELS}>
                    {(entry) => (
                      <ListBox.Item
                        id={entry.id}
                        textValue={entry.name}
                        className={`${itemClasses} items-start`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">
                            {entry.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {entry.tagline}
                          </span>
                        </span>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    )}
                  </ListBox>
                </Select.Popover>
              </Select>

              <VoicePicker
                value={voice}
                options={voiceChoices}
                onChange={setVoice}
                source={model.voice.source}
                loading={model.voice.source === "library" && voicesLoading}
                error={model.voice.source === "library" ? voicesError : null}
                onRetry={loadVoices}
              />

              {model.variants ? (
                <PillSelect
                  label={model.variants.label}
                  value={variant ?? model.variants.defaultValue}
                  options={model.variants.options}
                  onChange={setVariant}
                  valueContent={
                    <span className="flex items-center gap-1.5">
                      <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">
                        {model.variants.label}
                      </span>
                      {model.variants.options.find(
                        (option) => option.value === variant,
                      )?.label ?? model.variants.defaultValue}
                    </span>
                  }
                  className="w-48"
                />
              ) : null}

              {pillExtras.map((extra) => (
                <PillSelect
                  key={extra.key}
                  label={extra.label}
                  value={extras[extra.key] ?? extra.defaultValue}
                  options={extra.options ?? []}
                  onChange={(value) =>
                    setExtras((current) => ({
                      ...current,
                      [extra.key]: value,
                    }))
                  }
                  valueContent={
                    <span className="flex items-center gap-1.5">
                      <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">
                        {extra.label}
                      </span>
                      {(extra.options ?? []).find(
                        (option) =>
                          option.value ===
                          (extras[extra.key] ?? extra.defaultValue),
                      )?.label ?? "Auto"}
                    </span>
                  }
                  className="w-44"
                />
              ))}

              {settingsExtras.length > 0 ? (
                <SettingsPopover
                  key={model.id}
                  extras={settingsExtras}
                  values={extras}
                  onChange={(key, value) =>
                    setExtras((current) => ({ ...current, [key]: value }))
                  }
                />
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {prompt.length > 0 ? (
                <span
                  title={limit ? "Characters used" : "Characters"}
                  className={`text-[11px] whitespace-nowrap tabular-nums ${
                    overLimit
                      ? "text-rose-600 dark:text-rose-400"
                      : nearLimit
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {prompt.length.toLocaleString()}
                  {limit ? ` / ${limit.toLocaleString()}` : ""}
                </span>
              ) : null}

              {cost !== null ? (
                <span
                  title="Estimated credits for this script"
                  className={`text-[11px] whitespace-nowrap text-zinc-500 tabular-nums transition-opacity dark:text-zinc-400 ${
                    costLoading ? "opacity-50" : ""
                  }`}
                >
                  {formatCredits(cost)} {cost === 1 ? "credit" : "credits"}
                </span>
              ) : null}

              <Button
                type="button"
                isIconOnly
                size="sm"
                onPress={() => void submit()}
                isDisabled={!canSubmit}
                aria-label={
                  missingVoice
                    ? "Choose a voice to continue"
                    : overLimit
                      ? "Script is too long"
                      : "Generate audio"
                }
                className="size-9 shrink-0 rounded-full bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:opacity-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
              >
                {busy ? <Spinner color="current" size="sm" /> : <ArrowUpIcon />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings dock popover. Rendered through a portal (the blurred dock would
 * otherwise become the containing block for `position: fixed`) and anchored
 * above its trigger, right-aligned.
 */
function SettingsPopover({
  extras,
  values,
  onChange,
}: {
  extras: AudioModelExtra[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (
        target &&
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function reposition() {
      setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  function toggle() {
    setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen((current) => !current);
  }

  const width =
    typeof window === "undefined" ? 352 : Math.min(352, window.innerWidth - 32);
  const left =
    rect === null
      ? 16
      : Math.max(
          16,
          Math.min(rect.right - width, window.innerWidth - width - 16),
        );
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
        aria-label="Voice settings"
        onClick={toggle}
        className={`flex h-9 min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-medium text-zinc-700 shadow-none transition-colors outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/40 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100/40 ${
          open
            ? "border-zinc-400 dark:border-zinc-500"
            : "border-zinc-200 dark:border-zinc-700/80"
        }`}
      >
        <SlidersIcon />
        <span className="hidden sm:inline">Settings</span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Voice settings"
              style={{ position: "fixed", left, bottom, width }}
              className="z-50 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
            >
              <div className="mb-1 flex items-center gap-1.5 px-1 pt-0.5">
                <SlidersIcon />
                <span className="text-[10px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
                  Voice settings
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {extras.map((extra) => (
                  <ExtraField
                    key={extra.key}
                    extra={extra}
                    value={values[extra.key] ?? extra.defaultValue}
                    onChange={(value) => onChange(extra.key, value)}
                  />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** One settings-panel control: select, number, or free-text param. */
function ExtraField({
  extra,
  value,
  onChange,
}: {
  extra: AudioModelExtra;
  value: string;
  onChange: (value: string) => void;
}) {
  const numeric = Number(value);
  const step = extra.step ?? 1;
  const isSlider =
    extra.kind === "number" &&
    extra.min !== undefined &&
    extra.max !== undefined;
  const wide = extra.kind === "text" || isSlider;

  if (isSlider) {
    return (
      <div className="col-span-2 flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[10px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {extra.label}
          </span>
          <span className="text-[10px] font-medium text-zinc-500 tabular-nums dark:text-zinc-400">
            {formatExtraValue(extra, value)}
          </span>
        </div>
        <Slider
          aria-label={extra.label}
          value={
            Number.isFinite(numeric) ? numeric : Number(extra.defaultValue)
          }
          minValue={extra.min}
          maxValue={extra.max}
          step={step}
          onChange={(next) =>
            onChange(String(Number(Number(next).toFixed(step < 1 ? 2 : 0))))
          }
          className="w-full"
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <span className="px-0.5 text-[10px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {extra.label}
      </span>
      {extra.kind === "select" ? (
        <Select
          aria-label={extra.label}
          className="w-full"
          value={value}
          onChange={(key) => {
            if (key != null) onChange(String(key));
          }}
        >
          <Select.Trigger className="flex h-8 min-h-8 w-full items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 shadow-none transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
            <Select.Value className="min-w-0 flex-1 truncate text-left" />
            <Select.Indicator className="size-3 shrink-0 text-zinc-400" />
          </Select.Trigger>
          <Select.Popover placement="bottom" className={`${popoverPanel} w-44`}>
            <ListBox aria-label={extra.label} items={extra.options ?? []}>
              {(option) => (
                <ListBox.Item
                  id={option.value}
                  textValue={option.value === "" ? "Auto" : option.label}
                  className={itemClasses}
                >
                  <span className="flex-1 truncate">
                    {option.value === "" ? "Auto" : option.label}
                  </span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              )}
            </ListBox>
          </Select.Popover>
        </Select>
      ) : (
        <Input
          aria-label={extra.label}
          type={extra.kind === "number" ? "number" : "text"}
          value={value}
          min={extra.min}
          max={extra.max}
          step={extra.step}
          placeholder={extra.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 min-h-8 w-full rounded-lg px-2 py-0 text-xs"
        />
      )}
    </div>
  );
}

/** Slider labels: two decimals for fractional steps, whole numbers otherwise. */
function formatExtraValue(extra: AudioModelExtra, value: string) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return value;

  return numeric.toFixed((extra.step ?? 1) < 1 ? 2 : 0);
}

function fixedVoiceRef(
  model: AudioModel,
  preferredId?: string,
): AudioVoiceRef | null {
  const options = model.voice.fixedOptions ?? [];
  const id =
    (preferredId && options.includes(preferredId) ? preferredId : options[0]) ??
    null;

  return id ? { id, type: "preset", name: voiceLabel(id) } : null;
}

function defaultLibraryVoice(
  voices: AudioVoice[] | null,
): AudioVoiceRef | null {
  const entry = voices?.find((voice) => voice.type === "preset") ?? voices?.[0];

  return entry ? { id: entry.id, type: entry.type, name: entry.name } : null;
}

function formatCredits(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

const SETTINGS_STORAGE_KEY = "higgs-proxy:audio-prompt-settings";

interface StoredAudioSettings {
  modelId: string;
  variant?: string;
  extras: Record<string, string>;
  voice: AudioVoiceRef | null;
}

/**
 * Restores the last configuration and clamps it to the stored model, so a
 * stale engine, extra, or voice never reaches the CLI.
 */
function readStoredSettings(): StoredAudioSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) return null;

    const value = parsed as Record<string, unknown>;
    const model = getAudioModel(
      typeof value.modelId === "string"
        ? value.modelId
        : DEFAULT_AUDIO_MODEL_ID,
    );

    const variant =
      typeof value.variant === "string" &&
      model.variants?.options.some((option) => option.value === value.variant)
        ? value.variant
        : model.variants?.defaultValue;

    const storedVoice =
      typeof value.voice === "object" && value.voice !== null
        ? (value.voice as Record<string, unknown>)
        : null;

    const voiceType: VoiceType | null =
      storedVoice?.type === "preset" || storedVoice?.type === "element"
        ? storedVoice.type
        : null;

    const voice =
      storedVoice &&
      typeof storedVoice.id === "string" &&
      typeof storedVoice.name === "string" &&
      voiceType
        ? {
            id: storedVoice.id,
            type: voiceType,
            name: storedVoice.name,
          }
        : null;

    return {
      modelId: model.id,
      variant,
      extras: sanitizeExtras(
        model,
        typeof value.extras === "object" && value.extras !== null
          ? (value.extras as Record<string, string>)
          : undefined,
      ),
      voice:
        model.voice.source === "fixed"
          ? fixedVoiceRef(model, voice?.id)
          : voice,
    };
  } catch {
    return null;
  }
}
