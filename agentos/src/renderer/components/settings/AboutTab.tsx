import React from 'react';
import { GithubLogo } from '@phosphor-icons/react';
import { useAppVersion } from '../../hooks/useAppVersion';

export function AboutTab() {
  const version = useAppVersion();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-1">AgentOS</p>
        <p className="text-xs text-muted-foreground">Version {version ?? '…'}</p>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Repository</p>
        <button
          type="button"
          onClick={() => window.electronAPI?.shell.openExternal('https://github.com/shinydrift/workspace')}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <GithubLogo size={14} />
          <span>shinydrift/workspace</span>
        </button>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Author</p>
        <p className="text-xs text-muted-foreground">pradeepgodara</p>
      </div>
    </div>
  );
}
