import {
  ArrowUp,
  FolderOpen,
  GitBranch,
  Microphone,
  MicrophoneSlash,
  Paperclip,
  Robot,
  Stop,
} from '@phosphor-icons/react';
import type { Provider, SavedProject } from '../../../shared/types';
import type { ClaudeEffort, CodexReasoning } from '../../../shared/types/provider';
import { Button } from '@/components/ui/button';
import { cn, formatSeconds } from '@/lib/utils';
import { ComposerProjectPicker } from './ComposerProjectPicker';
import { ProviderModelBadges } from './ProviderModelBadges';
import { SandboxToggleButton } from './SandboxToggleButton';

interface Props {
  autopilotEnabled: boolean;
  creating: boolean;
  model: string | undefined;
  effort?: ClaudeEffort | undefined;
  reasoning?: CodexReasoning | undefined;
  onAttach: () => void;
  onModelChange: (model: string | undefined) => void;
  onEffortChange?: (effort: ClaudeEffort | undefined) => void;
  onReasoningChange?: (reasoning: CodexReasoning | undefined) => void;
  onStop: () => void;
  onSubmit: () => void | Promise<void>;
  onToggleAutopilot: () => void;
  provider: Provider;
  runOnHost?: boolean;
  inheritedRunOnHost?: boolean;
  onToggleRunOnHost?: (runOnHost: boolean) => void;
  worktreeOn?: boolean;
  onToggleWorktree?: () => void;
  recording: boolean;
  recordingSeconds: number;
  setProviderSelection: (provider: Provider) => void;
  toggleRecording: () => Promise<void>;
  transcribing: boolean;
  projects?: SavedProject[];
  projectName?: string;
  workingDir?: string;
  onProjectChange?: (project: SavedProject) => void;
  onBrowseFolder?: () => Promise<void>;
}

export function ComposerToolbar({
  autopilotEnabled,
  creating,
  model,
  effort,
  reasoning,
  onAttach,
  onModelChange,
  onEffortChange,
  onReasoningChange,
  onStop,
  onSubmit,
  onToggleAutopilot,
  provider,
  runOnHost,
  inheritedRunOnHost,
  onToggleRunOnHost,
  worktreeOn,
  onToggleWorktree,
  recording,
  recordingSeconds,
  setProviderSelection,
  toggleRecording,
  transcribing,
  projects,
  projectName,
  workingDir,
  onProjectChange,
  onBrowseFolder,
}: Props) {
  function handleProviderChange(p: Provider) {
    setProviderSelection(p);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Button
        onClick={onAttach}
        disabled={creating || transcribing || recording}
        variant="ghost"
        size="icon"
        title="Attach files"
        aria-label="Attach files"
        className="h-7 w-7 shrink-0 text-muted-foreground"
      >
        <Paperclip className="h-3.5 w-3.5" />
      </Button>

      <Button
        onClick={onToggleAutopilot}
        variant="ghost"
        size="icon"
        title={autopilotEnabled ? 'Autopilot on — click to disable' : 'Autopilot off — click to enable'}
        aria-label={autopilotEnabled ? 'Autopilot on — click to disable' : 'Autopilot off — click to enable'}
        className={cn(
          'h-7 w-7 shrink-0',
          autopilotEnabled ? 'text-emerald-500 hover:text-emerald-400' : 'text-muted-foreground'
        )}
      >
        <Robot className="h-4 w-4" weight={autopilotEnabled ? 'fill' : 'regular'} />
      </Button>

      {projects && projects.length > 0 && onProjectChange ? (
        <ComposerProjectPicker
          projects={projects}
          projectName={projectName ?? ''}
          workingDir={workingDir ?? ''}
          onSelect={onProjectChange}
          onBrowseFolder={onBrowseFolder}
        />
      ) : projects?.length === 0 && onBrowseFolder ? (
        <Button
          onClick={onBrowseFolder}
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          Browse folder
        </Button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {recording && <span className="text-xs tabular-nums text-destructive">{formatSeconds(recordingSeconds)}</span>}

        {onToggleWorktree && (
          <Button
            onClick={onToggleWorktree}
            variant="ghost"
            size="icon"
            title={
              worktreeOn
                ? 'Worktree on — thread runs in its own git worktree. Click to run in the project directory'
                : 'Worktree off — running in the project directory. Click to use a git worktree'
            }
            aria-label={worktreeOn ? 'Worktree on' : 'Worktree off'}
            className={cn(
              'h-7 w-7 shrink-0',
              worktreeOn ? 'text-emerald-500 hover:text-emerald-400' : 'text-muted-foreground'
            )}
          >
            <GitBranch className="h-4 w-4" weight={worktreeOn ? 'fill' : 'regular'} />
          </Button>
        )}

        {onToggleRunOnHost && (
          <SandboxToggleButton
            runOnHost={runOnHost}
            inheritedRunOnHost={inheritedRunOnHost}
            onToggle={onToggleRunOnHost}
          />
        )}

        <ProviderModelBadges
          provider={provider}
          model={model}
          effort={effort}
          reasoning={reasoning}
          onProviderChange={handleProviderChange}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
          onReasoningChange={onReasoningChange}
        />

        <Button
          onClick={toggleRecording}
          disabled={creating || transcribing}
          variant={recording ? 'destructive' : 'ghost'}
          size="icon"
          title={recording ? 'Stop recording' : 'Record voice input'}
          aria-label={recording ? 'Stop recording' : 'Record voice input'}
          className="h-7 w-7"
        >
          {recording ? <MicrophoneSlash className="h-3.5 w-3.5" /> : <Microphone className="h-3.5 w-3.5" />}
        </Button>

        {creating ? (
          <Button onClick={onStop} variant="secondary" size="icon" className="h-7 w-7 p-0">
            <Stop className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button onClick={onSubmit} size="icon" className="h-7 w-7 p-0">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
