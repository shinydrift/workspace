---
name: agentos-settings
description: Add or modify settings in the AgentOS settings modal — keys, types, Slack, sandbox, and containers tabs
metadata:
  agentos:
    emoji: "⚙️"
---

# AgentOS Settings Skill

Key files:
- UI: `agentos/src/renderer/components/settings/SettingsModal.tsx`
- Types + defaults: `agentos/src/shared/types.ts`

## Adding a new setting

1. Add the field to the relevant type in `shared/types.ts` and update its `DEFAULT_*` constant.
2. Add a `useState` for it in `SettingsModal.tsx`.
3. Load it from `s.*` in the `useEffect` settings.get() block.
4. Persist it in the `save()` function.
5. Render the input in the appropriate tab section.

## Slack channel table

Columns: Channel, ID, Type, Project, Action.
`SlackChannelOption` (from `shared/types.ts`) has `id`, `name`, and `isPrivate`.
Discovered channels are stored in `slackDiscoveredChannels` state; watched IDs in `slackChannels`.
The Type column shows `channel.isPrivate ? 'Private' : 'Public'`, or `'—'` if not yet discovered.

## Tabs

`'keys' | 'claude' | 'slack' | 'sandbox' | 'memory' | 'containers'`

Match the existing tab pattern: `{tab === 'foo' && (<>...</>)}`.
