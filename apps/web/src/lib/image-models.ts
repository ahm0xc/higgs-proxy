/**
 * Image models exposed by the Higgsfield CLI, mirroring
 * https://github.com/higgsfield-ai/cli/blob/main/MODELS.md.
 *
 * Only the flags the prompt bar can drive are modeled here: the prompt,
 * composition (aspect ratio, resolution, quality), reference images, and the
 * handful of model-specific extras (variant, background, ...). Every value is
 * the verbatim enum the CLI accepts, so it can be forwarded as
 * `--aspect_ratio`, `--resolution`, `--quality`, `--variant`, ... unchanged.
 */

export interface ImageModelExtra {
  key: string;
  label: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}

export interface ImageModel {
  /** CLI job set type, e.g. `nano_banana_2`. */
  id: string;
  name: string;
  tagline: string;
  aspectRatios: string[];
  defaultAspectRatio: string;
  resolutions?: string[];
  defaultResolution?: string;
  qualities?: string[];
  defaultQuality?: string;
  extras?: ImageModelExtra[];
  /** `max` caps attachments; `min` makes references mandatory. */
  references?: { min?: number; max: number };
  /** Some edit models accept references with no prompt. */
  promptRequired: boolean;
}

const BANANA_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
  "21:9",
];

const WIDE_RATIOS = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "4:5",
  "5:4",
  "16:9",
  "9:16",
  "21:9",
];

function options(values: string[]): ImageModelExtra["options"] {
  return values.map((value) => ({ value, label: value }));
}

const BACKGROUND: ImageModelExtra = {
  key: "background",
  label: "Background",
  defaultValue: "auto",
  options: options(["auto", "opaque", "transparent"]),
};

const BATCH_SIZE: ImageModelExtra = {
  key: "batch_size",
  label: "Images per run",
  defaultValue: "1",
  options: options(["1", "2", "3", "4"]),
};

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "nano_banana_2",
    name: "Nano Banana Pro",
    tagline: "Best all-round quality and prompt accuracy",
    aspectRatios: BANANA_RATIOS,
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k", "4k"],
    defaultResolution: "2k",
    references: { max: 14 },
    promptRequired: true,
  },
  {
    id: "gpt_image_2_5",
    name: "GPT Image 2.5",
    tagline: "High-fidelity design and on-image text",
    aspectRatios: [
      "auto",
      "1:1",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "21:9",
      "27:16",
      "16:27",
      "9:8",
      "8:9",
      "4:5",
      "5:4",
    ],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k", "4k"],
    defaultResolution: "1k",
    qualities: ["low", "medium", "high", "xhigh", "max"],
    defaultQuality: "low",
    extras: [
      BACKGROUND,
      {
        key: "variant",
        label: "Variant",
        defaultValue: "flare",
        options: options(["flare", "sunburst"]),
      },
    ],
    references: { max: 16 },
    promptRequired: true,
  },
  {
    id: "gpt_image_2",
    name: "GPT Image 2",
    tagline: "Product shots, graphics, and text rendering",
    aspectRatios: [
      "auto",
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "21:9",
      "9:16",
      "3:2",
      "2:3",
      "4:5",
      "5:4",
    ],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k", "4k"],
    defaultResolution: "2k",
    qualities: ["low", "medium", "high"],
    defaultQuality: "high",
    extras: [BACKGROUND],
    references: { max: 12 },
    promptRequired: true,
  },
  {
    id: "nano_banana_flash",
    name: "Nano Banana 2",
    tagline: "Fast, balanced everyday generations",
    aspectRatios: BANANA_RATIOS,
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k", "4k"],
    defaultResolution: "1k",
    references: { max: 10 },
    promptRequired: true,
  },
  {
    id: "nano_banana_2_lite",
    name: "Nano Banana 2 Lite",
    tagline: "Cheapest Nano Banana, good for drafts",
    aspectRatios: ["auto", ...BANANA_RATIOS],
    defaultAspectRatio: "1:1",
    resolutions: ["1k"],
    defaultResolution: "1k",
    extras: [
      {
        key: "thinking",
        label: "Thinking",
        defaultValue: "HIGH",
        options: options(["MINIMAL", "HIGH"]),
      },
    ],
    references: { max: 14 },
    promptRequired: true,
  },
  {
    id: "nano_banana",
    name: "Nano Banana",
    tagline: "Classic edits and style transfers",
    aspectRatios: BANANA_RATIOS,
    defaultAspectRatio: "1:1",
    references: { max: 8 },
    promptRequired: true,
  },
  {
    id: "seedream_v4_5",
    name: "Seedream 4.5",
    tagline: "Cinematic stills with strong lighting",
    aspectRatios: ["1:1", "4:3", "16:9", "3:2", "21:9", "3:4", "9:16", "2:3"],
    defaultAspectRatio: "1:1",
    qualities: ["basic", "high"],
    defaultQuality: "basic",
    references: { max: 14 },
    promptRequired: true,
  },
  {
    id: "seedream_v5_lite",
    name: "Seedream V5 Lite",
    tagline: "Quick, inexpensive Seedream pass",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "1:1",
    qualities: ["basic", "high"],
    defaultQuality: "basic",
    references: { max: 8 },
    promptRequired: true,
  },
  {
    id: "flux_2",
    name: "FLUX.2",
    tagline: "Expressive, illustration-friendly output",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k"],
    defaultResolution: "1k",
    extras: [
      {
        key: "variant",
        label: "Variant",
        defaultValue: "pro",
        options: options(["pro", "flex", "max"]),
      },
    ],
    references: { max: 8 },
    promptRequired: true,
  },
  {
    id: "flux_kontext",
    name: "Flux Kontext",
    tagline: "Reference-guided editing up to 4 images",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "1:1",
    references: { max: 4 },
    promptRequired: true,
  },
  {
    id: "text2image_soul_v2",
    name: "Higgsfield Soul V2",
    tagline: "Face-faithful portraits with Soul IDs",
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    defaultAspectRatio: "1:1",
    qualities: ["1.5k", "2k"],
    defaultQuality: "2k",
    references: { max: 1 },
    promptRequired: true,
  },
  {
    id: "soul_cinematic",
    name: "Soul Cinematic",
    tagline: "Film-still portraits and characters",
    aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
    defaultAspectRatio: "1:1",
    qualities: ["1.5k", "2k"],
    defaultQuality: "2k",
    references: { max: 1 },
    promptRequired: true,
  },
  {
    id: "soul_location",
    name: "Soul Location",
    tagline: "Place a subject in a described location",
    aspectRatios: [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "9:21",
    ],
    defaultAspectRatio: "1:1",
    promptRequired: true,
  },
  {
    id: "soul_cast",
    name: "Soul Cast",
    tagline: "Cast a consistent character, 16:9 only",
    aspectRatios: ["16:9"],
    defaultAspectRatio: "16:9",
    promptRequired: false,
  },
  {
    id: "kling_omni_image",
    name: "Kling O1 Image",
    tagline: "Reference-driven composition and edits",
    aspectRatios: [
      "1:1",
      "auto",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
    ],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k"],
    defaultResolution: "1k",
    references: { max: 10 },
    promptRequired: true,
  },
  {
    id: "grok_image",
    name: "Grok Image",
    tagline: "Playful, fast image generation",
    aspectRatios: [
      "1:1",
      "auto",
      "1:2",
      "2:1",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
    ],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k"],
    defaultResolution: "1k",
    extras: [
      {
        key: "mode",
        label: "Mode",
        defaultValue: "std",
        options: options(["std", "quality"]),
      },
    ],
    references: { max: 4 },
    promptRequired: true,
  },
  {
    id: "recraft_v4_1",
    name: "Recraft V4.1",
    tagline: "Vectors, icons, and brand illustration",
    aspectRatios: [
      "1:1",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
    ],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k"],
    defaultResolution: "1k",
    extras: [
      {
        key: "model_type",
        label: "Style",
        defaultValue: "standard",
        options: options(["standard", "vector", "utility", "utility_vector"]),
      },
    ],
    promptRequired: true,
  },
  {
    id: "openai_hazel",
    name: "OpenAI Hazel",
    tagline: "Clean product and lifestyle imagery",
    aspectRatios: ["1:1", "3:2", "2:3", "auto"],
    defaultAspectRatio: "1:1",
    qualities: ["low", "medium", "high"],
    defaultQuality: "medium",
    references: { max: 16 },
    promptRequired: true,
  },
  {
    id: "cinematic_studio_2_5",
    name: "Cinematic Studio 2.5",
    tagline: "Directed, film-grade frames with batching",
    aspectRatios: WIDE_RATIOS,
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k", "4k"],
    defaultResolution: "1k",
    extras: [BATCH_SIZE],
    references: { max: 14 },
    promptRequired: true,
  },
  {
    id: "marketing_studio_image",
    name: "Marketing Studio Image",
    tagline: "Brand ads, products, and avatars",
    aspectRatios: [
      "auto",
      "1:1",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ],
    defaultAspectRatio: "1:1",
    resolutions: ["1k", "2k", "4k"],
    defaultResolution: "1k",
    references: { max: 14 },
    promptRequired: false,
  },
  {
    id: "image_auto",
    name: "Image Auto",
    tagline: "Router that picks a model for you",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "1:1",
    references: { max: 14 },
    promptRequired: true,
  },
  {
    id: "z_image",
    name: "Z Image",
    tagline: "Lightweight prompt-only generations",
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    defaultAspectRatio: "1:1",
    promptRequired: true,
  },
  {
    id: "outpaint",
    name: "Outpaint",
    tagline: "Extend an existing image outward",
    aspectRatios: WIDE_RATIOS,
    defaultAspectRatio: "21:9",
    references: { min: 1, max: 1 },
    promptRequired: false,
  },
  {
    id: "image_background_remover",
    name: "Background Remover",
    tagline: "Cut a subject out onto transparency",
    aspectRatios: ["1:1"],
    defaultAspectRatio: "1:1",
    references: { min: 1, max: 1 },
    promptRequired: false,
  },
];

export const DEFAULT_IMAGE_MODEL_ID = "nano_banana_2";

export function getImageModel(id: string): ImageModel {
  return (
    IMAGE_MODELS.find((model) => model.id === id) ??
    IMAGE_MODELS.find((model) => model.id === DEFAULT_IMAGE_MODEL_ID) ??
    (IMAGE_MODELS[0] as ImageModel)
  );
}
