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
}));
