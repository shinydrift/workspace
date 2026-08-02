import { describe, expect, it } from 'vitest';
import { buildTimelineClips, downsamplePeaks, resolveTimelineTime } from '../../src/renderer/components/meetings/audioTimeline';

const source = (id: string, createdAt: number, durationSeconds: number) => ({ id, createdAt, durationSeconds });

describe('audio timeline', () => {
  it('clips sources to selection boundaries and retains source offsets', () => {
    expect(buildTimelineClips([source('a', 0, 10)], 2_000, 8_000)).toEqual([
      { source: source('a', 0, 10), from: 0, to: 6, sourceOffset: 2 },
    ]);
  });

  it('preserves wall-clock gaps and resolves a gap to the next audio', () => {
    const clips = buildTimelineClips([source('a', 0, 2), source('b', 5_000, 2)], 0, 10_000);
    expect(clips.map(({ from, to }) => [from, to])).toEqual([[0, 2], [5, 7]]);
    expect(resolveTimelineTime(clips, 3)).toMatchObject({ wallTime: 5, sourceTime: 0 });
  });

  it('deduplicates overlaps in deterministic source order', () => {
    const clips = buildTimelineClips([source('b', 2_000, 4), source('a', 0, 4)], 0, 10_000);
    expect(clips.map((clip) => [clip.source.id, clip.from, clip.to, clip.sourceOffset])).toEqual([
      ['a', 0, 4, 0], ['b', 4, 6, 2],
    ]);
  });

  it('ignores empty, negative, and out-of-window sources', () => {
    expect(buildTimelineClips([source('bad', 0, -1), source('late', 20_000, 2)], 0, 10_000)).toEqual([]);
  });

  it('returns null after the last available clip', () => {
    const clips = buildTimelineClips([source('a', 0, 1)], 0, 2_000);
    expect(resolveTimelineTime(clips, 2)).toBeNull();
  });

  it('downsamples real PCM amplitudes by maximum absolute sample', () => {
    expect(downsamplePeaks(new Float32Array([0.1, -0.8, 0.25, -0.5]), 2)).toEqual([expect.closeTo(0.8), 0.5]);
  });

  it('handles more peak buckets than samples and empty audio', () => {
    expect(downsamplePeaks(new Float32Array([0.25]), 3)).toEqual([0.25, 0.25, 0.25]);
    expect(downsamplePeaks(new Float32Array(), 4)).toEqual([]);
  });
});
