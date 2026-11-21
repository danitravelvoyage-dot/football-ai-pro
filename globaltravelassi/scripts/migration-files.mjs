import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The files the manifest covers, relative to the repository root: every migration, then the rollback scripts. */
export function migrationFiles(root) {
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => `supabase/migrations/${f}`);
  return [...migrations, "docs/migrations/0018_rollback.sql", "docs/migrations/0019_rollback.sql"];
}
