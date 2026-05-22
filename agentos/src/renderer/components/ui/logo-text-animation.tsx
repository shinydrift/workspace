import React, { useEffect, useRef } from 'react';

const BLOCK = 70;
const STEP = 80;
const OFFSET = 5;
const SIZE = 320;

type Cell = { row: number; col: number };

function rotateCW(cells: Cell[]): Cell[] {
  return cells.map(({ row, col }) => ({ row: col, col: 3 - row }));
}

// Top-right orientation (original logo)
const state1: Cell[] = [
  { row: 0, col: 0 },
  { row: 0, col: 1 },
  { row: 0, col: 2 },
  { row: 1, col: 1 },
  { row: 1, col: 2 },
  { row: 1, col: 3 },
  { row: 2, col: 2 },
  { row: 2, col: 3 },
  { row: 3, col: 3 },
];
// Bottom-left (180°)
const state3 = rotateCW(rotateCW(state1));

// 2-phase cycle: HOLD=400ms, FADE=400ms, PHASE=800ms, CYCLE=1600ms
const HOLD = 400;
const FADE = 400;
const PHASE = HOLD + FADE; // 800ms
const CYCLE_MS = PHASE * 2; // 1600ms

// Keyframe stops as percentages
const H1 = '25.00'; // hold-1 end:  400ms
const F1 = '50.00'; // fade-1 end:  800ms
const H3 = '75.00'; // hold-3 end: 1200ms

const CSS = `
  @keyframes logo-state-1 {
    0%, ${H1}% { opacity: 1; }
    ${F1}%     { opacity: 0; }
    ${H3}%     { opacity: 0; }
    100%        { opacity: 1; }
  }
  @keyframes logo-state-3 {
    0%, ${H1}% { opacity: 0; }
    ${F1}%     { opacity: 1; }
    ${H3}%     { opacity: 1; }
    100%        { opacity: 0; }
  }
  .logo-s1 { animation: logo-state-1 ${CYCLE_MS}ms ease-in-out infinite; }
  .logo-s3 { animation: logo-state-3 ${CYCLE_MS}ms ease-in-out infinite; }
`;

interface LogoTextAnimationProps {
  onComplete?: () => void;
  className?: string;
}

function rectFor({ row, col }: Cell) {
  return (
    <rect
      key={`${row}-${col}`}
      x={OFFSET + col * STEP}
      y={OFFSET + row * STEP}
      width={BLOCK}
      height={BLOCK}
      fill="var(--primary)"
    />
  );
}

export function LogoTextAnimation({ onComplete, className = 'h-5 w-auto' }: LogoTextAnimationProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const t = window.setTimeout(() => onCompleteRef.current?.(), CYCLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={className}>
      <style>{CSS}</style>
      <g className="logo-s1">{state1.map(rectFor)}</g>
      <g className="logo-s3">{state3.map(rectFor)}</g>
    </svg>
  );
}
