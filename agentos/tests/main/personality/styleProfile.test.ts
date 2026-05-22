/**
 * Tests for src/main/personality/styleProfile.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { traitDescription, buildPersonalityPrompt } from '../../../src/main/personality/styleProfile';
import type { BigFiveTraits, PersonalitySettings } from '../../../src/shared/types';

// ── traitDescription ──────────────────────────────────────────────────────────

test('high openness produces curious description', () => {
  const traits: BigFiveTraits = { openness: 5, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('curious'));
});

test('low openness produces practical description', () => {
  const traits: BigFiveTraits = { openness: 1, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('practical'));
});

test('high conscientiousness produces thorough description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 5, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('thorough'));
});

test('high extraversion produces warm description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 5, agreeableness: 3, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('warm'));
});

test('low extraversion produces reserved description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 1, agreeableness: 3, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('reserved'));
});

test('high agreeableness produces empathetic description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 5, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('empathetic'));
});

test('low agreeableness produces direct description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 1, neuroticism: 3 };
  assert.ok(traitDescription(traits).includes('direct'));
});

test('high neuroticism produces emotionally reactive description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 5 };
  assert.ok(traitDescription(traits).includes('emotionally reactive'));
});

test('low neuroticism produces emotionally steady description', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 1 };
  assert.ok(traitDescription(traits).includes('emotionally steady'));
});

test('all neutral traits produce balanced fallback', () => {
  const traits: BigFiveTraits = { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  assert.strictEqual(traitDescription(traits), 'balanced, adapts style to context');
});

test('multiple active traits are joined with period-space', () => {
  const traits: BigFiveTraits = { openness: 5, conscientiousness: 5, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  const desc = traitDescription(traits);
  assert.ok(desc.includes('. '));
});

// ── buildPersonalityPrompt ────────────────────────────────────────────────────

test('returns empty string when personality is undefined', () => {
  assert.strictEqual(buildPersonalityPrompt(undefined), '');
});

test('returns empty string when agentStyle is blank and no bigFive', () => {
  const p: PersonalitySettings = { agentStyle: '   ', bigFive: undefined };
  assert.strictEqual(buildPersonalityPrompt(p), '');
});

test('includes agentStyle in output', () => {
  const p: PersonalitySettings = { agentStyle: 'Be brief.', bigFive: undefined };
  const result = buildPersonalityPrompt(p);
  assert.ok(result.includes('Be brief.'));
  assert.ok(result.includes('# Personality Emulation'));
});

test('includes trait line when bigFive is present', () => {
  const traits: BigFiveTraits = { openness: 5, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  const p: PersonalitySettings = { agentStyle: '', bigFive: traits };
  const result = buildPersonalityPrompt(p);
  assert.ok(result.includes('Tone:'));
  assert.ok(result.includes('curious'));
});

test('includes both agentStyle and trait line when both present', () => {
  const traits: BigFiveTraits = { openness: 5, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 };
  const p: PersonalitySettings = { agentStyle: 'Stay concise.', bigFive: traits };
  const result = buildPersonalityPrompt(p);
  assert.ok(result.includes('Tone:'));
  assert.ok(result.includes('Stay concise.'));
});

test('prompt header is always present when output is non-empty', () => {
  const p: PersonalitySettings = { agentStyle: 'Hello.', bigFive: undefined };
  const result = buildPersonalityPrompt(p);
  assert.ok(result.startsWith('# Personality Emulation'));
});
