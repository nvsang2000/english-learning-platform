import { execFile } from "node:child_process";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { EdgeTTS } from "node-edge-tts";

const execFileAsync = promisify(execFile);

export const LEARNING_TTS_RATE = "-20%";
export const SENTENCE_PAUSE_SECONDS = 2;
export const EXERCISE_PAUSE_SECONDS = 3;

const vietnameseMarks = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/iu;

export function extractExerciseAudioText(text: string): string | null {
  const candidates = [
    ...[...text.matchAll(/\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi)].map((match) => match[1].trim()),
    ...[...text.matchAll(/\[\[tts:(?!text\]\])([^\]\n]{1,1000})\]\]/gi)].map((match) => match[1].trim())
  ];
  const visibleText = stripExerciseAudioDirectives(text);
  for (const rawLine of visibleText.split(/\n+/)) {
    if (!/_{3,}/.test(rawLine)) continue;
    const quotedBlanks = [...rawLine.matchAll(/["“]([^"”\n]*_{3,}[^"”\n]*)["”]/g)].map((match) => match[1].trim());
    if (quotedBlanks.length > 0) {
      candidates.push(...quotedBlanks);
      continue;
    }
    const clean = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (/[A-Za-z]/.test(clean) && !vietnameseMarks.test(clean)) candidates.push(clean);
  }
  const unique = [...new Set(candidates.map((item) => item
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()).filter(Boolean))];
  return unique.length > 0 ? unique.join("\n").slice(0, 1000) : null;
}

export function stripExerciseAudioDirectives(text: string): string {
  return text
    .replace(/\n?\s*\[\[tts:text\]\][\s\S]*?\[\[\/tts:text\]\]\s*/gi, "\n")
    .replace(/\n?\s*\[\[tts:[^\]\n]{1,1000}\]\]\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function vocabularyAudioFileName(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "vocabulary"}.mp3`;
}

export function deliberateSpeechSegments(value: string | string[]): string[] {
  const inputs = Array.isArray(value) ? value : [value];
  return inputs.flatMap((input) => {
    const normalized = String(input)
      .replace(/\r/g, "\n")
      .replace(/_{3,}\s*(?:\([^\n)]{1,80}\))?/g, "\n")
      .replace(/\[(?:blank|pause)\]/gi, "\n")
      .trim();
    if (!normalized) return [];
    return (normalized.match(/[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g) ?? [normalized])
      .map((segment) => segment.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  });
}

export async function synthesizeLearningAudio(
  value: string | string[],
  outputPath: string,
  options: { ffmpegBin?: string; pauseSeconds?: number; rate?: string } = {}
): Promise<void> {
  const segments = deliberateSpeechSegments(value);
  if (segments.length === 0) throw new Error("Nội dung audio rỗng");

  const rate = options.rate ?? LEARNING_TTS_RATE;
  const pauseSeconds = Math.max(0, options.pauseSeconds ?? SENTENCE_PAUSE_SECONDS);
  const ffmpegBin = options.ffmpegBin ?? process.env.FFMPEG_BIN ?? "ffmpeg";
  const parsed = path.parse(outputPath);
  const segmentPaths = segments.map((_, index) => path.join(parsed.dir, `.${parsed.name}.segment-${index}.mp3`));
  const tts = new EdgeTTS({
    voice: "en-US-JennyNeural",
    lang: "en-US",
    outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    rate,
    pitch: "+0%",
    timeout: 30_000
  });

  try {
    for (let index = 0; index < segments.length; index += 1) {
      await tts.ttsPromise(segments[index], segmentPaths[index]);
    }

    if (segmentPaths.length === 1) {
      await rename(segmentPaths[0], outputPath);
      return;
    }

    const args = ["-hide_banner", "-loglevel", "error", "-y"];
    const inputLabels: string[] = [];
    let inputIndex = 0;
    for (let index = 0; index < segmentPaths.length; index += 1) {
      args.push("-i", segmentPaths[index]);
      inputLabels.push(`[${inputIndex}:a]`);
      inputIndex += 1;
      if (index < segmentPaths.length - 1) {
        args.push("-f", "lavfi", "-t", String(pauseSeconds), "-i", "anullsrc=r=24000:cl=mono");
        inputLabels.push(`[${inputIndex}:a]`);
        inputIndex += 1;
      }
    }
    args.push(
      "-filter_complex",
      `${inputLabels.join("")}concat=n=${inputLabels.length}:v=0:a=1[out]`,
      "-map",
      "[out]",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-b:a",
      "48k",
      outputPath
    );
    await execFileAsync(ffmpegBin, args, { timeout: 60_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all(segmentPaths.map((segmentPath) => unlink(segmentPath).catch(() => undefined)));
  }
}
