import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

export const CURRICULUM_SKILLS = [
  "grammar",
  "vocabulary",
  "reading",
  "listening",
  "speaking",
  "writing",
  "pronunciation",
  "mixed"
] as const;

export type CurriculumSkill = (typeof CURRICULUM_SKILLS)[number];
export type CurriculumSourceType = "docx" | "xlsx" | "png";
export type AnswerPolicy = "exclude" | "include_after_attempt";

export type SourceMetadata = {
  sourcePath: string;
  sourceType: CurriculumSourceType;
  title: string;
  level: string | null;
  skill: CurriculumSkill;
  exam: string | null;
  accessScope: "learner" | "answer_key";
};

export type ExtractedUnit = {
  unitKey: string;
  unitIndex: number;
  unitType: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
};

export type ExtractedQuestion = {
  questionNumber: string;
  prompt: string;
  options: Array<{ key: string; text: string }>;
};

export type ExtractedCurriculum = {
  paragraphs: string[];
  units: ExtractedUnit[];
  questions: ExtractedQuestion[];
  extractedText: string;
  metadata: Record<string, unknown>;
};

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  batchSize: number;
};

export type IngestionOptions = {
  force?: boolean;
  embeddings?: boolean;
  migrationPath?: string;
};

export type SearchCurriculumInput = {
  query: string;
  level?: string;
  skill?: CurriculumSkill;
  exam?: string;
  answerPolicy?: AnswerPolicy;
  approvedOnly?: boolean;
  limit?: number;
};

type PreparedChunk = {
  unitIndex: number;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  embedding: number[] | null;
};

function execFileText(command: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || error.message).trim();
        reject(new Error(`${command} thất bại: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripXmlTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, ""));
}

function cleanParagraph(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\u0000/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function xmlAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }
  return attributes;
}

export function extractDocxParagraphs(documentXml: string): string[] {
  const paragraphs: string[] = [];
  for (const paragraphMatch of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const body = paragraphMatch[1]
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<w:cr\s*\/>/g, "\n");
    const fragments: string[] = [];
    const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|(\t|\n)/g;
    for (const token of body.matchAll(tokenPattern)) {
      fragments.push(token[1] !== undefined ? decodeXmlEntities(token[1]) : token[2]);
    }
    const text = cleanParagraph(fragments.join(""));
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function columnIndex(cellReference: string): number {
  const letters = cellReference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function sharedStringValues(sharedStringsXml: string): string[] {
  const values: string[] = [];
  for (const match of sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const fragments = Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (item) => decodeXmlEntities(item[1]));
    values.push(cleanParagraph(fragments.join("")));
  }
  return values;
}

export function extractXlsxRows(sheetXml: string, sharedStrings: string[] = []): string[] {
  const rows: string[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = xmlAttributes(cellMatch[1]);
      const index = columnIndex(attributes.r ?? "A1");
      const rawValue = cellMatch[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      const inlineValue = cellMatch[2].match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1];
      let value = "";
      if (attributes.t === "s" && rawValue !== undefined) {
        value = sharedStrings[Number.parseInt(rawValue, 10)] ?? "";
      } else if (attributes.t === "inlineStr" && inlineValue !== undefined) {
        value = stripXmlTags(inlineValue);
      } else if (rawValue !== undefined) {
        value = decodeXmlEntities(rawValue);
      }
      while (cells.length <= index) cells.push("");
      cells[index] = cleanParagraph(value);
    }
    while (cells.at(-1) === "") cells.pop();
    if (cells.some(Boolean)) rows.push(cells.join(" | "));
  }
  return rows;
}

function looksLikeHeading(value: string): boolean {
  if (value.length > 150) return false;
  if (/^(READING|LISTENING|SPEAKING|WRITING|PASSAGE|PART|TOPIC|TEST|UNIT|LESSON|DẠNG|HƯỚNG DẪN|MỞ BÀI|THÂN BÀI|KẾT BÀI|BẢNG|THÌ)\b/i.test(value)) {
    return true;
  }
  const letters = value.match(/[A-Za-zÀ-ỹ]/g) ?? [];
  const uppercase = value.match(/[A-ZÀ-Ỹ]/g) ?? [];
  return letters.length >= 4 && uppercase.length / letters.length > 0.85;
}

function unitTypeFor(title: string, metadata: SourceMetadata): string {
  if (metadata.accessScope === "answer_key") return "answer_key";
  if (/PASSAGE/i.test(title)) return "reading_passage";
  if (/QUESTION|CÂU HỎI/i.test(title)) return "question_set";
  if (/TOPIC/i.test(title) && metadata.skill === "speaking") return "speaking_topic";
  if (/TOPIC/i.test(title) && metadata.skill === "writing") return "writing_prompt";
  if (metadata.sourceType === "xlsx") return "reference_table";
  return `${metadata.skill}_material`;
}

export function segmentParagraphs(paragraphs: string[], metadata: SourceMetadata, maxUnitCharacters = 6_000): ExtractedUnit[] {
  const units: ExtractedUnit[] = [];
  let title = metadata.title;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n\n").trim();
    if (!content) return;
    const unitIndex = units.length;
    units.push({
      unitKey: `unit-${String(unitIndex + 1).padStart(4, "0")}`,
      unitIndex,
      unitType: unitTypeFor(title, metadata),
      title,
      content,
      metadata: {}
    });
    buffer = [];
  };

  for (const paragraph of paragraphs.map(cleanParagraph).filter(Boolean)) {
    if (looksLikeHeading(paragraph)) {
      flush();
      title = paragraph;
      continue;
    }
    const currentLength = buffer.reduce((total, item) => total + item.length + 2, 0);
    if (buffer.length && currentLength + paragraph.length > maxUnitCharacters) {
      flush();
      title = `${title} — tiếp theo`;
    }
    buffer.push(paragraph);
  }
  flush();

  if (!units.length && paragraphs.length) {
    const content = paragraphs.join("\n\n");
    units.push({
      unitKey: "unit-0001",
      unitIndex: 0,
      unitType: unitTypeFor(metadata.title, metadata),
      title: metadata.title,
      content,
      metadata: {}
    });
  }
  return units;
}

function splitLongParagraph(value: string, maxCharacters: number): string[] {
  if (value.length <= maxCharacters) return [value];
  const sentences = value.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    const parts: string[] = [];
    for (let offset = 0; offset < value.length; offset += maxCharacters) {
      parts.push(value.slice(offset, offset + maxCharacters));
    }
    return parts;
  }
  const parts: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (buffer && buffer.length + sentence.length + 1 > maxCharacters) {
      parts.push(buffer);
      buffer = "";
    }
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }
  if (buffer) parts.push(buffer);
  return parts.flatMap((part) => part.length > maxCharacters ? splitLongParagraph(part, maxCharacters) : [part]);
}

export function chunkUnitContent(content: string, maxCharacters = 1_800, overlapCharacters = 220): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map(cleanParagraph)
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxCharacters));
  const chunks: string[] = [];
  let buffer: string[] = [];

  for (const paragraph of paragraphs) {
    const candidate = [...buffer, paragraph].join("\n\n");
    if (buffer.length && candidate.length > maxCharacters) {
      chunks.push(buffer.join("\n\n"));
      const overlap: string[] = [];
      let overlapLength = 0;
      for (let index = buffer.length - 1; index >= 0; index -= 1) {
        if (overlapLength + buffer[index].length > overlapCharacters) break;
        overlap.unshift(buffer[index]);
        overlapLength += buffer[index].length + 2;
      }
      buffer = [...overlap, paragraph];
    } else {
      buffer.push(paragraph);
    }
  }
  if (buffer.length) chunks.push(buffer.join("\n\n"));
  return chunks.filter(Boolean);
}

export function extractQuestions(paragraphs: string[]): ExtractedQuestion[] {
  const questions: ExtractedQuestion[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const questionMatch = paragraphs[index].match(/^(\d{1,3})[.)]\s*(.+)$/);
    if (!questionMatch) continue;
    const options: Array<{ key: string; text: string }> = [];
    let cursor = index + 1;
    while (cursor < paragraphs.length) {
      const optionMatch = paragraphs[cursor].match(/^([A-D])[.)]\s*(.+)$/i);
      if (!optionMatch) break;
      options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2] });
      cursor += 1;
    }
    if (options.length >= 2) {
      questions.push({ questionNumber: questionMatch[1], prompt: questionMatch[2], options });
      index = cursor - 1;
    }
  }
  return questions;
}

function storedSourcePath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  const value = relative.startsWith("..") ? filePath : relative;
  return value.split(path.sep).join("/");
}

export function inferSourceMetadata(filePath: string): SourceMetadata {
  const sourcePath = storedSourcePath(path.resolve(filePath));
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!new Set(["docx", "xlsx", "png"]).has(extension)) throw new Error(`Định dạng học liệu chưa hỗ trợ: ${extension}`);
  const sourceType = extension as CurriculumSourceType;
  const baseName = path.basename(filePath, path.extname(filePath));
  const normalized = sourcePath.toLocaleLowerCase("vi");
  const noKey = /\bno[ _-]*key\b/i.test(baseName);
  const answerKey = !noKey && /(^|[^a-z])key([^a-z]|$)/i.test(baseName);
  let skill: CurriculumSkill = "mixed";
  if (/\/(listen|listening)\//.test(normalized) || /listening/.test(normalized)) skill = "listening";
  else if (/\/(read|reading)\//.test(normalized) || /reading/.test(normalized)) skill = "reading";
  else if (/\/(speak|speaking)\//.test(normalized) || /speaking/.test(normalized)) skill = "speaking";
  else if (/\/(write|writing)\//.test(normalized) || /writing|letter|agree|disagree|advantages|causes|views/.test(normalized)) skill = "writing";
  else if (/grammar|động từ|dong tu/.test(normalized)) skill = "grammar";
  else if (sourceType === "xlsx") skill = "grammar";
  const levelMatch = normalized.match(/(?:^|\/)b([12])(?:\/|$)/);
  const level = levelMatch ? `B${levelMatch[1]}` : sourceType === "xlsx" ? "A1–B1" : null;
  const exam = /vstep/.test(normalized) ? "VSTEP" : null;
  return {
    sourcePath,
    sourceType,
    title: baseName.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim(),
    level,
    skill,
    exam,
    accessScope: answerKey ? "answer_key" : "learner"
  };
}

async function readZipEntry(filePath: string, entry: string): Promise<string> {
  return execFileText("unzip", ["-p", filePath, entry]);
}

async function extractDocx(filePath: string, metadata: SourceMetadata): Promise<ExtractedCurriculum> {
  const documentXml = await readZipEntry(filePath, "word/document.xml");
  const paragraphs = extractDocxParagraphs(documentXml);
  if (!paragraphs.length) throw new Error("DOCX không có đoạn văn có thể trích xuất.");
  return {
    paragraphs,
    units: segmentParagraphs(paragraphs, metadata),
    questions: metadata.accessScope === "learner" ? extractQuestions(paragraphs) : [],
    extractedText: paragraphs.join("\n\n"),
    metadata: { paragraphCount: paragraphs.length }
  };
}

async function extractXlsx(filePath: string, metadata: SourceMetadata): Promise<ExtractedCurriculum> {
  const workbookXml = await readZipEntry(filePath, "xl/workbook.xml");
  const relationshipsXml = await readZipEntry(filePath, "xl/_rels/workbook.xml.rels");
  let sharedStrings: string[] = [];
  try {
    sharedStrings = sharedStringValues(await readZipEntry(filePath, "xl/sharedStrings.xml"));
  } catch {
    // XLSX có thể chỉ dùng inline strings.
  }

  const relationships = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const attributes = xmlAttributes(match[1]);
    if (attributes.Id && attributes.Target) relationships.set(attributes.Id, attributes.Target);
  }
  const sheets: Array<{ name: string; rows: string[] }> = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = xmlAttributes(match[1]);
    const target = relationships.get(attributes["r:id"]);
    if (!target) continue;
    const entry = target.startsWith("/")
      ? target.slice(1)
      : target.startsWith("xl/") ? target : path.posix.join("xl", target);
    const rows = extractXlsxRows(await readZipEntry(filePath, entry), sharedStrings);
    if (rows.length) sheets.push({ name: attributes.name || `Sheet ${sheets.length + 1}`, rows });
  }
  if (!sheets.length) throw new Error("XLSX không có sheet có thể trích xuất.");

  const units: ExtractedUnit[] = [];
  const paragraphs: string[] = [];
  for (const sheet of sheets) {
    paragraphs.push(`# ${sheet.name}`, ...sheet.rows);
    for (let offset = 0; offset < sheet.rows.length; offset += 60) {
      const rows = sheet.rows.slice(offset, offset + 60);
      const unitIndex = units.length;
      units.push({
        unitKey: `sheet-${String(sheets.indexOf(sheet) + 1).padStart(2, "0")}-part-${String(Math.floor(offset / 60) + 1).padStart(3, "0")}`,
        unitIndex,
        unitType: "reference_table",
        title: `${sheet.name}${offset ? ` — phần ${Math.floor(offset / 60) + 1}` : ""}`,
        content: rows.join("\n"),
        metadata: { sheet: sheet.name, startRow: offset + 1, endRow: offset + rows.length }
      });
    }
  }
  return {
    paragraphs,
    units,
    questions: [],
    extractedText: paragraphs.join("\n"),
    metadata: { sheets: sheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rows.length })) }
  };
}

async function extractPng(filePath: string, metadata: SourceMetadata): Promise<ExtractedCurriculum> {
  let languages = "eng";
  try {
    const installed = await execFileText("tesseract", ["--list-langs"]);
    if (/^vie$/m.test(installed)) languages = "eng+vie";
  } catch {
    // Lỗi chi tiết sẽ được trả về từ lần OCR thực tế.
  }
  const text = await execFileText("tesseract", [filePath, "stdout", "-l", languages]);
  const paragraphs = text.split(/\n+/).map(cleanParagraph).filter(Boolean);
  if (!paragraphs.length) throw new Error("OCR không đọc được nội dung từ PNG.");
  return {
    paragraphs,
    units: segmentParagraphs(paragraphs, metadata),
    questions: [],
    extractedText: paragraphs.join("\n\n"),
    metadata: { ocr: "tesseract", languages }
  };
}

export async function extractCurriculumFile(filePath: string): Promise<{ metadata: SourceMetadata; extracted: ExtractedCurriculum }> {
  const metadata = inferSourceMetadata(filePath);
  const extracted = metadata.sourceType === "docx"
    ? await extractDocx(filePath, metadata)
    : metadata.sourceType === "xlsx"
      ? await extractXlsx(filePath, metadata)
      : await extractPng(filePath, metadata);
  return { metadata, extracted };
}

async function curriculumFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (/\.(docx|xlsx|png)$/i.test(entry.name)) files.push(fullPath);
    }
  };
  await visit(rootPath);
  return files.sort((a, b) => a.localeCompare(b, "vi"));
}

export function embeddingConfigFromEnv(): EmbeddingConfig | null {
  const baseUrl = process.env.CURRICULUM_EMBEDDING_BASE_URL?.trim();
  const model = process.env.CURRICULUM_EMBEDDING_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const batchSize = Math.max(1, Math.min(128, Number.parseInt(process.env.CURRICULUM_EMBEDDING_BATCH_SIZE ?? "32", 10) || 32));
  return {
    baseUrl,
    apiKey: process.env.CURRICULUM_EMBEDDING_API_KEY?.trim() || undefined,
    model,
    batchSize
  };
}

function embeddingEndpoint(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/embeddings") ? normalized : `${normalized}/embeddings`;
}

export async function embedTexts(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetch(embeddingEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({ model: config.model, input: texts }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Embedding endpoint trả HTTP ${response.status}: ${body}`);
  }
  const payload = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
  const ordered = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (ordered.length !== texts.length || ordered.some((item) => !Array.isArray(item.embedding) || !item.embedding.length)) {
    throw new Error("Embedding endpoint trả dữ liệu thiếu hoặc sai định dạng.");
  }
  const vectors = ordered.map((item) => item.embedding as number[]);
  const dimensions = vectors[0].length;
  if (vectors.some((vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("Embedding endpoint trả vector không đồng nhất.");
  }
  return vectors;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export async function applyCurriculumMigration(db: Pool, migrationPath = path.resolve("db/init/006_curriculum_knowledge.sql")): Promise<void> {
  const sql = await readFile(migrationPath, "utf8");
  const filename = path.basename(migrationPath);
  const migrationChecksum = createHash("sha256").update(sql).digest("hex");
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const existing = await db.query(
    "SELECT checksum_sha256 FROM schema_migrations WHERE filename = $1",
    [filename]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum_sha256 !== migrationChecksum) {
      throw new Error(`Migration ${filename} đã bị thay đổi sau khi áp dụng; hãy tạo migration mới.`);
    }
    return;
  }
  await withTransaction(db, async (client) => {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename, checksum_sha256) VALUES ($1, $2)",
      [filename, migrationChecksum]
    );
  });
}

async function checksum(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function withTransaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function prepareChunks(units: ExtractedUnit[], config: EmbeddingConfig | null): Promise<PreparedChunk[]> {
  const chunks: PreparedChunk[] = [];
  for (const unit of units) {
    for (const [chunkIndex, content] of chunkUnitContent(unit.content).entries()) {
      chunks.push({
        unitIndex: unit.unitIndex,
        chunkIndex,
        content,
        tokenEstimate: Math.max(1, Math.ceil(content.length / 4)),
        embedding: null
      });
    }
  }
  if (!config) return chunks;
  for (let offset = 0; offset < chunks.length; offset += config.batchSize) {
    const batch = chunks.slice(offset, offset + config.batchSize);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.content), config);
    embeddings.forEach((embedding, index) => { batch[index].embedding = embedding; });
  }
  return chunks;
}

export async function ingestCurriculum(db: Pool, rootPath: string, options: IngestionOptions = {}): Promise<{
  runId: string;
  filesSeen: number;
  filesImported: number;
  filesSkipped: number;
  chunksCreated: number;
  embeddingModel: string | null;
  errors: Array<{ sourcePath: string; error: string }>;
}> {
  const root = path.resolve(rootPath);
  const files = await curriculumFiles(root);
  const embeddingConfig = options.embeddings === false ? null : embeddingConfigFromEnv();
  const runResult = await db.query(
    `INSERT INTO curriculum_ingestion_runs (source_root, files_seen)
     VALUES ($1, $2) RETURNING id`,
    [root, files.length]
  );
  const runId = runResult.rows[0].id as string;
  let filesImported = 0;
  let filesSkipped = 0;
  let chunksCreated = 0;
  const errors: Array<{ sourcePath: string; error: string }> = [];

  for (const filePath of files) {
    const metadata = inferSourceMetadata(filePath);
    const digest = await checksum(filePath);
    const existing = await db.query(
      "SELECT checksum_sha256, extraction_status FROM curriculum_sources WHERE source_path = $1",
      [metadata.sourcePath]
    );
    if (!options.force && existing.rows[0]?.checksum_sha256 === digest && existing.rows[0]?.extraction_status === "ready") {
      filesSkipped += 1;
      continue;
    }
    try {
      const { extracted } = await extractCurriculumFile(filePath);
      const preparedChunks = await prepareChunks(extracted.units, embeddingConfig);
      await withTransaction(db, async (client) => {
        const sourceResult = await client.query(
          `INSERT INTO curriculum_sources
             (source_path, source_type, checksum_sha256, title, level, skill, exam,
              access_scope, extraction_status, extraction_error, extracted_text, metadata, active, imported_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', NULL, $9, $10::jsonb, true, now())
           ON CONFLICT (source_path) DO UPDATE SET
             source_type = EXCLUDED.source_type,
             checksum_sha256 = EXCLUDED.checksum_sha256,
             title = EXCLUDED.title,
             level = EXCLUDED.level,
             skill = EXCLUDED.skill,
             exam = EXCLUDED.exam,
             access_scope = EXCLUDED.access_scope,
             extraction_status = 'ready',
             extraction_error = NULL,
             extracted_text = EXCLUDED.extracted_text,
             metadata = EXCLUDED.metadata,
             active = true,
             imported_at = now(),
             updated_at = now()
           RETURNING id`,
          [
            metadata.sourcePath,
            metadata.sourceType,
            digest,
            metadata.title,
            metadata.level,
            metadata.skill,
            metadata.exam,
            metadata.accessScope,
            extracted.extractedText,
            JSON.stringify(extracted.metadata)
          ]
        );
        const sourceId = sourceResult.rows[0].id as string;
        await client.query("DELETE FROM curriculum_units WHERE source_id = $1", [sourceId]);
        const unitIds = new Map<number, string>();
        for (const unit of extracted.units) {
          const unitResult = await client.query(
            `INSERT INTO curriculum_units
               (source_id, unit_key, unit_index, unit_type, title, content, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             RETURNING id`,
            [sourceId, unit.unitKey, unit.unitIndex, unit.unitType, unit.title, unit.content, JSON.stringify(unit.metadata)]
          );
          unitIds.set(unit.unitIndex, unitResult.rows[0].id as string);
        }
        for (const chunk of preparedChunks) {
          const unitId = unitIds.get(chunk.unitIndex);
          if (!unitId) throw new Error(`Không tìm thấy unit ${chunk.unitIndex} khi nhập chunk.`);
          await client.query(
            `INSERT INTO curriculum_chunks
               (unit_id, chunk_index, content, token_estimate, embedding, embedding_model, embedding_dimensions)
             VALUES ($1, $2, $3, $4, $5::vector, $6, $7)`,
            [
              unitId,
              chunk.chunkIndex,
              chunk.content,
              chunk.tokenEstimate,
              chunk.embedding ? vectorLiteral(chunk.embedding) : null,
              chunk.embedding ? embeddingConfig?.model ?? null : null,
              chunk.embedding?.length ?? null
            ]
          );
        }
        for (const question of extracted.questions) {
          const matchingUnit = extracted.units.find((unit) => unit.content.includes(question.prompt)) ?? extracted.units[0];
          const unitId = matchingUnit ? unitIds.get(matchingUnit.unitIndex) : undefined;
          if (!unitId) continue;
          await client.query(
            `INSERT INTO curriculum_question_bank
               (unit_id, question_number, prompt, options)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [unitId, question.questionNumber, question.prompt, JSON.stringify(question.options)]
          );
        }
      });
      filesImported += 1;
      chunksCreated += preparedChunks.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ sourcePath: metadata.sourcePath, error: message.slice(0, 1_000) });
      await db.query(
        `INSERT INTO curriculum_sources
           (source_path, source_type, checksum_sha256, title, level, skill, exam,
            access_scope, extraction_status, extraction_error, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'failed', $9, false)
         ON CONFLICT (source_path) DO UPDATE SET
           checksum_sha256 = EXCLUDED.checksum_sha256,
           extraction_status = 'failed',
           extraction_error = EXCLUDED.extraction_error,
           active = false,
           updated_at = now()`,
        [metadata.sourcePath, metadata.sourceType, digest, metadata.title, metadata.level, metadata.skill, metadata.exam, metadata.accessScope, message.slice(0, 2_000)]
      );
    }
  }

  const status = errors.length ? "completed_with_errors" : "completed";
  await db.query(
    `UPDATE curriculum_ingestion_runs SET
       status = $2,
       files_imported = $3,
       files_skipped = $4,
       chunks_created = $5,
       errors = $6::jsonb,
       finished_at = now()
     WHERE id = $1`,
    [runId, status, filesImported, filesSkipped, chunksCreated, JSON.stringify(errors)]
  );
  return {
    runId,
    filesSeen: files.length,
    filesImported,
    filesSkipped,
    chunksCreated,
    embeddingModel: embeddingConfig?.model ?? null,
    errors
  };
}

function cleanedSearchValue(value: string | undefined, maxLength: number): string | null {
  const clean = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return clean || null;
}

export async function searchCurriculum(db: Pool, input: SearchCurriculumInput): Promise<{
  query: string;
  retrievalMode: "hybrid_vector_text" | "hybrid_text";
  answerPolicy: AnswerPolicy;
  qualityNotice: string | null;
  results: Array<Record<string, unknown>>;
}> {
  const query = cleanedSearchValue(input.query, 500);
  if (!query) throw new Error("Cần có nội dung cần tìm trong kho học liệu.");
  const level = cleanedSearchValue(input.level, 20)?.toUpperCase() ?? null;
  const exam = cleanedSearchValue(input.exam, 50) ?? null;
  const skill = input.skill && CURRICULUM_SKILLS.includes(input.skill) ? input.skill : null;
  const answerPolicy: AnswerPolicy = input.answerPolicy === "include_after_attempt" ? "include_after_attempt" : "exclude";
  const limit = Math.max(1, Math.min(8, Math.trunc(input.limit ?? 5)));
  const approvedOnly = Boolean(input.approvedOnly);
  const embeddingConfig = embeddingConfigFromEnv();
  let queryEmbedding: number[] | null = null;
  let embeddingWarning: string | null = null;
  if (embeddingConfig) {
    try {
      queryEmbedding = (await embedTexts([query], embeddingConfig))[0];
    } catch (error) {
      embeddingWarning = `Không tạo được query embedding; đã dùng tìm kiếm văn bản: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const params: unknown[] = [query, level, skill, exam, answerPolicy, approvedOnly];
  const semanticExpression = queryEmbedding
    ? `CASE WHEN c.embedding IS NOT NULL
                  AND c.embedding_model = $7
                  AND c.embedding_dimensions = $8
             THEN GREATEST(0, 1 - (c.embedding <=> $9::vector))
             ELSE 0 END`
    : "0::double precision";
  if (queryEmbedding) params.push(embeddingConfig?.model, queryEmbedding.length, vectorLiteral(queryEmbedding));
  params.push(limit);
  const limitParameter = `$${params.length}`;

  const result = await db.query(
    `WITH candidates AS (
       SELECT
         c.id,
         c.chunk_index,
         c.content,
         u.unit_key,
         u.unit_type,
         u.title AS unit_title,
         s.source_path,
         s.title AS source_title,
         s.level,
         s.skill,
         s.exam,
         s.access_scope,
         s.review_status,
         GREATEST(
           ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', $1)),
           ts_rank_cd(
             to_tsvector('simple', coalesce(s.title, '') || ' ' || coalesce(u.title, '')),
             websearch_to_tsquery('simple', $1)
           ) * 1.5
         ) AS lexical_score,
         GREATEST(
           word_similarity(lower($1), lower(c.content)),
           word_similarity(lower($1), lower(s.title)),
           word_similarity(lower($1), lower(u.title))
         ) AS fuzzy_score,
         ${semanticExpression} AS semantic_score
       FROM curriculum_chunks c
       JOIN curriculum_units u ON u.id = c.unit_id
       JOIN curriculum_sources s ON s.id = u.source_id
       WHERE s.active = true
         AND s.extraction_status = 'ready'
         AND ($2::text IS NULL OR upper(s.level) = $2)
         AND ($3::text IS NULL OR s.skill = $3)
         AND ($4::text IS NULL OR s.exam ILIKE $4)
         AND (s.access_scope = 'learner' OR $5 = 'include_after_attempt')
         AND ($6::boolean = false OR s.review_status = 'approved')
     ), ranked AS (
       SELECT *,
         LEAST(1, lexical_score * 4) * ${queryEmbedding ? "0.30" : "0.78"}
         + LEAST(1, fuzzy_score) * ${queryEmbedding ? "0.10" : "0.22"}
         + semantic_score * ${queryEmbedding ? "0.60" : "0.00"} AS score
       FROM candidates
     )
     SELECT * FROM ranked
      WHERE lexical_score > 0 OR fuzzy_score > 0.04 OR semantic_score > 0.20
      ORDER BY score DESC, source_path, unit_key, chunk_index
      LIMIT ${limitParameter}`,
    params
  );
  const results = result.rows.map((row) => ({
    score: Number(Number(row.score).toFixed(4)),
    content: row.content,
    source: {
      path: row.source_path,
      title: row.source_title,
      level: row.level,
      skill: row.skill,
      exam: row.exam,
      reviewStatus: row.review_status,
      isAnswerKey: row.access_scope === "answer_key"
    },
    unit: {
      key: row.unit_key,
      type: row.unit_type,
      title: row.unit_title,
      chunk: Number(row.chunk_index)
    },
    citation: `[${row.source_title} — ${row.unit_title}]`
  }));
  const hasUnreviewed = result.rows.some((row) => row.review_status !== "approved");
  const qualityNotice = [
    hasUnreviewed ? "Một số kết quả chưa được giáo viên chuyên môn duyệt; cần kiểm tra lỗi trước khi dùng làm đáp án chuẩn." : null,
    embeddingWarning
  ].filter(Boolean).join(" ") || null;
  return {
    query,
    retrievalMode: queryEmbedding ? "hybrid_vector_text" : "hybrid_text",
    answerPolicy,
    qualityNotice,
    results
  };
}
