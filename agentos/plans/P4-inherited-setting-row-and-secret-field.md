# P4 — InheritedSettingRow + SecretField

## Goal
Standardize the app-level-default / project-level-override UX pattern and password input rows, which are independently re-implemented in the global settings tab and the project settings section.

## Background

### Current duplication
| Location | What it does |
|----------|-------------|
| `settings/KeysTab.tsx` | Renders password `<Input>` with `<Label>` and `autoComplete="off"`. No inheritance UI. |
| `project/sections/KeysSection.tsx` — local `KeyRow` | Renders password `<Input>` + `<Label>` + optional "Using app setting." hint + "reset to app" button. Has project-level override semantics. |
| `project/sections/InheritHint.tsx` | Renders `<p className="text-xs text-muted-foreground">Using app setting.</p>` only when `show` is true. |
| `project/sections/EnvSection.tsx` — local `InheritedVarRow` | Renders key=value row with `opacity-50` + "app" label for inherited env vars. |

The same conceptual question ("is this using the app default or overridden by the project?") is expressed four different ways.

---

## New File 1: `src/renderer/components/ui/secret-field.tsx`

A pure presentational component for password/secret inputs. No inheritance logic.

```tsx
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface SecretFieldProps {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helper?: React.ReactNode;         // hint text below the input
  rightAction?: React.ReactNode;    // button next to the label (e.g. "reset to app")
  disabled?: boolean;
  className?: string;
}

export function SecretField({
  id,
  label,
  value,
  onChange,
  placeholder,
  helper,
  rightAction,
  disabled,
  className,
}: SecretFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {rightAction}
      </div>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
      />
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}
```

---

## New File 2: `src/renderer/components/settings/inherited-setting-row.tsx`

Wraps `SecretField` (or any input) with the app-level inheritance pattern: shows "Using app setting." when not overridden, shows "reset to app" button when overridden.

```tsx
import React from 'react';
import { Button } from '@/components/ui/button';

interface InheritedSettingRowProps {
  /** True when a project-level value exists and overrides the app default. */
  isOverridden: boolean;
  /** True when the app has a value set (determines whether override UI is shown at all). */
  hasAppValue: boolean;
  onReset?: () => void;
  children: React.ReactNode;     // the input/control being wrapped
}

export function InheritedSettingRow({ isOverridden, hasAppValue, onReset, children }: InheritedSettingRowProps) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      {!isOverridden && hasAppValue && (
        <p className="text-xs text-muted-foreground">Using app setting.</p>
      )}
      {isOverridden && hasAppValue && onReset && (
        <Button
          type="button"
          variant="ghost"
          className="self-start h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
          onClick={onReset}
        >
          reset to app
        </Button>
      )}
    </div>
  );
}
```

Or, collapse both into one by composing them at the `SecretField` level via `rightAction` and `helper`. The caller decides which model fits better.

**Simpler composition pattern** (preferred if the reset button is always next to the label):

```tsx
// In KeysSection, per-key:
<SecretField
  id="proj-key-anthropic"
  label="Anthropic (Claude)"
  value={apiKeys.anthropic ?? ''}
  placeholder={hasAppValue ? `sk-ant-… (using app key)` : 'sk-ant-…'}
  onChange={(v) => onPatch({ ...apiKeys, anthropic: v || undefined })}
  helper={!apiKeys.anthropic && hasAppValue ? 'Using app setting.' : undefined}
  rightAction={
    apiKeys.anthropic && hasAppValue ? (
      <Button variant="ghost" className="h-auto p-0 text-xs" onClick={() => onPatch({ ...apiKeys, anthropic: undefined })}>
        reset to app
      </Button>
    ) : undefined
  }
/>
```

---

## Migration: `settings/KeysTab.tsx`

Replace each password field block with `SecretField`. Global settings have no project-level inheritance, so skip `rightAction`/`helper` inheritance UI here:

```tsx
// Before
<div className="flex flex-col gap-1.5">
  <Label htmlFor="key-anthropic">Anthropic (Claude)</Label>
  <Input id="key-anthropic" type="password" value={keys.anthropic} onChange={…} placeholder="sk-ant-..." autoComplete="off" />
</div>

// After
<SecretField
  id="key-anthropic"
  label="Anthropic (Claude)"
  value={keys.anthropic}
  onChange={keys.setAnthropic}
  placeholder="sk-ant-..."
/>
```

Fields to migrate in `KeysTab`: Anthropic, OpenAI, Google, GitHub PAT, Tailscale Auth Key.

---

## Migration: `project/sections/KeysSection.tsx`

Replace local `KeyRow` with `SecretField` (remove the local function entirely). Use `helper`/`rightAction` props for the inheritance UI:

```tsx
// Remove: local KeyRow function (lines ~38–79)
// Replace each <KeyRow …> with <SecretField …> + inline inheritance props
```

---

## Migration: `project/sections/InheritHint.tsx`

`InheritHint` becomes redundant once `SecretField`'s `helper` prop handles this. After migrating `KeysSection`, check if `InheritHint` is used elsewhere:

```bash
grep -r "InheritHint" src/ --include="*.tsx"
```

If no remaining callers, delete `project/sections/InheritHint.tsx`.

---

## Files Changed Summary
| File | Change |
|------|--------|
| `src/renderer/components/ui/secret-field.tsx` | **New file** |
| `src/renderer/components/settings/inherited-setting-row.tsx` | **New file** (optional — may not be needed if SecretField props suffice) |
| `src/renderer/components/settings/KeysTab.tsx` | Replace 5× password field blocks with `SecretField` |
| `src/renderer/components/project/sections/KeysSection.tsx` | Remove local `KeyRow`, use `SecretField` |
| `src/renderer/components/project/sections/InheritHint.tsx` | Delete if no remaining callers |

---

## Edge Cases
- Empty string vs `undefined`: both `KeysTab` and `KeysSection` treat empty string as "not set". `SecretField` should call `onChange('')` and callers decide how to interpret it (`|| undefined` pattern is already in both files).
- Password manager autocomplete: preserve `autoComplete="off"` on all secret inputs.
- Tailscale funnel radio group is not a secret field — don't fold it into `SecretField`.

---

## Acceptance Criteria
- `SecretField` exported from `@/components/ui/secret-field`
- `settings/KeysTab.tsx` has no `<Input type="password">` directly — uses `SecretField`
- `project/sections/KeysSection.tsx` has no local `KeyRow` function
- Inheritance hint ("Using app setting.") and reset button render correctly in project keys section
- `npx tsc --noEmit` passes
- Settings modal keys tab and project settings keys section look identical to before
