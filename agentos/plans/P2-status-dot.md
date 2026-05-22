# P2 — StatusDot Unification

## Goal
Extend the existing `StatusDot` primitive in `status-badge.tsx` with `pulse` and `tooltip` props, add a `pending` status token, then migrate all inline dot/indicator patterns to use it. Keep thin domain adapters (`ThreadStatusDot`, `AgingDot`) — they map domain vocabulary to the primitive rather than disappearing.

## Background
`StatusDot` already exists in `components/ui/status-badge.tsx` with `success/warning/error/idle` statuses. `ThreadStatusDot` already wraps it. But three parallel implementations exist outside it:
- `JobStatusDot` — inlined inside `AutomationJobRow.tsx`
- Container status icon — inlined inside `ThreadItem.tsx`
- `AgingDot` (`board/card/AgingDot.tsx`) — uses `bg-destructive` / `bg-amber-500` classes directly

---

## Step 1 — Extend `StatusDot` in `status-badge.tsx`

### Changes
```tsx
// Add 'pending' to status variants
status: {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error:   'bg-status-error',
  idle:    'bg-muted-foreground/40',
  pending: 'bg-muted-foreground/25',   // ← new: not-yet-started / disabled state
},

// Add pulse prop
export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusDotVariants> {
  pulse?: boolean;
  tooltip?: string;   // wraps in <Tooltip> if provided
}

function StatusDot({ className, status, size, pulse, tooltip, ...props }: StatusDotProps) {
  const dot = (
    <span
      className={cn(statusDotVariants({ status, size }), pulse && 'animate-pulse', className)}
      aria-hidden
      {...props}
    />
  );
  if (tooltip) {
    return <Tooltip content={tooltip}>{dot}</Tooltip>;
  }
  return dot;
}
```

Import `Tooltip` from `@/components/ui/tooltip`.

---

## Step 2 — Extract `JobStatusDot` in `AutomationJobRow.tsx`

Remove the local `JobStatusDot` function and replace with `StatusDot` calls:

| Job state | StatusDot props |
|-----------|-----------------|
| `!job.enabled` | `status="pending"` |
| `job.lastRunStatus === 'error'` | `status="error"` |
| `job.lastRunStatus === 'ok'` | `status="success"` |
| else (never run / unknown) | `status="idle" className="h-2 w-2"` |

```tsx
// Before
<JobStatusDot job={job} />

// After
import { StatusDot } from '@/components/ui/status-badge';

<StatusDot
  status={!job.enabled ? 'pending' : job.lastRunStatus === 'error' ? 'error' : job.lastRunStatus === 'ok' ? 'success' : 'idle'}
  size="sm"
  className="shrink-0"
/>
```

### File to update
`src/renderer/components/automations/AutomationJobRow.tsx`

---

## Step 3 — Replace `ContainerStatusIcon` in `ThreadItem.tsx`

Remove the local `ContainerStatusIcon` function. Map container state → StatusDot:

| Container state | StatusDot props |
|----------------|-----------------|
| `!exists` | render nothing |
| `orphaned \|\| drift` | `status="warning" tooltip={containerTooltip(container)}` |
| `running` | `status="success" tooltip={containerTooltip(container)}` |
| else (stopped) | `status="idle" tooltip={containerTooltip(container)}` |

```tsx
// After
{container?.exists && (
  <StatusDot
    status={container.orphaned || container.drift ? 'warning' : container.running ? 'success' : 'idle'}
    size="sm"
    tooltip={containerTooltip(container)}
    className="shrink-0"
  />
)}
```

`containerTooltip` helper can stay local or move to a utils file.

### File to update
`src/renderer/components/threads/ThreadItem.tsx`

---

## Step 4 — Update `AgingDot` to use `StatusDot`

`AgingDot` is a positioned indicator that uses raw color classes. Map to StatusDot:

```tsx
// src/renderer/components/board/card/AgingDot.tsx
import { StatusDot } from '@/components/ui/status-badge';

export function AgingDot({ level }: { level: 'warn' | 'crit' }) {
  return (
    <StatusDot
      status={level === 'crit' ? 'error' : 'warning'}
      size="sm"
      className="absolute top-2 right-2"
    />
  );
}
```

Positioning (`absolute top-2 right-2`) stays in `AgingDot` — it's domain-specific and doesn't belong in the primitive.

---

## Step 5 — Update `ThreadStatusDot` pulse mapping

`ThreadStatusDot` currently applies `animate-pulse` via `className`. After Step 1, use the new `pulse` prop instead:

```tsx
// Before
<StatusDot status={STATUS_TOKEN[status]} size={size} className={cn(animated && status === 'running' && 'animate-pulse', className)} />

// After
<StatusDot status={STATUS_TOKEN[status]} size={size} pulse={animated && status === 'running'} className={className} />
```

### File to update
`src/renderer/components/threads/ThreadStatusDot.tsx`

---

## Files Changed Summary
| File | Change |
|------|--------|
| `src/renderer/components/ui/status-badge.tsx` | Add `pending` status, `pulse` prop, optional `tooltip` prop |
| `src/renderer/components/automations/AutomationJobRow.tsx` | Remove `JobStatusDot`, use `StatusDot` |
| `src/renderer/components/threads/ThreadItem.tsx` | Remove `ContainerStatusIcon`, use `StatusDot` |
| `src/renderer/components/board/card/AgingDot.tsx` | Delegate to `StatusDot` |
| `src/renderer/components/threads/ThreadStatusDot.tsx` | Use new `pulse` prop |

---

## Acceptance Criteria
- `grep -rn "JobStatusDot\|ContainerStatusIcon" src/` → 0 results
- `AgingDot` has no `bg-destructive` or `bg-amber-500` classes
- `ThreadStatusDot` uses `pulse` prop, not `animate-pulse` in className
- `StatusDot` renders `<Tooltip>` wrapper when `tooltip` prop is provided
- `npx tsc --noEmit` passes
- Visual parity: job rows, thread list, kanban cards look identical before and after
