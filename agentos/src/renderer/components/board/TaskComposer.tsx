import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  reviewPending: boolean;
  isBlocked: boolean;
  savingNote: boolean;
  savingReview: boolean;
  savingBlocker: boolean;
  onAddNote: (text: string) => Promise<void> | void;
  onApprove: (text: string) => Promise<void> | void;
  onRequestChanges: (text: string) => Promise<void> | void;
  onSetBlocked: (text: string) => Promise<void> | void;
  onClearBlocker: (text: string) => Promise<void> | void;
}

export function TaskComposer({
  reviewPending,
  isBlocked,
  savingNote,
  savingReview,
  savingBlocker,
  onAddNote,
  onApprove,
  onRequestChanges,
  onSetBlocked,
  onClearBlocker,
}: Props) {
  const [text, setText] = useState('');
  const busy = savingNote || savingReview || savingBlocker;
  const hasText = text.trim().length > 0;

  async function run(fn: (value: string) => Promise<void> | void) {
    try {
      await fn(text.trim());
      setText('');
    } catch {
      // preserve text on failure so the user can retry
    }
  }

  const placeholder = reviewPending
    ? 'Leave a review note, or add a comment.'
    : isBlocked
      ? 'Describe what unblocked it, or add a comment.'
      : 'Add a comment, raise a blocker, or record context.';

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        className="min-h-[76px] resize-none text-sm"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {reviewPending && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run(onRequestChanges)}
              disabled={busy}
              className="text-amber-700 hover:text-amber-700 dark:text-amber-300"
            >
              Request changes
            </Button>
            <Button size="sm" onClick={() => void run(onApprove)} disabled={busy}>
              Approve
            </Button>
          </>
        )}
        {!reviewPending && !isBlocked && (
          <Button size="sm" variant="outline" onClick={() => void run(onSetBlocked)} disabled={busy}>
            Mark blocked
          </Button>
        )}
        {isBlocked && (
          <Button size="sm" variant="outline" onClick={() => void run(onClearBlocker)} disabled={busy}>
            Clear blocker
          </Button>
        )}
        <Button
          size="sm"
          variant={reviewPending ? 'ghost' : 'default'}
          onClick={() => void run(onAddNote)}
          disabled={busy || !hasText}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}
