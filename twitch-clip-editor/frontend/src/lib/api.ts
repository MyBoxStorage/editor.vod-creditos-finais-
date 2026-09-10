import { humanizeApiError } from "./previewFileErrors";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const err = await res.json().catch(() => ({}));
  const msg = (err as { error?: string }).error || fallback;
  throw new Error(humanizeApiError(msg));
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function mediaUrl(vodId: string, relativePath = "source.mp4"): string {
  return apiUrl(`/media/${vodId}/${relativePath}`);
}

export type Highlight = {
  start: number;
  end: number;
  reason: string;
  suggestedTitle: string;
};

export type LayoutPreset = {
  id: string;
  name: string;
  orientation: "vertical" | "horizontal";
  split: boolean;
};

export type SemanticCandidate = {
  start: number;
  end: number;
  title: string;
  reason: string;
  score?: number;
  windowIndex: number;
  windowStart: number;
  windowEnd: number;
  transcriptSnippet: string;
  wasRankedByClaude: boolean;
};

export type AcousticCandidate = {
  start: number;
  end: number;
  score: number;
  sampleMessages: string[];
  source?: "laughter" | "energy" | "both" | string;
  wasRankedByClaude: boolean;
};

export type AllCandidatesResponse = {
  vodId: string;
  semanticCount: number;
  acousticCount: number;
  rankedCount: number;
  semanticCandidates: SemanticCandidate[];
  acousticCandidates: AcousticCandidate[];
  rankedHighlights: Highlight[];
};

export type VodListItem = {
  vodId: string;
  title: string;
  duration: number | null;
  uploadDate: string | null;
  webpageUrl?: string;
};

export type ProntosClip = {
  fileName: string;
  urlPath: string;
  sizeBytes: number;
};

export type ProntosRun = {
  runId: string;
  method: string | null;
  labelDate: string | null;
  clipCount: number;
  clips: ProntosClip[];
};

export async function fetchVods(): Promise<VodListItem[]> {
  const res = await fetch(apiUrl("/vods"), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load vods: ${res.status}`);
  const data = (await res.json()) as { vods: VodListItem[] };
  return data.vods ?? [];
}

export async function fetchProntosRuns(vodId: string): Promise<ProntosRun[]> {
  const res = await fetch(apiUrl(`/vod/${vodId}/prontos-runs`), {
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to load prontos runs: ${res.status}`);
  }
  const data = (await res.json()) as { runs: ProntosRun[] };
  return data.runs ?? [];
}

export type ObsChapter = {
  timeSec: number;
  title: string;
};

export type WaveformResponse = {
  vodId: string;
  bucketCount: number;
  durationSec: number;
  peaks: number[];
  generatedAtMs: number;
  elapsedMs: number;
  cached: boolean;
};

export type NavThumbnailEntry = {
  index: number;
  timeSec: number;
  relativePath: string;
};

export type NavThumbnailManifest = {
  vodId: string;
  intervalSec: number;
  width: number;
  durationSec: number;
  thumbnails: NavThumbnailEntry[];
  generatedAtMs: number;
  elapsedMs: number;
  cached: boolean;
};

export async function fetchChapters(vodId: string): Promise<ObsChapter[]> {
  const res = await fetch(apiUrl(`/vod/${vodId}/chapters`), {
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to load chapters: ${res.status}`);
  }
  const data = (await res.json()) as { chapters: ObsChapter[] };
  return data.chapters ?? [];
}

export async function fetchWaveform(vodId: string): Promise<WaveformResponse> {
  const res = await fetch(apiUrl(`/vod/${vodId}/waveform`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load waveform: ${res.status}`
    );
  }
  return res.json();
}

export async function fetchNavThumbnails(
  vodId: string
): Promise<NavThumbnailManifest> {
  const res = await fetch(apiUrl(`/vod/${vodId}/nav-thumbnails`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load nav thumbnails: ${res.status}`
    );
  }
  return res.json();
}

export async function fetchHighlights(vodId: string): Promise<Highlight[]> {
  const res = await fetch(apiUrl(`/vod/${vodId}/highlights`), {
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to load highlights: ${res.status}`);
  }
  const data = (await res.json()) as { highlights: Highlight[] };
  return data.highlights ?? [];
}

export async function fetchAllCandidates(
  vodId: string
): Promise<AllCandidatesResponse> {
  const res = await fetch(apiUrl(`/vod/${vodId}/all-candidates`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load all-candidates: ${res.status}`
    );
  }
  return res.json();
}

export async function fetchLayouts(): Promise<LayoutPreset[]> {
  const res = await fetch(apiUrl("/layouts"), { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load layouts: ${res.status}`);
  const data = (await res.json()) as { presets: LayoutPreset[] };
  return data.presets ?? [];
}

export type MarkedCandidateStatus =
  | "marked"
  | "trimmed"
  | "transcribed"
  | "exported";

export type MarkedCandidate = {
  id: string;
  vodId: string;
  start: number;
  end: number;
  originalStart?: number;
  originalEnd?: number;
  score: number;
  reason: string;
  origin: string;
  status: MarkedCandidateStatus;
  createdAt: string;
  previewRelativePath?: string;
  clipTranscriptRelativePath?: string;
  clipAssRelativePath?: string;
  clipSrtRelativePath?: string;
  exportRelativePath?: string;
  isManuallyEdited?: boolean;
};

export type MarkedCandidatesFile = {
  vodId: string;
  candidates: MarkedCandidate[];
  markedAt: string;
};

export async function fetchMarkedCandidates(
  vodId: string
): Promise<MarkedCandidatesFile> {
  const res = await fetch(apiUrl(`/vod/${vodId}/marked-candidates`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load marked-candidates: ${res.status}`
    );
  }
  return res.json();
}

export type ClipSegmentStatus =
  | "marked"
  | "trimmed"
  | "transcribed"
  | "exported";

export type ClipSegmentRole = "normal" | "hook";

export type ClipSegment = {
  id: string;
  sourceType: string;
  vodId: string;
  candidateId: string | null;
  sourceStart: number;
  sourceEnd: number;
  role: ClipSegmentRole;
  zoomKeyframes: unknown | null;
  colorPreset: string | null;
  speedRamp: unknown | null;
  isReusable: boolean;
  reusableName: string | null;
  tags: string[] | null;
  createdAt: string;
  status: ClipSegmentStatus;
  originalSourceStart: number | null;
  originalSourceEnd: number | null;
  previewRelativePath: string | null;
  clipTranscriptRelativePath: string | null;
  clipAssRelativePath: string | null;
  clipSrtRelativePath: string | null;
  exportRelativePath: string | null;
  isManuallyEdited: boolean | null;
  presetApplicationsJson?: unknown | null;
};

export type CreateClipSegmentResult = {
  status: string;
  clipSegment: ClipSegment;
  clipSegmentId: string;
};

export type ClipSegmentsListResult = {
  vodId: string;
  count: number;
  clipSegments: ClipSegment[];
};

/** Always creates a NEW Layer-2 clip_segment (never reuses by range). */
export async function createClipSegment(
  vodId: string,
  input: {
    start: number;
    end: number;
    candidateId?: string;
    role?: ClipSegmentRole;
  }
): Promise<CreateClipSegmentResult> {
  const res = await fetch(apiUrl(`/vod/${vodId}/clip-segments`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to create clip-segment: ${res.status}`
    );
  }
  return res.json();
}

export async function fetchClipSegments(
  vodId: string
): Promise<ClipSegmentsListResult> {
  const res = await fetch(apiUrl(`/vod/${vodId}/clip-segments`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load clip-segments: ${res.status}`
    );
  }
  return res.json();
}

/** Resolve one clip_segment via the VOD list (no dedicated GET-by-id yet). */
export async function fetchClipSegmentById(
  vodId: string,
  id: string
): Promise<ClipSegment | null> {
  const data = await fetchClipSegments(vodId);
  return (data.clipSegments ?? []).find((s) => s.id === id) ?? null;
}

export type ToggleReusableResult = {
  status: string;
  clipSegment: ClipSegment;
};

/** Body matches POST /clip-segments/:id/toggle-reusable (reusableName, optional tags). */
export async function toggleClipSegmentReusable(
  id: string,
  input: {
    isReusable: boolean;
    reusableName?: string;
    tags?: string[];
  }
): Promise<ToggleReusableResult> {
  const body: Record<string, unknown> = {
    isReusable: input.isReusable,
  };
  if (typeof input.reusableName === "string") {
    body.reusableName = input.reusableName;
  }
  if (input.tags !== undefined) {
    body.tags = input.tags;
  }
  const res = await fetch(apiUrl(`/clip-segments/${id}/toggle-reusable`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Toggle reusable failed: ${res.status}`
    );
  }
  return res.json();
}

export type EnsureCandidateResult = {
  status: string;
  created: boolean;
  candidate: MarkedCandidate;
  candidateId: string;
};

/** Reuse or create a marked candidate for a timeline marker range (lazy preview). */
export async function ensureCandidateFromMarker(
  vodId: string,
  input: {
    start: number;
    end: number;
    reason?: string;
    origin?: string;
    score?: number;
  }
): Promise<EnsureCandidateResult> {
  const res = await fetch(apiUrl(`/vod/${vodId}/ensure-candidate`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to ensure candidate: ${res.status}`
    );
  }
  return res.json();
}

/** Ensures thumbnail exists (server-side cache) and returns image URL for <img>. */
export function candidateThumbnailUrl(candidateId: string): string {
  return apiUrl(`/candidates/${candidateId}/thumbnail`);
}

export type TrimPreviewResult = {
  status: string;
  candidateId: string;
  vodId: string;
  start: number;
  end: number;
  originalStart?: number;
  originalEnd?: number;
  candidateStatus: MarkedCandidateStatus;
  previewPath: string;
  previewUrlPath: string;
  usedCopy: boolean;
};

export async function trimCandidatePreview(
  candidateId: string,
  start: number,
  end: number
): Promise<TrimPreviewResult> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/trim-preview`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end }),
  });
  if (!res.ok) {
    await throwApiError(res, `Trim preview failed: ${res.status}`);
  }
  return res.json();
}

export type ClipTranscript = {
  language?: string;
  isManuallyEdited?: boolean;
  subtitle?: {
    style: "active_word" | "one_at_a_time" | "block_highlight" | "classic";
    uppercase: boolean;
    highlightColor: string;
    fontSize: number;
    positionPercent: number;
    outlineWidth: number;
    tailAfterSpeechSec?: number;
    clearGapThresholdSec?: number;
  };
  segments: Array<{
    id?: number;
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
    timingStatus?: "original" | "partial" | "redistributed";
    highlightedWordIndices?: number[];
  }>;
};

export type SubtitleRenderSnapshot = {
  settings: NonNullable<ClipTranscript["subtitle"]>;
  segments: Array<{
    text: string;
    start: number;
    end: number;
    words?: Array<{ word: string; start: number; end: number }>;
    highlightedWordIndices?: number[];
    timingStatus?: "original" | "partial" | "redistributed";
  }>;
};

export type TranscribeClipResult = {
  status: string;
  candidateId: string;
  vodId: string;
  candidateStatus: MarkedCandidateStatus;
  transcriptPath: string;
  assPath: string;
  srtPath: string;
  wavPath: string;
  segmentCount: number;
  transcript: ClipTranscript;
};

export async function transcribeCandidateClip(
  candidateId: string,
  layoutPresetId?: string
): Promise<TranscribeClipResult> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/transcribe-clip`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layoutPresetId ? { layoutPresetId } : {}),
  });
  if (!res.ok) {
    await throwApiError(res, `Transcribe failed: ${res.status}`);
  }
  return res.json();
}

export type SaveTranscriptResult = {
  status: string;
  candidateId: string;
  vodId: string;
  candidateStatus: MarkedCandidateStatus;
  isManuallyEdited: boolean;
  transcriptPath: string;
  assPath: string;
  srtPath: string;
  segmentCount: number;
  transcript: ClipTranscript;
};

export async function saveCandidateTranscript(
  candidateId: string,
  segments: Array<{
    index: number;
    text: string;
    highlightedWordIndices?: number[];
  }>,
  subtitle?: ClipTranscript["subtitle"]
): Promise<SaveTranscriptResult> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/save-transcript`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments, subtitle }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Save transcript failed: ${res.status}`
    );
  }
  return res.json();
}

export type GlossaryEntry = { from: string; to: string };

export async function fetchGlossary(): Promise<{ entries: GlossaryEntry[] }> {
  const res = await fetch(apiUrl("/glossary"));
  if (!res.ok) await throwApiError(res, `Glossary fetch failed: ${res.status}`);
  return res.json();
}

export async function saveGlossary(
  entries: GlossaryEntry[]
): Promise<{ entries: GlossaryEntry[] }> {
  const res = await fetch(apiUrl("/glossary"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) await throwApiError(res, `Glossary save failed: ${res.status}`);
  return res.json();
}

export async function resyncTranscriptSegment(
  candidateId: string,
  segmentIndex: number
): Promise<{ transcript: ClipTranscript }> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/resync-segment`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentIndex }),
  });
  if (!res.ok) await throwApiError(res, `Resync failed: ${res.status}`);
  return res.json();
}

export type QualityId = "draft" | "hd" | "max";

export type ExportCandidateResult = {
  status: string;
  candidateId: string;
  vodId: string;
  candidateStatus: MarkedCandidateStatus;
  quality: QualityId;
  speed: number;
  preset: string;
  useSubtitles: boolean;
  subtitleRange: { start: number; end: number } | null;
  runId: string;
  prontosPath: string;
  prontosRelativePath: string;
  elapsedMs: number;
};

export async function exportMarkedCandidate(input: {
  candidateId: string;
  useSubtitles: boolean;
  subtitleRange: { start: number; end: number } | null;
  quality: QualityId;
  speed: number;
  preset: string;
  /** Clip-relative punch-in keyframes. Omit or empty = no zoom. */
  zoomKeyframes?: Array<{
    time: number;
    scale: number;
    x: number;
    y: number;
  }>;
  /** Omit or "none" = no color grade. */
  colorPreset?: "none" | "vivid" | "vivid_contrast" | "cold_desaturated" | "wasted_grayscale";
  /** 0–200 when color preset active (100 = recipe baseline). */
  colorIntensityPercent?: number;
  /** Clip-relative window so color grade only applies inside the effect. */
  colorEffectStart?: number;
  colorEffectEnd?: number;
  colorFadeSeconds?: number;
  /** @deprecated routing field — Wasted is in-place; duration no longer extends the clip. */
  wastedInsert?: {
    insertAtTime: number;
    effectDuration: number;
    intensityPercent?: number;
  };
  /** Piecewise speed ramp; when non-empty, replaces uniform speed. */
  speedRamp?: Array<{ time: number; speed: number }>;
  /** Clip-relative window within preview material for export (omit = full material). */
  clipRange?: { start: number; end: number } | null;
  /** Sprint 5: multiple preset applications (2+). Single-app uses legacy fields. */
  presetApplications?: Array<{
    presetId: string;
    effectStart: number;
    effectEnd: number;
    effectDuration?: number;
    intensityPercent: number;
    zoomKeyframes?: Array<{ time: number; scale: number; x: number; y: number }>;
    colorPreset?: "none" | "vivid" | "vivid_contrast" | "cold_desaturated" | "wasted_grayscale";
    speedRamp?: Array<{ time: number; speed: number }>;
    colorEffectStart?: number;
    colorEffectEnd?: number;
    colorFadeSeconds?: number;
  }>;
}): Promise<ExportCandidateResult> {
  const body: Record<string, unknown> = {
    useSubtitles: input.useSubtitles,
    subtitleRange: input.subtitleRange,
    quality: input.quality,
    speed: input.speed,
    preset: input.preset,
  };
  if (input.zoomKeyframes && input.zoomKeyframes.length > 0) {
    body.zoomKeyframes = input.zoomKeyframes;
  }
  if (input.colorPreset && input.colorPreset !== "none") {
    body.colorPreset = input.colorPreset;
    if (typeof input.colorIntensityPercent === "number") {
      body.colorIntensityPercent = input.colorIntensityPercent;
    }
    if (
      typeof input.colorEffectStart === "number" &&
      typeof input.colorEffectEnd === "number"
    ) {
      body.colorEffectStart = input.colorEffectStart;
      body.colorEffectEnd = input.colorEffectEnd;
    }
    if (typeof input.colorFadeSeconds === "number") {
      body.colorFadeSeconds = input.colorFadeSeconds;
    }
  }
  if (input.wastedInsert) {
    body.wastedInsert = input.wastedInsert;
  }
  if (input.speedRamp && input.speedRamp.length > 0) {
    body.speedRamp = input.speedRamp;
  }
  if (input.presetApplications && input.presetApplications.length > 1) {
    body.presetApplications = input.presetApplications;
  }
  if (input.clipRange) {
    body.clipRange = input.clipRange;
  }

  const res = await fetch(apiUrl(`/candidates/${input.candidateId}/export`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, `Export failed: ${res.status}`);
  }
  return res.json();
}

export type PreviewEmotionPresetResult = {
  status: string;
  candidateId: string;
  cached: boolean;
  elapsedMs: number;
  previewRelativePath: string;
  previewUrlPath: string;
  windowStart: number;
  windowDuration: number;
  summary: string;
  presetId: string;
  effectStart: number;
  effectEnd: number;
  intensityPercent: number;
  expectedDuration?: number;
};

/** Real ffmpeg preview of an emotion preset (full clip, disk cache). */
export async function previewEmotionPresetApi(
  candidateId: string,
  input: {
    presetId: string;
    effectStart: number;
    effectEnd: number;
    effectDuration?: number;
    intensityPercent?: number;
    layoutPresetId: string;
  }
): Promise<PreviewEmotionPresetResult> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/preview-preset`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    await throwApiError(res, `Preset preview failed: ${res.status}`);
  }
  return res.json();
}

export type PreviewRenderResult = {
  status: string;
  candidateId: string;
  cached: boolean;
  elapsedMs: number;
  previewRelativePath: string;
  previewUrlPath: string;
  windowStart: number;
  windowEnd: number;
  windowDuration: number;
  excludedHook?: boolean;
  excludedWasted?: boolean;
};

/** NVENC faithful preview for a clip-relative window (cached under previews_render/). */
export async function previewRenderApi(
  candidateId: string,
  input: Parameters<typeof exportMarkedCandidate>[0] & {
    windowStart: number;
    windowEnd: number;
    subtitleSnapshot?: SubtitleRenderSnapshot | null;
  }
): Promise<PreviewRenderResult> {
  const body: Record<string, unknown> = {
    useSubtitles: input.useSubtitles,
    subtitleRange: input.subtitleRange,
    quality: input.quality,
    speed: input.speed,
    preset: input.preset,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };
  if (input.useSubtitles && input.subtitleSnapshot) {
    body.subtitleSnapshot = input.subtitleSnapshot;
  }
  if (input.zoomKeyframes && input.zoomKeyframes.length > 0) {
    body.zoomKeyframes = input.zoomKeyframes;
  }
  if (input.colorPreset && input.colorPreset !== "none") {
    body.colorPreset = input.colorPreset;
    if (typeof input.colorIntensityPercent === "number") {
      body.colorIntensityPercent = input.colorIntensityPercent;
    }
    if (
      typeof input.colorEffectStart === "number" &&
      typeof input.colorEffectEnd === "number"
    ) {
      body.colorEffectStart = input.colorEffectStart;
      body.colorEffectEnd = input.colorEffectEnd;
    }
    if (typeof input.colorFadeSeconds === "number") {
      body.colorFadeSeconds = input.colorFadeSeconds;
    }
  }
  if (input.wastedInsert) {
    body.wastedInsert = input.wastedInsert;
  }
  if (input.speedRamp && input.speedRamp.length > 0) {
    body.speedRamp = input.speedRamp;
  }
  if (input.presetApplications && input.presetApplications.length > 1) {
    body.presetApplications = input.presetApplications;
  }

  const res = await fetch(apiUrl(`/candidates/${candidateId}/preview-render`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await throwApiError(res, `Preview render failed: ${res.status}`);
  }
  return res.json();
}

export type MergeCandidatesResult = {
  status: string;
  vodId: string;
  runId: string;
  candidateIds: string[];
  quality: QualityId;
  targetResolution: { w: number; h: number };
  normalized: boolean;
  prontosPath: string;
  prontosRelativePath: string;
  elapsedMs: number;
};

export async function mergeMarkedCandidates(input: {
  candidateIds: string[];
  quality: QualityId;
}): Promise<MergeCandidatesResult> {
  const res = await fetch(apiUrl("/candidates/merge"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidateIds: input.candidateIds,
      quality: input.quality,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Merge failed: ${res.status}`
    );
  }
  return res.json();
}

export async function saveClip(input: {
  vodId: string;
  start: number;
  end: number;
  layoutPresetId: string;
}): Promise<{ clipId: string; rawPath: string }> {
  const res = await fetch(apiUrl(`/vod/${input.vodId}/clips`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start: input.start,
      end: input.end,
      layoutPresetId: input.layoutPresetId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Save clip failed: ${res.status}`
    );
  }
  return res.json();
}

export type ExportResult = {
  vodId: string;
  clipId: string;
  finalPath: string;
  finalUrlPath: string;
  version: number;
  elapsedMs: number;
  hasHook?: boolean;
  prontosFileName?: string;
  runId?: string;
};

const PROGRESS_LABELS: Record<string, string> = {
  queued: "Na fila...",
  cutting: "Cortando...",
  generating_captions: "Gerando legenda...",
  burning_captions: "Queimando legenda...",
  concatenating: "Concatenando gancho...",
  done: "Pronto",
  error: "Erro",
};

export function progressLabel(step: string): string {
  return PROGRESS_LABELS[step] || step;
}

/**
 * Creates a clip (if needed) then runs export with JSON response (progress via callbacks
 * when using the SSE helper below).
 */
export async function exportClipJson(input: {
  vodId: string;
  clipId: string;
  start: number;
  end: number;
  layoutPresetId: string;
  hookStart?: number;
  hookEnd?: number;
}): Promise<ExportResult> {
  const res = await fetch(
    apiUrl(`/vod/${input.vodId}/clips/${input.clipId}/export`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: input.start,
        end: input.end,
        layoutPresetId: input.layoutPresetId,
        ...(typeof input.hookStart === "number" &&
        typeof input.hookEnd === "number"
          ? { hookStart: input.hookStart, hookEnd: input.hookEnd }
          : {}),
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Export failed: ${res.status}`
    );
  }
  return res.json();
}

export async function exportClipWithProgress(input: {
  vodId: string;
  clipId: string;
  start: number;
  end: number;
  layoutPresetId: string;
  hookStart?: number;
  hookEnd?: number;
  onProgress: (step: string) => void;
}): Promise<ExportResult> {
  const res = await fetch(
    apiUrl(`/vod/${input.vodId}/clips/${input.clipId}/export`),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        start: input.start,
        end: input.end,
        layoutPresetId: input.layoutPresetId,
        ...(typeof input.hookStart === "number" &&
        typeof input.hookEnd === "number"
          ? { hookStart: input.hookStart, hookEnd: input.hookEnd }
          : {}),
      }),
    }
  );

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Export failed: ${res.status}`
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ExportResult | null = null;
  let errorMessage: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (event === "progress" && typeof parsed.step === "string") {
        input.onProgress(parsed.step);
      } else if (event === "done") {
        result = parsed as unknown as ExportResult;
      } else if (event === "error") {
        errorMessage = String(parsed.error || "Export failed");
      }
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  if (!result) throw new Error("Export finished without a result");
  return result;
}

/* —— Effects library (audio_library / clip_audio_instances backend) —— */

export type EffectLibraryType = "video" | "image" | "music" | "sfx";

export type EffectLibraryStatus = "active" | "archived";

/** Lean card summary returned by GET /effects-library/browse */
export type EffectLibraryCard = {
  id: string;
  type: EffectLibraryType;
  name: string;
  durationSeconds: number | null;
  tags: string[];
  sensationTags: string[];
  isFavorite: boolean;
  usageCount: number;
  status: EffectLibraryStatus;
  thumbnailPath: string | null;
  waveformPath: string | null;
  mediaPath: string;
};

export type LibraryBrowseSort =
  | "mostUsed"
  | "recentlyUsed"
  | "recentlyAdded"
  | "alphabetical";

export type EffectLibraryItem = {
  id: string;
  type: EffectLibraryType;
  name: string;
  filePath: string;
  durationSeconds: number | null;
  tags: string[];
  sensationTags: string[];
  isFavorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  status: EffectLibraryStatus;
  thumbnailPath: string | null;
  waveformPath: string | null;
  sourceType: string;
  sourceItemId: string | null;
  createdAt: string;
  chromaKeyColor: string | null;
  chromaKeySimilarity: number | null;
  chromaKeyBlend: number | null;
  backgroundRemovalMode?: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
};

export type ClipEffectInstance = {
  id: string;
  clipSegmentId: string;
  effectLibraryItemId: string;
  type: EffectLibraryType;
  /** §3 — início da parte no arquivo da biblioteca (segundos no source). */
  sourceTrimStart: number | null;
  /** §3 — fim da parte no arquivo da biblioteca. */
  sourceTrimEnd: number | null;
  volume: number | null;
  fadeInSeconds: number | null;
  fadeOutSeconds: number | null;
  duckingEnabled: boolean;
  /** §4 — entrada do efeito no clipe (segundos relativos ao início do trecho). */
  clipTimestamp: number | null;
  positionX: number | null;
  positionY: number | null;
  positionWidth: number | null;
  positionHeight: number | null;
  videoLoopEnabled?: boolean;
  libraryItem?: EffectLibraryItem;
};

export function libraryMediaUrl(relativePath: string): string {
  return apiUrl(`/media/${relativePath.replace(/\\/g, "/")}`);
}

export async function fetchEffectsLibrary(filter?: {
  type?: EffectLibraryType;
  tag?: string;
  favorite?: boolean;
  includeArchived?: boolean;
}): Promise<EffectLibraryItem[]> {
  const qs = new URLSearchParams();
  if (filter?.type) qs.set("type", filter.type);
  if (filter?.tag) qs.set("tag", filter.tag);
  if (filter?.favorite === true) qs.set("favorite", "true");
  if (filter?.favorite === false) qs.set("favorite", "false");
  if (filter?.includeArchived) qs.set("includeArchived", "true");
  const q = qs.toString();
  const res = await fetch(apiUrl(`/effects-library${q ? `?${q}` : ""}`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load effects library: ${res.status}`
    );
  }
  const data = (await res.json()) as { items: EffectLibraryItem[] };
  return (data.items ?? []).map((item) => ({
    ...item,
    sensationTags: item.sensationTags ?? [],
    status: item.status ?? "active",
    lastUsedAt: item.lastUsedAt ?? null,
    thumbnailPath: item.thumbnailPath ?? null,
    waveformPath: item.waveformPath ?? null,
  }));
}

export async function browseEffectLibrary(input: {
  type?: EffectLibraryType;
  search?: string;
  sensationTags?: string[];
  favorite?: boolean;
  includeArchived?: boolean;
  sort?: LibraryBrowseSort;
  limit?: number;
  offset?: number;
  excludeIds?: string[];
}): Promise<{ items: EffectLibraryCard[]; total: number }> {
  const qs = new URLSearchParams();
  if (input.type) qs.set("type", input.type);
  if (input.search) qs.set("search", input.search);
  if (input.sensationTags?.length) {
    qs.set("sensationTags", input.sensationTags.join(","));
  }
  if (input.favorite) qs.set("favorite", "true");
  if (input.includeArchived) qs.set("includeArchived", "true");
  if (input.sort) qs.set("sort", input.sort);
  if (input.limit != null) qs.set("limit", String(input.limit));
  if (input.offset != null) qs.set("offset", String(input.offset));
  if (input.excludeIds?.length) {
    qs.set("excludeIds", input.excludeIds.join(","));
  }
  const q = qs.toString();
  const res = await fetch(apiUrl(`/effects-library/browse${q ? `?${q}` : ""}`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to browse effects library: ${res.status}`
    );
  }
  const data = (await res.json()) as {
    items: EffectLibraryCard[];
    total: number;
  };
  return {
    items: (data.items ?? []).map(normalizeLibraryCard),
    total: data.total ?? 0,
  };
}

export async function fetchLibrarySections(): Promise<{
  pinned: EffectLibraryCard[];
  topVideo: EffectLibraryCard[];
  topAudio: EffectLibraryCard[];
}> {
  const res = await fetch(apiUrl("/effects-library/sections"), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load library sections: ${res.status}`
    );
  }
  const data = (await res.json()) as {
    pinned: EffectLibraryCard[];
    topVideo: EffectLibraryCard[];
    topAudio: EffectLibraryCard[];
  };
  return {
    pinned: (data.pinned ?? []).map(normalizeLibraryCard),
    topVideo: (data.topVideo ?? []).map(normalizeLibraryCard),
    topAudio: (data.topAudio ?? []).map(normalizeLibraryCard),
  };
}

function normalizeLibraryCard(item: EffectLibraryCard): EffectLibraryCard {
  return {
    ...item,
    sensationTags: item.sensationTags ?? [],
    status: item.status ?? "active",
    thumbnailPath: item.thumbnailPath ?? null,
    waveformPath: item.waveformPath ?? null,
    mediaPath: item.mediaPath ?? "",
  };
}

export async function fetchEffectLibraryItem(
  id: string
): Promise<EffectLibraryItem> {
  const res = await fetch(apiUrl(`/effects-library/${id}`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load library item: ${res.status}`
    );
  }
  const data = (await res.json()) as { item: EffectLibraryItem };
  const item = data.item;
  return {
    ...item,
    sensationTags: item.sensationTags ?? [],
    status: item.status ?? "active",
    lastUsedAt: item.lastUsedAt ?? null,
    thumbnailPath: item.thumbnailPath ?? null,
    waveformPath: item.waveformPath ?? null,
  };
}

export async function uploadEffectLibraryItem(input: {
  type: EffectLibraryType;
  name: string;
  tags?: string[];
  sensationTags?: string[];
  file: File;
  chromaKeyColor?: string;
  chromaKeySimilarity?: number;
  chromaKeyBlend?: number;
  backgroundRemovalMode?: string;
}): Promise<EffectLibraryItem> {
  const form = new FormData();
  form.append("type", input.type);
  form.append("name", input.name);
  if (input.tags && input.tags.length > 0) {
    form.append("tags", input.tags.join(","));
  }
  if (input.sensationTags && input.sensationTags.length > 0) {
    form.append("sensationTags", JSON.stringify(input.sensationTags));
  }
  form.append("file", input.file);
  if (input.type === "video") {
    if (input.chromaKeyColor) {
      form.append("chromaKeyColor", input.chromaKeyColor);
    }
    if (typeof input.chromaKeySimilarity === "number") {
      form.append("chromaKeySimilarity", String(input.chromaKeySimilarity));
    }
    if (typeof input.chromaKeyBlend === "number") {
      form.append("chromaKeyBlend", String(input.chromaKeyBlend));
    }
    if (input.backgroundRemovalMode) {
      form.append("backgroundRemovalMode", input.backgroundRemovalMode);
    }
  }
  const res = await fetch(apiUrl("/effects-library"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Upload effect failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { item: EffectLibraryItem };
  return data.item;
}

export async function updateEffectLibraryItem(
  id: string,
  input: {
    name?: string;
    tags?: string[];
    sensationTags?: string[];
    isFavorite?: boolean;
    status?: EffectLibraryStatus;
    chromaKeyColor?: string | null;
    chromaKeySimilarity?: number | null;
    chromaKeyBlend?: number | null;
    backgroundRemovalMode?: string | null;
  }
): Promise<EffectLibraryItem> {
  const res = await fetch(apiUrl(`/effects-library/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Update effect failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { item: EffectLibraryItem };
  return data.item;
}

export async function deleteEffectLibraryItem(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/effects-library/${id}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Delete effect failed: ${res.status}`
    );
  }
}

export async function toggleEffectLibraryFavorite(
  id: string
): Promise<EffectLibraryItem> {
  const res = await fetch(apiUrl(`/effects-library/${id}/toggle-favorite`), {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Toggle favorite failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { item: EffectLibraryItem };
  return data.item;
}

export async function archiveEffectLibraryItem(
  id: string
): Promise<EffectLibraryItem> {
  const res = await fetch(apiUrl(`/effects-library/${id}/archive`), {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Archive effect failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { item: EffectLibraryItem };
  return data.item;
}

export async function unarchiveEffectLibraryItem(
  id: string
): Promise<EffectLibraryItem> {
  const res = await fetch(apiUrl(`/effects-library/${id}/unarchive`), {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Unarchive effect failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { item: EffectLibraryItem };
  return data.item;
}

export async function batchEffectLibrary(input: {
  ids: string[];
  action:
    | "archive"
    | "unarchive"
    | "favorite"
    | "unfavorite"
    | "delete"
    | "setTags";
  sensationTags?: string[];
  tags?: string[];
}): Promise<{ updated: number; deleted: number }> {
  const res = await fetch(apiUrl("/effects-library/batch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Batch action failed: ${res.status}`
    );
  }
  return (await res.json()) as { updated: number; deleted: number };
}

export async function bulkUploadEffectLibrary(input: {
  files: File[];
  items: Array<{
    originalName: string;
    name: string;
    type?: EffectLibraryType;
    tags?: string[];
    sensationTags?: string[];
  }>;
}): Promise<EffectLibraryItem[]> {
  const form = new FormData();
  for (const f of input.files) {
    form.append("files", f);
  }
  form.append("items", JSON.stringify(input.items));
  const res = await fetch(apiUrl("/effects-library/bulk"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Bulk upload failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { items: EffectLibraryItem[] };
  return data.items ?? [];
}

export async function backfillLibraryPreviews(): Promise<{
  processed: number;
  elapsedMs: number;
}> {
  const res = await fetch(apiUrl("/effects-library/backfill-previews"), {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Backfill previews failed: ${res.status}`
    );
  }
  return (await res.json()) as { processed: number; elapsedMs: number };
}

export async function fetchClipEffects(
  candidateId: string
): Promise<ClipEffectInstance[]> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/effects`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Failed to load clip effects: ${res.status}`
    );
  }
  const data = (await res.json()) as { effects: ClipEffectInstance[] };
  return data.effects ?? [];
}

export async function applyEffectToClip(
  candidateId: string,
  input: {
    effectLibraryItemId: string;
    sourceTrimStart?: number;
    sourceTrimEnd?: number;
    clipTimestamp?: number;
    positionX?: number;
    positionY?: number;
    positionWidth?: number;
    positionHeight?: number;
    volume?: number;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
    duckingEnabled?: boolean;
    videoLoopEnabled?: boolean;
  }
): Promise<ClipEffectInstance> {
  const res = await fetch(apiUrl(`/candidates/${candidateId}/effects`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Apply effect failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { effect: ClipEffectInstance };
  return data.effect;
}

export async function removeEffectFromClip(
  candidateId: string,
  instanceId: string
): Promise<void> {
  const res = await fetch(
    apiUrl(`/candidates/${candidateId}/effects/${instanceId}`),
    { method: "DELETE" }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Remove effect failed: ${res.status}`
    );
  }
}

export async function updateEffectOnClip(
  candidateId: string,
  instanceId: string,
  input: {
    sourceTrimStart?: number;
    sourceTrimEnd?: number;
    clipTimestamp?: number;
    positionX?: number;
    positionY?: number;
    positionWidth?: number;
    positionHeight?: number;
    volume?: number;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
    duckingEnabled?: boolean;
    videoLoopEnabled?: boolean;
  }
): Promise<ClipEffectInstance> {
  const res = await fetch(
    apiUrl(`/candidates/${candidateId}/effects/${instanceId}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Update effect failed: ${res.status}`
    );
  }
  const data = (await res.json()) as { effect: ClipEffectInstance };
  return data.effect;
}

// --- Camada 3: edição final ---

export type CompositionStatus = "draft" | "exported";

export type Composition = {
  id: string;
  vodId: string | null;
  name: string | null;
  status: CompositionStatus;
  createdAt: string;
  subtitleSettingsJson?: unknown | null;
  joinSettingsJson?: unknown | null;
  colorSettingsJson?: unknown | null;
  openingSettingsJson?: unknown | null;
  closingSettingsJson?: unknown | null;
};

export type CompositionWithSegments = Composition & {
  segments: Array<{
    orderIndex: number;
    clipSegment: ClipSegment;
  }>;
};

export async function fetchCompositions(
  vodId: string
): Promise<Composition[]> {
  const res = await fetch(apiUrl(`/vod/${vodId}/compositions`), {
    cache: "no-store",
  });
  if (!res.ok) await throwApiError(res, `Failed to load compositions: ${res.status}`);
  const data = (await res.json()) as { compositions: Composition[] };
  return data.compositions ?? [];
}

export async function fetchComposition(
  id: string
): Promise<CompositionWithSegments> {
  const res = await fetch(apiUrl(`/compositions/${id}`), { cache: "no-store" });
  if (!res.ok) await throwApiError(res, `Failed to load composition: ${res.status}`);
  const data = (await res.json()) as { composition: CompositionWithSegments };
  return data.composition;
}

export async function createComposition(input: {
  vodId: string;
  name?: string;
  clipSegmentIds: string[];
}): Promise<CompositionWithSegments> {
  const res = await fetch(apiUrl("/compositions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, `Create composition failed: ${res.status}`);
  const data = (await res.json()) as { composition: CompositionWithSegments };
  return data.composition;
}

export async function reorderComposition(
  compositionId: string,
  clipSegmentIds: string[]
): Promise<CompositionWithSegments> {
  const res = await fetch(apiUrl(`/compositions/${compositionId}/reorder`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clipSegmentIds }),
  });
  if (!res.ok) await throwApiError(res, `Reorder failed: ${res.status}`);
  const data = (await res.json()) as { composition: CompositionWithSegments };
  return data.composition;
}

export async function addSegmentToComposition(
  compositionId: string,
  clipSegmentId: string
): Promise<CompositionWithSegments> {
  const res = await fetch(apiUrl(`/compositions/${compositionId}/segments`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clipSegmentId }),
  });
  if (!res.ok) await throwApiError(res, `Add segment failed: ${res.status}`);
  const data = (await res.json()) as { composition: CompositionWithSegments };
  return data.composition;
}

export async function removeSegmentFromComposition(
  compositionId: string,
  clipSegmentId: string
): Promise<CompositionWithSegments> {
  const res = await fetch(
    apiUrl(`/compositions/${compositionId}/segments/${clipSegmentId}`),
    { method: "DELETE" }
  );
  if (!res.ok) await throwApiError(res, `Remove segment failed: ${res.status}`);
  const data = (await res.json()) as { composition: CompositionWithSegments };
  return data.composition;
}

export async function fetchSegmentCompositionUsage(
  clipSegmentId: string
): Promise<number> {
  const res = await fetch(
    apiUrl(`/clip-segments/${clipSegmentId}/composition-usage`),
    { cache: "no-store" }
  );
  if (!res.ok) await throwApiError(res, `Usage check failed: ${res.status}`);
  const data = (await res.json()) as { compositionCount: number };
  return data.compositionCount ?? 0;
}

export async function trimClipSegmentInterval(
  clipSegmentId: string,
  sourceStart: number,
  sourceEnd: number
): Promise<ClipSegment> {
  const res = await fetch(apiUrl(`/clip-segments/${clipSegmentId}/interval`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceStart, sourceEnd }),
  });
  if (!res.ok) await throwApiError(res, `Trim segment failed: ${res.status}`);
  const data = (await res.json()) as { clipSegment: ClipSegment };
  return data.clipSegment;
}

export async function saveCompositionJoinSettings(
  compositionId: string,
  joinSettings: unknown
): Promise<Composition> {
  const res = await fetch(
    apiUrl(`/compositions/${compositionId}/join-settings`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinSettings }),
    }
  );
  if (!res.ok) await throwApiError(res, `Save join settings failed: ${res.status}`);
  const data = (await res.json()) as { composition: Composition };
  return data.composition;
}

export async function saveCompositionColorSettings(
  compositionId: string,
  colorSettings: unknown
): Promise<Composition> {
  const res = await fetch(
    apiUrl(`/compositions/${compositionId}/color-settings`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorSettings }),
    }
  );
  if (!res.ok) await throwApiError(res, `Save color settings failed: ${res.status}`);
  const data = (await res.json()) as { composition: Composition };
  return data.composition;
}

export async function saveCompositionSubtitleSettings(
  compositionId: string,
  subtitleSettings: unknown
): Promise<Composition> {
  const res = await fetch(
    apiUrl(`/compositions/${compositionId}/subtitle-settings`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitleSettings }),
    }
  );
  if (!res.ok) await throwApiError(res, `Save subtitle settings failed: ${res.status}`);
  const data = (await res.json()) as { composition: Composition };
  return data.composition;
}

export async function saveCompositionOpeningSettings(
  compositionId: string,
  openingSettings: unknown
): Promise<Composition> {
  const res = await fetch(
    apiUrl(`/compositions/${compositionId}/opening-settings`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingSettings }),
    }
  );
  if (!res.ok) await throwApiError(res, `Save opening settings failed: ${res.status}`);
  const data = (await res.json()) as { composition: Composition };
  return data.composition;
}

export async function saveCompositionClosingSettings(
  compositionId: string,
  closingSettings: unknown
): Promise<Composition> {
  const res = await fetch(
    apiUrl(`/compositions/${compositionId}/closing-settings`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closingSettings }),
    }
  );
  if (!res.ok) await throwApiError(res, `Save closing settings failed: ${res.status}`);
  const data = (await res.json()) as { composition: Composition };
  return data.composition;
}

export async function saveClipSegmentPresetApplications(
  clipSegmentId: string,
  presetApplications: unknown[]
): Promise<ClipSegment> {
  const res = await fetch(
    apiUrl(`/clip-segments/${clipSegmentId}/preset-applications`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetApplications }),
    }
  );
  if (!res.ok) await throwApiError(res, `Save presets failed: ${res.status}`);
  const data = (await res.json()) as { clipSegment: ClipSegment };
  return data.clipSegment;
}

export type UnifiedExportSegmentInput = {
  clipSegmentId: string;
  finalStart?: number;
  finalEnd?: number;
  presetApplications?: unknown[];
};

export async function exportUnifiedComposition(input: {
  vodId: string;
  quality: QualityId;
  preset: string;
  segments: UnifiedExportSegmentInput[];
  outputName?: string;
  joinSettings?: unknown;
  colorSettings?: unknown;
  openingSettings?: unknown;
  closingSettings?: unknown;
  subtitleSettings?: unknown;
  segmentSubtitleInputs?: unknown[];
  burnSubtitles?: boolean;
}): Promise<{
  prontosPath: string;
  prontosRelativePath: string;
  totalDurationSec: number;
  elapsedMs: number;
  joinWarnings?: string[];
}> {
  const res = await fetch(apiUrl("/compositions/unified-export"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, `Unified export failed: ${res.status}`);
  return res.json();
}

export async function compositionUnifiedPreview(input: {
  vodId: string;
  preset: string;
  windowStart: number;
  windowEnd: number;
  segments: UnifiedExportSegmentInput[];
  joinSettings?: unknown;
  colorSettings?: unknown;
  openingSettings?: unknown;
  closingSettings?: unknown;
  subtitleSettings?: unknown;
  segmentSubtitleInputs?: unknown[];
}): Promise<{
  previewUrlPath: string;
  cached: boolean;
  elapsedMs: number;
}> {
  const res = await fetch(apiUrl("/compositions/unified-preview"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, `Unified preview failed: ${res.status}`);
  return res.json();
}

export async function compositionJoinPreview(input: {
  vodId: string;
  preset: string;
  joinIndex: number;
  segments: UnifiedExportSegmentInput[];
  joinSettings?: unknown;
  colorSettings?: unknown;
  openingSettings?: unknown;
  closingSettings?: unknown;
  subtitleSettings?: unknown;
  segmentSubtitleInputs?: unknown[];
  beforeSec?: number;
  afterSec?: number;
}): Promise<{
  previewUrlPath: string;
  joinTime: number;
  cached: boolean;
  elapsedMs: number;
}> {
  const res = await fetch(apiUrl("/compositions/join-preview"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, `Join preview failed: ${res.status}`);
  return res.json();
}
