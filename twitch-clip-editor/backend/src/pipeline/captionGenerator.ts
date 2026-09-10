import fs from "fs/promises";
import path from "path";
import type {
  SubtitleSettings,
  Transcript,
} from "../services/transcribeService";
import { DEFAULT_SUBTITLE_SETTINGS } from "../services/transcribeService";
import {
  getLayoutPreset,
  type LayoutPreset,
} from "./layoutPresets";

import {
  enforceWordGap,
  gapConfigFromSettings,
  nextSpeechStart,
  segmentClassicVisibleEnd,
  segmentSpeechStart,
  wordVisibleEnd,
  windowWordRange,
} from "./subtitleTiming";

const CAPTION_FONT_NAME = "Anton";
const ANTON_AVG_CHAR_WIDTH_FACTOR = 0.55;

export function getCaptionFontsDir(): string {
  return path.resolve(__dirname, "..", "..", "assets", "fonts");
}

function formatAssTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

type Word = { word: string; start: number; end: number; highlight?: boolean };

function hexToAssBgr(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

function collectSegmentWords(
  seg: Transcript["segments"][0],
  clipStart: number,
  clipEnd: number,
  keepAbsoluteTimes: boolean
): Word[] {
  const highlights = new Set(seg.highlightedWordIndices ?? []);
  const segWords = seg.words ?? [];
  if (segWords.length === 0) {
    const text = seg.text.trim();
    if (!text) return [];
    return [
      {
        word: text,
        start: keepAbsoluteTimes
          ? Math.max(0, seg.start)
          : Math.max(0, seg.start - clipStart),
        end: keepAbsoluteTimes
          ? Math.max(0, seg.end)
          : Math.max(0, seg.end - clipStart),
      },
    ];
  }
  const out: Word[] = [];
  segWords.forEach((w, wi) => {
    if (w.end < clipStart || w.start > clipEnd) return;
    out.push({
      word: w.word.trim(),
      start: keepAbsoluteTimes
        ? Math.max(0, w.start)
        : Math.max(0, w.start - clipStart),
      end: keepAbsoluteTimes
        ? Math.max(0, w.end)
        : Math.max(0, w.end - clipStart),
      highlight: highlights.has(wi),
    });
  });
  return out.filter((w) => w.word.length > 0);
}

function collectWords(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number,
  keepAbsoluteTimes = false
): Word[] {
  const words: Word[] = [];
  for (const seg of transcript.segments) {
    if (seg.end < clipStart || seg.start > clipEnd) continue;
    words.push(...collectSegmentWords(seg, clipStart, clipEnd, keepAbsoluteTimes));
  }
  return words;
}

function displayToken(word: string, uppercase: boolean): string {
  const t = word.replace(/\s+/g, " ").trim();
  return uppercase ? t.toUpperCase() : t;
}

function estimateTextWidth(text: string, fontSize: number): number {
  const plain = text.replace(/\{[^}]*\}/g, "");
  return plain.length * fontSize * ANTON_AVG_CHAR_WIDTH_FACTOR;
}

function fitFontSize(baseSize: number, text: string, maxWidth: number): number {
  const estimated = estimateTextWidth(text, baseSize);
  if (estimated <= maxWidth) return baseSize;
  return Math.max(48, Math.floor(baseSize * (maxWidth / estimated)));
}

function captionMarginV(playResY: number, positionPercent: number): number {
  const baselineFromTop = (positionPercent / 100) * playResY;
  return Math.max(24, Math.round(playResY - baselineFromTop));
}

function centiseconds(durationSec: number): number {
  return Math.max(5, Math.round(durationSec * 100));
}

function buildClassicEvents(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number,
  mapT: (t: number) => number,
  settings: SubtitleSettings
): string[] {
  const events: string[] = [];
  const gapConfig = gapConfigFromSettings(settings);
  const relSegments = transcript.segments
    .filter((seg) => !(seg.end < clipStart || seg.start > clipEnd))
    .map((seg) => ({
      start: Math.max(0, seg.start - clipStart),
      end: Math.max(0, seg.end - clipStart),
      text: seg.text,
      words: (seg.words ?? []).map((w) => ({
        word: w.word,
        start: Math.max(0, w.start - clipStart),
        end: Math.max(0, w.end - clipStart),
      })),
    }));

  for (let si = 0; si < relSegments.length; si++) {
    const seg = relSegments[si];
    const text = displayToken(seg.text.trim(), settings.uppercase);
    if (!text) continue;
    const lineStart = mapT(segmentSpeechStart(seg));
    const lineEnd = mapT(
      segmentClassicVisibleEnd(seg, nextSpeechStart(relSegments, si), gapConfig)
    );
    events.push(
      `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Default,,0,0,0,,${text}`
    );
  }
  return events;
}

function buildKaraokeLine(
  group: Word[],
  activeIdx: number,
  settings: SubtitleSettings,
  primary: string,
  highlight: string,
  customHighlight: string
): string {
  const parts: string[] = [];
  for (let i = 0; i < group.length; i++) {
    const w = group[i];
    const dur = centiseconds(Math.max(0.05, w.end - w.start));
    const token = displayToken(w.word, settings.uppercase);
    const isActive = i === activeIdx;
    const isCustom = w.highlight === true;
    const color = isCustom ? customHighlight : isActive ? highlight : primary;
    if (settings.style === "active_word") {
      // Sliding window: only the active word uses \k; others stay static to avoid
      // re-sweeping prior words each time the window advances.
      if (isActive) {
        parts.push(`{\\c${color}&\\k${dur}}${token}{\\r}`);
      } else if (i < activeIdx) {
        parts.push(`{\\c${primary}&\\k0}${token}`);
      } else {
        parts.push(`{\\c${primary}&}${token}`);
      }
    } else if (settings.style === "block_highlight" && isActive) {
      parts.push(`{\\fscx108\\fscy108\\c${color}&\\k${dur}}${token}{\\r}`);
    } else if (settings.style === "one_at_a_time" && isActive) {
      parts.push(`{\\fscx112\\fscy112\\c${color}&\\k${dur}}${token}{\\r}`);
    } else if (settings.style === "one_at_a_time") {
      parts.push(`{\\c${primary}&}${token}`);
    } else {
      parts.push(`{\\c${color}&\\k${dur}}${token}`);
    }
  }
  return parts.join(" ");
}

function buildAnimatedEvents(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number,
  mapT: (t: number) => number,
  settings: SubtitleSettings,
  playResX: number,
  primary: string,
  highlight: string,
  customHighlight: string
): string[] {
  const events: string[] = [];
  const gapConfig = gapConfigFromSettings(settings);

  for (const seg of transcript.segments) {
    if (seg.end < clipStart || seg.start > clipEnd) continue;
    const timed = enforceWordGap(
      collectSegmentWords(seg, clipStart, clipEnd, false)
    );
    for (let i = 0; i < timed.length; i++) {
      const current = timed[i];
      const range = windowWordRange(timed.length, i, settings.style);
      const group = timed.slice(range.start, range.end);
      const activeIdx = group.findIndex((w) => w === current);
      const lineStart = mapT(current.start);
      const lineEnd = mapT(wordVisibleEnd(timed, i, gapConfig));
      const plain = group
        .map((w) => displayToken(w.word, settings.uppercase))
        .join(" ");
      const fs = fitFontSize(settings.fontSize, plain, playResX * 0.9);
      const text = buildKaraokeLine(
        group,
        activeIdx,
        { ...settings, fontSize: fs },
        primary,
        highlight,
        customHighlight
      );
      events.push(
        `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Default,,0,0,0,,${text}`
      );
    }
  }
  return events;
}

export function generateAssContent(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number,
  playResX: number,
  playResY: number,
  preset?: LayoutPreset,
  options?: {
    keepAbsoluteTimes?: boolean;
    timeScale?: number;
    remapTime?: (t: number) => number;
    subtitleSettings?: SubtitleSettings;
  }
): string {
  const settings: SubtitleSettings = {
    ...DEFAULT_SUBTITLE_SETTINGS,
    ...options?.subtitleSettings,
    ...transcript.subtitle,
  };
  const words = collectWords(
    transcript,
    clipStart,
    clipEnd,
    options?.keepAbsoluteTimes === true
  );
  const timeScale =
    typeof options?.timeScale === "number" && options.timeScale > 0
      ? options.timeScale
      : 1;
  const remapTime = options?.remapTime;
  const mapT = (t: number) => (remapTime ? remapTime(t) : t * timeScale);

  const primary = hexToAssBgr("#FFFFFF");
  const highlight = hexToAssBgr(settings.highlightColor);
  const customHighlight = hexToAssBgr(settings.highlightColor);
  const marginV = captionMarginV(playResY, settings.positionPercent);
  let fontSize = settings.fontSize;
  const maxTextWidth = playResX * 0.9;

  if (words.length > 0 && settings.style !== "classic") {
    const widest = words
      .map((w) => displayToken(w.word, settings.uppercase))
      .sort((a, b) => b.length - a.length)[0];
    fontSize = fitFontSize(fontSize, widest ?? "", maxTextWidth);
  }

  const header = `[Script Info]
Title: Twitch Clip Captions
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${CAPTION_FONT_NAME},${fontSize},${primary},${highlight},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${settings.outlineWidth},0,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  if (words.length === 0 && settings.style !== "classic") {
    return header;
  }

  const events =
    settings.style === "classic"
      ? buildClassicEvents(transcript, clipStart, clipEnd, mapT, settings)
      : buildAnimatedEvents(
          transcript,
          clipStart,
          clipEnd,
          mapT,
          settings,
          playResX,
          primary,
          highlight,
          customHighlight
        );

  return header + events.join("\n") + "\n";
}

export async function writeClipCaptions(options: {
  transcriptPath: string;
  clipStart: number;
  clipEnd: number;
  layoutPresetId: string;
  outputAssPath: string;
  playResOverride?: { w: number; h: number };
  keepAbsoluteTimes?: boolean;
  timeScale?: number;
  remapTime?: (t: number) => number;
  subtitleSettings?: SubtitleSettings;
  transcriptOverride?: Transcript;
}): Promise<string> {
  const transcript =
    options.transcriptOverride ??
    (JSON.parse(
      await fs.readFile(options.transcriptPath, "utf-8")
    ) as Transcript);
  const preset = getLayoutPreset(options.layoutPresetId);
  const playResX =
    options.playResOverride?.w ?? preset?.outputResolution.w ?? 1080;
  const playResY =
    options.playResOverride?.h ?? preset?.outputResolution.h ?? 1920;

  const content = generateAssContent(
    transcript,
    options.clipStart,
    options.clipEnd,
    playResX,
    playResY,
    preset,
    {
      keepAbsoluteTimes: options.keepAbsoluteTimes,
      timeScale: options.timeScale,
      remapTime: options.remapTime,
      subtitleSettings: options.subtitleSettings ?? transcript.subtitle,
    }
  );

  await fs.mkdir(path.dirname(options.outputAssPath), { recursive: true });
  await fs.writeFile(options.outputAssPath, content, "utf-8");
  return options.outputAssPath;
}
