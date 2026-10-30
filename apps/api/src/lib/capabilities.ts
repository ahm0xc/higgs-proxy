import { eq, inArray } from "drizzle-orm";

import { db } from "./db";
import { userCapabilities } from "./db/schema";

export type Capability = "image" | "video" | "audio";

export interface Capabilities {
  image: boolean;
  video: boolean;
  audio: boolean;
}

/** Admins bypass capability checks, so they read as "everything allowed". */
export const ALL_CAPABILITIES: Capabilities = {
  image: true,
  video: true,
  audio: true,
};

export const NO_CAPABILITIES: Capabilities = {
  image: false,
  video: false,
  audio: false,
};

type CapabilityRow = {
  canImage: boolean;
  canVideo: boolean;
  canAudio: boolean;
};

function fromRow(row: CapabilityRow | undefined): Capabilities {
  if (!row) return NO_CAPABILITIES;

  return {
    image: row.canImage,
    video: row.canVideo,
    audio: row.canAudio,
  };
}

/** A missing row fails closed: no row means no access. */
export async function getCapabilities(userId: string): Promise<Capabilities> {
  const rows = await db
    .select({
      canImage: userCapabilities.canImage,
      canVideo: userCapabilities.canVideo,
      canAudio: userCapabilities.canAudio,
    })
    .from(userCapabilities)
    .where(eq(userCapabilities.userId, userId))
    .limit(1);

  return fromRow(rows[0]);
}

export async function getCapabilitiesFor(
  userIds: string[],
): Promise<Map<string, Capabilities>> {
  if (userIds.length === 0) return new Map();

  const rows = await db
    .select({
      userId: userCapabilities.userId,
      canImage: userCapabilities.canImage,
      canVideo: userCapabilities.canVideo,
      canAudio: userCapabilities.canAudio,
    })
    .from(userCapabilities)
    .where(inArray(userCapabilities.userId, userIds));

  return new Map(rows.map((row) => [row.userId, fromRow(row)]));
}

export async function setCapabilities(
  userId: string,
  capabilities: Capabilities,
): Promise<Capabilities> {
  const now = new Date();

  await db
    .insert(userCapabilities)
    .values({
      userId,
      canImage: capabilities.image,
      canVideo: capabilities.video,
      canAudio: capabilities.audio,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userCapabilities.userId,
      set: {
        canImage: capabilities.image,
        canVideo: capabilities.video,
        canAudio: capabilities.audio,
        updatedAt: now,
      },
    });

  return capabilities;
}

export async function deleteCapabilities(userId: string): Promise<void> {
  await db.delete(userCapabilities).where(eq(userCapabilities.userId, userId));
}

export function hasCapability(
  capabilities: Capabilities,
  capability: Capability,
): boolean {
  return capabilities[capability];
}
