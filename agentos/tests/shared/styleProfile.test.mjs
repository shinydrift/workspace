/**
 * Tests for personality/styleProfile.ts
 * Pure-function helpers are inlined so no TS loader is needed.
 * The LLM-based derivePersonalityProfileWithLLM path requires an integration test
 * with a mocked Claude CLI and is not covered here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined helpers (must stay in sync with styleProfile.ts) ─────────────────

const MAX_MESSAGES = 200;
const MAX_PROFILE_CHARS = 2000;
const PROFILE_PREAMBLE = "Emulate the user's communication style";

function clampUserMessages(messages) {
  return messages.filter((m) => m.role === 'user' && m.content.trim()).slice(-MAX_MESSAGES);
}

function traitDescription(traits) {
  const lines = [];
  if (traits.openness >= 4) lines.push('curious, explores unconventional angles');
  if (traits.openness <= 2) lines.push('stays practical and conventional');
  if (traits.conscientiousness >= 4) lines.push('thorough, organized, follows through');
  if (traits.extraversion >= 4) lines.push('warm, expressive, proactive in conversation');
  if (traits.extraversion <= 2) lines.push('reserved, concise, avoids small talk');
  if (traits.agreeableness >= 4) lines.push('empathetic, cooperative, softens disagreement');
  if (traits.agreeableness <= 2) lines.push('direct, states disagreement plainly');
  if (traits.neuroticism >= 4) lines.push('emotionally reactive, sensitive to uncertainty');
  if (traits.neuroticism <= 2) lines.push('emotionally steady, unfazed by ambiguity');
  if (lines.length === 0) lines.push('balanced, adapts style to context');
  return lines.join('. ');
}

function buildPersonalityPrompt(personality) {
  if (!personality) return '';
  const agentStyle = personality.agentStyle.trim();
  const traitLine = personality.bigFive ? traitDescription(personality.bigFive) : '';

  if (!agentStyle && !traitLine) return '';

  const parts = [
    '# Personality Emulation',
    'Use the following style profile when responding in this thread.',
    'Mirror communication habits while remaining honest about being the assistant.',
    '',
  ];
  if (traitLine) parts.push(`Tone: ${traitLine}.`);
  if (agentStyle) parts.push(agentStyle);
  return parts.join('\n');
}

function truncateProfile(profile) {
  if (profile.length <= MAX_PROFILE_CHARS) return profile;
  const truncated = profile.slice(0, MAX_PROFILE_CHARS);
  return truncated.slice(0, truncated.lastIndexOf('\n'));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMessages(texts) {
  return texts.map((t) => ({ role: 'user', content: t }));
}

// ── clampUserMessages ─────────────────────────────────────────────────────────

test('clampUserMessages: truncates to MAX_MESSAGES (200)', () => {
  const msgs = Array.from({ length: 300 }, (_, i) => ({ role: 'user', content: `msg ${i}` }));
  const result = clampUserMessages(msgs);
  assert.equal(result.length, 200);
  assert.equal(result[0].content, 'msg 100');
  assert.equal(result[199].content, 'msg 299');
});

test('clampUserMessages: filters out non-user messages', () => {
  const messages = [
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'one' },
    { role: 'user', content: 'two' },
    { role: 'user', content: 'three' },
  ];
  assert.equal(clampUserMessages(messages).length, 3);
});

test('clampUserMessages: filters out empty-content messages', () => {
  const messages = [
    { role: 'user', content: '' },
    { role: 'user', content: '   ' },
    { role: 'user', content: 'valid one' },
    { role: 'user', content: 'valid two' },
    { role: 'user', content: 'valid three' },
  ];
  assert.equal(clampUserMessages(messages).length, 3);
});

// ── buildPersonalityPrompt ────────────────────────────────────────────────────

test('buildPersonalityPrompt: undefined returns empty string', () => {
  assert.equal(buildPersonalityPrompt(undefined), '');
});

test('buildPersonalityPrompt: empty agentStyle and no bigFive returns empty string', () => {
  assert.equal(buildPersonalityPrompt({ agentStyle: '   ', autopilotInstructions: '' }), '');
});

test('buildPersonalityPrompt: includes agentStyle content', () => {
  const result = buildPersonalityPrompt({ agentStyle: 'Tone: terse.', autopilotInstructions: '' });
  assert.ok(result.includes('# Personality Emulation'));
  assert.ok(result.includes('Tone: terse.'));
});

test('buildPersonalityPrompt: never includes generatedAt metadata', () => {
  const result = buildPersonalityPrompt({ agentStyle: 'hello', autopilotInstructions: '', generatedAt: 42 });
  assert.ok(!result.includes('42'));
  assert.ok(!result.includes('generatedAt'));
});

// ── profile validation (preamble check) ──────────────────────────────────────

test('profile preamble check: valid profile starts with preamble', () => {
  const profile = `${PROFILE_PREAMBLE}, not their identity. Stay truthful about being an AI.\nTone: terse.`;
  assert.ok(profile.startsWith(PROFILE_PREAMBLE));
});

test('profile preamble check: profile without preamble is detectable', () => {
  const badProfile = 'Tone: terse.\nKeep replies short.';
  assert.ok(!badProfile.startsWith(PROFILE_PREAMBLE));
});

// ── profile size guard ────────────────────────────────────────────────────────

test('truncateProfile: short profile is unchanged', () => {
  const profile = `${PROFILE_PREAMBLE}.\nTone: terse.`;
  assert.equal(truncateProfile(profile), profile);
});

test('truncateProfile: oversized profile is truncated at last newline', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}: ${'x'.repeat(30)}`);
  const profile = lines.join('\n');
  assert.ok(profile.length > MAX_PROFILE_CHARS);
  const result = truncateProfile(profile);
  assert.ok(result.length <= MAX_PROFILE_CHARS);
  assert.ok(!result.endsWith('\n'));
  // Must end at a clean line boundary
  assert.ok(result.endsWith(`x`.repeat(30)));
});

test('truncateProfile: exactly at limit is unchanged', () => {
  const profile = 'x'.repeat(MAX_PROFILE_CHARS);
  assert.equal(truncateProfile(profile), profile);
});

// ── traitDescription ──────────────────────────────────────────────────────────

test('traitDescription: all neutral traits (3) returns fallback', () => {
  const result = traitDescription({ openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 });
  assert.equal(result, 'balanced, adapts style to context');
});

test('traitDescription: high openness includes curious line', () => {
  const result = traitDescription({ openness: 4, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 });
  assert.ok(result.includes('curious, explores unconventional angles'));
});

test('traitDescription: low openness includes practical line', () => {
  const result = traitDescription({ openness: 2, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 });
  assert.ok(result.includes('stays practical and conventional'));
});

test('traitDescription: high conscientiousness includes thorough line', () => {
  const result = traitDescription({ openness: 3, conscientiousness: 5, extraversion: 3, agreeableness: 3, neuroticism: 3 });
  assert.ok(result.includes('thorough, organized, follows through'));
});

test('traitDescription: low extraversion includes reserved line', () => {
  const result = traitDescription({ openness: 3, conscientiousness: 3, extraversion: 1, agreeableness: 3, neuroticism: 3 });
  assert.ok(result.includes('reserved, concise, avoids small talk'));
});

test('traitDescription: high agreeableness includes empathetic line', () => {
  const result = traitDescription({ openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 5, neuroticism: 3 });
  assert.ok(result.includes('empathetic, cooperative, softens disagreement'));
});

test('traitDescription: low neuroticism includes steady line', () => {
  const result = traitDescription({ openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 1 });
  assert.ok(result.includes('emotionally steady, unfazed by ambiguity'));
});

test('traitDescription: multiple traits joined with period-space', () => {
  const result = traitDescription({ openness: 5, conscientiousness: 5, extraversion: 3, agreeableness: 3, neuroticism: 3 });
  assert.ok(result.includes('. '));
  assert.ok(result.includes('curious'));
  assert.ok(result.includes('thorough'));
});

// ── buildPersonalityPrompt with bigFive ────────────────────────────────────────

test('buildPersonalityPrompt: bigFive with empty agentStyle still generates output', () => {
  const result = buildPersonalityPrompt({
    agentStyle: '',
    autopilotInstructions: '',
    bigFive: { openness: 5, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  });
  assert.ok(result.includes('# Personality Emulation'));
  assert.ok(result.includes('Tone:'));
  assert.ok(result.includes('curious'));
});

test('buildPersonalityPrompt: bigFive tone line prefixes agentStyle', () => {
  const result = buildPersonalityPrompt({
    agentStyle: 'Keep replies short.',
    autopilotInstructions: '',
    bigFive: { openness: 3, conscientiousness: 5, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  });
  const lines = result.split('\n');
  const toneIdx = lines.findIndex((l) => l.startsWith('Tone:'));
  const profileIdx = lines.findIndex((l) => l === 'Keep replies short.');
  assert.ok(toneIdx >= 0 && profileIdx > toneIdx);
});

test('buildPersonalityPrompt: neutral bigFive with agentStyle includes fallback Tone line', () => {
  const result = buildPersonalityPrompt({
    agentStyle: 'My style.',
    autopilotInstructions: '',
    bigFive: { openness: 3, conscientiousness: 3, extraversion: 3, agreeableness: 3, neuroticism: 3 },
  });
  assert.ok(result.includes('Tone: balanced, adapts style to context.'));
  assert.ok(result.includes('My style.'));
});
