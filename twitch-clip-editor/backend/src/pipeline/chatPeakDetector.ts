export type ChatMessage = {
  timestamp: number; // seconds from VOD start
  message: string;
};

export type PeakCandidate = {
  start: number;
  end: number;
  score: number;
  sampleMessages: string[];
  /**
   * Acoustic: laughter | energy | both
   * Semantic scan (+ optional acoustic reinforce): semantic | semantic+*
   */
  source?:
    | "laughter"
    | "energy"
    | "both"
    | "semantic"
    | "semantic+laughter"
    | "semantic+energy"
    | "semantic+both";
};

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Statistical chat peak detector: windowed message counts → z-score → top K.
 */
export function detectChatPeaks(
  chatLog: ChatMessage[],
  options?: {
    windowSeconds?: number;
    topK?: number;
    vodDurationSeconds?: number;
  }
): PeakCandidate[] {
  const windowSeconds = options?.windowSeconds ?? 15;
  const topK = options?.topK ?? 15;

  if (chatLog.length === 0) return [];

  const maxTs = Math.max(
    ...chatLog.map((m) => m.timestamp),
    options?.vodDurationSeconds ?? 0
  );
  const windowCount = Math.max(1, Math.ceil(maxTs / windowSeconds));

  const counts = new Array<number>(windowCount).fill(0);
  const messagesByWindow: string[][] = Array.from(
    { length: windowCount },
    () => []
  );

  for (const msg of chatLog) {
    const idx = Math.min(
      windowCount - 1,
      Math.max(0, Math.floor(msg.timestamp / windowSeconds))
    );
    counts[idx] += 1;
    if (messagesByWindow[idx].length < 5) {
      messagesByWindow[idx].push(msg.message);
    }
  }

  const avg = mean(counts);
  const sd = stdDev(counts, avg);

  const scored: PeakCandidate[] = counts.map((count, i) => {
    const z = sd === 0 ? 0 : (count - avg) / sd;
    return {
      start: i * windowSeconds,
      end: Math.min((i + 1) * windowSeconds, maxTs || (i + 1) * windowSeconds),
      score: z,
      sampleMessages: messagesByWindow[i],
    };
  });

  return scored
    .filter((c) => c.score > 0 || counts.length <= topK)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
