// Writes docs/migrations/manifest.json: a SHA-256 for every migration and for the 0018 rollback script.
// Run it after a migration is reviewed and changed. Nothing here touches a database.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { migrationFiles } = await import("./migration-files.mjs");
const files = migrationFiles(root);

const manifest = Object.fromEntries(files.map((name) => [name, createHash("sha256").update(readFileSync(join(root, name))).digest("hex")]));
writeFileSync(
  join(root, "docs/migrations/manifest.json"),
  JSON.stringify({ note: "SHA-256 of each migration and rollback. Regenerate with scripts/migration-manifest.mjs after review.", files: manifest }, null, 2) + "\n",
);
console.log(`Wrote ${files.length} checksums to docs/migrations/manifest.json`);
