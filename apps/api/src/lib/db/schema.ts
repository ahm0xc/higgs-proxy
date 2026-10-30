import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const todosTable = sqliteTable("todos_table", {
  id: int().primaryKey({ autoIncrement: true }),
  content: text(),
});
