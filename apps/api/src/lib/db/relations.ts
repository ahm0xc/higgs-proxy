import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    capabilities: r.one.userCapabilities({
      from: r.user.id,
      to: r.userCapabilities.userId,
    }),
    imageGenerations: r.many.imageGeneration({
      from: r.user.id,
      to: r.imageGeneration.userId,
    }),
    audioGenerations: r.many.audioGeneration({
      from: r.user.id,
      to: r.audioGeneration.userId,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
    }),
  },
  userCapabilities: {
    user: r.one.user({
      from: r.userCapabilities.userId,
      to: r.user.id,
    }),
  },
  imageGeneration: {
    user: r.one.user({
      from: r.imageGeneration.userId,
      to: r.user.id,
    }),
    inputs: r.many.imageGenerationInput({
      from: r.imageGeneration.id,
      to: r.imageGenerationInput.generationId,
    }),
  },
  imageGenerationInput: {
    generation: r.one.imageGeneration({
      from: r.imageGenerationInput.generationId,
      to: r.imageGeneration.id,
    }),
  },
  audioGeneration: {
    user: r.one.user({
      from: r.audioGeneration.userId,
      to: r.user.id,
    }),
  },
}));
