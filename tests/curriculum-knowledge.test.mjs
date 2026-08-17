import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkUnitContent,
  extractDocxParagraphs,
  extractQuestions,
  extractXlsxRows,
  inferSourceMetadata,
  searchCurriculum,
  segmentParagraphs
} from "../dist/curriculum-knowledge.js";

test("source metadata separates learner papers from answer keys", () => {
  const paper = inferSourceMetadata("curriculum/b1/Read/VSTEP-Reading test 1- NO KEY.docx");
  assert.equal(paper.level, "B1");
  assert.equal(paper.skill, "reading");
  assert.equal(paper.exam, "VSTEP");
  assert.equal(paper.accessScope, "learner");

  const key = inferSourceMetadata("curriculum/b1/Read/KEY READING 1-5.docx");
  assert.equal(key.accessScope, "answer_key");

  const workbook = inferSourceMetadata("curriculum/excel/tieng-anh-co-ban.xlsx");
  assert.equal(workbook.sourceType, "xlsx");
  assert.equal(workbook.skill, "grammar");
  assert.equal(workbook.level, "A1–B1");
});

test("DOCX XML extraction preserves paragraph text and line breaks", () => {
  const xml = `
    <w:document xmlns:w="test"><w:body>
      <w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>
      <w:p><w:r><w:t>Choose A &amp; B</w:t></w:r><w:br/><w:r><w:t>carefully.</w:t></w:r></w:p>
    </w:body></w:document>`;
  assert.deepEqual(extractDocxParagraphs(xml), ["Hello world", "Choose A & B carefully."]);
});

test("XLSX XML extraction resolves shared strings and sparse columns", () => {
  const xml = `
    <worksheet xmlns="test"><sheetData>
      <row r="1">
        <c r="A1" t="s"><v>0</v></c>
        <c r="C1" t="inlineStr"><is><t>Meaning</t></is></c>
      </row>
      <row r="2"><c r="A2"><v>42</v></c></row>
    </sheetData></worksheet>`;
  assert.deepEqual(extractXlsxRows(xml, ["Verb"]), ["Verb |  | Meaning", "42"]);
});

test("semantic segmentation and chunking keep content bounded", () => {
  const metadata = inferSourceMetadata("curriculum/b1/Speak/SPEAKING PART 1-bậc 3.docx");
  const units = segmentParagraphs([
    "SPEAKING PART 1",
    "Talk about your neighbour.",
    "What do you like about your neighbourhood?",
    "TOPIC 2",
    "Talk about a holiday destination."
  ], metadata, 200);
  assert.equal(units.length, 2);
  assert.equal(units[0].title, "SPEAKING PART 1");
  assert.equal(units[1].title, "TOPIC 2");

  const chunks = chunkUnitContent(`${"A".repeat(900)}\n\n${"B".repeat(900)}\n\n${"C".repeat(900)}`, 1_200, 100);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 1_200));
});

test("multiple-choice questions are recognized without inventing answers", () => {
  assert.deepEqual(extractQuestions([
    "1. What is the main idea?",
    "A. A history lesson",
    "B. A travel guide",
    "C. A grammar rule",
    "D. A recipe"
  ]), [{
    questionNumber: "1",
    prompt: "What is the main idea?",
    options: [
      { key: "A", text: "A history lesson" },
      { key: "B", text: "A travel guide" },
      { key: "C", text: "A grammar rule" },
      { key: "D", text: "A recipe" }
    ]
  }]);
});

test("curriculum search excludes answer keys by default and returns citations", async () => {
  const previousBaseUrl = process.env.CURRICULUM_EMBEDDING_BASE_URL;
  const previousModel = process.env.CURRICULUM_EMBEDDING_MODEL;
  delete process.env.CURRICULUM_EMBEDDING_BASE_URL;
  delete process.env.CURRICULUM_EMBEDDING_MODEL;
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          score: 0.75,
          chunk_index: 0,
          content: "The second conditional uses would plus a bare infinitive.",
          unit_key: "unit-0001",
          unit_type: "grammar_material",
          unit_title: "Second conditional",
          source_path: "curriculum/b1/grammar.docx",
          source_title: "B1 Grammar",
          level: "B1",
          skill: "grammar",
          exam: null,
          access_scope: "learner",
          review_status: "approved"
        }]
      };
    }
  };
  try {
    const result = await searchCurriculum(db, { query: "second conditional", skill: "grammar" });
    assert.equal(result.retrievalMode, "hybrid_text");
    assert.equal(result.answerPolicy, "exclude");
    assert.equal(result.results[0].citation, "[B1 Grammar — Second conditional]");
    assert.equal(calls[0].params[4], "exclude");
    assert.match(calls[0].sql, /access_scope = 'learner'/);
    assert.match(calls[0].sql, /word_similarity\(lower\(\$1\), lower\(s\.title\)\)/);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.CURRICULUM_EMBEDDING_BASE_URL;
    else process.env.CURRICULUM_EMBEDDING_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.CURRICULUM_EMBEDDING_MODEL;
    else process.env.CURRICULUM_EMBEDDING_MODEL = previousModel;
  }
});
