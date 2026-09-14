export interface LatencySample {
  sttMs?: number;
  llmMs?: number;
  ttsFirstAudioMs?: number;
  ttsTotalMs?: number;
  totalMs?: number;
}

export interface PercentileStats { median: number; p95: number; }

export interface MetricsSummary {
  stt: PercentileStats | null;
  llm: PercentileStats | null;
  ttsFirstAudio: PercentileStats | null;
  total: PercentileStats | null;
  errorCounts: Record<string, number>;
  jsonValidRate: number | null;
}

function isNumber(x: number | undefined): x is number {
  return typeof x === "number";
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function percentileStats(values: number[]): PercentileStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

export class MetricsCollector {
  private samples: LatencySample[] = [];
  private errorCounts: Record<string, number> = {};
  private jsonValidCount = 0;
  private jsonInvalidCount = 0;

  recordTurnLatency(sample: LatencySample): void {
    this.samples.push(sample);
  }

  recordError(agent: string): void {
    this.errorCounts[agent] = (this.errorCounts[agent] ?? 0) + 1;
  }

  recordJsonOutcome(valid: boolean): void {
    if (valid) this.jsonValidCount += 1;
    else this.jsonInvalidCount += 1;
  }

  summary(): MetricsSummary {
    const total = this.jsonValidCount + this.jsonInvalidCount;
    return {
      stt: percentileStats(this.samples.map((s) => s.sttMs).filter(isNumber)),
      llm: percentileStats(this.samples.map((s) => s.llmMs).filter(isNumber)),
      ttsFirstAudio: percentileStats(this.samples.map((s) => s.ttsFirstAudioMs).filter(isNumber)),
      total: percentileStats(this.samples.map((s) => s.totalMs).filter(isNumber)),
      errorCounts: { ...this.errorCounts },
      jsonValidRate: total === 0 ? null : this.jsonValidCount / total,
    };
  }
}
