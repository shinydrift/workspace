/**
 * Placement gestures on the meeting picker. Recorded stretches are shading, not controls — a click
 * anywhere, captured audio included, drops a 30-minute slot snapped to 5-minute marks at that time,
 * and only a double-click takes the whole stretch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SegmentTimeline } from '../../../../src/renderer/components/meetings/SegmentTimeline';
import type { RecordingRecord, SavedProject } from '../../../../src/shared/types';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const WINDOW_MS = 7 * 24 * HOUR;
const TIMELINE_HEIGHT = (WINDOW_MS / HOUR) * 48; // Mirrors the component's 48px-per-hour grid.

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
// One two-hour recorded stretch, ending three hours ago.
const STRETCH_TO = NOW - 3 * HOUR;
const STRETCH_FROM = STRETCH_TO - 2 * HOUR;
const MID = STRETCH_FROM + HOUR;

const project: SavedProject = { id: 'p1', name: 'Demo', path: '/tmp/demo' } as SavedProject;

const stretch: RecordingRecord = {
  id: 'r1',
  threadId: null,
  title: null,
  audioPath: '/tmp/r1.wav',
  transcriptPath: '/tmp/r1.txt',
  durationSeconds: (STRETCH_TO - STRETCH_FROM) / 1000,
  createdAt: STRETCH_FROM,
  kind: 'segment',
};

// The clock label the picker puts on a handle, formatted the same way it does.
function clockOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Newest-first axis: the top of the track is now, the bottom is the far edge of the window.
function yOf(ts: number): number {
  return ((NOW - ts) / WINDOW_MS) * TIMELINE_HEIGHT;
}

async function openPicker(): Promise<HTMLElement> {
  render(<SegmentTimeline defaultProject={project} active />);
  fireEvent.click(screen.getByRole('button', { name: 'New meeting' }));
  const track = await screen.findByRole('group', { name: /Timeline/ });
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: TIMELINE_HEIGHT,
    height: TIMELINE_HEIGHT,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return track;
}

// A press and release at one time, the way a plain click arrives.
function clickAt(target: HTMLElement, ts: number) {
  fireEvent.pointerDown(target, { button: 0, buttons: 1, clientY: yOf(ts) });
  fireEvent.pointerUp(window, { clientY: yOf(ts) });
}

// The shading drawn over captured audio. jsdom has no layout, so a press "on a stretch" means a
// press dispatched at the shading — which must bubble to the track rather than being handled there.
function bandIn(track: HTMLElement): HTMLElement {
  const bands = Array.from(track.querySelectorAll('*')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.className.includes('bg-blue-400/10')
  );
  expect(bands).toHaveLength(1);
  return bands[0];
}

// The handles carry the selected clock times, which pins both edges and the length.
function selection(): { start: string; end: string } {
  return {
    start: screen.getByRole('slider', { name: 'Meeting start' }).getAttribute('aria-valuetext') || '',
    end: screen.getByRole('slider', { name: 'Meeting end' }).getAttribute('aria-valuetext') || '',
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(window.electronAPI.files, 'listSegments').mockResolvedValue([stretch]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SegmentTimeline placement', () => {
  it('places a 30-minute slot where you click on a recorded stretch', async () => {
    const track = await openPicker();
    const band = bandIn(track);

    // The shading is inert; the press belongs to the track underneath.
    clickAt(band, MID);

    const { start, end } = selection();
    expect(start).toBe(clockOf(MID));
    expect(end).toBe(clockOf(MID + 30 * MINUTE));
  });

  it('snaps the slot to a 5-minute mark', async () => {
    const track = await openPicker();

    clickAt(track, MID + 2 * MINUTE);

    // 2 minutes past the mark rounds back to it, so the slot never starts at an odd minute.
    expect(selection().start).toBe(clockOf(MID));
  });

  it('takes the whole recorded stretch on a double-click', async () => {
    const track = await openPicker();

    // The browser delivers both clicks before dblclick — the expansion has to win.
    clickAt(track, MID);
    clickAt(track, MID);
    fireEvent.doubleClick(track, { clientY: yOf(MID) });

    const { start, end } = selection();
    expect(start).toBe(clockOf(STRETCH_FROM));
    expect(end).toBe(clockOf(STRETCH_TO));
  });

  it('leaves the slot alone when a double-click misses every stretch', async () => {
    const track = await openPicker();
    const emptySpot = STRETCH_FROM - 6 * HOUR;

    clickAt(track, emptySpot);
    fireEvent.doubleClick(track, { clientY: yOf(emptySpot) });

    const { start, end } = selection();
    expect(start).toBe(clockOf(emptySpot));
    expect(end).toBe(clockOf(emptySpot + 30 * MINUTE));
  });

  it('sizes the slot by dragging across a recorded stretch', async () => {
    const track = await openPicker();

    fireEvent.pointerDown(track, { button: 0, buttons: 1, clientY: yOf(MID) });
    fireEvent.pointerMove(window, { buttons: 1, clientY: yOf(MID + 45 * MINUTE) });
    fireEvent.pointerUp(window, { clientY: yOf(MID + 45 * MINUTE) });

    const { start, end } = selection();
    expect(start).toBe(clockOf(MID));
    expect(end).toBe(clockOf(MID + 45 * MINUTE));
  });
});
