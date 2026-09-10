import type {
  ClipSegment,
  ClipTranscript,
  MarkedCandidate,
} from "../../../../../lib/api";

export function clipSegmentAsMarked(s: ClipSegment): MarkedCandidate {
  return {
    id: s.id,
    vodId: s.vodId,
    start: s.sourceStart,
    end: s.sourceEnd,
    originalStart: s.originalSourceStart ?? undefined,
    originalEnd: s.originalSourceEnd ?? undefined,
    score: 0,
    reason:
      s.reusableName?.trim() ||
      (s.role === "hook" ? "Gancho" : "Trecho de edição"),
    origin: s.sourceType || "clip_segment",
    status: s.status,
    createdAt: s.createdAt,
    previewRelativePath: s.previewRelativePath ?? undefined,
    clipTranscriptRelativePath: s.clipTranscriptRelativePath ?? undefined,
    clipAssRelativePath: s.clipAssRelativePath ?? undefined,
    clipSrtRelativePath: s.clipSrtRelativePath ?? undefined,
    exportRelativePath: s.exportRelativePath ?? undefined,
    isManuallyEdited: s.isManuallyEdited ?? undefined,
  };
}

/** Exibição única: m:ss,d (ou h:mm:ss,d acima de 60 min). */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const h = Math.floor(s / 3600);
  const rem = s % 3600;
  const m = Math.floor(rem / 60);
  const sec = rem % 60;
  const secPart = sec.toFixed(1).replace(".", ",").padStart(4, "0");
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${secPart}`;
  }
  return `${m}:${secPart}`;
}

function normalizeDecimalPart(part: string): string {
  return part.trim().replace(",", ".");
}

/** Aceita m:ss,d, h:mm:ss,d, segundos com vírgula ou ponto. */
export function parseTime(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;

  if (!t.includes(":")) {
    const n = Number(normalizeDecimalPart(t));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const parts = t.split(":");
  const lastIdx = parts.length - 1;
  parts[lastIdx] = normalizeDecimalPart(parts[lastIdx]);

  if (parts.length === 2) {
    const m = Number(parts[0]);
    const sec = Number(parts[1]);
    if (
      !Number.isFinite(m) ||
      !Number.isFinite(sec) ||
      m < 0 ||
      sec < 0 ||
      sec >= 60
    ) {
      return null;
    }
    return m * 60 + sec;
  }

  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const sec = Number(parts[2]);
    if (
      !Number.isFinite(h) ||
      !Number.isFinite(m) ||
      !Number.isFinite(sec) ||
      h < 0 ||
      m < 0 ||
      m >= 60 ||
      sec < 0 ||
      sec >= 60
    ) {
      return null;
    }
    return h * 3600 + m * 60 + sec;
  }

  return null;
}

export function segmentTextsFromTranscript(t: ClipTranscript | null): string[] {
  if (!t) return [];
  return t.segments.map((seg) => seg.text);
}
