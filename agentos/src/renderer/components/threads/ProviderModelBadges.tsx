import React from 'react';
import type { Provider, ProviderBackend } from '../../../shared/types';
import {
  CLAUDE_EFFORT_LABEL,
  CLAUDE_EFFORT_VALUES,
  CODEX_REASONING_LABEL,
  CODEX_REASONING_VALUES,
  DEFAULT_BACKEND,
  HARNESS_BACKENDS,
  MODEL_LABEL,
  PROVIDER_BACKEND_LABEL,
  PROVIDER_LABEL,
  PROVIDER_MODELS,
  type ClaudeEffort,
  type CodexReasoning,
} from '../../../shared/types/provider';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const PROVIDERS: Provider[] = ['claude', 'claude-interactive', 'codex', 'gemini', 'pi'];

interface Props {
  provider: Provider;
  backend?: ProviderBackend;
  model: string | undefined;
  baseUrl?: string;
  effort?: ClaudeEffort | undefined;
  reasoning?: CodexReasoning | undefined;
  onProviderChange: (p: Provider) => void;
  onBackendChange?: (b: ProviderBackend | undefined) => void;
  onModelChange: (m: string | undefined) => void;
  onBaseUrlChange?: (url: string | undefined) => void;
  onEffortChange?: (e: ClaudeEffort | undefined) => void;
  onReasoningChange?: (r: CodexReasoning | undefined) => void;
}

export function ProviderModelBadges({
  provider,
  backend,
  model,
  baseUrl,
  effort,
  reasoning,
  onProviderChange,
  onBackendChange,
  onModelChange,
  onBaseUrlChange,
  onEffortChange,
  onReasoningChange,
}: Props) {
  const effectiveBackend = backend ?? DEFAULT_BACKEND[provider];
  const isOpenBackend = effectiveBackend === 'ollama' || effectiveBackend === 'openrouter' || provider === 'pi';
  const models = isOpenBackend ? [] : PROVIDER_MODELS[provider];

  const parts: string[] = [PROVIDER_LABEL[provider]];
  if (backend && backend !== DEFAULT_BACKEND[provider]) parts.push(PROVIDER_BACKEND_LABEL[backend]);
  if (model) parts.push(MODEL_LABEL[model] ?? model);
  if (provider === 'claude' && effort) parts.push(CLAUDE_EFFORT_LABEL[effort]);
  if (provider === 'codex' && reasoning) parts.push(CODEX_REASONING_LABEL[reasoning]);
  const summaryLabel = parts.join(' · ');

  const validBackends = HARNESS_BACKENDS[provider];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          {summaryLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-1" align="end">
        <div className="flex flex-col gap-0">
          <div className="flex">
            {/* Provider column */}
            <div className="flex flex-col">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Harness</div>
              {PROVIDERS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant="ghost"
                  onClick={() => onProviderChange(p)}
                  className={cn(
                    'h-auto justify-start px-2 py-1.5 text-xs',
                    provider === p ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  {PROVIDER_LABEL[p]}
                </Button>
              ))}
            </div>

            {/* Backend column */}
            {onBackendChange && validBackends.length > 1 && (
              <div className="flex flex-col border-l border-border/50 pl-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Backend</div>
                {validBackends.map((b) => (
                  <Button
                    key={b}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      onBackendChange(b === DEFAULT_BACKEND[provider] ? undefined : b);
                      // Clear model when switching backends to avoid stale values
                      onModelChange(undefined);
                      if (onBaseUrlChange) onBaseUrlChange(undefined);
                    }}
                    className={cn(
                      'h-auto justify-start px-2 py-1.5 text-xs',
                      effectiveBackend === b ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {PROVIDER_BACKEND_LABEL[b]}
                  </Button>
                ))}
              </div>
            )}

            {/* Model column */}
            <div className="flex flex-col border-l border-border/50 pl-1">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Model</div>
              {isOpenBackend ? (
                <div className="px-2 py-1.5">
                  <input
                    type="text"
                    value={model ?? ''}
                    onChange={(e) => onModelChange(e.target.value || undefined)}
                    placeholder={effectiveBackend === 'ollama' ? 'llama3.2' : 'meta-llama/llama-3.1-70b'}
                    className="w-40 rounded border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onModelChange(undefined)}
                    className={cn(
                      'h-auto justify-start px-2 py-1.5 text-xs',
                      model === undefined ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}
                  >
                    Default
                  </Button>
                  {models.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      variant="ghost"
                      onClick={() => onModelChange(m)}
                      className={cn(
                        'h-auto justify-start px-2 py-1.5 text-xs',
                        model === m ? 'text-foreground font-medium' : 'text-muted-foreground'
                      )}
                    >
                      {MODEL_LABEL[m] ?? m}
                    </Button>
                  ))}
                </>
              )}
            </div>

            {/* Effort column (Claude only) */}
            {provider === 'claude' && onEffortChange && (
              <div className="flex flex-col border-l border-border/50 pl-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Effort</div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onEffortChange(undefined)}
                  className={cn(
                    'h-auto justify-start px-2 py-1.5 text-xs',
                    effort === undefined ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  Default
                </Button>
                {CLAUDE_EFFORT_VALUES.map((e) => (
                  <Button
                    key={e}
                    type="button"
                    variant="ghost"
                    onClick={() => onEffortChange(e)}
                    className={cn(
                      'h-auto justify-start px-2 py-1.5 text-xs',
                      effort === e ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {CLAUDE_EFFORT_LABEL[e]}
                  </Button>
                ))}
              </div>
            )}

            {/* Reasoning column (Codex only) */}
            {provider === 'codex' && onReasoningChange && (
              <div className="flex flex-col border-l border-border/50 pl-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Reasoning</div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onReasoningChange(undefined)}
                  className={cn(
                    'h-auto justify-start px-2 py-1.5 text-xs',
                    reasoning === undefined ? 'text-foreground font-medium' : 'text-muted-foreground'
                  )}
                >
                  Default
                </Button>
                {CODEX_REASONING_VALUES.map((r) => (
                  <Button
                    key={r}
                    type="button"
                    variant="ghost"
                    onClick={() => onReasoningChange(r)}
                    className={cn(
                      'h-auto justify-start px-2 py-1.5 text-xs',
                      reasoning === r ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {CODEX_REASONING_LABEL[r]}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Base URL row — Ollama only */}
          {effectiveBackend === 'ollama' && onBaseUrlChange && (
            <div className="border-t border-border/50 px-2 py-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Ollama URL</div>
              <input
                type="text"
                value={baseUrl ?? ''}
                onChange={(e) => onBaseUrlChange(e.target.value || undefined)}
                placeholder="http://localhost:11434"
                className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
