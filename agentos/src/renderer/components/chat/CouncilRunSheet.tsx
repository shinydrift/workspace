import React from 'react';
import type { CouncilOutcomeRecord } from '../../../shared/types';
import { MODEL_LABEL, PROVIDER_LABEL } from '../../../shared/types/provider';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { renderMarkdown } from '../../lib/markdown';

function memberLabel(outcome: CouncilOutcomeRecord): string {
  const provider = PROVIDER_LABEL[outcome.member.provider] ?? outcome.member.provider;
  const model = outcome.member.model ? (MODEL_LABEL[outcome.member.model] ?? outcome.member.model) : '';
  return model ? `${provider} / ${model}` : provider;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'text-green-500';
  if (confidence >= 0.5) return 'text-yellow-500';
  return 'text-red-500';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  outcomes: CouncilOutcomeRecord[];
}

export function CouncilRunSheet({ open, onOpenChange, prompt, outcomes }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[1200px] max-w-[90vw]">
        <div className="flex flex-col h-full overflow-hidden">
          <div className="px-4 py-3 border-b border-border shrink-0">
            <SheetTitle>Council</SheetTitle>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{prompt}</p>
          </div>
          {outcomes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 px-4 italic">No responses yet.</p>
          ) : (
            <Tabs defaultValue={outcomes[0].childThreadId} className="flex flex-col flex-1 overflow-hidden">
              <TabsList className="flex flex-wrap h-auto gap-1 px-4 py-2 border-b border-border rounded-none bg-transparent justify-start shrink-0">
                {outcomes.map((o) => (
                  <TabsTrigger key={o.childThreadId} value={o.childThreadId}>
                    {memberLabel(o)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {outcomes.map((o) => (
                <TabsContent
                  key={o.childThreadId}
                  value={o.childThreadId}
                  className="flex-1 overflow-y-auto px-4 py-3 m-0 h-full"
                >
                  {o.status !== 'submitted' || !o.outcome ? (
                    <p className="text-xs text-muted-foreground italic">
                      {o.status === 'error'
                        ? (o.error ?? 'unknown error')
                        : o.status === 'timeout'
                          ? 'timed out'
                          : o.status === 'invalid'
                            ? o.raw
                              ? `invalid: ${o.raw.slice(0, 80)}`
                              : 'invalid response'
                            : 'no outcome'}
                    </p>
                  ) : (
                    <>
                      {o.outcome.confidence != null && (
                        <div className="flex justify-end mb-2">
                          <span className={`text-xs tabular-nums ${confidenceColor(o.outcome.confidence)}`}>
                            {Math.round(o.outcome.confidence * 100)}%
                          </span>
                        </div>
                      )}
                      <div
                        className="text-sm prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(o.outcome.answer) }}
                      />
                      {o.outcome.summary && (
                        <div
                          className="text-xs mt-1.5 prose prose-sm dark:prose-invert max-w-none opacity-60"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(o.outcome.summary) }}
                        />
                      )}
                      {o.outcome.caveats && o.outcome.caveats.length > 0 && (
                        <ul className="mt-1.5 text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                          {o.outcome.caveats.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
