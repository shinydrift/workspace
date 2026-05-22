import { test, expect } from 'vitest';
import { detectPreset, type Preset } from '../../../../src/renderer/components/settings/PresetGrid';

interface Cfg {
  a?: number;
  b?: number;
  c?: number;
}

type Key = 'a' | 'b';

const PRESETS: Preset<Cfg, Key>[] = [
  { name: 'default', label: 'Default', description: '', settings: {} },
  { name: 'precise', label: 'Precise', description: '', settings: { a: 1, b: 2 } },
  { name: 'broad', label: 'Broad', description: '', settings: { a: 10, b: 20 } },
  { name: 'custom', label: 'Custom', description: '', settings: {} },
];

const KEYS: Key[] = ['a', 'b'];

test('detectPreset: matches default when all preset keys are undefined', () => {
  expect(detectPreset(PRESETS, {}, KEYS)).toBe('default');
});

test('detectPreset: matches default even when non-preset key is set', () => {
  expect(detectPreset(PRESETS, { c: 99 }, KEYS)).toBe('default');
});

test('detectPreset: matches a named preset on exact value match', () => {
  expect(detectPreset(PRESETS, { a: 1, b: 2 }, KEYS)).toBe('precise');
  expect(detectPreset(PRESETS, { a: 10, b: 20 }, KEYS)).toBe('broad');
});

test('detectPreset: returns custom when one preset key differs', () => {
  expect(detectPreset(PRESETS, { a: 1, b: 999 }, KEYS)).toBe('custom');
});

test('detectPreset: returns custom when only some preset keys are set', () => {
  expect(detectPreset(PRESETS, { a: 1 }, KEYS)).toBe('custom');
});

test('detectPreset: ignores non-preset keys', () => {
  expect(detectPreset(PRESETS, { a: 1, b: 2, c: 42 }, KEYS)).toBe('precise');
});

test('detectPreset: skips the custom preset entry', () => {
  const onlyCustom: Preset<Cfg, Key>[] = [{ name: 'custom', label: 'Custom', description: '', settings: {} }];
  expect(detectPreset(onlyCustom, {}, KEYS)).toBe('custom');
});

test('detectPreset: with empty presets returns custom', () => {
  expect(detectPreset([], { a: 1, b: 2 }, KEYS)).toBe('custom');
});
