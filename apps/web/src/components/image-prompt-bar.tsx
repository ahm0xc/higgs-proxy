import { Button } from "@heroui/react/button";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
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

import type { ImageModel } from "~/lib/image-models";
import {
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_MODELS,
  getImageModel,
} from "~/lib/image-models";
import { estimateImageCost } from "~/lib/images-api";

export interface ImagePrompt {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  quality?: string;
  /** Model-specific flags, e.g. `{ variant: "flare" }` or `{ background: "opaque" }`. */
  extras: Record<string, string>;
  references: File[];
}

export interface ImagePromptBarProps {
  onSubmit: (prompt: ImagePrompt) => void | Promise<void>;
  className?: string;
}

interface Attachment {
  file: File;
  url: string;
}

function formatOption(value: string) {
  if (/^\d+(\.\d+)?k$/i.test(value)) return value.toUpperCase();
  if (value === "xhigh") return "X-High";
  if (value === "utility_vector") return "Utility vector";
  if (value === "std") return "Standard";
  if (/^[A-Z]+$/.test(value)) return value;

  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function ratioOf(value: string) {
  const [w, h] = value.split(":").map(Number);

  return { w: Number.isFinite(w) ? w : 1, h: Number.isFinite(h) ? h : 1 };
}

function RatioGlyph({ ratio }: { ratio: string }) {
  const size =
    ratio === "auto"
      ? { width: 11, height: 11 }
      : (() => {
          const { w, h } = ratioOf(ratio);
          const scale = 14 / Math.max(w, h);

          return {
            width: Math.round(w * scale),
            height: Math.round(h * scale),
          };
        })();

  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      <span
        style={size}
        className="rounded-[2px] border border-current opacity-80"
      />
    </span>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-4"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
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

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="size-2.5"
    >
      <path d="M6 6l12 12M18 6L6 18" />
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

/** Compact pill look for HeroUI's select trigger inside the dock. */
const triggerPill =
  "h-9 min-h-9 w-auto max-w-44 gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-none transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

const popoverPanel =
  "z-50 rounded-2xl border border-zinc-200 bg-white p-1 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40";

const itemClasses =
  "rounded-lg px-2 py-1.5 text-xs text-zinc-600 data-[hovered=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 dark:text-zinc-300 dark:data-[hovered=true]:bg-zinc-800 dark:data-[selected=true]:text-zinc-50";

interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

/** Single-value HeroUI select rendered as one of the bar's pills. */
function PillSelect({
  label,
  value,
  options,
  onChange,
  valueContent,
  className = "w-40",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Custom trigger content; defaults to the option label. */
  valueContent?: React.ReactNode;
  className?: string;
}) {
  return (
    <Select
      aria-label={label}
      className="w-auto"
      value={value}
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
              {option.icon ?? null}
              <span className="flex-1 truncate">{option.label}</span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          )}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/**
 * Filter field rendered above the model list. The select popover focuses its
 * listbox on open; this hands focus to the search input instead.
 */
function ModelSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, []);

  function focusOptions() {
    const listbox = inputRef.current
      ?.closest('[data-slot="select-popover"]')
      ?.querySelector<HTMLElement>('[role="listbox"]');

    listbox?.focus();
  }

  return (
    <div className="px-1 pt-1 pb-1.5">
      <div className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2 dark:bg-zinc-800">
        <SearchIcon />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              focusOptions();
            }
          }}
          placeholder="Search models"
          aria-label="Search models"
          className="h-8 w-full min-w-0 bg-transparent text-xs text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
      </div>
    </div>
  );
}

/**
 * Floating prompt dock for the image page. Everything the Higgsfield CLI
 * accepts for `generate create <image-model>` is reachable from here: the
 * model, prompt, aspect ratio, resolution, quality, reference images, and the
 * model-specific extras the CLI exposes (variant, background, ...).
 */
export function ImagePromptBar({
  onSubmit,
  className = "",
}: ImagePromptBarProps) {
  const [storedSettings] = useState(readStoredSettings);
  const initialModel = getImageModel(
    storedSettings?.modelId ?? DEFAULT_IMAGE_MODEL_ID,
  );

  const [modelId, setModelId] = useState(initialModel.id);
  const model = getImageModel(modelId);

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState(
    storedSettings?.aspectRatio ?? initialModel.defaultAspectRatio,
  );
  const [resolution, setResolution] = useState(
    storedSettings?.resolution ?? initialModel.defaultResolution,
  );
  const [quality, setQuality] = useState(
    storedSettings?.quality ?? initialModel.defaultQuality,
  );
  const [extras, setExtras] = useState<Record<string, string>>(
    storedSettings?.extras ?? defaultsOf(initialModel),
  );
  const [references, setReferences] = useState<Attachment[]>([]);
  const [modelQuery, setModelQuery] = useState("");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const dragDepth = useRef(0);

  // Filtering lives up here on purpose: the Select derives its collection from
  // its children, so the list has to be declared by this component for the
  // popover to re-collect when the query changes.
  const filteredModels = useMemo(() => {
    const needle = modelQuery.trim().toLowerCase();

    if (!needle) return IMAGE_MODELS;

    return IMAGE_MODELS.filter((entry) =>
      `${entry.name} ${entry.id} ${entry.tagline}`
        .toLowerCase()
        .includes(needle),
    );
  }, [modelQuery]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptId = useId();

  // Grow with the prompt, up to a few lines, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;

    if (!el) return;

    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [prompt]);

  // Estimated credits for the current settings. Skipped for models that need a
  // reference before the CLI can price the job (Outpaint, Background Remover).
  useEffect(() => {
    if ((model.references?.min ?? 0) > 0) {
      setCost(null);
      setCostLoading(false);
      return;
    }

    const controller = new AbortController();
    setCostLoading(true);

    const timer = setTimeout(() => {
      estimateImageCost(
        {
          model: model.id,
          aspectRatio,
          resolution,
          quality,
          extras,
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
  }, [model.id, model.references, aspectRatio, resolution, quality, extras]);

  // Object URLs for attachment previews are revoked on removal and unmount.
  const referencesRef = useRef<Attachment[]>([]);
  referencesRef.current = references;
  useEffect(
    () => () => {
      for (const attachment of referencesRef.current) {
        URL.revokeObjectURL(attachment.url);
      }
    },
    [],
  );

  // Remember the last configuration, so reloading the page or visiting another
  // media page and coming back restores the model and its composition.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          modelId: model.id,
          aspectRatio,
          resolution,
          quality,
          extras,
        } satisfies StoredImageSettings),
      );
    } catch {
      // Storage may be unavailable (private mode); remembering is best effort.
    }
  }, [model.id, aspectRatio, resolution, quality, extras]);

  const maxReferences = model.references?.max ?? 0;
  const minReferences = model.references?.min ?? 0;
  const missingReferences = Math.max(0, minReferences - references.length);
  const canSubmit =
    !busy &&
    missingReferences === 0 &&
    (prompt.trim().length > 0 || !model.promptRequired);

  function applyModel(nextId: string) {
    const next = getImageModel(nextId);
    const limit = next.references?.max ?? 0;

    setModelId(next.id);
    setAspectRatio(next.defaultAspectRatio);
    setResolution(next.defaultResolution);
    setQuality(next.defaultQuality);
    setExtras(defaultsOf(next));
    setModelQuery("");
    setReferences((current) => {
      for (const dropped of current.slice(limit)) {
        URL.revokeObjectURL(dropped.url);
      }

      return current.slice(0, limit);
    });
  }

  function ingestFiles(files: File[]) {
    if (maxReferences === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));

    if (images.length === 0) return;

    const room = maxReferences - references.length;

    if (room <= 0) {
      setNotice(
        `${model.name} accepts up to ${maxReferences} reference image${
          maxReferences === 1 ? "" : "s"
        }.`,
      );

      return;
    }

    const accepted = images
      .slice(0, room)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));

    setReferences((current) => [...current, ...accepted]);
    setNotice(
      images.length > room
        ? `Only ${room} more reference image${
            room === 1 ? "" : "s"
          } fit — ${model.name} accepts up to ${maxReferences}.`
        : null,
    );
  }

  function hasImageDrag(event: React.DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function onDragEnter(event: React.DragEvent) {
    if (!hasImageDrag(event)) return;

    event.preventDefault();

    if (maxReferences === 0) return;

    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: React.DragEvent) {
    if (!hasImageDrag(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = maxReferences === 0 ? "none" : "copy";
  }

  function onDragLeave() {
    if (dragDepth.current === 0) return;

    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: React.DragEvent) {
    if (!hasImageDrag(event)) return;

    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);

    if (maxReferences === 0) return;

    ingestFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  function onPaste(event: React.ClipboardEvent) {
    if (maxReferences === 0) return;

    const clipboard = event.clipboardData;
    const files = Array.from(clipboard?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);

    const images = files.filter((file) => file.type.startsWith("image/"));

    if (images.length === 0) return;

    // Keep normal text pastes intact; only swallow the event when the clipboard
    // is image-only (screenshots, copied images).
    if (!clipboard.getData("text/plain")) event.preventDefault();

    ingestFiles(images);
  }

  function removeReference(url: string) {
    URL.revokeObjectURL(url);
    setReferences((current) => current.filter((item) => item.url !== url));
  }

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setNotice(null);

    try {
      await onSubmit({
        model: model.id,
        prompt: prompt.trim(),
        aspectRatio,
        resolution,
        quality,
        extras,
        references: references.map((item) => item.file),
      });
      setPrompt("");
      for (const attachment of references) URL.revokeObjectURL(attachment.url);
      setReferences([]);
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
        <div
          className={`relative rounded-3xl border border-zinc-200/80 bg-white/90 p-2 shadow-[0_18px_50px_-18px_rgba(24,24,27,0.35)] backdrop-blur-xl transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/90 dark:shadow-black/60 ${
            dragging ? "border-zinc-400 dark:border-zinc-500" : ""
          }`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onPaste={onPaste}
        >
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-zinc-400 bg-white/85 backdrop-blur-sm dark:border-zinc-500 dark:bg-zinc-900/85">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                Drop images to add references
              </p>
            </div>
          ) : null}
          {notice ? (
            <div
              role="alert"
              className="mx-1 mt-1 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-rose-500" />
              <span>{notice}</span>
            </div>
          ) : null}

          {references.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 px-1.5 pt-1.5 pb-1">
              {references.map((attachment) => (
                <div
                  key={attachment.url}
                  className="group relative size-14 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <img
                    src={attachment.url}
                    alt={attachment.file.name}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeReference(attachment.url)}
                    aria-label={`Remove ${attachment.file.name}`}
                    className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <label htmlFor={promptId} className="sr-only">
            Prompt
          </label>
          <TextArea
            id={promptId}
            ref={textareaRef}
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={
              model.promptRequired
                ? "Describe the image you want to create…"
                : "Optional prompt — or just add a reference image"
            }
            className="max-h-33 min-h-0 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed text-zinc-900 shadow-none placeholder:text-zinc-400 focus:bg-transparent focus:shadow-none focus:ring-0 dark:bg-transparent dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />

          <div className="flex items-end gap-2 px-0.5 pb-0.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {maxReferences > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isIconOnly
                  isDisabled={references.length >= maxReferences}
                  onPress={() => fileInputRef.current?.click()}
                  aria-label={`Add reference images (${references.length} of ${maxReferences})`}
                  className="size-9 min-h-9 shrink-0 rounded-full border-zinc-200 bg-white text-zinc-700 shadow-none hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <PlusIcon />
                </Button>
              ) : null}

              <Select
                aria-label="Model"
                className="w-auto"
                value={model.id}
                onChange={(key) => {
                  if (key != null) applyModel(String(key));
                }}
                onOpenChange={(open) => {
                  if (!open) setModelQuery("");
                }}
              >
                <Select.Trigger className={triggerPill}>
                  <Select.Value className="truncate whitespace-nowrap">
                    {model.name}
                  </Select.Value>
                </Select.Trigger>
                <Select.Popover
                  placement="top start"
                  className={`${popoverPanel} max-h-96 w-72 max-w-[calc(100vw-2rem)]`}
                >
                  <ModelSearchField
                    value={modelQuery}
                    onChange={setModelQuery}
                  />

                  {filteredModels.length > 0 ? (
                    <ListBox
                      aria-label="Image models"
                      items={filteredModels}
                      className="max-h-72 overflow-y-auto"
                    >
                      {(option) => (
                        <ListBox.Item
                          id={option.id}
                          textValue={option.name}
                          className={`${itemClasses} items-start`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">
                              {option.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                              {option.tagline}
                            </span>
                          </span>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      )}
                    </ListBox>
                  ) : (
                    <ListBox
                      aria-label="Image models"
                      className="max-h-72 overflow-y-auto"
                    >
                      <ListBox.Item
                        id="__no_results"
                        isDisabled
                        textValue="No models found"
                        className={itemClasses}
                      >
                        <span className="truncate text-zinc-500 dark:text-zinc-400">
                          No models match “{modelQuery.trim()}”
                        </span>
                      </ListBox.Item>
                    </ListBox>
                  )}
                </Select.Popover>
              </Select>

              {model.aspectRatios.length > 1 ? (
                <PillSelect
                  label="Aspect ratio"
                  value={aspectRatio}
                  options={model.aspectRatios.map((ratio) => ({
                    value: ratio,
                    label: ratio,
                    icon: <RatioGlyph ratio={ratio} />,
                  }))}
                  onChange={setAspectRatio}
                  valueContent={
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <RatioGlyph ratio={aspectRatio} />
                      {aspectRatio}
                    </span>
                  }
                  className="w-40"
                />
              ) : null}

              {model.resolutions && model.resolutions.length > 1 ? (
                <PillSelect
                  label="Resolution"
                  value={resolution ?? ""}
                  options={model.resolutions.map((value) => ({
                    value,
                    label: formatOption(value),
                  }))}
                  onChange={setResolution}
                  className="w-36"
                />
              ) : null}

              {model.qualities && model.qualities.length > 1 ? (
                <PillSelect
                  label="Quality"
                  value={quality ?? ""}
                  options={model.qualities.map((value) => ({
                    value,
                    label: formatOption(value),
                  }))}
                  onChange={setQuality}
                  className="w-36"
                />
              ) : null}

              {(model.extras ?? []).map((extra) => (
                <PillSelect
                  key={extra.key}
                  label={extra.label}
                  value={extras[extra.key] ?? extra.defaultValue}
                  options={extra.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  onChange={(value) =>
                    setExtras((current) => ({ ...current, [extra.key]: value }))
                  }
                  valueContent={
                    <span className="flex items-center gap-1.5">
                      <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">
                        {extra.label}
                      </span>
                      {formatOption(extras[extra.key] ?? extra.defaultValue)}
                    </span>
                  }
                  className="w-44"
                />
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {cost !== null ? (
                <span
                  title="Estimated credits for these settings"
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
                  missingReferences > 0
                    ? `Add ${missingReferences} reference image${
                        missingReferences > 1 ? "s" : ""
                      } to continue`
                    : "Generate image"
                }
                className="size-9 shrink-0 rounded-full bg-zinc-900 text-white hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:opacity-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
              >
                {busy ? <Spinner color="current" size="sm" /> : <ArrowUpIcon />}
              </Button>
            </div>
          </div>
        </div>

        <p className="mt-2 hidden text-center text-[11px] text-zinc-400 sm:block dark:text-zinc-500">
          {model.name} · {aspectRatio}
          {model.resolutions ? ` · ${formatOption(resolution ?? "")}` : ""}
          {model.qualities ? ` · ${formatOption(quality ?? "")} quality` : ""}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            ingestFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function defaultsOf(model: ImageModel): Record<string, string> {
  return Object.fromEntries(
    (model.extras ?? []).map((extra) => [extra.key, extra.defaultValue]),
  );
}

function formatCredits(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}

const SETTINGS_STORAGE_KEY = "higgs-proxy:image-prompt-settings";

interface StoredImageSettings {
  modelId: string;
  aspectRatio: string;
  resolution?: string;
  quality?: string;
  extras: Record<string, string>;
}

/**
 * Reads the last used configuration and clamps it to what the stored model
 * actually accepts, so stale or hand-edited values never reach the CLI.
 */
function readStoredSettings(): StoredImageSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) return null;

    const value = parsed as Record<string, unknown>;
    const model = getImageModel(
      typeof value.modelId === "string"
        ? value.modelId
        : DEFAULT_IMAGE_MODEL_ID,
    );

    const aspectRatio =
      typeof value.aspectRatio === "string" &&
      model.aspectRatios.includes(value.aspectRatio)
        ? value.aspectRatio
        : model.defaultAspectRatio;

    const resolution =
      typeof value.resolution === "string" &&
      model.resolutions?.includes(value.resolution)
        ? value.resolution
        : model.defaultResolution;

    const quality =
      typeof value.quality === "string" &&
      model.qualities?.includes(value.quality)
        ? value.quality
        : model.defaultQuality;

    const storedExtras =
      typeof value.extras === "object" && value.extras !== null
        ? (value.extras as Record<string, unknown>)
        : {};

    const extras = Object.fromEntries(
      (model.extras ?? []).map((extra) => {
        const candidate = storedExtras[extra.key];

        return [
          extra.key,
          typeof candidate === "string" &&
          extra.options.some((option) => option.value === candidate)
            ? candidate
            : extra.defaultValue,
        ];
      }),
    );

    return {
      modelId: model.id,
      aspectRatio,
      resolution,
      quality,
      extras,
    };
  } catch {
    return null;
  }
}
