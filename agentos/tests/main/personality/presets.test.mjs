/**
 * Tests for personality/presets.ts — PERSONA_PRESETS and getPreset (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined from presets.ts ───────────────────────────────────────────────────

const PERSONA_PRESETS = [
  {
    id: 'default',
    label: 'Balanced',
    description: 'Neutral across all traits — no trait influence on tone',
    traits: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  },
  {
    id: 'concise-technical',
    label: 'Concise & Technical',
    description: 'Thorough and organized, reserved, states disagreement plainly',
    traits: { openness: 3, conscientiousness: 5, extraversion: 1, agreeableness: 2, neuroticism: 2 },
  },
  {
    id: 'warm-collaborative',
    label: 'Warm & Collaborative',
    description: 'Warm and expressive, empathetic, emotionally steady',
    traits: { openness: 3, conscientiousness: 3, extraversion: 5, agreeableness: 5, neuroticism: 1 },
  },
  {
    id: 'creative-explorer',
    label: 'Creative Explorer',
    description: 'Curious and imaginative, warm and expressive',
    traits: { openness: 5, conscientiousness: 3, extraversion: 4, agreeableness: 3, neuroticism: 3 },
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Manually set each trait with the sliders below',
    traits: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  },
];

function getPreset(id) {
  return PERSONA_PRESETS.find((p) => p.id === id);
}

const TRAIT_KEYS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

// ── PERSONA_PRESETS shape ─────────────────────────────────────────────────────

test('PERSONA_PRESETS: has 5 entries', () => {
  assert.equal(PERSONA_PRESETS.length, 5);
});

test('PERSONA_PRESETS: each preset has required fields', () => {
  for (const preset of PERSONA_PRESETS) {
    assert.ok(typeof preset.id === 'string' && preset.id.length > 0, `${preset.id}: missing id`);
    assert.ok(typeof preset.label === 'string' && preset.label.length > 0, `${preset.id}: missing label`);
    assert.ok(typeof preset.description === 'string', `${preset.id}: missing description`);
    assert.ok(typeof preset.traits === 'object', `${preset.id}: missing traits`);
  }
});

test('PERSONA_PRESETS: all trait values are integers 1–5', () => {
  for (const preset of PERSONA_PRESETS) {
    for (const key of TRAIT_KEYS) {
      const val = preset.traits[key];
      assert.ok(Number.isInteger(val) && val >= 1 && val <= 5, `${preset.id}.${key}=${val} out of range`);
    }
  }
});

test('PERSONA_PRESETS: each preset has all 5 trait keys', () => {
  for (const preset of PERSONA_PRESETS) {
    for (const key of TRAIT_KEYS) {
      assert.ok(key in preset.traits, `${preset.id} missing trait: ${key}`);
    }
  }
});

test('PERSONA_PRESETS: ids are unique', () => {
  const ids = PERSONA_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ── getPreset ─────────────────────────────────────────────────────────────────

test('getPreset: returns preset for known id', () => {
  const p = getPreset('default');
  assert.ok(p !== undefined);
  assert.equal(p.id, 'default');
});

test('getPreset: returns undefined for unknown id', () => {
  assert.equal(getPreset('nonexistent'), undefined);
});

test('getPreset: finds each preset by its id', () => {
  for (const preset of PERSONA_PRESETS) {
    const found = getPreset(preset.id);
    assert.ok(found !== undefined, `getPreset(${preset.id}) returned undefined`);
    assert.equal(found.id, preset.id);
  }
});

test('getPreset: custom preset has balanced default traits', () => {
  const custom = getPreset('custom');
  assert.ok(custom !== undefined);
  for (const key of TRAIT_KEYS) {
    assert.equal(custom.traits[key], 3);
  }
});

test('getPreset: concise-technical has high conscientiousness and low extraversion', () => {
  const p = getPreset('concise-technical');
  assert.ok(p !== undefined);
  assert.equal(p.traits.conscientiousness, 5);
  assert.equal(p.traits.extraversion, 1);
});
