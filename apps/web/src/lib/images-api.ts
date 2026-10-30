import { apiBaseUrl } from "./api";
import { requestJson } from "./request";

export type ImageStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface GeneratedImage {
  id: string;
  userId: string;
  model: string;
  modelName: string;
  prompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  resolution: string | null;
  quality: string | null;
  status: ImageStatus;
  progress: number;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  creditsCost: number | null;
  isFavorite: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface ImageListResponse {
  images: GeneratedImage[];
  nextCursor: number | null;
}

export function listImages(options: { favorite?: boolean } = {}) {
  const params = new URLSearchParams({ limit: "60" });
  if (options.favorite) params.set("favorite", "true");

  return requestJson<ImageListResponse>(`/images?${params.toString()}`);
}

export interface ImageCostInput {
  model: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  extras?: Record<string, string>;
}

/** Estimated credits for one generation, priced by the CLI without a job. */
export function estimateImageCost(
  input: ImageCostInput,
  init: RequestInit = {},
) {
  return requestJson<{ credits: number }>("/images/cost", {
    method: "POST",
    body: JSON.stringify(input),
    ...init,
  });
}

export interface CreateImageInput {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  quality?: string;
  extras: Record<string, string>;
  references: File[];
}

/** Uploads references and enqueues the generation; returns the new rows. */
export function createImage(input: CreateImageInput) {
  const body = new FormData();

  body.set("model", input.model);
  body.set("prompt", input.prompt);
  body.set("aspectRatio", input.aspectRatio);
  if (input.resolution) body.set("resolution", input.resolution);
  if (input.quality) body.set("quality", input.quality);
  body.set("extras", JSON.stringify(input.extras));

  for (const file of input.references) {
    body.append("references", file);
  }

  return requestJson<{ images: GeneratedImage[] }>("/images", {
    method: "POST",
    body,
  });
}

/** Same-origin download endpoint; the API streams the file as an attachment. */
export function imageDownloadUrl(id: string) {
  return `${apiBaseUrl}/images/${id}/download`;
}

/** Sets the star on one image; the gallery updates optimistically. */
export function setImageFavorite(id: string, favorite: boolean) {
  return requestJson<{ id: string; isFavorite: boolean }>(
    `/images/${id}/favorite`,
    {
      method: "PATCH",
      body: JSON.stringify({ favorite }),
    },
  );
}

export function getImage(id: string) {
  return requestJson<{ image: GeneratedImage; inputs: unknown[] }>(
    `/images/${id}`,
  );
}
