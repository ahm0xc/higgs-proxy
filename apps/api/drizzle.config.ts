import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
config();

export default defineConfig({
  out: "./drizzle",
  schema: "./src/lib/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_FILE_NAME ?? "./db.sqlite",
  },
});
