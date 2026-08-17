import path from "node:path";
import { Pool } from "pg";
import { applyCurriculumMigration, ingestCurriculum } from "./curriculum-knowledge.js";

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const databaseUrl = process.env.ENGLISH_LEARNING_DATABASE_URL;
if (!databaseUrl) throw new Error("Thiếu ENGLISH_LEARNING_DATABASE_URL");

const positionalRoot = process.argv.slice(2).find((value, index, values) => {
  if (value.startsWith("--")) return false;
  return index === 0 || !values[index - 1].startsWith("--");
});
const root = path.resolve(argumentValue("--root") ?? positionalRoot ?? process.env.CURRICULUM_ROOT ?? "curriculum");
const migrationPath = path.resolve(argumentValue("--migration") ?? "db/init/006_curriculum_knowledge.sql");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

try {
  await applyCurriculumMigration(pool, migrationPath);
  if (process.argv.includes("--schema-only")) {
    console.log(JSON.stringify({ schemaApplied: true, migrationPath }, null, 2));
  } else {
    const summary = await ingestCurriculum(pool, root, {
      force: process.argv.includes("--force"),
      embeddings: !process.argv.includes("--no-embeddings"),
      migrationPath
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.errors.length) process.exitCode = 2;
  }
} finally {
  await pool.end();
}
