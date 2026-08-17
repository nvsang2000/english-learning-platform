import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.ENGLISH_LEARNING_DATABASE_URL;
if (!databaseUrl) throw new Error("Thiếu ENGLISH_LEARNING_DATABASE_URL");

const migrationsDirectory = path.resolve(process.argv[2] ?? "db/init");
const files = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort((a, b) => a.localeCompare(b, "en"));
if (!files.length) throw new Error(`Không tìm thấy migration SQL trong ${migrationsDirectory}`);

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query(
      "SELECT checksum_sha256 FROM schema_migrations WHERE filename = $1",
      [filename]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].checksum_sha256 !== checksum) {
        throw new Error(`Migration ${filename} đã bị thay đổi sau khi áp dụng; hãy tạo migration mới.`);
      }
      skipped.push(filename);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum_sha256) VALUES ($1, $2)",
        [filename, checksum]
      );
      await client.query("COMMIT");
      applied.push(filename);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ migrationsDirectory, applied, skipped }, null, 2));
} finally {
  await pool.end();
}
