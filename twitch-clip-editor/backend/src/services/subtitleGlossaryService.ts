import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./vodIngest";

export type GlossaryEntry = {
  from: string;
  to: string;
};

export type Glossary = {
  entries: GlossaryEntry[];
};

const GLOSSARY_PATH = () => path.join(getDataDir(), "glossary.json");

export async function loadGlossary(): Promise<Glossary> {
  try {
    const raw = await fs.readFile(GLOSSARY_PATH(), "utf-8");
    const parsed = JSON.parse(raw) as Glossary;
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return {
      entries: parsed.entries.filter(
        (e) =>
          e &&
          typeof e.from === "string" &&
          typeof e.to === "string" &&
          e.from.trim() &&
          e.to.trim()
      ),
    };
  } catch {
    return { entries: [] };
  }
}

export async function saveGlossary(glossary: Glossary): Promise<Glossary> {
  const cleaned: Glossary = {
    entries: glossary.entries
      .map((e) => ({ from: e.from.trim(), to: e.to.trim() }))
      .filter((e) => e.from && e.to),
  };
  await fs.mkdir(path.dirname(GLOSSARY_PATH()), { recursive: true });
  await fs.writeFile(
    GLOSSARY_PATH(),
    JSON.stringify(cleaned, null, 2),
    "utf-8"
  );
  return cleaned;
}

/** Apply glossary replacements to transcript segment texts (whole-word, case-insensitive). */
export function applyGlossaryToText(text: string, entries: GlossaryEntry[]): string {
  let out = text;
  for (const { from, to } of entries) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
  }
  return out;
}

export function applyGlossaryToTranscript<
  T extends { segments: Array<{ text: string }> }
>(transcript: T, entries: GlossaryEntry[]): T {
  if (entries.length === 0) return transcript;
  return {
    ...transcript,
    segments: transcript.segments.map((seg) => ({
      ...seg,
      text: applyGlossaryToText(seg.text, entries),
    })),
  };
}
