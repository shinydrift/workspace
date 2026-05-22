# P5 — PropRow, FieldMessage, RelativeTime

## Goal
Three small opportunistic extractions to be applied when the relevant areas are already being touched. None is urgent enough to justify a standalone PR, but all should be picked up as part of any nearby work.

---

## Component 1: `PropertyRow` — `src/renderer/components/ui/property-row.tsx`

### Background
`TaskPropertiesSidebar.tsx` has a local `PropRow` function that renders a two-column label/value layout. The same layout appears informally in activity rows and git summary panels. It's a good primitive for dense metadata sidebars.

### New File
```tsx
import React from 'react';
import { cn } from '@/lib/utils';

interface PropertyRowProps {
  label: React.ReactNode;
  children: React.ReactNode;
  /** Width of the label column. Default: 'w-16' (matches TaskPropertiesSidebar). */
  labelWidth?: string;
  /** Vertical alignment. Default: 'center'. */
  align?: 'start' | 'center';
  className?: string;
}

export function PropertyRow({ label, children, labelWidth = 'w-16', align = 'center', className }: PropertyRowProps) {
  return (
    <div className={cn('flex min-h-7 gap-1', align === 'center' ? 'items-center' : 'items-start', className)}>
      <span className={cn('shrink-0 text-[11px] text-muted-foreground', labelWidth)}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
```

### Migration
- `src/renderer/components/board/TaskPropertiesSidebar.tsx`: remove local `PropRow`, import `PropertyRow` from `@/components/ui/property-row`.
- Apply opportunistically to any other dense sidebar/metadata panel.

---

## Component 2: `FieldMessage` — `src/renderer/components/ui/field-message.tsx`

### Background
Forms throughout settings and project sections repeat `<p className="text-xs text-muted-foreground">…</p>` for helper text, and `<p className="text-xs text-destructive">…</p>` for errors. A tiny primitive standardizes tone and makes form rows consistent.

### New File
```tsx
import React from 'react';
import { cn } from '@/lib/utils';

type FieldMessageTone = 'muted' | 'danger' | 'success' | 'warning';

const TONE_CLASS: Record<FieldMessageTone, string> = {
  muted:   'text-muted-foreground',
  danger:  'text-destructive',
  success: 'text-status-success',
  warning: 'text-status-warning',
};

interface FieldMessageProps {
  children: React.ReactNode;
  tone?: FieldMessageTone;
  className?: string;
}

export function FieldMessage({ children, tone = 'muted', className }: FieldMessageProps) {
  return (
    <p className={cn('text-xs', TONE_CLASS[tone], className)}>
      {children}
    </p>
  );
}
```

### Migration
Apply when touching `SecretField` (P4) — helper text inside `SecretField` should render via `FieldMessage`:

```tsx
// In SecretField.tsx
{helper && <FieldMessage>{helper}</FieldMessage>}
// or allow caller to pass tone:
{helper && <FieldMessage tone={helperTone}>{helper}</FieldMessage>}
```

Also apply to `KeysTab`, `EnvSection`, and any settings tab with inline `text-xs text-muted-foreground` description text below inputs.

---

## Component 3: `RelativeTime` — `src/renderer/components/ui/relative-time.tsx`

### Background
`relativeTime(timestamp)` utility is already imported from `@/lib/utils` and used in `ThreadItem`, activity timelines, and automation rows. The formatting is consistent but the *presentation* (text size, color, optional tooltip with absolute date) varies per callsite.

### New File
```tsx
import React from 'react';
import { cn, relativeTime } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

interface RelativeTimeProps {
  value: number | string | Date;
  /** Show absolute date/time in a tooltip. Default: true. */
  tooltip?: boolean;
  className?: string;
}

export function RelativeTime({ value, tooltip = true, className }: RelativeTimeProps) {
  const ts = typeof value === 'number' ? value : new Date(value).getTime();
  const relative = relativeTime(ts);
  const absolute = new Date(ts).toLocaleString();

  const text = (
    <span className={cn('text-xs text-muted-foreground tabular-nums', className)}>
      {relative}
    </span>
  );

  if (tooltip) {
    return <Tooltip content={absolute}>{text}</Tooltip>;
  }
  return text;
}
```

### Migration (opportunistic)
- `src/renderer/components/threads/ThreadItem.tsx`: replace `{relativeTime(t.lastActiveAt)}` span with `<RelativeTime value={t.lastActiveAt} />`.
- Activity timeline events and automation job rows: apply when touching those files for other reasons.

---

## Files Changed Summary
| File | Change |
|------|--------|
| `src/renderer/components/ui/property-row.tsx` | **New file** |
| `src/renderer/components/ui/field-message.tsx` | **New file** |
| `src/renderer/components/ui/relative-time.tsx` | **New file** |
| `src/renderer/components/board/TaskPropertiesSidebar.tsx` | Remove local `PropRow`, use `PropertyRow` |
| `src/renderer/components/ui/secret-field.tsx` (from P4) | Use `FieldMessage` for helper text |
| `src/renderer/components/threads/ThreadItem.tsx` | Use `RelativeTime` (can bundle with P3) |

---

## Delivery note
These three don't justify their own PR. Ship them as part of the nearest relevant PR:
- `PropertyRow` + `FieldMessage` → bundle with P4 (touching secrets/keys area anyway)
- `RelativeTime` → bundle with P3 (touching `ThreadItem` anyway)

If neither P3 nor P4 ends up touching these files, ship as a single small cleanup PR.

---

## Acceptance Criteria
- `PropertyRow` exported from `@/components/ui/property-row`; `TaskPropertiesSidebar` has no local `PropRow`
- `FieldMessage` exported from `@/components/ui/field-message`; used in `SecretField` helper slot
- `RelativeTime` exported from `@/components/ui/relative-time`; renders tooltip with absolute date
- `npx tsc --noEmit` passes
