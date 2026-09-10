"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiUrl,
  exportMarkedCandidate,
  fetchClipSegmentById,
  fetchClipSegments,
  fetchLayouts,
  fetchMarkedCandidates,
  applyEffectToClip,
  removeEffectFromClip,
  createClipSegment,
  mediaUrl,
  previewEmotionPresetApi,
  previewRenderApi,
  saveCandidateTranscript,
  saveClipSegmentPresetApplications,
  fetchGlossary,
  saveGlossary,
  resyncTranscriptSegment,
  type GlossaryEntry,
  toggleClipSegmentReusable,
  transcribeCandidateClip,
  trimCandidatePreview,
  updateEffectOnClip,
  type ClipEffectInstance,
  type ClipSegment,
  type ClipTranscript,
  type LayoutPreset,
  type MarkedCandidate,
  type QualityId,
} from "../../../../../lib/api";
import { PREVIEW_PREPARING_MESSAGE } from "../../../../../lib/previewFileErrors";
import {
  isSegmentDurationBlocked,
  SEGMENT_DURATION_BLOCK_MESSAGE,
  segmentDurationSec,
} from "../../../../../lib/segmentDurationPolicy";
import {
  expandEmotionPreset,
  type EmotionPresetId,
} from "../../../../../lib/emotionPresets";
import { useRouter } from "next/navigation";
import { AdvancedOptions } from "./components/AdvancedOptions";
import { EditorHeader } from "./components/EditorHeader";
import { HelpPanel } from "./components/HelpPanel";
import { EditorTabs } from "./components/EditorTabs";
import { EmotionPresetSection } from "./components/EmotionPresetSection";
import { ExportOptions } from "./components/ExportOptions";
import { ExportResult } from "./components/ExportResult";
import { LibraryEffectsPanel } from "./components/LibraryEffectsPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { OverlayEditProvider } from "./overlayEditContext";
import { ReusableSection } from "./components/ReusableSection";
import { SectionFeedback } from "./components/SectionFeedback";
import { TimelineTracks, type TimelineSelection } from "./components/TimelineTracks";
import { TranscriptSection } from "./components/TranscriptSection";
import {
  DEFAULT_SUBTITLE_SETTINGS,
  buildSubtitleRenderSnapshot,
  findWordSubstitutions,
  type SubtitleSettings,
} from "../../../../../lib/animatedSubtitle";
import { TrimSection } from "./components/TrimSection";
import {
  clampEndHandle,
  clampStartHandle,
  computeTrimBarLayout,
  deriveTrimDisplayTimes,
  dragTimeFromAnchor,
  materialBarBounds,
  MIN_TRIM_SEGMENT_SEC,
  roundDisplaySec,
  selectionDiffers,
  type DragAnchor,
  type TrimBarLayout,
  type VodInterval,
} from "./trimViewport";
import { computeFaithfulWindow } from "./effectTiming";
import {
  applicationEnd,
  applicationOverlapsAny,
  applicationToLegacyExportFields,
  applicationsToExportPayload,
  clampApplicationTiming,
  createPresetApplication,
  mergeApplicationsForFastPreview,
  sanitizePresetApplications,
  type PresetApplication,
} from "./presetApplications";
import {
  MIN_PRESET_APPLICATION_SEC,
  PRESET_INSUFFICIENT_SPACE_MESSAGE,
} from "./presetApply";
import { onTimeFieldBlur, onTimeFieldChange } from "./timeField";
import {
  presetIdAtUiIndex,
  useEditorKeyboard,
} from "./useEditorKeyboard";
import { useEditorUndo, type EditorSnapshot } from "./useEditorUndo";
import type {
  ColorPresetUi,
  DragHandle,
  EditorTabId,
  EditKind,
  Props,
  SectionKey,
  SectionMessage,
  SpeedRampRow,
  ZoomKeyframeRow,
} from "./types";
import {
  clipSegmentAsMarked,
  formatTime,
  parseTime,
  segmentTextsFromTranscript,
} from "./utils";
import {
  INITIAL_FAITHFUL_PREVIEW,
  invalidateFaithfulPreviewState,
} from "./editorRenderDispatch";

const EMPTY_SECTION: SectionMessage = { status: "", error: "" };

function initialSections(): Record<SectionKey, SectionMessage> {
  return {
    cortar: { ...EMPTY_SECTION },
    legendas: { ...EMPTY_SECTION },
    momentos: { ...EMPTY_SECTION },
    efeitos: { ...EMPTY_SECTION },
    ajuste_fino: { ...EMPTY_SECTION },
    acoes: { ...EMPTY_SECTION },
  };
}

export default function MarkedCandidateEditorPage({ params }: Props) {
  const router = useRouter();
  const [vodId, setVodId] = useState("");
  const [candidateId, setCandidateId] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const faithfulVideoRef = useRef<HTMLVideoElement>(null);
  const presetPreviewVideoRef = useRef<HTMLVideoElement>(null);
  const trimBarRef = useRef<HTMLDivElement>(null);
  const trimPendingRef = useRef<{ start: number; end: number } | null>(null);
  const previewStopAt = useRef<number | null>(null);
  const dragHandleRef = useRef<DragHandle>(null);
  const startRef = useRef(0);
  const endRef = useRef(10);
  const selStartRef = useRef(0);
  const selEndRef = useRef(10);
  const trimSinceLastUndoRef = useRef(false);
  /** Bumped on each library toggle and on undo; stale API responses are ignored. */
  const libraryToggleEpochRef = useRef(0);
  const jklRef = useRef<{ dir: "rewind" | "forward" | null; level: number }>({
    dir: null,
    level: 0,
  });
  const jklPlaybackRef = useRef({ active: false, rate: 1 });
  const jklRewindTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appliedEffectsRef = useRef<ClipEffectInstance[]>([]);
  /** Absolute VOD time at t=0 of the isolated preview file (clip_segment only). */
  const clipOriginRef = useRef(0);
  const committedTrimRef = useRef({ start: 0, end: 10 });
  type TrimDragSession = {
    which: "start" | "end";
    anchor: DragAnchor;
    baseInterval: VodInterval;
    barStartSec: number;
    barEndSec: number;
  };
  const trimDragSessionRef = useRef<TrimDragSession | null>(null);

  const [duration, setDuration] = useState(0);
  /** Full source.mp4 duration — for context bar (clip_segment probes separately). */
  const [vodDuration, setVodDuration] = useState(0);
  const [editKind, setEditKind] = useState<EditKind | null>(null);
  const [clipSegmentMeta, setClipSegmentMeta] = useState<ClipSegment | null>(
    null
  );
  const [clipOrigin, setClipOrigin] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [siblingSegmentIds, setSiblingSegmentIds] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<MarkedCandidate | null>(null);
  const [layouts, setLayouts] = useState<LayoutPreset[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(10);
  const [selStart, setSelStart] = useState(0);
  const [selEnd, setSelEnd] = useState(10);
  const [startInput, setStartInput] = useState("0:00,0");
  const [endInput, setEndInput] = useState("0:10,0");
  const [startTimeError, setStartTimeError] = useState(false);
  const [endTimeError, setEndTimeError] = useState(false);
  const [dragging, setDragging] = useState<DragHandle>(null);
  const [editingInterval, setEditingInterval] = useState<VodInterval | null>(null);
  const editingIntervalRef = useRef<VodInterval | null>(null);
  const [trimBarWidthPx, setTrimBarWidthPx] = useState(0);
  const [dragBarLayout, setDragBarLayout] = useState<TrimBarLayout | null>(null);

  const [activeTab, setActiveTab] = useState<EditorTabId>("cortar");
  const [sections, setSections] =
    useState<Record<SectionKey, SectionMessage>>(initialSections);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [appliedEffects, setAppliedEffects] = useState<ClipEffectInstance[]>(
    []
  );

  const patchSection = useCallback(
    (key: SectionKey, patch: Partial<SectionMessage>) => {
      setSections((prev) => ({
        ...prev,
        [key]: { ...prev[key], ...patch },
      }));
    },
    []
  );

  const clearSection = useCallback(
    (key: SectionKey) => {
      patchSection(key, { status: "", error: "" });
    },
    [patchSection]
  );

  const setSectionError = useCallback(
    (key: SectionKey, error: string) => {
      patchSection(key, { error, status: "" });
    },
    [patchSection]
  );

  const setSectionStatus = useCallback(
    (key: SectionKey, status: string) => {
      patchSection(key, { status, error: "" });
    },
    [patchSection]
  );

  const handleEfeitosStatus = useCallback(
    (msg: string) => patchSection("efeitos", { status: msg, error: "" }),
    [patchSection]
  );

  const handleEfeitosError = useCallback(
    (msg: string) => patchSection("efeitos", { error: msg, status: "" }),
    [patchSection]
  );
  const [quality, setQuality] = useState<QualityId>("hd");
  const [speed, setSpeed] = useState(1);
  const [useSubtitles, setUseSubtitles] = useState(true);
  const [subtitleFullClip, setSubtitleFullClip] = useState(true);
  const [subStart, setSubStart] = useState(0);
  const [subEnd, setSubEnd] = useState(10);
  const [subStartInput, setSubStartInput] = useState("0:00,0");
  const [subEndInput, setSubEndInput] = useState("0:10,0");
  const [subStartError, setSubStartError] = useState(false);
  const [subEndError, setSubEndError] = useState(false);
  const [zoomKeyframes, setZoomKeyframes] = useState<ZoomKeyframeRow[]>([]);
  const [colorPreset, setColorPreset] = useState<ColorPresetUi>("none");
  const [speedRamp, setSpeedRamp] = useState<SpeedRampRow[]>([]);
  const [presetApplications, setPresetApplications] = useState<
    PresetApplication[]
  >([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<
    string | null
  >(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [timelineSelection, setTimelineSelection] =
    useState<TimelineSelection>(null);
  const { pushUndo, popUndo } = useEditorUndo();
  const [emotionIntensity, setEmotionIntensity] = useState(100);
  const [presetSummary, setPresetSummary] = useState("");
  const [presetPreviewLoading, setPresetPreviewLoading] = useState(false);
  const [presetPreviewUrl, setPresetPreviewUrl] = useState<string | null>(
    null
  );
  const [presetPreviewCached, setPresetPreviewCached] = useState(false);
  const [faithfulPreview, setFaithfulPreview] = useState(
    INITIAL_FAITHFUL_PREVIEW
  );
  const [draftEmotionIntensity, setDraftEmotionIntensity] = useState<
    number | null
  >(null);
  const [draftSpeed, setDraftSpeed] = useState<number | null>(null);

  const [transcript, setTranscript] = useState<ClipTranscript | null>(null);
  const [segmentTexts, setSegmentTexts] = useState<string[]>([]);
  const [segmentBaseline, setSegmentBaseline] = useState<string[]>([]);
  const [segmentHighlights, setSegmentHighlights] = useState<number[][]>([]);
  const [segmentHighlightsBaseline, setSegmentHighlightsBaseline] = useState<
    number[][]
  >([]);
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(
    DEFAULT_SUBTITLE_SETTINGS
  );
  const [subtitleSettingsBaseline, setSubtitleSettingsBaseline] =
    useState<SubtitleSettings>(DEFAULT_SUBTITLE_SETTINGS);
  const [glossaryEntries, setGlossaryEntries] = useState<GlossaryEntry[]>([]);
  const [resyncingIndex, setResyncingIndex] = useState<number | null>(null);
  const [pendingGlossaryOffer, setPendingGlossaryOffer] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const syncTranscriptFromJson = useCallback((t: ClipTranscript) => {
    const texts = segmentTextsFromTranscript(t);
    const highlights = t.segments.map((s) => s.highlightedWordIndices ?? []);
    const settings = { ...DEFAULT_SUBTITLE_SETTINGS, ...t.subtitle };
    setTranscript(t);
    setSegmentTexts(texts);
    setSegmentBaseline(texts);
    setSegmentHighlights(highlights);
    setSegmentHighlightsBaseline(highlights.map((h) => [...h]));
    setSubtitleSettings(settings);
    setSubtitleSettingsBaseline({ ...settings });
  }, []);

  const [layoutPresetId, setLayoutPresetId] = useState("vertical-split-9x16");
  const [busy, setBusy] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [exportResultUrl, setExportResultUrl] = useState<string | null>(null);
  const [sentSegmentId, setSentSegmentId] = useState<string | null>(null);
  const [reusableNameDraft, setReusableNameDraft] = useState("");
  const [reusableTagsDraft, setReusableTagsDraft] = useState("");
  const [showReusableForm, setShowReusableForm] = useState(false);

  useEffect(() => {
    params.then((p) => {
      setVodId(p.vodId);
      setCandidateId(p.candidateId);
    });
  }, [params]);

  useEffect(() => {
    void fetchGlossary()
      .then((g) => setGlossaryEntries(g.entries))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    endRef.current = end;
  }, [end]);

  useEffect(() => {
    selStartRef.current = selStart;
  }, [selStart]);

  useEffect(() => {
    selEndRef.current = selEnd;
  }, [selEnd]);

  useEffect(() => {
    appliedEffectsRef.current = appliedEffects;
  }, [appliedEffects]);

  useEffect(() => {
    clipOriginRef.current = clipOrigin;
  }, [clipOrigin]);

  useEffect(() => {
    if (!vodId) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = mediaUrl(vodId, "source.mp4");
    const onMeta = () => setVodDuration(v.duration || 0);
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeAttribute("src");
      v.load();
    };
  }, [vodId]);

  useEffect(() => {
    dragHandleRef.current = dragging;
  }, [dragging]);

  const syncTrimInputs = useCallback(
    (interval: VodInterval, materialStartSec: number) => {
      setStartInput(
        formatTime(Math.max(0, interval.startSec - materialStartSec))
      );
      setEndInput(formatTime(Math.max(0, interval.endSec - materialStartSec)));
      setStartTimeError(false);
      setEndTimeError(false);
    },
    []
  );

  useEffect(() => {
    if (!vodId || !candidateId) return;
    let cancelled = false;
    (async () => {
      setSections(initialSections());
      setEditKind(null);
      setClipSegmentMeta(null);
      setCandidate(null);
      setShowReusableForm(false);
      setSiblingSegmentIds([]);
      setDuration(0);
      setTranscript(null);
      setSegmentTexts([]);
      setSegmentBaseline([]);
      setExportResultUrl(null);
      try {
        // Prefer clip_segment (drawer → this route); fall back to candidate.
        const [segment, file, ls] = await Promise.all([
          fetchClipSegmentById(vodId, candidateId),
          fetchMarkedCandidates(vodId),
          fetchLayouts(),
        ]);
        if (cancelled) return;

        let found: MarkedCandidate | null = null;
        let kind: EditKind | null = null;
        let segMeta: ClipSegment | null = null;

        if (segment) {
          kind = "clip_segment";
          segMeta = segment;
          found = clipSegmentAsMarked(segment);
          setReusableNameDraft(segment.reusableName ?? "");
          setReusableTagsDraft((segment.tags ?? []).join(", "));
          setShowReusableForm(segment.isReusable);

          // Isolated session needs a cut preview file (create does not generate one).
          if (!found.previewRelativePath) {
            patchSection("cortar", {
              status: "Gerando preview isolado do trecho…",
            });
            const trim = await trimCandidatePreview(
              candidateId,
              found.start,
              found.end
            );
            if (cancelled) return;
            found = {
              ...found,
              start: trim.start,
              end: trim.end,
              originalStart: trim.originalStart ?? found.start,
              originalEnd: trim.originalEnd ?? found.end,
              status: trim.candidateStatus,
              previewRelativePath: `previews/${candidateId}.mp4`,
            };
            segMeta = {
              ...segMeta,
              sourceStart: trim.start,
              sourceEnd: trim.end,
              originalSourceStart: trim.originalStart ?? found.start,
              originalSourceEnd: trim.originalEnd ?? found.end,
              status: trim.candidateStatus,
              previewRelativePath: `previews/${candidateId}.mp4`,
            };
            clearSection("cortar");
          }

          const siblings = await fetchClipSegments(vodId);
          if (cancelled) return;
          setSiblingSegmentIds(
            (siblings.clipSegments ?? []).map((s) => s.id)
          );
          setClipOrigin(Number(found.start.toFixed(1)));
          setPreviewRevision(Date.now());
        } else {
            const c = (file.candidates ?? []).find((x) => x.id === candidateId);
            if (c) {
              kind = "candidate";
              found = c;
              setClipOrigin(0);
            }
          }

        if (!found || !kind) {
          patchSection("cortar", {
            error: `Trecho ${candidateId} não encontrado neste VOD`,
          });
          return;
        }

        setEditKind(kind);
        setClipSegmentMeta(segMeta);
        setCandidate(found);
        setStart(Number(found.start.toFixed(1)));
        setEnd(Number(found.end.toFixed(1)));
        setSelStart(Number(found.start.toFixed(1)));
        setSelEnd(Number(found.end.toFixed(1)));
        selStartRef.current = Number(found.start.toFixed(1));
        selEndRef.current = Number(found.end.toFixed(1));
        committedTrimRef.current = {
          start: Number(found.start.toFixed(1)),
          end: Number(found.end.toFixed(1)),
        };
        const clipLen = Math.max(0.5, found.end - found.start);
        syncTrimInputs(
          { startSec: found.start, endSec: found.end },
          found.start
        );
        setSubStart(0);
        setSubEnd(Number(clipLen.toFixed(1)));
        setSubStartInput(formatTime(0));
        setSubEndInput(formatTime(clipLen));
        setPresetApplications([]);
        setSelectedApplicationId(null);
        setEmotionIntensity(100);
        setZoomKeyframes([]);
        setColorPreset("none");
        setSpeedRamp([]);
        setPresetSummary("");
        setPresetPreviewUrl(null);
        setPresetPreviewCached(false);
        setLayouts(ls);
        if (ls[0]) setLayoutPresetId(ls[0].id);

        if (found.clipTranscriptRelativePath) {
          try {
            const res = await fetch(
              mediaUrl(vodId, found.clipTranscriptRelativePath),
              { cache: "no-store" }
            );
            if (res.ok) {
              const t = (await res.json()) as ClipTranscript;
              if (!cancelled) {
                syncTranscriptFromJson(t);
              }
            }
          } catch {
            // no transcript yet
          }
        }
      } catch (e) {
        if (!cancelled) {
          patchSection("cortar", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vodId, candidateId, patchSection, clearSection]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => {
      const stop = previewStopAt.current;
      if (stop != null && video.currentTime >= stop) {
        video.pause();
        previewStopAt.current = null;
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  const videoSrc = useMemo(() => {
    if (!vodId || !editKind) return "";
    if (editKind === "clip_segment") {
      const rel =
        candidate?.previewRelativePath || `previews/${candidateId}.mp4`;
      return `${mediaUrl(vodId, rel)}?v=${previewRevision}`;
    }
    return mediaUrl(vodId, "source.mp4");
  }, [
    vodId,
    editKind,
    candidate?.previewRelativePath,
    candidateId,
    previewRevision,
  ]);

  const materialInterval: VodInterval = useMemo(
    () => ({ startSec: start, endSec: end }),
    [start, end]
  );

  const selectionInterval: VodInterval = useMemo(
    () => ({
      startSec: editingInterval?.startSec ?? selStart,
      endSec: editingInterval?.endSec ?? selEnd,
    }),
    [editingInterval, selStart, selEnd]
  );

  const displayOriginAbs = start;

  const materialDuration = Math.max(
    MIN_TRIM_SEGMENT_SEC,
    materialInterval.endSec - materialInterval.startSec
  );
  const selectionDuration = Math.max(
    MIN_TRIM_SEGMENT_SEC,
    selectionInterval.endSec - selectionInterval.startSec
  );
  const clipDuration = materialDuration;
  const isIsolated = editKind === "clip_segment";
  const effectiveVodDuration =
    editKind === "candidate" ? duration || vodDuration : vodDuration;
  const materialBar = useMemo(
    () => materialBarBounds(materialInterval),
    [materialInterval]
  );

  const trimBarLayout: TrimBarLayout | null = useMemo(() => {
    if (dragBarLayout) return dragBarLayout;
    if (!(trimBarWidthPx > 0)) return null;
    return computeTrimBarLayout(
      materialBar.barStartSec,
      materialBar.barEndSec,
      trimBarWidthPx
    );
  }, [dragBarLayout, materialBar, trimBarWidthPx]);

  const trimDisplayTimes = useMemo(
    () => deriveTrimDisplayTimes(materialInterval, selectionInterval),
    [materialInterval, selectionInterval]
  );

  const selectionPending = useMemo(
    () => selectionDiffers(materialInterval, selectionInterval),
    [materialInterval, selectionInterval]
  );

  const playheadAbs = materialInterval.startSec + playheadTime;
  const previewPreparing = trimming;

  const selectedApplication = useMemo(
    () =>
      presetApplications.find((a) => a.id === selectedApplicationId) ?? null,
    [presetApplications, selectedApplicationId]
  );

  const mergedPresetPreview = useMemo(
    () =>
      mergeApplicationsForFastPreview(
        presetApplications,
        clipDuration,
        playheadTime
      ),
    [presetApplications, clipDuration, playheadTime]
  );

  const fastPreviewParams = useMemo(
    () => ({
      zoomKeyframes:
        zoomKeyframes.length > 0
          ? zoomKeyframes
          : mergedPresetPreview.zoomKeyframes,
      colorPreset:
        colorPreset !== "none"
          ? colorPreset
          : mergedPresetPreview.colorPreset,
      colorIntensityPercent:
        draftEmotionIntensity ?? mergedPresetPreview.colorIntensityPercent,
      colorEffectStart: mergedPresetPreview.colorEffectStart,
      colorEffectEnd: mergedPresetPreview.colorEffectEnd,
      speed:
        speedRamp.length > 0 || mergedPresetPreview.speedRamp.length > 0
          ? 1
          : (draftSpeed ?? speed),
      speedRamp:
        speedRamp.length > 0 ? speedRamp : mergedPresetPreview.speedRamp,
      appliedEffects,
      useSubtitles,
      transcript,
    }),
    [
      zoomKeyframes,
      colorPreset,
      mergedPresetPreview,
      draftEmotionIntensity,
      draftSpeed,
      speed,
      speedRamp,
      appliedEffects,
      useSubtitles,
      transcript,
    ]
  );

  const siblingIndex = siblingSegmentIds.indexOf(candidateId);
  const prevSiblingId =
    siblingIndex > 0 ? siblingSegmentIds[siblingIndex - 1] : null;
  const nextSiblingId =
    siblingIndex >= 0 && siblingIndex < siblingSegmentIds.length - 1
      ? siblingSegmentIds[siblingIndex + 1]
      : null;
  const transcriptDirty =
    segmentTexts.length > 0 &&
    (segmentTexts.length !== segmentBaseline.length ||
      segmentTexts.some((t, i) => t !== segmentBaseline[i]) ||
      segmentHighlights.some(
        (h, i) =>
          JSON.stringify(h) !== JSON.stringify(segmentHighlightsBaseline[i] ?? [])
      ) ||
      JSON.stringify(subtitleSettings) !== JSON.stringify(subtitleSettingsBaseline));

  const invalidateRenderPreviews = useCallback(() => {
    setFaithfulPreview((prev) => invalidateFaithfulPreviewState(prev));
    setPresetPreviewUrl(null);
    setPresetPreviewCached(false);
    setPresetSummary("");
  }, []);

  const handleAppliedEffectsChange = useCallback(
    (effects: ClipEffectInstance[]) => {
      setAppliedEffects(effects);
      invalidateRenderPreviews();
    },
    [invalidateRenderPreviews]
  );

  const captureSnapshot = useCallback((): EditorSnapshot => {
    return {
      presetApplications: presetApplications.map((a) => ({
        ...a,
        zoomKeyframes: [...a.zoomKeyframes],
        speedRamp: [...a.speedRamp],
        itensBiblioteca: [...a.itensBiblioteca],
        linkedEffectIds: { ...a.linkedEffectIds },
      })),
      selectedApplicationId,
      appliedEffects: appliedEffects.map((e) => ({ ...e })),
      segmentTexts: [...segmentTexts],
      clipSpeed: speed,
      clipZoomKeyframes: [...zoomKeyframes],
      clipColorPreset: colorPreset,
      clipSpeedRamp: [...speedRamp],
      selectionStart: selStart,
      selectionEnd: selEnd,
    };
  }, [
    presetApplications,
    selectedApplicationId,
    appliedEffects,
    segmentTexts,
    speed,
    zoomKeyframes,
    colorPreset,
    speedRamp,
    selStart,
    selEnd,
  ]);

  const restoreSnapshot = useCallback(
    (snap: EditorSnapshot) => {
      const sanitized = sanitizePresetApplications(
        snap.presetApplications,
        clipDuration
      );
      setPresetApplications(sanitized.apps);
      if (sanitized.removedCount > 0 || sanitized.fixedCount > 0) {
        const parts: string[] = [];
        if (sanitized.fixedCount > 0) {
          parts.push(
            `${sanitized.fixedCount} aplicação(ões) ajustada(s) para duração mínima de 0,5 s`
          );
        }
        if (sanitized.removedCount > 0) {
          parts.push(
            `${sanitized.removedCount} aplicação(ões) removida(s) por não caber no trecho`
          );
        }
        setSectionStatus("momentos", parts.join("; ") + ".");
      }
      setSelectedApplicationId(snap.selectedApplicationId);
      setAppliedEffects(snap.appliedEffects);
      setSegmentTexts(snap.segmentTexts);
      setSpeed(snap.clipSpeed);
      setZoomKeyframes(snap.clipZoomKeyframes);
      setColorPreset(snap.clipColorPreset);
      setSpeedRamp(snap.clipSpeedRamp);
      setDraftEmotionIntensity(null);
      setDraftSpeed(null);
      setSelStart(snap.selectionStart);
      setSelEnd(snap.selectionEnd);
      selStartRef.current = snap.selectionStart;
      selEndRef.current = snap.selectionEnd;
      syncTrimInputs(
        { startSec: snap.selectionStart, endSec: snap.selectionEnd },
        startRef.current
      );
      invalidateRenderPreviews();
    },
    [invalidateRenderPreviews, clipDuration, setSectionStatus]
  );

  const pushUndoBeforeAction = useCallback(() => {
    pushUndo(captureSnapshot());
  }, [pushUndo, captureSnapshot]);

  const handleLocalUndo = useCallback(() => {
    libraryToggleEpochRef.current += 1;
    const snap = popUndo();
    if (!snap) {
      const msg = trimSinceLastUndoRef.current
        ? "Cortes confirmados não entram na pilha local de desfazer."
        : "Nada na pilha local para desfazer.";
      const key: SectionKey =
        activeTab === "cortar"
          ? "cortar"
          : activeTab === "legendas"
            ? "legendas"
            : activeTab === "momentos"
              ? "momentos"
              : activeTab === "efeitos"
                ? "efeitos"
                : activeTab === "ajuste_fino"
                  ? "ajuste_fino"
                  : "acoes";
      patchSection(key, { status: "", error: msg });
      trimSinceLastUndoRef.current = false;
      return;
    }
    restoreSnapshot(snap);
    clearSection(
      activeTab === "cortar"
        ? "cortar"
        : activeTab === "legendas"
          ? "legendas"
          : activeTab === "momentos"
            ? "momentos"
            : activeTab === "efeitos"
              ? "efeitos"
              : activeTab === "ajuste_fino"
                ? "ajuste_fino"
                : "acoes"
    );
  }, [popUndo, restoreSnapshot, activeTab, patchSection, clearSection]);

  const resetJklPlayback = useCallback(() => {
    if (jklRewindTimerRef.current) {
      clearInterval(jklRewindTimerRef.current);
      jklRewindTimerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = 1;
    }
    jklRef.current = { dir: null, level: 0 };
    jklPlaybackRef.current = { active: false, rate: 1 };
  }, []);

  const startJklRewind = useCallback(
    (speed: number) => {
      if (jklRewindTimerRef.current) {
        clearInterval(jklRewindTimerRef.current);
      }
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.playbackRate = 1;
      jklPlaybackRef.current = { active: true, rate: -speed };
      const step = speed / 30;
      jklRewindTimerRef.current = setInterval(() => {
        const v = videoRef.current;
        if (!v) return;
        const next = Math.max(0, v.currentTime - step);
        v.currentTime = next;
        const rel =
          editKind === "clip_segment"
            ? next
            : Math.max(0, Math.min(clipDuration, next - start));
        setPlayheadTime(Number(rel.toFixed(3)));
      }, 1000 / 30);
    },
    [editKind, clipDuration, start]
  );

  const JKL_SPEEDS = [1, 2, 4] as const;

  const pushSelectionUndo = useCallback(() => {
    pushUndo(captureSnapshot());
  }, [pushUndo, captureSnapshot]);

  const restoreCommittedTrim = useCallback(
    (committed: { start: number; end: number }) => {
      const interval = { startSec: committed.start, endSec: committed.end };
      startRef.current = committed.start;
      endRef.current = committed.end;
      selStartRef.current = committed.start;
      selEndRef.current = committed.end;
      setEditingInterval(null);
      setStart(committed.start);
      setEnd(committed.end);
      setSelStart(committed.start);
      setSelEnd(committed.end);
      syncTrimInputs(interval, committed.start);
      invalidateRenderPreviews();
    },
    [syncTrimInputs, invalidateRenderPreviews]
  );

  const commitTrim = useCallback(
    async (nextStart: number, nextEnd: number) => {
      if (!candidateId) return;
      trimPendingRef.current = null;
      const committed = committedTrimRef.current;

      if (isSegmentDurationBlocked(nextStart, nextEnd)) {
        const dur = segmentDurationSec(nextStart, nextEnd);
        restoreCommittedTrim(committed);
        patchSection("cortar", {
          error: SEGMENT_DURATION_BLOCK_MESSAGE(dur),
        });
        return;
      }

      setTrimming(true);
      clearSection("cortar");
      invalidateRenderPreviews();
      try {
        const result = await trimCandidatePreview(
          candidateId,
          nextStart,
          nextEnd
        );
        committedTrimRef.current = {
          start: result.start,
          end: result.end,
        };
        setCandidate((prev) =>
          prev
            ? {
                ...prev,
                start: result.start,
                end: result.end,
                originalStart: result.originalStart ?? prev.originalStart,
                originalEnd: result.originalEnd ?? prev.originalEnd,
                status: result.candidateStatus,
                previewRelativePath: `previews/${candidateId}.mp4`,
              }
            : prev
        );
        setStart(result.start);
        setEnd(result.end);
        setSelStart(result.start);
        setSelEnd(result.end);
        selStartRef.current = result.start;
        selEndRef.current = result.end;
        if (editKind === "clip_segment") {
          setClipOrigin(result.start);
          setPreviewRevision(Date.now());
          setClipSegmentMeta((prev) =>
            prev
              ? {
                  ...prev,
                  sourceStart: result.start,
                  sourceEnd: result.end,
                  originalSourceStart:
                    result.originalStart ?? prev.originalSourceStart,
                  originalSourceEnd:
                    result.originalEnd ?? prev.originalSourceEnd,
                  status: result.candidateStatus,
                  previewRelativePath: `previews/${candidateId}.mp4`,
                }
              : prev
          );
        }
        patchSection("cortar", {
          status: `Preview atualizado (${formatTime(0)}–${formatTime(Math.max(0.5, result.end - result.start))})`,
        });
        trimSinceLastUndoRef.current = true;
        const len = Math.max(0.5, result.end - result.start);
        setSubStart(0);
        setSubEnd(Number(len.toFixed(1)));
        setSubStartInput(formatTime(0));
        setSubEndInput(formatTime(len));
        setSubtitleFullClip(true);
        syncTrimInputs(
          { startSec: result.start, endSec: result.end },
          result.start
        );
      } catch (e) {
        restoreCommittedTrim(committed);
        patchSection("cortar", {
          error:
            (e instanceof Error ? e.message : String(e)) +
            " O intervalo anterior foi restaurado.",
        });
      } finally {
        setTrimming(false);
      }
    },
    [candidateId, editKind, patchSection, clearSection, invalidateRenderPreviews, syncTrimInputs, restoreCommittedTrim]
  );

  function previewAtAbs(absTime: number) {
    const video = videoRef.current;
    if (!video) return;
    if (editKind === "clip_segment") {
      video.currentTime = Math.max(0, absTime - clipOriginRef.current);
    } else {
      video.currentTime = absTime;
    }
  }

  function setEditingSelection(interval: VodInterval) {
    editingIntervalRef.current = interval;
    setEditingInterval(interval);
    syncTrimInputs(interval, startRef.current);
  }

  function finalizeSelection(interval: VodInterval) {
    editingIntervalRef.current = null;
    setEditingInterval(null);
    selStartRef.current = interval.startSec;
    selEndRef.current = interval.endSec;
    setSelStart(interval.startSec);
    setSelEnd(interval.endSec);
    syncTrimInputs(interval, startRef.current);
    invalidateRenderPreviews();
  }

  function resetSelectionToMaterial() {
    pushSelectionUndo();
    finalizeSelection({ startSec: startRef.current, endSec: endRef.current });
  }

  function requestConfirmCut() {
    const head = trimDisplayTimes.excludedHead;
    const tail = trimDisplayTimes.excludedTail;
    const dur = trimDisplayTimes.selectionDuration;
    const parts: string[] = [];
    if (head > 0.05) parts.push(`${formatTime(head)} do início`);
    if (tail > 0.05) parts.push(`${formatTime(tail)} do fim`);
    const removed =
      parts.length > 0 ? parts.join(" e ") : "nenhum trecho";
    const ok = window.confirm(
      `Confirmar corte?\n\nSerá removido permanentemente: ${removed}.\nDuração resultante: ${formatTime(dur)}.\n\nEsta ação não pode ser desfeita com Ctrl+Z.`
    );
    if (!ok) return;
    void commitTrim(selStartRef.current, selEndRef.current);
  }

  function onTrimPointerMove(e: React.PointerEvent<HTMLElement>) {
    const session = trimDragSessionRef.current;
    if (!session) return;

    let t = dragTimeFromAnchor(session.anchor, e.clientX, e.shiftKey);
    const base = session.baseInterval;
    if (session.which === "start") {
      t = clampStartHandle(
        t,
        { startSec: t, endSec: base.endSec },
        session.barStartSec
      );
      setEditingSelection({
        startSec: roundDisplaySec(t),
        endSec: base.endSec,
      });
      previewAtAbs(t);
    } else {
      t = clampEndHandle(t, base, session.barEndSec);
      setEditingSelection({
        startSec: base.startSec,
        endSec: roundDisplaySec(t),
      });
      previewAtAbs(t);
    }
  }

  function onTrimPointerUp() {
    const which = dragHandleRef.current;
    if (which !== "start" && which !== "end") return;
    trimDragSessionRef.current = null;
    dragHandleRef.current = null;
    setDragging(null);
    setDragBarLayout(null);
    const final = editingIntervalRef.current ?? {
      startSec: selStartRef.current,
      endSec: selEndRef.current,
    };
    finalizeSelection(final);
  }

  function onHandlePointerDown(
    which: "start" | "end",
    e: React.PointerEvent<HTMLButtonElement>
  ) {
    const el = trimBarRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pushSelectionUndo();
    const interval = {
      startSec: selStartRef.current,
      endSec: selEndRef.current,
    };
    const { barStartSec, barEndSec } = materialBarBounds({
      startSec: startRef.current,
      endSec: endRef.current,
    });
    const layout = computeTrimBarLayout(barStartSec, barEndSec, el.clientWidth);
    const handleTime = which === "start" ? interval.startSec : interval.endSec;
    setDragBarLayout(layout);
    trimDragSessionRef.current = {
      which,
      anchor: {
        pointerX: e.clientX,
        timeSec: handleTime,
        pxPerSec: layout.pxPerSec,
      },
      baseInterval: interval,
      barStartSec,
      barEndSec,
    };
    setDragging(which);
    dragHandleRef.current = which;
    setEditingSelection(interval);
  }

  function nudge(which: "start" | "end", delta: number) {
    pushSelectionUndo();
    const materialStart = startRef.current;
    const materialEnd = endRef.current;
    if (which === "start") {
      const next = Math.max(
        materialStart,
        Math.min(
          Number((selStart + delta).toFixed(1)),
          selEnd - MIN_TRIM_SEGMENT_SEC
        )
      );
      finalizeSelection({ startSec: next, endSec: selEnd });
    } else {
      const next = Math.min(
        materialEnd,
        Math.max(
          Number((selEnd + delta).toFixed(1)),
          selStart + MIN_TRIM_SEGMENT_SEC
        )
      );
      finalizeSelection({ startSec: selStart, endSec: next });
    }
  }

  function playPreview(rangeStart: number, rangeEnd: number) {
    const video = videoRef.current;
    if (!video) return;
    if (editKind === "clip_segment") {
      const origin = clipOriginRef.current;
      previewStopAt.current = Math.max(0, rangeEnd - origin);
      video.currentTime = Math.max(0, rangeStart - origin);
    } else {
      previewStopAt.current = rangeEnd;
      video.currentTime = rangeStart;
    }
    void video.play();
  }

  function seekToClipTime(t: number) {
    const clamped = Number(
      Math.max(0, Math.min(clipDuration, t)).toFixed(3)
    );
    setPlayheadTime(clamped);
    const showFaithful =
      faithfulPreview.mode === "faithful" && faithfulPreview.url != null;
    const video = showFaithful
      ? faithfulVideoRef.current
      : videoRef.current;
    if (!video) return;
    if (showFaithful) {
      const local = Math.max(
        0,
        Math.min(
          faithfulPreview.windowEnd - faithfulPreview.windowStart,
          clamped - faithfulPreview.windowStart
        )
      );
      video.currentTime = local;
    } else if (editKind === "clip_segment") {
      video.currentTime = clamped;
    } else {
      video.currentTime = start + clamped;
    }
  }

  async function onTranscribe() {
    if (!candidateId) return;
    if (previewPreparing) {
      patchSection("legendas", {
        error: PREVIEW_PREPARING_MESSAGE,
        status: "",
      });
      return;
    }
    setBusy(true);
    clearSection("legendas");
    patchSection("legendas", {
      status: "Transcrevendo trecho (Whisper isolado)…",
    });
    try {
      // Ensure latest trim is on disk before whisper
      if (trimPendingRef.current) {
        const pending = trimPendingRef.current;
        trimPendingRef.current = null;
        await trimCandidatePreview(candidateId, pending.start, pending.end);
      }
      const result = await transcribeCandidateClip(
        candidateId,
        layoutPresetId
      );
      setTranscript(result.transcript);
      syncTranscriptFromJson(result.transcript);
      setCandidate((prev) =>
        prev
          ? {
              ...prev,
              status: result.candidateStatus,
              clipTranscriptRelativePath: `transcripts/${candidateId}.json`,
              isManuallyEdited: false,
            }
          : prev
      );
      setUseSubtitles(true);
      patchSection("legendas", {
        status: `Transcrição ok (${result.segmentCount} segmentos)`,
      });
    } catch (e) {
      setSectionError(
        "legendas",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(false);
    }
  }

  async function onSaveTranscript() {
    if (!candidateId || !transcript) return;
    if (segmentTexts.length !== transcript.segments.length) {
      patchSection("legendas", {
        error: "Número de segmentos inconsistente — re-transcreva o trecho.",
      });
      return;
    }
    setBusy(true);
    clearSection("legendas");
    setSectionStatus("legendas", "Salvando correções…");
    try {
      const result = await saveCandidateTranscript(
        candidateId,
        segmentTexts.map((text, index) => ({
          index,
          text,
          highlightedWordIndices: segmentHighlights[index] ?? [],
        })),
        subtitleSettings
      );
      syncTranscriptFromJson(result.transcript);
      setCandidate((prev) =>
        prev
          ? {
              ...prev,
              status: result.candidateStatus,
              isManuallyEdited: true,
            }
          : prev
      );
      const substitutions: Array<{ from: string; to: string }> = [];
      for (let i = 0; i < segmentBaseline.length; i++) {
        substitutions.push(
          ...findWordSubstitutions(segmentBaseline[i] ?? "", segmentTexts[i] ?? "")
        );
      }
      const unique = substitutions.filter(
        (s, idx, arr) =>
          arr.findIndex(
            (x) =>
              x.from.toLowerCase() === s.from.toLowerCase() &&
              x.to.toLowerCase() === s.to.toLowerCase()
          ) === idx
      );
      const alreadyInGlossary = (from: string, to: string) =>
        glossaryEntries.some(
          (e) =>
            e.from.toLowerCase() === from.toLowerCase() &&
            e.to.toLowerCase() === to.toLowerCase()
        );
      const offer = unique.find((s) => !alreadyInGlossary(s.from, s.to));
      setPendingGlossaryOffer(offer ?? null);
      invalidateRenderPreviews();
      patchSection("legendas", {
        status: `Correções salvas (${result.segmentCount} segmentos)`,
      });
    } catch (e) {
      setSectionError(
        "legendas",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(false);
    }
  }

  async function onResyncSegment(index: number) {
    if (!candidateId) return;
    setResyncingIndex(index);
    clearSection("legendas");
    setSectionStatus("legendas", `Re-sincronizando segmento #${index}…`);
    const started = Date.now();
    try {
      const result = await resyncTranscriptSegment(candidateId, index);
      syncTranscriptFromJson(result.transcript);
      invalidateRenderPreviews();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      patchSection("legendas", {
        status: `Segmento #${index} re-sincronizado em ${secs}s`,
      });
    } catch (e) {
      setSectionError(
        "legendas",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setResyncingIndex(null);
    }
  }

  async function onSaveGlossary() {
    try {
      const saved = await saveGlossary(glossaryEntries);
      setGlossaryEntries(saved.entries);
      patchSection("legendas", { status: "Glossário salvo" });
    } catch (e) {
      setSectionError(
        "legendas",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  async function onExport() {
    if (!candidateId) return;
    if (previewPreparing) {
      patchSection("acoes", {
        error: PREVIEW_PREPARING_MESSAGE,
        status: "",
      });
      return;
    }
    if (useSubtitles && transcriptDirty) {
      patchSection("acoes", {
        error:
          "Há edições de segmento não salvas. Clique em “salvar correções” antes de exportar.",
      });
      return;
    }
    if (useSubtitles && !transcript && !candidate?.clipTranscriptRelativePath) {
      patchSection("acoes", {
        error:
          "Legendas ativas exigem transcrição. Gere as legendas antes, ou desligue a gravação no vídeo.",
        status: "",
      });
      return;
    }
    const invalidPreset = presetApplications.find(
      (app) => app.duracao < MIN_PRESET_APPLICATION_SEC
    );
    if (invalidPreset) {
      setSectionError(
        "acoes",
        "Há um preset com duração inválida — ajuste ou remova antes de exportar."
      );
      return;
    }

    setBusy(true);
    clearSection("acoes");
    setExportResultUrl(null);
    setSectionStatus("acoes", "Exportando…");
    try {
      const exportBody = {
        ...buildExportRenderBody(),
        clipRange: {
          start: selStart - start,
          end: selEnd - start,
        },
      };
      const result = await exportMarkedCandidate(exportBody);

      if (editKind === "clip_segment" && presetApplications.length > 0) {
        try {
          const payload = applicationsToExportPayload(
            presetApplications,
            clipDuration
          );
          await saveClipSegmentPresetApplications(candidateId, payload);
        } catch {
          // non-blocking — export succeeded
        }
      }

      setCandidate((prev) =>
        prev
          ? {
              ...prev,
              status: result.candidateStatus,
              exportRelativePath: result.prontosRelativePath,
            }
          : prev
      );
      setExportResultUrl(
        apiUrl(
          `/media/${result.vodId}/${result.prontosRelativePath}?t=${Date.now()}`
        )
      );
      setSectionStatus(
        "acoes",
        `Exportado em ${(result.elapsedMs / 1000).toFixed(1)}s → ${result.prontosRelativePath}`
      );
    } catch (e) {
      setSectionError(
        "acoes",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(false);
    }
  }

  function clipRelativeFromVideoTime(videoTime: number): number {
    if (editKind === "clip_segment") {
      return Number(Math.max(0, Math.min(clipDuration, videoTime)).toFixed(2));
    }
    return Number(
      Math.max(0, Math.min(clipDuration, videoTime - start)).toFixed(2)
    );
  }

  function buildExportRenderBody() {
    const base = {
      candidateId: candidateId!,
      useSubtitles: false,
      subtitleRange: null,
      subtitleSnapshot: null,
      quality,
      speed:
        speedRamp.length > 0 ||
        presetApplications.some((a) => a.speedRamp.length > 0)
          ? 1
          : speed,
      preset: layoutPresetId,
    };

    if (presetApplications.length === 1) {
      return {
        ...base,
        ...applicationToLegacyExportFields(presetApplications[0], clipDuration),
      };
    }

    if (presetApplications.length > 1) {
      return {
        ...base,
        presetApplications: applicationsToExportPayload(
          presetApplications,
          clipDuration
        ),
      };
    }

    return {
      ...base,
      ...(zoomKeyframes.length > 0 ? { zoomKeyframes } : {}),
      ...(colorPreset !== "none"
        ? {
            colorPreset,
            colorIntensityPercent: emotionIntensity,
          }
        : {}),
      ...(speedRamp.length > 0 ? { speedRamp } : {}),
    };
  }

  function faithfulWindow() {
    const selLo = selStart - start;
    const selHi = selEnd - start;
    const win = computeFaithfulWindow({
      clipDuration: materialDuration,
      presetApplications,
      appliedEffects,
    });
    return {
      start: Math.max(selLo, win.start),
      end: Math.min(selHi, win.end),
    };
  }

  async function requestFaithfulRender() {
    if (!candidateId) return;
    if (previewPreparing) {
      patchSection("acoes", {
        error: PREVIEW_PREPARING_MESSAGE,
        status: "",
      });
      return;
    }
    const { start: windowStart, end: windowEnd } = faithfulWindow();
    setFaithfulPreview((prev) => ({
      ...prev,
      loading: true,
      mode: "fast",
    }));
    try {
      const body = buildExportRenderBody();
      const result = await previewRenderApi(candidateId, {
        ...body,
        windowStart,
        windowEnd,
      });
      setFaithfulPreview({
        mode: "faithful",
        url: apiUrl(`${result.previewUrlPath}?t=${Date.now()}`),
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        cached: result.cached,
        loading: false,
        excludedHook: result.excludedHook === true,
      });
    } catch (e) {
      setFaithfulPreview((prev) => ({
        ...invalidateFaithfulPreviewState(prev),
        loading: false,
      }));
      setSectionError(
        "acoes",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  function applyEmotionPresetSelection(presetId: EmotionPresetId) {
    const created = createPresetApplication(
      presetId,
      playheadTime,
      clipDuration
    );
    if ("rejected" in created && created.rejected) {
      setSectionError("momentos", PRESET_INSUFFICIENT_SPACE_MESSAGE);
      return;
    }
    const { app, truncated } = created;
    pushUndoBeforeAction();
    if (
      applicationOverlapsAny(
        { inicio: app.inicio, duracao: app.duracao },
        presetApplications
      )
    ) {
      patchSection("momentos", {
        error:
          "Não é possível sobrepor aplicações de preset — escolha outro momento no trecho.",
        status: "",
      });
      return;
    }
    setPresetApplications((prev) => [...prev, app]);
    setSelectedApplicationId(app.id);
    setActiveTab("momentos");
    setTimelineSelection({ kind: "preset", id: app.id });
    if (truncated) {
      setSectionStatus(
        "momentos",
        `Preset encurtado para caber no trecho (fim em ${formatTime(applicationEnd(app))}).`
      );
    } else {
      clearSection("momentos");
    }
    invalidateRenderPreviews();
  }

  function selectEmotionPreset(presetId: EmotionPresetId) {
    applyEmotionPresetSelection(presetId);
  }

  const updateApplication = useCallback(
    (id: string, patch: Partial<PresetApplication>) => {
      setPresetApplications((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
      invalidateRenderPreviews();
    },
    [invalidateRenderPreviews]
  );

  const removeApplication = useCallback(
    async (id: string) => {
      pushUndoBeforeAction();
      const app = presetApplications.find((a) => a.id === id);
      if (app && candidateId) {
        for (const instanceId of Object.values(app.linkedEffectIds)) {
          try {
            await removeEffectFromClip(candidateId, instanceId);
          } catch {
            /* ignore */
          }
        }
        setAppliedEffects((prev) =>
          prev.filter((e) => !Object.values(app.linkedEffectIds).includes(e.id))
        );
      }
      setPresetApplications((prev) => prev.filter((a) => a.id !== id));
      if (selectedApplicationId === id) {
        setSelectedApplicationId(null);
      }
      invalidateRenderPreviews();
    },
    [
      presetApplications,
      candidateId,
      selectedApplicationId,
      pushUndoBeforeAction,
      invalidateRenderPreviews,
    ]
  );

  const toggleLibraryItemForApplication = useCallback(
    async (
      applicationId: string,
      item: import("../../../../../lib/api").EffectLibraryCard,
      checked: boolean
    ) => {
      if (!candidateId) return;
      pushUndoBeforeAction();
      const opEpoch = ++libraryToggleEpochRef.current;
      const isStale = () => opEpoch !== libraryToggleEpochRef.current;
      const app = presetApplications.find((a) => a.id === applicationId);
      if (!app) return;
      if (checked) {
        const fileDur = item.durationSeconds ?? 7.8;
        try {
          const effect = await applyEffectToClip(candidateId, {
            effectLibraryItemId: item.id,
            sourceTrimStart: 0,
            sourceTrimEnd: fileDur,
            clipTimestamp: app.inicio,
          });
          if (isStale()) return;
          updateApplication(applicationId, {
            itensBiblioteca: [...app.itensBiblioteca, item.id],
            linkedEffectIds: {
              ...app.linkedEffectIds,
              [item.id]: effect.id,
            },
          });
          setAppliedEffects((prev) => [...prev, effect]);
        } catch (e) {
          if (isStale()) return;
          patchSection("momentos", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      } else {
        const instanceId = app.linkedEffectIds[item.id];
        if (instanceId) {
          try {
            await removeEffectFromClip(candidateId, instanceId);
            if (isStale()) return;
            setAppliedEffects((prev) =>
              prev.filter((e) => e.id !== instanceId)
            );
          } catch (e) {
            if (isStale()) return;
            patchSection("momentos", {
              error: e instanceof Error ? e.message : String(e),
            });
            return;
          }
        }
        if (isStale()) return;
        const nextLinked = { ...app.linkedEffectIds };
        delete nextLinked[item.id];
        updateApplication(applicationId, {
          itensBiblioteca: app.itensBiblioteca.filter((x) => x !== item.id),
          linkedEffectIds: nextLinked,
        });
      }
      if (isStale()) return;
      invalidateRenderPreviews();
    },
    [
      candidateId,
      presetApplications,
      pushUndoBeforeAction,
      updateApplication,
      patchSection,
      invalidateRenderPreviews,
    ]
  );

  function handleSpeedPreview(value: number) {
    setDraftSpeed(value);
    invalidateRenderPreviews();
  }

  function handleSpeedCommit(value: number) {
    pushUndoBeforeAction();
    setDraftSpeed(null);
    setSpeed(value);
    invalidateRenderPreviews();
  }

  function handleColorPresetChange(value: ColorPresetUi) {
    setColorPreset(value);
    if (presetApplications.length > 0) invalidateRenderPreviews();
  }

  function handleZoomKeyframesChange(keyframes: ZoomKeyframeRow[]) {
    setZoomKeyframes(keyframes);
    if (presetApplications.length > 0) invalidateRenderPreviews();
  }

  async function generatePresetPreview() {
    if (previewPreparing) {
      patchSection("momentos", {
        error: PREVIEW_PREPARING_MESSAGE,
        status: "",
      });
      return;
    }
    if (!selectedApplication || !candidateId) {
      patchSection("momentos", {
        error: "Selecione uma aplicação de preset antes de gerar a prévia.",
      });
      return;
    }
    const app = selectedApplication;
    const effectEnd = applicationEnd(app);
    if (app.presetId === "wasted") {
      if (!(app.duracao >= 0.5)) {
        patchSection("momentos", {
          error: "Duração do Wasted deve ser pelo menos 0,5s.",
        });
        return;
      }
    } else if (!(effectEnd > app.inicio)) {
      patchSection("momentos", {
        error: "O fim do efeito precisa ser depois do início.",
      });
      return;
    }

    setPresetPreviewLoading(true);
    setPresetPreviewUrl(null);
    clearSection("momentos");
    try {
      const result = expandEmotionPreset({
        presetId: app.presetId,
        effectStart: app.inicio,
        effectEnd,
        effectDuration: app.presetId === "wasted" ? app.duracao : undefined,
        clipDuration,
        intensityPercent: app.intensidade,
      });
      setPresetSummary(result.summary);

      const preview = await previewEmotionPresetApi(candidateId, {
        presetId: app.presetId,
        effectStart: app.inicio,
        effectEnd,
        effectDuration: app.presetId === "wasted" ? app.duracao : undefined,
        intensityPercent: app.intensidade,
        layoutPresetId,
      });
      const url = apiUrl(preview.previewUrlPath);
      setPresetPreviewUrl(url);
      setPresetPreviewCached(preview.cached);
      setPresetSummary(preview.summary);
      const durHint =
        preview.expectedDuration != null
          ? ` · duração final ~${preview.expectedDuration.toFixed(1)}s`
          : "";
      patchSection("momentos", {
        status: preview.cached
          ? `Preview do preset (cache, ${(preview.elapsedMs / 1000).toFixed(1)}s)${durHint}`
          : `Preview renderizado em ${(preview.elapsedMs / 1000).toFixed(1)}s (ffmpeg)${durHint}`,
      });
    } catch (e) {
      setSectionError(
        "momentos",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setPresetPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!presetPreviewUrl || !presetPreviewVideoRef.current) return;
    const el = presetPreviewVideoRef.current;
    const play = () => {
      void el.play().catch(() => undefined);
    };
    if (el.readyState >= 2) {
      play();
    } else {
      el.addEventListener("loadeddata", play, { once: true });
      return () => el.removeEventListener("loadeddata", play);
    }
  }, [presetPreviewUrl]);

  async function onSendToEdit() {
    if (!vodId || !candidateId || editKind !== "candidate") return;
    if (isSegmentDurationBlocked(start, end)) {
      setSectionError(
        "acoes",
        SEGMENT_DURATION_BLOCK_MESSAGE(segmentDurationSec(start, end))
      );
      return;
    }
    if (previewPreparing) {
      patchSection("acoes", {
        error: PREVIEW_PREPARING_MESSAGE,
        status: "",
      });
      return;
    }
    setBusy(true);
    clearSection("acoes");
    setSentSegmentId(null);
    setSectionStatus("acoes", "Enviando para edição…");
    try {
      const result = await createClipSegment(vodId, {
        start,
        end,
        candidateId,
        role: "normal",
      });
      setSentSegmentId(result.clipSegmentId);
      patchSection("acoes", {
        status: `Enviado para edição (${result.clipSegmentId.slice(0, 8)}…) · ${formatTime(start)}–${formatTime(end)}`,
      });
    } catch (e) {
      setSectionError(
        "acoes",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setBusy(false);
    }
  }

  async function onApplyReusable(isReusable: boolean) {
    if (!candidateId || editKind !== "clip_segment") return;
    if (isReusable) {
      const name = reusableNameDraft.trim();
      if (!name) {
        patchSection("acoes", {
          error: "Informe um nome para guardar este trecho para reusar.",
        });
        setShowReusableForm(true);
        return;
      }
    }
    setBusy(true);
    clearSection("acoes");
    try {
      const tags = reusableTagsDraft
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const result = await toggleClipSegmentReusable(candidateId, {
        isReusable,
        ...(isReusable
          ? {
              reusableName: reusableNameDraft.trim(),
              tags,
            }
          : {}),
      });
      setClipSegmentMeta(result.clipSegment);
      setCandidate(clipSegmentAsMarked(result.clipSegment));
      setShowReusableForm(result.clipSegment.isReusable);
      setReusableNameDraft(result.clipSegment.reusableName ?? "");
      setReusableTagsDraft((result.clipSegment.tags ?? []).join(", "));
      patchSection("acoes", {
        status: isReusable
          ? `Marcado como reutilizável: ${result.clipSegment.reusableName}`
          : "Removido da biblioteca reutilizável",
      });
    } catch (e) {
      patchSection("acoes", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const tabIndicators: Record<EditorTabId, boolean> = {
    cortar: true,
    legendas: !!transcript,
    momentos: presetApplications.length > 0,
    efeitos: appliedEffects.length > 0,
    ajuste_fino:
      presetApplications.length === 0 &&
      (zoomKeyframes.length > 0 || colorPreset !== "none" || speed !== 1),
  };

  const tabAttention: Record<EditorTabId, boolean> = {
    cortar: !!(sections.cortar.status || sections.cortar.error),
    legendas: !!(sections.legendas.status || sections.legendas.error),
    momentos: !!(sections.momentos.status || sections.momentos.error),
    efeitos: !!(sections.efeitos.status || sections.efeitos.error),
    ajuste_fino: !!(
      sections.ajuste_fino.status || sections.ajuste_fino.error
    ),
  };


  const onTimelinePresetChange = useCallback(
    (id: string, nextStart: number, nextEnd: number) => {
      const app = presetApplications.find((a) => a.id === id);
      if (!app) return;
      const dur = Number((nextEnd - nextStart).toFixed(3));
      if (dur < MIN_PRESET_APPLICATION_SEC) {
        setSectionError("momentos", PRESET_INSUFFICIENT_SPACE_MESSAGE);
        return;
      }
      const candidateApp = { inicio: nextStart, duracao: dur };
      if (applicationOverlapsAny(candidateApp, presetApplications, id)) {
        patchSection("momentos", {
          error:
            "Não é possível sobrepor aplicações de preset — escolha outro intervalo.",
          status: "",
        });
        return;
      }
      clearSection("momentos");
      updateApplication(id, { inicio: nextStart, duracao: dur });
    },
    [presetApplications, updateApplication, patchSection, clearSection, setSectionError]
  );

  const onTimelineEffectChange = useCallback(
    (
      id: string,
      patch: {
        clipTimestamp?: number;
        sourceTrimStart?: number;
        sourceTrimEnd?: number;
      }
    ) => {
      setAppliedEffects((prev) =>
        prev.map((inst) =>
          inst.id === id
            ? {
                ...inst,
                clipTimestamp:
                  patch.clipTimestamp !== undefined
                    ? patch.clipTimestamp
                    : inst.clipTimestamp,
                sourceTrimStart:
                  patch.sourceTrimStart !== undefined
                    ? patch.sourceTrimStart
                    : inst.sourceTrimStart,
                sourceTrimEnd:
                  patch.sourceTrimEnd !== undefined
                    ? patch.sourceTrimEnd
                    : inst.sourceTrimEnd,
              }
            : inst
        )
      );
      invalidateRenderPreviews();
    },
    [invalidateRenderPreviews]
  );

  const onTimelineEffectDragEnd = useCallback(
    async (id: string) => {
      if (!candidateId) return;
      const inst = appliedEffectsRef.current.find((e) => e.id === id);
      if (!inst) return;
      try {
        const updated = await updateEffectOnClip(candidateId, id, {
          clipTimestamp: inst.clipTimestamp ?? undefined,
          sourceTrimStart: inst.sourceTrimStart ?? undefined,
          sourceTrimEnd: inst.sourceTrimEnd ?? undefined,
        });
        setAppliedEffects((prev) =>
          prev.map((e) => (e.id === id ? updated : e))
        );
      } catch (e) {
        handleEfeitosError(e instanceof Error ? e.message : String(e));
      }
    },
    [candidateId, handleEfeitosError]
  );

  const togglePlayPause = useCallback(() => {
    const showFaithful =
      faithfulPreview.mode === "faithful" && faithfulPreview.url != null;
    const video = showFaithful
      ? faithfulVideoRef.current
      : videoRef.current;
    if (!video) return;
    if (video.paused) {
      resetJklPlayback();
      void video.play();
    } else {
      resetJklPlayback();
      video.pause();
    }
  }, [faithfulPreview.mode, faithfulPreview.url, resetJklPlayback]);

  const markTrimAtPlayhead = useCallback(
    (which: "start" | "end") => {
      const abs = Number((start + playheadTime).toFixed(1));
      pushSelectionUndo();
      if (which === "start") {
        const next = Math.max(
          start,
          Math.min(abs, selEnd - MIN_TRIM_SEGMENT_SEC)
        );
        finalizeSelection({ startSec: next, endSec: selEnd });
      } else {
        const next = Math.min(
          end,
          Math.max(abs, selStart + MIN_TRIM_SEGMENT_SEC)
        );
        finalizeSelection({ startSec: selStart, endSec: next });
      }
    },
    [playheadTime, start, end, selStart, selEnd, pushSelectionUndo]
  );

  useEditorKeyboard(!!candidateId && !!editKind, {
    togglePlayPause,
    markTrimStart: () => markTrimAtPlayhead("start"),
    markTrimEnd: () => markTrimAtPlayhead("end"),
    seekByFrames: (deltaFrames) => {
      seekToClipTime(playheadTime + deltaFrames);
    },
    seekBySeconds: (deltaSeconds) => {
      seekToClipTime(playheadTime + deltaSeconds);
    },
    onJ: () => {
      const showFaithful =
        faithfulPreview.mode === "faithful" && faithfulPreview.url != null;
      const video = showFaithful
        ? faithfulVideoRef.current
        : videoRef.current;
      if (!video) return;
      const prev = jklRef.current;
      const level =
        prev.dir === "rewind" ? Math.min(2, prev.level + 1) : 0;
      jklRef.current = { dir: "rewind", level };
      startJklRewind(JKL_SPEEDS[level]);
    },
    onK: () => resetJklPlayback(),
    onL: () => {
      if (jklRewindTimerRef.current) {
        clearInterval(jklRewindTimerRef.current);
        jklRewindTimerRef.current = null;
      }
      const showFaithful =
        faithfulPreview.mode === "faithful" && faithfulPreview.url != null;
      const video = showFaithful
        ? faithfulVideoRef.current
        : videoRef.current;
      if (!video) return;
      const prev = jklRef.current;
      const level =
        prev.dir === "forward" ? Math.min(2, prev.level + 1) : 0;
      jklRef.current = { dir: "forward", level };
      const rate = JKL_SPEEDS[level];
      jklPlaybackRef.current = { active: true, rate };
      video.playbackRate = rate;
      void video.play().catch(() => undefined);
    },
    applyPresetByIndex: (index) => {
      const id = presetIdAtUiIndex(index);
      if (!id) return;
      selectEmotionPreset(id);
    },
    undo: handleLocalUndo,
    getVideoFps: () => {
      const video = videoRef.current;
      if (!video) return null;
      const fps = (video as HTMLVideoElement & { videoFrameRate?: number })
        .videoFrameRate;
      return typeof fps === "number" && fps > 0 ? fps : null;
    },
  });

  return (
    <OverlayEditProvider>
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <EditorHeader
          vodId={vodId}
          candidateId={candidateId}
          editKind={editKind}
          candidate={candidate}
          clipSegmentMeta={clipSegmentMeta}
          isIsolated={isIsolated}
          clipDuration={clipDuration}
          trechoStart={start}
          trechoEnd={end}
          siblingSegmentIds={siblingSegmentIds}
          siblingIndex={siblingIndex}
          prevSiblingId={prevSiblingId}
          nextSiblingId={nextSiblingId}
          trimming={trimming}
          router={router}
          onHelpClick={() => setHelpOpen(true)}
        />

        <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />

        {candidate && (
          <p className="text-sm text-zinc-400">{candidate.reason}</p>
        )}

        <div className="flex items-start gap-4">
          {vodId && editKind && videoSrc && (
            <PreviewPanel
              vodId={vodId}
              editKind={editKind}
              videoSrc={videoSrc}
              videoRef={videoRef}
              faithfulVideoRef={faithfulVideoRef}
              start={start}
              clipOriginRef={clipOriginRef}
              clipDuration={clipDuration}
              onDurationLoaded={setDuration}
              onPlayheadUpdate={setPlayheadTime}
              onSeek={seekToClipTime}
              playheadTime={playheadTime}
              jklPlaybackRef={jklPlaybackRef}
              fastPreview={fastPreviewParams}
              faithfulPreview={faithfulPreview}
              subtitleSettings={subtitleSettings}
              previewPreparing={previewPreparing}
              onRequestFaithfulRender={() => void requestFaithfulRender()}
            />
          )}

          <EditorTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabIndicators={tabIndicators}
            tabAttention={tabAttention}
            panels={{
              cortar: (
                <div className="space-y-3">
                  <SectionFeedback
                    status={sections.cortar.status}
                    error={sections.cortar.error}
                  />
                  <TrimSection
                    material={materialInterval}
                    selection={selectionInterval}
                    displayTimes={trimDisplayTimes}
                    trimBarLayout={trimBarLayout}
                    playheadAbs={playheadAbs}
                    trimBarRef={trimBarRef}
                    onTrimBarWidthChange={setTrimBarWidthPx}
                    onTrimPointerMove={onTrimPointerMove}
                    onTrimPointerUp={onTrimPointerUp}
                    presetApplications={presetApplications}
                    dragging={dragging}
                    onHandlePointerDown={onHandlePointerDown}
                    startInput={startInput}
                    endInput={endInput}
                    startTimeError={startTimeError}
                    endTimeError={endTimeError}
                    onStartInputChange={(v) =>
                      onTimeFieldChange(
                        v,
                        setStartInput,
                        setStartTimeError,
                        (next) => {
                          const abs = start + next;
                          const clamped = Math.max(
                            start,
                            Math.min(Number(abs.toFixed(1)), selEnd - MIN_TRIM_SEGMENT_SEC)
                          );
                          setEditingSelection({
                            startSec: clamped,
                            endSec: selEnd,
                          });
                          invalidateRenderPreviews();
                        }
                      )
                    }
                    onEndInputChange={(v) =>
                      onTimeFieldChange(
                        v,
                        setEndInput,
                        setEndTimeError,
                        (next) => {
                          const abs = start + next;
                          const clamped = Math.min(
                            end,
                            Math.max(Number(abs.toFixed(1)), selStart + MIN_TRIM_SEGMENT_SEC)
                          );
                          setEditingSelection({
                            startSec: selStart,
                            endSec: clamped,
                          });
                          invalidateRenderPreviews();
                        }
                      )
                    }
                    onStartInputBlur={() => {
                      onTimeFieldBlur(
                        startInput,
                        Math.max(0, selStart - start),
                        setStartInput,
                        setStartTimeError
                      );
                      pushSelectionUndo();
                      finalizeSelection(
                        editingIntervalRef.current ?? {
                          startSec: selStartRef.current,
                          endSec: selEndRef.current,
                        }
                      );
                    }}
                    onEndInputBlur={() => {
                      onTimeFieldBlur(
                        endInput,
                        Math.max(0, selEnd - start),
                        setEndInput,
                        setEndTimeError
                      );
                      pushSelectionUndo();
                      finalizeSelection(
                        editingIntervalRef.current ?? {
                          startSec: selStartRef.current,
                          endSec: selEndRef.current,
                        }
                      );
                    }}
                    onPlayPreview={() => playPreview(selStart, selEnd)}
                    onNudgeStartMinus1={() => nudge("start", -1)}
                    onNudgeStartMinus05={() => nudge("start", -0.5)}
                    onNudgeStartPlus05={() => nudge("start", 0.5)}
                    onNudgeStartPlus1={() => nudge("start", 1)}
                    onNudgeEndMinus1={() => nudge("end", -1)}
                    onNudgeEndMinus05={() => nudge("end", -0.5)}
                    onNudgeEndPlus05={() => nudge("end", 0.5)}
                    onNudgeEndPlus1={() => nudge("end", 1)}
                    selectionPending={selectionPending}
                    onConfirmCut={requestConfirmCut}
                    onResetSelection={resetSelectionToMaterial}
                    cutBusy={trimming}
                  />
                </div>
              ),
              legendas: (
                <div className="space-y-3">
                  <SectionFeedback
                    status={sections.legendas.status}
                    error={sections.legendas.error}
                  />
                  <TranscriptSection
          busy={busy || previewPreparing}
          onTranscribe={() => void onTranscribe()}
          transcript={transcript}
          transcriptDirty={transcriptDirty}
          onSaveTranscript={() => void onSaveTranscript()}
          candidate={candidate}
          segmentTexts={segmentTexts}
          onSegmentTextChange={(index, value) => {
            setSegmentTexts((prev) => {
              const next = [...prev];
              next[index] = value;
              return next;
            });
            invalidateRenderPreviews();
          }}
          segmentHighlights={segmentHighlights}
          onToggleWordHighlight={(segIdx, wordIdx) => {
            setSegmentHighlights((prev) => {
              const next = prev.map((row) => [...row]);
              const row = new Set(next[segIdx] ?? []);
              if (row.has(wordIdx)) row.delete(wordIdx);
              else row.add(wordIdx);
              next[segIdx] = [...row].sort((a, b) => a - b);
              return next;
            });
            invalidateRenderPreviews();
          }}
          subtitleSettings={subtitleSettings}
          onSubtitleSettingsChange={(s) => {
            setSubtitleSettings(s);
            invalidateRenderPreviews();
          }}
          onResyncSegment={(i) => void onResyncSegment(i)}
          resyncingIndex={resyncingIndex}
          glossaryEntries={glossaryEntries}
          onGlossaryChange={setGlossaryEntries}
          onSaveGlossary={() => void onSaveGlossary()}
          onOfferGlossary={(from, to) => {
            setGlossaryEntries((prev) => {
              if (
                prev.some(
                  (e) =>
                    e.from.toLowerCase() === from.toLowerCase() &&
                    e.to.toLowerCase() === to.toLowerCase()
                )
              ) {
                return prev;
              }
              return [...prev, { from, to }];
            });
            void onSaveGlossary();
          }}
          pendingGlossaryOffer={pendingGlossaryOffer}
          onDismissGlossaryOffer={() => setPendingGlossaryOffer(null)}
          useSubtitles={useSubtitles}
          onUseSubtitlesChange={(v) => {
            setUseSubtitles(v);
            invalidateRenderPreviews();
          }}
          subtitleFullClip={subtitleFullClip}
          onSubtitleFullClip={() => {
            setSubtitleFullClip(true);
            setSubStart(0);
            setSubEnd(Number(clipDuration.toFixed(1)));
            setSubStartInput(formatTime(0));
            setSubEndInput(formatTime(clipDuration));
            invalidateRenderPreviews();
          }}
          onSubtitleSubset={() => {
            setSubtitleFullClip(false);
            invalidateRenderPreviews();
          }}
          clipDuration={clipDuration}
          subStartInput={subStartInput}
          subEndInput={subEndInput}
          subStartError={subStartError}
          subEndError={subEndError}
          onSubStartInputChange={(v) =>
            onTimeFieldChange(
              v,
              setSubStartInput,
              setSubStartError,
              (next) => {
                const clamped = Math.max(
                  0,
                  Math.min(Number(next.toFixed(3)), clipDuration)
                );
                setSubStart(clamped);
                invalidateRenderPreviews();
              }
            )
          }
          onSubEndInputChange={(v) =>
            onTimeFieldChange(
              v,
              setSubEndInput,
              setSubEndError,
              (next) => {
                const clamped = Math.max(
                  0,
                  Math.min(Number(next.toFixed(3)), clipDuration)
                );
                setSubEnd(clamped);
                invalidateRenderPreviews();
              }
            )
          }
          onSubStartBlur={() =>
            onTimeFieldBlur(
              subStartInput,
              subStart,
              setSubStartInput,
              setSubStartError
            )
          }
          onSubEndBlur={() =>
            onTimeFieldBlur(
              subEndInput,
              subEnd,
              setSubEndInput,
              setSubEndError
            )
          }
                  />
                </div>
              ),
              momentos: (
                <EmotionPresetSection
                  busy={busy || previewPreparing}
                  presetPreviewLoading={presetPreviewLoading}
                  applications={presetApplications}
                  selectedApplicationId={selectedApplicationId}
                  onSelectEmotionPreset={selectEmotionPreset}
                  onSelectApplication={(id) => {
                    setSelectedApplicationId(id);
                    setTimelineSelection({ kind: "preset", id });
                  }}
                  onRemoveApplication={(id) => void removeApplication(id)}
                  onUpdateApplication={(id, patch) => {
                    if (
                      patch.inicio != null ||
                      patch.duracao != null
                    ) {
                      const app = presetApplications.find((a) => a.id === id);
                      if (!app) return;
                      const inicio = patch.inicio ?? app.inicio;
                      const duracao = patch.duracao ?? app.duracao;
                      const clamped = clampApplicationTiming(
                        inicio,
                        duracao,
                        clipDuration
                      );
                      if (!clamped.valid) {
                        setSectionError(
                          "momentos",
                          PRESET_INSUFFICIENT_SPACE_MESSAGE
                        );
                        return;
                      }
                      if (
                        applicationOverlapsAny(
                          {
                            inicio: clamped.inicio,
                            duracao: clamped.duracao,
                          },
                          presetApplications,
                          id
                        )
                      ) {
                        patchSection("momentos", {
                          error:
                            "Não é possível sobrepor aplicações de preset.",
                          status: "",
                        });
                        return;
                      }
                      pushUndoBeforeAction();
                      updateApplication(id, {
                        ...patch,
                        inicio: clamped.inicio,
                        duracao: clamped.duracao,
                      });
                      return;
                    }
                    pushUndoBeforeAction();
                    updateApplication(id, patch);
                  }}
                  onToggleLibraryItem={(appId, item, checked) =>
                    void toggleLibraryItemForApplication(appId, item, checked)
                  }
                  clipDuration={clipDuration}
                  onGeneratePresetPreview={() => void generatePresetPreview()}
                  presetSummary={presetSummary}
                  presetPreviewCached={presetPreviewCached}
                  presetPreviewUrl={presetPreviewUrl}
                  presetPreviewVideoRef={presetPreviewVideoRef}
                  onEmotionIntensityCommit={(appId, value) => {
                    pushUndoBeforeAction();
                    updateApplication(appId, { intensidade: value });
                  }}
                  onSpeedCommit={(appId, value) => {
                    pushUndoBeforeAction();
                    updateApplication(appId, { speedRamp: [] });
                  }}
                  getPlayheadTime={() => playheadTime}
                  status={sections.momentos.status}
                  error={sections.momentos.error}
                />
              ),
              efeitos: candidateId ? (
                <LibraryEffectsPanel
                  candidateId={candidateId}
                  clipDuration={clipDuration}
                  getPlayheadTime={() => playheadTime}
                  disabled={busy}
                  appliedEffects={appliedEffects}
                  onAppliedEffectsChange={handleAppliedEffectsChange}
                  onBeforeApply={pushUndoBeforeAction}
                  onBeforeRemove={pushUndoBeforeAction}
                  onStatus={handleEfeitosStatus}
                  onError={handleEfeitosError}
                  status={sections.efeitos.status}
                  error={sections.efeitos.error}
                />
              ) : (
                <p className="text-sm text-zinc-500">Carregando…</p>
              ),
              ajuste_fino: (
                <div className="space-y-3">
                  <SectionFeedback
                    status={sections.ajuste_fino.status}
                    error={sections.ajuste_fino.error}
                  />
                  {presetApplications.length > 0 ? (
                    <p className="text-sm text-zinc-400">
                      Com aplicações de preset ativas, o ajuste fino de cor, zoom
                      e velocidade fica dentro de cada aplicação na aba momentos.
                    </p>
                  ) : (
                    <AdvancedOptions
                      speed={draftSpeed ?? speed}
                      onSpeedPreviewChange={handleSpeedPreview}
                      onSpeedCommit={handleSpeedCommit}
                      speedRamp={speedRamp}
                      colorPreset={colorPreset}
                      onColorPresetChange={handleColorPresetChange}
                      zoomKeyframes={zoomKeyframes}
                      onZoomKeyframesChange={handleZoomKeyframesChange}
                    />
                  )}
                </div>
              ),
            }}
          />
        </div>

        <TimelineTracks
          clipDuration={clipDuration}
          playheadTime={playheadTime}
          onSeek={seekToClipTime}
          transcript={transcript}
          presetApplications={presetApplications}
          appliedEffects={appliedEffects}
          selection={timelineSelection}
          onSelectPreset={(id) => {
            setTimelineSelection({ kind: "preset", id });
            setSelectedApplicationId(id);
            setActiveTab("momentos");
          }}
          onSelectEffect={(id) => {
            setTimelineSelection({ kind: "effect", id });
            setActiveTab("efeitos");
          }}
          onPresetChange={onTimelinePresetChange}
          onPresetDragStart={pushUndoBeforeAction}
          onPresetDragEnd={() => undefined}
          onEffectChange={onTimelineEffectChange}
          onEffectDragStart={pushUndoBeforeAction}
          onEffectDragEnd={(id) => void onTimelineEffectDragEnd(id)}
        />

        <section className="space-y-3 rounded border border-zinc-800 bg-zinc-900/60 p-4">
          <SectionFeedback
            status={sections.acoes.status}
            error={sections.acoes.error}
          />
          {previewPreparing && (
            <p className="text-sm text-amber-300">
              Preparando trecho — exportar e render ficam indisponíveis até concluir.
            </p>
          )}
          <ExportOptions
            layouts={layouts}
            layoutPresetId={layoutPresetId}
            onLayoutPresetIdChange={setLayoutPresetId}
            quality={quality}
            onQualityChange={setQuality}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || previewPreparing}
              onClick={() => void onExport()}
              className="rounded bg-amber-600 px-4 py-2 text-sm font-medium hover:bg-amber-500 disabled:opacity-50"
            >
              {previewPreparing
                ? "Preparando trecho…"
                : busy
                  ? "Aguarde…"
                  : "Exportar"}
            </button>
            {editKind === "candidate" && (
              <button
                type="button"
                disabled={busy || previewPreparing || !vodId || !candidateId}
                onClick={() => {
                  void onSendToEdit();
                }}
                className="rounded border border-sky-600 bg-sky-950/60 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-900/80 disabled:opacity-50"
              >
                {previewPreparing
                  ? "Preparando trecho…"
                  : "Enviar para edição de trecho"}
              </button>
            )}
          </div>
          {editKind === "clip_segment" && (
            <ReusableSection
              busy={busy}
              showReusableForm={showReusableForm}
              clipSegmentMeta={clipSegmentMeta}
              reusableNameDraft={reusableNameDraft}
              reusableTagsDraft={reusableTagsDraft}
              onReusableNameDraftChange={setReusableNameDraft}
              onReusableTagsDraftChange={setReusableTagsDraft}
              onReusableCheckboxChange={(checked) => {
                if (checked) {
                  setShowReusableForm(true);
                  if (clipSegmentMeta?.isReusable) return;
                } else if (clipSegmentMeta?.isReusable) {
                  void onApplyReusable(false);
                } else {
                  setShowReusableForm(false);
                }
              }}
              onApplyReusable={() => void onApplyReusable(true)}
            />
          )}
          {sentSegmentId && (
            <p className="text-sm text-sky-300">
              Enviado para edição.{" "}
              <Link
                href={`/vod/${vodId}/segments`}
                className="underline hover:text-sky-200"
              >
                Abrir gaveta de trabalho
              </Link>
            </p>
          )}
          {exportResultUrl && (
            <ExportResult exportResultUrl={exportResultUrl} />
          )}
        </section>
      </div>
    </div>
    </OverlayEditProvider>
  );
}
