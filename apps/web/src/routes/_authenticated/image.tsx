import { Avatar } from "@heroui/react/avatar";
import { Tooltip } from "@heroui/react/tooltip";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import type { ImagePrompt } from "~/components/image-prompt-bar";
import { ImagePromptBar } from "~/components/image-prompt-bar";
import { LockedFeature } from "~/components/locked-feature";
import { avatarUrlFor } from "~/components/user-menu";
import type { GeneratedImage, ImageStatus } from "~/lib/images-api";
import {
  createImage,
  imageDownloadUrl,
  listImages,
  setImageFavorite,
} from "~/lib/images-api";

export const Route = createFileRoute("/_authenticated/image")({
  component: ImagePage,
});

function ImagePage() {
  const { auth } = Route.useRouteContext();

  if (!auth.capabilities.image) return <LockedFeature feature="image" />;

  return <Gallery />;
}

type Filter = "all" | "favorites";

const STATUS_LABEL: Record<ImageStatus, string> = {
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

function Gallery() {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GeneratedImage | null>(null);

  const load = useCallback(async (next: Filter) => {
    setLoading(true);
    setError(null);

    try {
      const result = await listImages({ favorite: next === "favorites" });
      setImages(result.images);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load images",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  // Poll while anything is still rendering. The API refreshes each pending job
  // from the CLI before answering, so this also picks up completed results.
  const hasPending = images.some(
    (image) => image.status === "queued" || image.status === "processing",
  );

  useEffect(() => {
    if (!hasPending) return;

    const timer = setInterval(() => {
      void listImages({ favorite: filter === "favorites" })
        .then((result) => setImages(result.images))
        .catch(() => {
          // A failed poll is transient; the next tick retries.
        });
    }, 3000);

    return () => clearInterval(timer);
  }, [hasPending, filter]);

  const generate = useCallback(
    async (prompt: ImagePrompt) => {
      const result = await createImage(prompt);

      // Favorites excludes fresh generations, so only the "all" view shows
      // the optimistic cards.
      if (filter === "all") {
        setImages((current) => [
          ...result.images,
          ...current.filter(
            (image) => !result.images.some((added) => added.id === image.id),
          ),
        ]);
      }
    },
    [filter],
  );

  const toggleFavorite = useCallback(async (image: GeneratedImage) => {
    const favorite = !image.isFavorite;

    // Optimistic: the star flips immediately, and rolls back if the API rejects.
    setImages((current) =>
      current.map((item) =>
        item.id === image.id ? { ...item, isFavorite: favorite } : item,
      ),
    );

    try {
      await setImageFavorite(image.id, favorite);
    } catch {
      setImages((current) =>
        current.map((item) =>
          item.id === image.id ? { ...item, isFavorite: !favorite } : item,
        ),
      );
    }
  }, []);

  return (
    <main className="w-full pt-4 pb-56">
      <div className="mb-3 flex justify-end px-4 sm:px-6">
        <div
          role="group"
          aria-label="Filter images"
          className="flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {(
            [
              ["all", "All"],
              ["favorites", "Favorites"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                filter === value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-8 flex flex-wrap items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(filter)}
            className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <SkeletonGrid />
      ) : images.length === 0 && !error ? (
        <EmptyState favorite={filter === "favorites"} />
      ) : (
        <div className="mt-4 px-0.5">
          <ImageGrid
            images={images}
            onOpen={setSelected}
            onToggleFavorite={(image) => void toggleFavorite(image)}
          />
        </div>
      )}

      {selected ? (
        <Lightbox image={selected} onClose={() => setSelected(null)} />
      ) : (
        <ImagePromptBar onSubmit={generate} />
      )}
    </main>
  );
}

const SKELETON_RATIOS = [
  "4 / 5",
  "16 / 9",
  "1 / 1",
  "2 / 3",
  "3 / 2",
  "9 / 16",
  "4 / 3",
  "1 / 1",
];

function SkeletonGrid() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 columns-1 gap-2 sm:columns-2 lg:columns-3 xl:columns-4 2xl:columns-5"
    >
      {SKELETON_RATIOS.map((ratio, index) => (
        <div
          key={index}
          className="mb-2 break-inside-avoid overflow-hidden bg-white dark:bg-zinc-900"
        >
          <div
            className="animate-pulse bg-zinc-100 dark:bg-zinc-800"
            style={{ aspectRatio: ratio }}
          />
          <div className="space-y-2 p-3">
            <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ favorite }: { favorite: boolean }) {
  return (
    <div className="mx-4 mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center sm:mx-6 dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {favorite ? "No favorites yet" : "No images yet"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {favorite
          ? "Star a generation and it will show up here."
          : "Describe an image in the prompt bar below and it will appear here."}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: ImageStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
      {status === "processing" || status === "queued" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
      ) : status === "failed" ? (
        <span className="size-1.5 rounded-full bg-red-400" />
      ) : (
        <span className="size-1.5 rounded-full bg-emerald-400" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M12 20.25l-1.1-1c-3.9-3.5-5.9-5.4-5.9-8.3A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 6.9 2.85c0 2.9-2 4.8-5.9 8.3l-1 1z" />
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
 * Saves the image through the API's download endpoint. Fetching the file as a
 * blob (rather than pointing an <a download> at it) is what makes the browser
 * save it instead of opening it, and the proxy is what makes it work at all —
 * the provider URL is cross-origin and CORS-blocked.
 */
async function saveImage(id: string) {
  const response = await fetch(imageDownloadUrl(id), {
    credentials: "include",
  });

  if (!response.ok) throw new Error("Could not download the image");

  const disposition = response.headers.get("content-disposition") ?? "";
  const filename =
    /filename="?([^";]+)"?/.exec(disposition)?.[1] ??
    `higgs-${id.slice(0, 8)}.png`;

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

function ImageCard({
  image,
  onOpen,
  onToggleFavorite,
}: {
  image: GeneratedImage;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const src = image.thumbnailUrl ?? image.resultUrl;
  const isReady = image.status === "completed" && Boolean(src);

  return (
    <div className="group relative block h-full min-h-0 w-full bg-zinc-100 dark:bg-zinc-900">
      {/* The whole card opens the lightbox; actions layer above it. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open image: ${image.prompt}`}
        className="absolute inset-0 z-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-inset dark:focus-visible:ring-zinc-100"
      />

      {/* Not clipped, so the avatar's tooltip can escape the card. */}
      <div className="pointer-events-none relative h-full w-full">
        {isReady ? (
          <img
            src={src ?? undefined}
            alt={image.prompt}
            width={image.width}
            height={image.height}
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : image.status === "failed" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-50 px-6 text-center dark:bg-red-950/30">
            <span className="text-xs font-semibold tracking-wide text-red-600 uppercase dark:text-red-300">
              Generation failed
            </span>
            <span className="line-clamp-3 text-xs text-red-500/90 dark:text-red-300/80">
              {image.error ?? "The provider rejected this request."}
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 overflow-hidden bg-zinc-100 dark:bg-zinc-900">
            <div className="shimmer absolute inset-0" />
          </div>
        )}

        {image.status !== "completed" ? (
          <div className="absolute top-2 left-2 flex gap-1.5">
            <StatusBadge status={image.status} />
          </div>
        ) : null}

        {/* Right rail: who made it, then the actions stacked below. */}
        <div className="absolute inset-y-0 right-0 z-10 flex w-24 flex-col items-end gap-2 bg-linear-to-l from-black/80 via-black/25 to-transparent p-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100 has-[:focus-visible]:opacity-100">
          <Tooltip delay={0}>
            <Tooltip.Trigger className="pointer-events-auto">
              <Avatar
                size="sm"
                className="size-7 shrink-0 ring-1 ring-white/20"
              >
                <Avatar.Image src={avatarUrlFor(image.userId)} alt="" />
              </Avatar>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {image.userName ?? "Unknown user"}
            </Tooltip.Content>
          </Tooltip>

          <div className="pointer-events-auto flex flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={
                image.isFavorite ? "Remove from favorites" : "Add to favorites"
              }
              aria-pressed={image.isFavorite}
              className={`flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/45 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-black/70 ${
                image.isFavorite
                  ? "text-rose-400"
                  : "text-white/90 hover:text-white"
              }`}
            >
              <HeartIcon filled={image.isFavorite} />
            </button>

            {isReady ? (
              <button
                type="button"
                onClick={() => {
                  void saveImage(image.id).catch(() => {
                    // Last resort: hand the file to the browser directly.
                    window.open(
                      image.resultUrl ?? src ?? "",
                      "_blank",
                      "noreferrer",
                    );
                  });
                }}
                aria-label="Download image"
                className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white"
              >
                <DownloadIcon />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Target row height the flex basis is derived from. */
const GRID_TARGET_HEIGHT_PX = 280;

/**
 * Justified grid: cards keep their aspect ratio at roughly the target size and
 * grow to fill a line. The trailing filler absorbs leftover space, so the last
 * line (or a single image) never stretches across the whole page.
 */
function ImageGrid({
  images,
  onOpen,
  onToggleFavorite,
}: {
  images: GeneratedImage[];
  onOpen: (image: GeneratedImage) => void;
  onToggleFavorite: (image: GeneratedImage) => void;
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {images.map((image) => {
        const ratio = image.width / image.height || 1;

        return (
          <div
            key={image.id}
            className="max-w-full min-w-0"
            style={{
              flexGrow: ratio,
              flexBasis: `${Math.round(ratio * GRID_TARGET_HEIGHT_PX)}px`,
              aspectRatio: `${image.width} / ${image.height}`,
            }}
          >
            <ImageCard
              image={image}
              onOpen={() => onOpen(image)}
              onToggleFavorite={() => onToggleFavorite(image)}
            />
          </div>
        );
      })}
      <div
        aria-hidden="true"
        style={{ flexBasis: 0, flexGrow: 1000 }}
        className="min-w-0"
      />
    </div>
  );
}

function Lightbox({
  image,
  onClose,
}: {
  image: GeneratedImage;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const src = image.resultUrl ?? image.thumbnailUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image details"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl md:flex-row dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center bg-zinc-950 md:min-h-[70vh]">
          {src ? (
            <img
              src={src}
              alt={image.prompt}
              className="max-h-[55vh] w-auto max-w-full object-contain md:max-h-[80vh]"
            />
          ) : (
            <p className="p-10 text-sm text-zinc-400">
              {image.error ?? "No image available yet."}
            </p>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-5 overflow-y-auto p-5 md:w-80">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                {image.modelName}
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {STATUS_LABEL[image.status]}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="size-4"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {image.prompt}
          </p>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <Meta label="Aspect ratio" value={image.aspectRatio} />
            <Meta label="Size" value={`${image.width}×${image.height}`} />
            {image.resolution ? (
              <Meta label="Resolution" value={image.resolution} />
            ) : null}
            {image.quality ? (
              <Meta label="Quality" value={image.quality} />
            ) : null}
            <Meta label="Created" value={formatDate(image.createdAt)} />
            {image.creditsCost !== null ? (
              <Meta label="Credits" value={String(image.creditsCost)} />
            ) : null}
          </dl>

          {src ? (
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="mt-auto inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Open full size
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wide text-zinc-500 uppercase dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </div>
  );
}
