/**
 * Seeds fake image generations so the gallery has something to render.
 *
 *   bun run scripts/seed-image-generations.ts [user@email.com]
 *
 * Without an email it falls back to the first admin, then the first user.
 * Images come from picsum.photos, so they are stable and need no local files.
 * Re-running is safe: rows get deterministic ids and are inserted with
 * `onConflictDoNothing`.
 */
import { createHash } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { db } from "../src/lib/db";
import { imageGeneration, user } from "../src/lib/db/schema";

type Seed = {
  model: string;
  modelName: string;
  prompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  resolution: string;
  quality: string;
  seed: number | null;
  status: "completed" | "processing" | "failed" | "queued";
  favorite?: boolean;
  credits: number | null;
  params?: Record<string, unknown>;
  ageHours: number;
};

const seeds: Seed[] = [
  {
    model: "text2image_soul_v2",
    modelName: "Higgsfield Soul 2.0",
    prompt:
      "Editorial portrait of a woman in a cream knit sweater, soft window light, shallow depth of field, film grain",
    aspectRatio: "2:3",
    width: 1024,
    height: 1536,
    resolution: "2k",
    quality: "2k",
    seed: 845_213,
    status: "completed",
    favorite: true,
    credits: 3,
    params: { style_id: "soul-cinematic", custom_reference_id: null },
    ageHours: 2,
  },
  {
    model: "nano_banana_pro",
    modelName: "Nano Banana Pro",
    prompt:
      "Aerial view of a turquoise coastline at golden hour, long shadows, ultra sharp landscape photography",
    aspectRatio: "16:9",
    width: 1344,
    height: 768,
    resolution: "4k",
    quality: "high",
    seed: null,
    status: "completed",
    favorite: true,
    credits: 6,
    params: { background: "opaque" },
    ageHours: 5,
  },
  {
    model: "gpt_image_2",
    modelName: "GPT Image 2",
    prompt:
      "Minimal product shot of a matte black perfume bottle on a concrete plinth, single hard key light",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    resolution: "2k",
    quality: "medium",
    seed: null,
    status: "completed",
    credits: 4,
    params: { remove_bg: false },
    ageHours: 9,
  },
  {
    model: "seedream_v4_5",
    modelName: "Seedream 4.5",
    prompt:
      "Wide cinematic still of a lone traveler on a desert road, dust in the air, anamorphic flare",
    aspectRatio: "21:9",
    width: 1680,
    height: 720,
    resolution: "2k",
    quality: "high",
    seed: 190_044,
    status: "completed",
    credits: 5,
    ageHours: 14,
  },
  {
    model: "flux_3_image",
    modelName: "FLUX 3 Image",
    prompt:
      "Overhead flat lay of breakfast on a linen tablecloth, croissants, coffee, morning sun",
    aspectRatio: "4:3",
    width: 1536,
    height: 1152,
    resolution: "2k",
    quality: "high",
    seed: 33_102,
    status: "completed",
    favorite: true,
    credits: 3,
    ageHours: 20,
  },
  {
    model: "ideogram_4_5",
    modelName: "Ideogram 4.5",
    prompt:
      "Poster design with bold brutalist typography reading 'MAKE IT LOUD', risograph texture",
    aspectRatio: "3:4",
    width: 1152,
    height: 1536,
    resolution: "2k",
    quality: "high",
    seed: 77_431,
    status: "completed",
    credits: 2,
    params: { magic_prompt: "off", batch_size: 1 },
    ageHours: 26,
  },
  {
    model: "text2image_soul_v2",
    modelName: "Higgsfield Soul 2.0",
    prompt:
      "Full body fashion photo on a rain-soaked Tokyo street at night, neon reflections",
    aspectRatio: "9:16",
    width: 768,
    height: 1344,
    resolution: "2k",
    quality: "2k",
    seed: 561_887,
    status: "completed",
    credits: 3,
    ageHours: 31,
  },
  {
    model: "nano_banana_2_1",
    modelName: "Nano Banana 2.1",
    prompt:
      "Macro shot of dew on a spider web between grass blades, backlit, dreamy bokeh",
    aspectRatio: "3:2",
    width: 1536,
    height: 1024,
    resolution: "4k",
    quality: "high",
    seed: null,
    status: "completed",
    credits: 6,
    ageHours: 40,
  },
  {
    model: "recraft_v4_1",
    modelName: "Recraft V4.1",
    prompt:
      "Isometric illustration of a cozy bookshop interior, warm palette, soft shadows",
    aspectRatio: "5:4",
    width: 1280,
    height: 1024,
    resolution: "1k",
    quality: "high",
    seed: 9_912,
    status: "completed",
    credits: 2,
    ageHours: 52,
  },
  {
    model: "grok_image_2_0",
    modelName: "Grok Image 2.0",
    prompt:
      "Street style portrait of a skateboarder mid-air, motion blur, overcast daylight",
    aspectRatio: "4:5",
    width: 1080,
    height: 1350,
    resolution: "2k",
    quality: "high",
    seed: null,
    status: "completed",
    credits: 2,
    ageHours: 63,
  },
  {
    model: "seedream_5_0_flash",
    modelName: "Seedream 5.0 Flash",
    prompt:
      "Cinematic wide of a lighthouse in a storm, huge waves breaking, moody teal grade",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    resolution: "2k",
    quality: "basic",
    seed: 120_398,
    status: "completed",
    favorite: true,
    credits: 1,
    ageHours: 75,
  },
  {
    model: "z_image",
    modelName: "Z Image",
    prompt:
      "Studio still life of citrus fruit arranged on a cobalt blue background, crisp shadows",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    resolution: "1k",
    quality: "high",
    seed: 44_501,
    status: "processing",
    credits: 1,
    ageHours: 0.2,
  },
  {
    model: "nano_banana_pro",
    modelName: "Nano Banana Pro",
    prompt:
      "Portrait of an elderly fisherman, weathered skin, natural light, documentary style",
    aspectRatio: "3:4",
    width: 1152,
    height: 1536,
    resolution: "2k",
    quality: "high",
    seed: null,
    status: "failed",
    credits: null,
    ageHours: 3,
  },
  {
    model: "text2image_soul_v2",
    modelName: "Higgsfield Soul 2.0",
    prompt:
      "Ultra wide interior of a concrete gallery hall, single skylight, sunbeam dust",
    aspectRatio: "21:9",
    width: 1680,
    height: 720,
    resolution: "2k",
    quality: "2k",
    seed: 60_777,
    status: "queued",
    credits: 3,
    ageHours: 0.05,
  },
];

const FAILED_ERROR =
  "Provider rejected the request: the prompt violated the content policy.";

function idFor(email: string, index: number, seed: Seed) {
  const hash = createHash("sha1")
    .update(`${email}:${index}:${seed.model}`)
    .digest("hex");

  // Shaped like a UUID so it looks like the provider's ids in the UI.
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

function providerJobIdFor(id: string) {
  return [`hf`, id.replace(/-/g, "").slice(0, 24)].join("_");
}

function imageUrl(seed: Seed, width: number, height: number, index: number) {
  return `https://picsum.photos/seed/${encodeURIComponent(
    `${seed.model}-${index}`,
  )}/${width}/${height}`;
}

async function resolveUser(email: string | undefined) {
  if (email) {
    const [found] = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (!found) throw new Error(`No user with email "${email}"`);

    return found;
  }

  const [admin] = await db
    .select()
    .from(user)
    .where(eq(user.role, "admin"))
    .orderBy(asc(user.createdAt))
    .limit(1);

  if (admin) return admin;

  const [first] = await db
    .select()
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);

  if (!first) {
    throw new Error(
      "No users found. Create the first admin through /setup, then re-run the seed.",
    );
  }

  return first;
}

const owner = await resolveUser(process.argv[2]);
const now = Date.now();

const rows = seeds.map((seed, index) => {
  const id = idFor(owner.email, index, seed);
  const createdAt = new Date(now - seed.ageHours * 60 * 60 * 1000);
  const completedAt =
    seed.status === "completed"
      ? new Date(createdAt.getTime() + 32_000)
      : seed.status === "failed"
        ? new Date(createdAt.getTime() + 12_000)
        : null;

  const progress =
    seed.status === "completed"
      ? 100
      : seed.status === "failed"
        ? 40
        : seed.status === "processing"
          ? 55
          : 0;

  return {
    id,
    userId: owner.id,
    providerJobId: providerJobIdFor(id),
    model: seed.model,
    modelName: seed.modelName,
    prompt: seed.prompt,
    aspectRatio: seed.aspectRatio,
    width: seed.width,
    height: seed.height,
    resolution: seed.resolution,
    quality: seed.quality,
    seed: seed.seed,
    status: seed.status,
    progress,
    resultUrl:
      seed.status === "completed"
        ? imageUrl(seed, seed.width, seed.height, index)
        : null,
    thumbnailUrl:
      seed.status === "completed"
        ? imageUrl(
            seed,
            Math.round(seed.width / 2),
            Math.round(seed.height / 2),
            index,
          )
        : null,
    error: seed.status === "failed" ? FAILED_ERROR : null,
    params: seed.params ?? {},
    creditsCost: seed.credits,
    isFavorite: seed.favorite ?? false,
    deletedAt: null,
    createdAt,
    updatedAt: completedAt ?? createdAt,
    completedAt,
  };
});

const inserted = await db
  .insert(imageGeneration)
  .values(rows)
  .onConflictDoNothing()
  .returning({ id: imageGeneration.id });

console.log(
  `Seeded ${inserted.length}/${rows.length} image generations for ${owner.email}.`,
);
if (inserted.length < rows.length) {
  console.log(
    "Some rows already existed (deterministic ids); nothing was overwritten.",
  );
}
