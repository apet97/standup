import { createLogger } from './logger';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const log = createLogger('metrics');

// --- Simple Prometheus-compatible metrics ---

interface CounterData {
  values: Map<string, number>;
  help: string;
}

interface GaugeData {
  fn: () => number;
  help: string;
}

interface HistogramData {
  buckets: number[];
  counts: Map<string, number[]>;
  sums: Map<string, number>;
  totals: Map<string, number>;
  help: string;
}

const counters = new Map<string, CounterData>();
const gauges = new Map<string, GaugeData>();
const histograms = new Map<string, HistogramData>();

// --- Counter ---

export function defineCounter(name: string, help: string): void {
  counters.set(name, { values: new Map(), help });
}

export function incCounter(name: string, labels: Record<string, string> = {}): void {
  const counter = counters.get(name);
  if (!counter) return;
  const key = labelsToKey(labels);
  counter.values.set(key, (counter.values.get(key) ?? 0) + 1);
}

// --- Gauge ---

export function defineGauge(name: string, help: string, fn: () => number): void {
  gauges.set(name, { fn, help });
}

// --- Histogram ---

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function defineHistogram(
  name: string,
  help: string,
  buckets: number[] = DEFAULT_BUCKETS,
): void {
  histograms.set(name, {
    buckets: [...buckets].sort((a, b) => a - b),
    counts: new Map(),
    sums: new Map(),
    totals: new Map(),
    help,
  });
}

export function observeHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  const h = histograms.get(name);
  if (!h) return;
  const key = labelsToKey(labels);
  if (!h.counts.has(key)) {
    h.counts.set(key, new Array(h.buckets.length).fill(0) as number[]);
    h.sums.set(key, 0);
    h.totals.set(key, 0);
  }
  const bucketCounts = h.counts.get(key)!;
  for (let i = 0; i < h.buckets.length; i++) {
    if (value <= h.buckets[i]!) {
      bucketCounts[i]!++;
    }
  }
  h.sums.set(key, (h.sums.get(key) ?? 0) + value);
  h.totals.set(key, (h.totals.get(key) ?? 0) + 1);
}

// --- Event loop lag monitoring ---

let eventLoopHistogram: IntervalHistogram | null = null;

export function startEventLoopMonitoring(): void {
  try {
    eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
    eventLoopHistogram.enable();
    log.info('Event loop delay monitoring started');
  } catch (error) {
    log.warn({ err: error }, 'Failed to start event loop monitoring');
  }
}

// --- Serialization ---

function labelsToKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}

export function serializeMetrics(): string {
  const lines: string[] = [];

  // Counters
  for (const [name, counter] of counters) {
    lines.push(`# HELP ${name} ${counter.help}`);
    lines.push(`# TYPE ${name} counter`);
    if (counter.values.size === 0) {
      lines.push(`${name} 0`);
    }
    for (const [key, val] of counter.values) {
      lines.push(`${name}${key} ${val}`);
    }
  }

  // Gauges
  for (const [name, gauge] of gauges) {
    lines.push(`# HELP ${name} ${gauge.help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${gauge.fn()}`);
  }

  // Histograms
  for (const [name, h] of histograms) {
    lines.push(`# HELP ${name} ${h.help}`);
    lines.push(`# TYPE ${name} histogram`);
    if (h.counts.size === 0) {
      // Emit zero-value histogram
      for (const bucket of h.buckets) {
        lines.push(`${name}_bucket{le="${bucket}"} 0`);
      }
      lines.push(`${name}_bucket{le="+Inf"} 0`);
      lines.push(`${name}_sum 0`);
      lines.push(`${name}_count 0`);
    }
    for (const [key, bucketCounts] of h.counts) {
      const labelsPrefix = key ? key.slice(0, -1) + ',' : '{';
      for (let i = 0; i < h.buckets.length; i++) {
        lines.push(`${name}_bucket${labelsPrefix}le="${h.buckets[i]}"}  ${bucketCounts[i]}`);
      }
      lines.push(`${name}_bucket${labelsPrefix}le="+Inf"} ${h.totals.get(key) ?? 0}`);
      lines.push(`${name}_sum${key} ${h.sums.get(key) ?? 0}`);
      lines.push(`${name}_count${key} ${h.totals.get(key) ?? 0}`);
    }
  }

  // Process metrics
  const mem = process.memoryUsage();
  lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${mem.rss}`);

  lines.push('# HELP process_heap_bytes_used Node.js heap used size in bytes.');
  lines.push('# TYPE process_heap_bytes_used gauge');
  lines.push(`process_heap_bytes_used ${mem.heapUsed}`);

  lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.floor(process.uptime())}`);

  // Event loop delay
  if (eventLoopHistogram) {
    lines.push('# HELP nodejs_eventloop_lag_seconds Event loop lag in seconds.');
    lines.push('# TYPE nodejs_eventloop_lag_seconds gauge');
    lines.push(`nodejs_eventloop_lag_seconds ${(eventLoopHistogram.mean / 1e9).toFixed(6)}`);
    lines.push('# HELP nodejs_eventloop_lag_p99_seconds Event loop lag p99 in seconds.');
    lines.push('# TYPE nodejs_eventloop_lag_p99_seconds gauge');
    lines.push(`nodejs_eventloop_lag_p99_seconds ${(eventLoopHistogram.percentile(99) / 1e9).toFixed(6)}`);
  }

  return lines.join('\n') + '\n';
}
