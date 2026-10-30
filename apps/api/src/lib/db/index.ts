import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { relations } from "./relations";

const client = new Database(process.env.DB_FILE_NAME ?? "./db.sqlite");

// SQLite does not enforce foreign keys unless asked to, per connection.
// Better Auth relies on `ON DELETE CASCADE` when it deletes a user.
client.exec("PRAGMA foreign_keys = ON");

export const db = drizzle({ client, relations });

export * from "./schema";
