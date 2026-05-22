# P1 — Adopt Existing Primitives

## Goal
Remove duplicated inline markup by migrating call sites to primitives that already exist in `components/ui/`. No new components; only migration and two small API extensions.

## Background
`SettingSection`, `DisclosureSection`, `EmptyState`, and `LoadingState` all exist but are widely ignored. Inline equivalents have proliferated in settings tabs, project sections, and the chat view.

---

## Part A — Uppercase section-group labels → `SettingSection`

`SettingSection` (`components/ui/setting-section.tsx`) already renders:
```tsx
<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
```

### Files to update
| File | What to change |
|------|----------------|
| `src/renderer/components/settings/KeysTab.tsx` | Wrap the GitHub and Tailscale groups in `<SettingSection title="GitHub">` / `<SettingSection title="Tailscale">`. Remove inline `<p className="text-xs font-medium …">` labels and `<Separator />` above them (SettingSection provides its own spacing). |
| `src/renderer/components/project/sections/KeysSection.tsx` | Same — GitHub and Tailscale groups use the same inline pattern. |
| Any other settings tab using the same `text-xs font-medium text-muted-foreground uppercase tracking-wide` pattern | Grep and replace. |

### Verification
```bash
grep -r "uppercase tracking-wide" src/renderer/components --include="*.tsx"
```
Should return zero results after migration.

---

## Part B — Promote `SectionHeader`

`project/sections/SectionHeader.tsx` is a title+description header used in project settings but not imported in the global settings tabs. Move it to `components/ui/` so both can share it.

### Steps
1. Move file: `src/renderer/components/project/sections/SectionHeader.tsx` → `src/renderer/components/ui/section-header.tsx`
2. Add an optional `action` slot:
   ```tsx
   interface SectionHeaderProps {
     title: React.ReactNode;
     description?: React.ReactNode;
     action?: React.ReactNode;       // ← new
     className?: string;
   }
   // render: justify-between row if action present
   ```
3. Update all imports from `./SectionHeader` / `../sections/SectionHeader` to `@/components/ui/section-header`.
4. Add inline title+description blocks in settings tabs (e.g. `KeysTab` has a bare `<p className="text-xs text-muted-foreground">…</p>` at the top — replace with `<SectionHeader title="Keys" description="…" />`).

### Files to update (imports)
- `src/renderer/components/project/sections/KeysSection.tsx`
- `src/renderer/components/project/sections/EnvSection.tsx`
- `src/renderer/components/project/sections/AgentsSection.tsx`
- `src/renderer/components/project/sections/AutopilotSection.tsx`
- `src/renderer/components/project/sections/SandboxSection.tsx`
- `src/renderer/components/project/sections/MemorySection.tsx`
- Any other project section importing the old path.

---

## Part C — Migrate `ToolCard` expand/collapse to `DisclosureSection`

`ThinkingSection` already uses `DisclosureSection` correctly. `ToolCard` has a parallel inline implementation using `showFull` state + "show more" / "show less" buttons that should use the same primitive.

`DisclosureSection` accepts `trigger: ReactNode` — pass a plain text button as the trigger (no caret needed for ToolCard):

```tsx
// Before (ToolCard.tsx — simplified)
const [showFull, setShowFull] = useState(false);
// ... conditional render with <Button onClick={() => setShowFull(true)}>show more</Button>

// After
<DisclosureSection
  trigger={<span className="text-xs text-muted-foreground/40">show more</span>}
  defaultOpen={false}
  // hide the default caret via triggerClassName that overrides caret display
>
  {/* full content */}
</DisclosureSection>
```

Alternatively, add a `hideCaret?: boolean` prop to `DisclosureSection` if the caret is unwanted at that call site. This is the minimal API extension needed.

### Files to update
- `src/renderer/components/chat/ToolCard.tsx` — replace `showFull` state + conditional render.

---

## Part D — Add `action` slot to `EmptyState`

Most inline empty states include a call-to-action button. The existing `EmptyState` has no `action` slot, forcing callers to either inline their own or skip the primitive.

### Change to `components/ui/empty-state.tsx`
```tsx
interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;   // ← new
  className?: string;
}
// render action below description if present
```

Then audit for inline empty states and replace with `<EmptyState … action={<Button>…</Button>} />`.

---

## Acceptance Criteria
- `grep -r "uppercase tracking-wide" src/renderer/components --include="*.tsx"` → 0 results
- `SectionHeader` importable from `@/components/ui/section-header`
- `ToolCard` has no `showFull` state
- `EmptyState` has `action` prop
- `npx tsc --noEmit` passes
- No visual regressions in settings modal, board, and chat panels
