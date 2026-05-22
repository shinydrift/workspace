import React, { useEffect, useRef } from 'react';

interface Block {
  x: number;
  y: number;
  brightness: number;
  nextFire: number;
  decayRate: number;
}

interface BlockGridBackgroundProps {
  mouseRef?: React.RefObject<{ x: number; y: number }>;
}

export function BlockGridBackground({ mouseRef: externalMouseRef }: BlockGridBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const internalMouseRef = useRef({ x: -9999, y: -9999 });
  const mouseRef = externalMouseRef ?? internalMouseRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SPACING = 20;
    const BLOCK = 2;
    const GLOW_RADIUS = 100;
    const PRIMARY_OPACITY = 0.18;
    const BRIGHTNESS_INTENSITY = 0.15;
    const GLOW_INTENSITY = 0.55;

    let blocks: Block[] = [];

    function buildBlocks() {
      const cols = Math.ceil(canvas.width / SPACING) + 1;
      const rows = Math.ceil(canvas.height / SPACING) + 1;
      const t = performance.now() / 1000;
      blocks = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          blocks.push({
            x: c * SPACING,
            y: r * SPACING,
            brightness: 0,
            nextFire: t + Math.random() * 8,
            decayRate: 0.4 + Math.random() * 0.6,
          });
        }
      }
    }

    function resize() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      buildBlocks();
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // cache primary color; re-read only when theme class changes
    let primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '220 90% 56%';
    const themeObserver = new MutationObserver(() => {
      primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '220 90% 56%';
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const GLOW_RADIUS_SQ = GLOW_RADIUS * GLOW_RADIUS;
    let rafId: number;
    let lastT = performance.now() / 1000;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const t = performance.now() / 1000;
      const dt = t - lastT;
      lastT = t;

      ctx.fillStyle = primaryColor;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (const b of blocks) {
        if (t >= b.nextFire) {
          b.brightness = 1;
          b.nextFire = t + 1.5 + Math.random() * 6;
        } else if (b.brightness > 0) {
          b.brightness = Math.max(0, b.brightness - b.decayRate * dt);
        }

        const dx = b.x - mx;
        const dy = b.y - my;
        const distSq = dx * dx + dy * dy;
        const glow = distSq < GLOW_RADIUS_SQ ? (1 - Math.sqrt(distSq) / GLOW_RADIUS) ** 2 : 0;

        ctx.globalAlpha = PRIMARY_OPACITY + b.brightness * BRIGHTNESS_INTENSITY + glow * GLOW_INTENSITY;
        ctx.fillRect(b.x - BLOCK / 2, b.y - BLOCK / 2, BLOCK, BLOCK);
      }

      rafId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      themeObserver.disconnect();
    };
  }, [mouseRef]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
