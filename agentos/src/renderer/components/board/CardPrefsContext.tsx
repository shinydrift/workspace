import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export interface CardDisplayPrefs {
  showAgentBadge: boolean;
  showProgress: boolean;
  showSkillTags: boolean;
  showBlockerCount: boolean;
  showDueDateBadge: boolean;
  showSubtaskBadge: boolean;
  showAgingIndicator: boolean;
  showTaskId: boolean;
  showDescriptionPreview: boolean;
  showWipLimit: boolean;
  showTaskCount: boolean;
}

const DEFAULT_PREFS: CardDisplayPrefs = {
  showAgentBadge: true,
  showProgress: true,
  showSkillTags: true,
  showBlockerCount: true,
  showDueDateBadge: true,
  showSubtaskBadge: true,
  showAgingIndicator: true,
  showTaskId: false,
  showDescriptionPreview: false,
  showWipLimit: true,
  showTaskCount: true,
};

function loadPrefs(projectId: string): CardDisplayPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(`agentos.kanban.cardPrefs.${projectId}`) ?? '{}');
    return { ...DEFAULT_PREFS, ...stored };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(projectId: string, prefs: CardDisplayPrefs): void {
  localStorage.setItem(`agentos.kanban.cardPrefs.${projectId}`, JSON.stringify(prefs));
}

interface CardPrefsContextValue {
  prefs: CardDisplayPrefs;
  setPref: (key: keyof CardDisplayPrefs, value: boolean) => void;
}

const CardPrefsContext = createContext<CardPrefsContextValue>({
  prefs: DEFAULT_PREFS,
  setPref: () => undefined,
});

export function CardPrefsProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<CardDisplayPrefs>(() => loadPrefs(projectId));
  const prevProjectId = useRef(projectId);
  if (prevProjectId.current !== projectId) {
    prevProjectId.current = projectId;
    setPrefs(loadPrefs(projectId));
  }

  const setPref = useCallback(
    (key: keyof CardDisplayPrefs, value: boolean) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value };
        savePrefs(projectId, next);
        return next;
      });
    },
    [projectId]
  );

  return <CardPrefsContext.Provider value={{ prefs, setPref }}>{children}</CardPrefsContext.Provider>;
}

export const useCardPrefs = () => useContext(CardPrefsContext);
