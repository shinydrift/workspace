export interface TimelineSource {
  id: string;
  createdAt: number;
  durationSeconds: number;
}

export interface TimelineClip<T extends TimelineSource = TimelineSource> {
  source: T;
  /** Wall-clock position in the displayed selection, in seconds. */
  from: number;
  to: number;
  /** Offset into the underlying audio file. */
  sourceOffset: number;
}

/** Clip recordings to a wall-clock selection. Overlaps are assigned to the earliest clip. */
export function buildTimelineClips<T extends TimelineSource>(
  sources: T[],
  fromMs: number,
  toMs: number
): TimelineClip<T>[] {
  const result: TimelineClip<T>[] = [];
  let coveredUntil = fromMs;
  for (const source of [...sources].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const sourceEnd = source.createdAt + Math.max(0, source.durationSeconds) * 1000;
    const start = Math.max(fromMs, source.createdAt, coveredUntil);
    const end = Math.min(toMs, sourceEnd);
    if (end <= start) continue;
    result.push({
      source,
      from: (start - fromMs) / 1000,
      to: (end - fromMs) / 1000,
      sourceOffset: (start - source.createdAt) / 1000,
    });
    coveredUntil = end;
  }
  return result;
}

/** Resolve a wall-clock seek. Positions in gaps advance to the next available clip. */
export function resolveTimelineTime<T extends TimelineSource>(clips: TimelineClip<T>[], time: number) {
  const clip = clips.find((item) => time >= item.from && time < item.to) ?? clips.find((item) => item.from > time);
  if (!clip) return null;
  const wallTime = Math.max(time, clip.from);
  return { clip, wallTime, sourceTime: clip.sourceOffset + (wallTime - clip.from) };
}

/** Peak envelope for a channel. Each bucket is the maximum absolute PCM sample. */
export function downsamplePeaks(samples: Float32Array, buckets: number): number[] {
  if (buckets <= 0 || samples.length === 0) return [];
  const result: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor((bucket * samples.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((bucket + 1) * samples.length) / buckets));
    let peak = 0;
    for (let index = from; index < Math.min(to, samples.length); index += 1) {
      peak = Math.max(peak, Math.abs(samples[index]));
    }
    result.push(Math.min(1, peak));
  }
  return result;
}

export function audioBufferPeaks(buffer: AudioBuffer, buckets = 160): number[] {
  if (!buffer.numberOfChannels) return [];
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    downsamplePeaks(buffer.getChannelData(index), buckets)
  );
  return Array.from({ length: buckets }, (_, index) => Math.max(...channels.map((channel) => channel[index] ?? 0)));
}
