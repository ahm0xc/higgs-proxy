import { requestJson } from "./request";

export type ImageStatus =
  "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface GeneratedImage {
  id: string;
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
