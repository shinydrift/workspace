import type { BigFiveTraits, PersonalitySettings } from '../../shared/types';

export function traitDescription(traits: BigFiveTraits): string {
  const lines: string[] = [];
  if (traits.openness >= 4) lines.push('curious, explores unconventional angles');
  if (traits.openness <= 2) lines.push('stays practical and conventional');
  if (traits.conscientiousness >= 4) lines.push('thorough, organized, follows through');
  if (traits.extraversion >= 4) lines.push('warm, expressive, proactive in conversation');
  if (traits.extraversion <= 2) lines.push('reserved, concise, avoids small talk');
  if (traits.agreeableness >= 4) lines.push('empathetic, cooperative, softens disagreement');
  if (traits.agreeableness <= 2) lines.push('direct, states disagreement plainly');
  if (traits.neuroticism >= 4) lines.push('emotionally reactive, sensitive to uncertainty');
  if (traits.neuroticism <= 2) lines.push('emotionally steady, unfazed by ambiguity');
  if (lines.length === 0) return 'balanced, adapts style to context';
  return lines.join('. ');
}

export function buildPersonalityPrompt(personality: PersonalitySettings | undefined): string {
  if (!personality) return '';
  const agentStyle = personality.agentStyle.trim();
  const traitLine = personality.bigFive ? traitDescription(personality.bigFive) : '';

  if (!agentStyle && !traitLine) return '';

  const parts: string[] = [
    '# Personality Emulation',
    'Use the following style profile when responding in this thread.',
    'Mirror communication habits while remaining honest about being the assistant.',
    '',
  ];
  if (traitLine) parts.push(`Tone: ${traitLine}.`);
  if (agentStyle) parts.push(agentStyle);
  return parts.join('\n');
}
