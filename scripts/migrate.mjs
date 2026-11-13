// Applies database/migrations/*.sql in order, tracking applied files in schema_migrations.
// Usage: DATABASE_URL=postgres://... npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Without it the app uses the local file store (.data/predictions.json).");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
const dir = path.resolve("database/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
  if (done.rowCount) {
    console.log(`= ${f} (already applied)`);
    continue;
  }
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    await client.query("COMMIT");
    console.log(`+ ${f}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`! ${f} failed:`, e.message);
    process.exit(1);
  }
}
await client.end();
console.log("Migrations complete.");
