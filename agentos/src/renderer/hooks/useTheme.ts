import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'violet' | 'emerald' | 'amber' | 'default';
export type FontSize = 'small' | 'medium' | 'large';

const THEME_STORAGE_KEY = 'agentos-theme';
const COLOR_THEME_STORAGE_KEY = 'agentos-color-theme';
const FONT_SIZE_STORAGE_KEY = 'agentos-font-size';
const COLOR_THEMES: ColorTheme[] = ['violet', 'emerald', 'amber', 'default'];
const DEFAULT_COLOR_THEME: ColorTheme = 'violet';
const FONT_SIZE_MAP: Record<FontSize, number> = { small: 14, medium: 16, large: 18 };
const FONT_SIZES = Object.keys(FONT_SIZE_MAP) as FontSize[];

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
    return storedTheme;
  }

  return 'system';
}

function getInitialColorTheme(): ColorTheme {
  if (typeof window === 'undefined') return DEFAULT_COLOR_THEME;
  const stored = window.localStorage.getItem(COLOR_THEME_STORAGE_KEY);
  if (COLOR_THEMES.includes(stored as ColorTheme)) return stored as ColorTheme;
  return DEFAULT_COLOR_THEME;
}

function getInitialFontSize(): FontSize {
  if (typeof window === 'undefined') return 'medium';
  const stored = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  if (FONT_SIZES.includes(stored as FontSize)) return stored as FontSize;
  return 'medium';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(getInitialColorTheme);
  const [fontSize, setFontSize] = useState<FontSize>(getInitialFontSize);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const resolvedTheme = theme === 'system' ? (mql.matches ? 'dark' : 'light') : theme;
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);

    if (theme !== 'system') return;

    const handleChange = () => {
      root.classList.toggle('dark', mql.matches);
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    for (const t of COLOR_THEMES) {
      if (t !== 'default') root.classList.remove(`theme-${t}`);
    }
    if (colorTheme !== 'default') {
      root.classList.add(`theme-${colorTheme}`);
    }
    window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme);
  }, [colorTheme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${FONT_SIZE_MAP[fontSize]}px`;
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSize);
  }, [fontSize]);

  function toggleTheme() {
    setTheme((current) => {
      if (current === 'system') return 'light';
      if (current === 'light') return 'dark';
      return 'system';
    });
  }

  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return { theme, isDark, setTheme, toggleTheme, colorTheme, setColorTheme, fontSize, setFontSize };
}
