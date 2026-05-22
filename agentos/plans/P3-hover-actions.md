# P3 — HoverActions Component

## Goal
Extract the hover-reveal action button pattern into `components/ui/hover-actions.tsx`. Standardize opacity transitions, background styling, and keyboard accessibility (`focus-within`) across `ThreadItem`, `AutomationJobRow`, `CardActionBar`, and `ListRow`.

## Background
Four components independently implement hidden-until-hover action buttons with different transition timings, backdrop styles, and (missing) keyboard support:

| Component | Current mechanism |
|-----------|-------------------|
| `ThreadItem.tsx` | `showActions` state toggled via `onMouseEnter`/`onMouseLeave`; absolute-positioned div with conditional render |
| `AutomationJobRow.tsx` | `group` + `hover:bg-accent/70` on wrapper; `Button` with `ghost` variant that's always rendered |
| `board/card/CardActionBar.tsx` | Likely absolute positioned, `opacity-0 group-hover:opacity-100` |
| `board/ListRow.tsx` | `opacity-0 group-hover:opacity-100 transition-opacity duration-75`, absolute right-side bar with backdrop blur |

---

## New File: `src/renderer/components/ui/hover-actions.tsx`

```tsx
import React from 'react';
import { cn } from '@/lib/utils';

interface HoverActionsProps {
  /** The always-visible row/card content. */
  children: React.ReactNode;
  /** Action buttons, revealed on hover or focus-within. */
  actions: React.ReactNode;
  /** Keep actions visible at all times (e.g. when a popover inside is open). */
  forceVisible?: boolean;
  /** Absolute right-aligned overlay vs inline end-positioned. Default: 'overlay'. */
  variant?: 'overlay' | 'inline';
  className?: string;
  actionsClassName?: string;
}

export function HoverActions({
  children,
  actions,
  forceVisible = false,
  variant = 'overlay',
  className,
  actionsClassName,
}: HoverActionsProps) {
  return (
    <div className={cn('group relative flex items-center w-full', className)}>
      {children}
      <div
        className={cn(
          'flex items-center gap-0.5 transition-opacity duration-75',
          variant === 'overlay' &&
            'absolute right-0 bg-background/90 backdrop-blur-sm border border-border/50 rounded-md px-1 py-0.5',
          variant === 'inline' && 'shrink-0',
          forceVisible
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100',
          actionsClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </div>
    </div>
  );
}
```

### Design decisions
- `focus-within` and `group-focus-within` ensure keyboard users can reach actions without hover.
- `forceVisible` lets callers (e.g. `ThreadItem` when its menu is open) keep actions visible while a descendant popover is mounted.
- `variant='overlay'` matches `ListRow`'s backdrop-blur bar. `variant='inline'` matches `ThreadItem`'s inline layout.
- `onClick` stopPropagation is built-in — all current sites need this to prevent row selection on action click.

---

## Migration

### `board/ListRow.tsx`
Replace the manual overlay div and `group-hover:opacity-0` metadata fade:

```tsx
// Before
<div className="group relative flex items-center …">
  {/* metadata with group-hover:opacity-0 */}
  <div className="flex items-center gap-2 shrink-0 group-hover:opacity-0 …">{metadata}</div>
  {!selectionActive && (
    <div className="absolute right-3 flex items-center … opacity-0 group-hover:opacity-100 … bg-background/90 …">
      <PriorityPicker … /> <DueDatePicker … /> <AgentAssignPicker … />
    </div>
  )}
</div>

// After — outer div keeps its own classes; HoverActions wraps the trailing section
{!selectionActive && (
  <HoverActions
    variant="overlay"
    actionsClassName="right-3"
    actions={
      <>
        <PriorityPicker … />
        <DueDatePicker … />
        <AgentAssignPicker … />
      </>
    }
  >
    <div className="flex items-center gap-2 shrink-0">{metadata}</div>
  </HoverActions>
)}
```

Note: the metadata fade (`group-hover:opacity-0`) is an extra animation specific to `ListRow`. It can be kept on the metadata div using the shared `group` class that `HoverActions` adds.

### `board/card/CardActionBar.tsx`
Replace the action container's manual `opacity-0 group-hover:opacity-100` with `HoverActions`. Since `CardActionBar` is rendered inside `TaskCard` which manages its own `group`, pass `forceVisible` down from the card when a picker popover is open (or rely on `focus-within`).

### `ThreadItem.tsx`
Replace `hoveredId`/`showActions` state with `HoverActions`:

```tsx
// Before — showActions drives conditional render
{showActions && (
  <div className="absolute inset-0 flex items-center justify-end">
    <ThreadItemMenu … />
  </div>
)}

// After
<HoverActions
  variant="inline"
  forceVisible={menuId === t.id}
  actions={<ThreadItemMenu … />}
>
  <span className="flex h-5 items-center text-xs text-muted-foreground tabular-nums">
    {relativeTime(t.lastActiveAt)}
  </span>
</HoverActions>
```

Also remove `hoveredId` state, `onMouseEnter`/`onMouseLeave` handlers from `ThreadItem` and `useThreadListContext` if they were only used for `showActions`.

### `AutomationJobRow.tsx`
The row already uses `group`/`hover:bg-accent`. The history button is always visible so `HoverActions` may not be needed here — only apply if there are hidden-until-hover elements. If not, skip this migration.

---

## Files Changed Summary
| File | Change |
|------|--------|
| `src/renderer/components/ui/hover-actions.tsx` | **New file** |
| `src/renderer/components/board/ListRow.tsx` | Use `HoverActions variant="overlay"` |
| `src/renderer/components/board/card/CardActionBar.tsx` | Use `HoverActions` |
| `src/renderer/components/threads/ThreadItem.tsx` | Use `HoverActions variant="inline"`, remove hover state |

---

## Accessibility Requirements
Before merging, manually verify with keyboard navigation:
- Tab into a thread row → actions become visible
- Tab into a board list row → pickers become focusable
- Clicking outside a picker closes it without the row losing action visibility unexpectedly
- Screen reader: action buttons must have `aria-label` (verify existing labels are present)

---

## Acceptance Criteria
- `HoverActions` exported from `@/components/ui/hover-actions`
- `ThreadItem` has no `hoveredId` state or mouse enter/leave handlers for show/hide actions
- `ListRow` action bar uses `HoverActions`
- All migrated sites pass keyboard tab navigation to action buttons
- `npx tsc --noEmit` passes
- Visual parity with before (transition speed ~75ms, backdrop blur on list row)
