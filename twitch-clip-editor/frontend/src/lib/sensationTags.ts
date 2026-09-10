/**
 * Fixed sensation tags for the effects library.
 * Keep in sync with backend/src/lib/sensationTags.ts
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
