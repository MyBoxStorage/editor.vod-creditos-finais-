/**
 * Fixed sensation tags for the effects library.
 * Edit this list in one place when adding/removing sensations.
 */
export const SENSATION_TAGS = [
  "ênfase",
  "suspense",
  "comemoração",
  "surpresa",
  "decepção",
  "raiva",
  "deboche",
  "tensão",
  "alívio",
  "meme",
  "transição",
  "impacto",
] as const;

export type SensationTag = (typeof SENSATION_TAGS)[number];

const SENSATION_SET = new Set<string>(SENSATION_TAGS);

export function isSensationTag(value: string): value is SensationTag {
  return SENSATION_SET.has(value);
}

export function normalizeSensationTags(raw: string[]): SensationTag[] {
  const out: SensationTag[] = [];
  for (const t of raw) {
    const lower = t.trim().toLowerCase();
    if (isSensationTag(lower) && !out.includes(lower)) {
      out.push(lower);
    }
  }
  return out;
}
