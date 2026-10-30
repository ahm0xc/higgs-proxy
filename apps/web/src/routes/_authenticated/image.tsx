import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { LockedFeature } from "~/components/locked-feature";
import type { GeneratedImage, ImageStatus } from "~/lib/images-api";
import { listImages } from "~/lib/images-api";

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

  return (
    <main className="w-full py-4">
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
        <div className="mt-4 columns-1 gap-0.5 sm:columns-2 lg:columns-3 xl:columns-4 2xl:columns-5">
          {images.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              onOpen={() => setSelected(image)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <Lightbox image={selected} onClose={() => setSelected(null)} />
      ) : null}
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
          : "Generated images will appear here as soon as you create the first one."}
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

function StarIcon({ filled }: { filled: boolean }) {
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
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
    </svg>
  );
}

function ImageCard({
  image,
  onOpen,
}: {
  image: GeneratedImage;
  onOpen: () => void;
}) {
  const src = image.thumbnailUrl ?? image.resultUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative mb-0.5 block w-full break-inside-avoid overflow-hidden bg-zinc-100 text-left dark:bg-zinc-900"
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        {image.status === "completed" && src ? (
          <img
            src={src}
            alt={image.prompt}
            width={image.width}
            height={image.height}
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
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
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-300/70 dark:bg-zinc-700/70">
              <div
                className="h-full bg-zinc-900 transition-[width] duration-700 dark:bg-zinc-100"
                style={{ width: `${image.progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="absolute top-2 left-2 flex gap-1.5">
          <StatusBadge status={image.status} />
        </div>

        {image.isFavorite ? (
          <span
            aria-label="Favorite"
            className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-amber-300 backdrop-blur-sm"
          >
            <StarIcon filled />
          </span>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-linear-to-t from-black/80 via-black/35 to-transparent px-3 pt-10 pb-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <p className="line-clamp-2 text-xs leading-snug text-white/90">
            {image.prompt}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/60">
            <span className="font-medium text-white/80">{image.modelName}</span>
            <span aria-hidden="true">·</span>
            <span>{image.aspectRatio}</span>
            <span aria-hidden="true">·</span>
            <span>
              {image.width}×{image.height}
            </span>
          </p>
        </div>
      </div>
    </button>
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
