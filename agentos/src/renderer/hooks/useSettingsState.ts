import { useState, useEffect, useRef, useMemo } from 'react';
import { useAutoSave } from './useAutoSave';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_SANDBOX_SETTINGS } from '../../shared/types';
import { useKeysSettings } from './settings/useKeysSettings';
import { useMemorySettings } from './settings/useMemorySettings';
import { useAgentSettings } from './settings/useAgentSettings';
import { useAppearanceSettings } from './settings/useAppearanceSettings';
import { useSlackSettings } from './settings/useSlackSettings';
import { useSandboxSettings } from './settings/useSandboxSettings';
import { useEnvSettings } from './settings/useEnvSettings';
import { useRecordingSettings } from './settings/useRecordingSettings';

export function useSettingsState() {
  const [loadedSettings, setLoadedSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const keys = useKeysSettings(loadedSettings);
  const appearance = useAppearanceSettings(loadedSettings);
  const memory = useMemorySettings(loadedSettings);
  const agents = useAgentSettings(loadedSettings);
  const slack = useSlackSettings(loadedSettings);

  const sandbox = useSandboxSettings(loadedSettings);
  const env = useEnvSettings(loadedSettings);
  const rec = useRecordingSettings(loadedSettings);

  useEffect(() => {
    window.electronAPI.settings
      .get()
      .then(setLoadedSettings)
      .catch((err) => {
        console.warn('Failed to load settings', err);
      });
  }, []);

  // Snapshot of all saveable values — changes here trigger debounced autosave
  const settingsSnapshot = useMemo(
    () =>
      JSON.stringify({
        keys: {
          anthropic: keys.anthropic,
          openai: keys.openai,
          google: keys.google,
          openrouter: keys.openrouter,
          voyage: keys.voyage,
          mistral: keys.mistral,
          tailscaleAuthKey: keys.tailscaleAuthKey,
          tailscaleFunnel: keys.tailscaleFunnel,
          githubToken: keys.githubToken,
        },
        appearance: {
          devMode: appearance.devMode,
        },
        memory: {
          embeddingProvider: memory.embeddingProvider,
          embeddingModel: memory.embeddingModel,
          localModelPath: memory.localModelPath,
          memorySearch: memory.memorySearch,
          extraMemoryPaths: memory.extraMemoryPaths,
        },
        agents: {
          queueSilenceFallbackMs: agents.queueSilenceFallbackMs,
          providerOrder: agents.providerOrder,
          persistDebugLogs: agents.persistDebugLogs,
          logRetentionDays: agents.logRetentionDays,
          autopilotEnabled: agents.autopilotEnabled,
          autopilotMaxConsecutiveTurns: agents.autopilotMaxConsecutiveTurns,
          autopilotTranscriptMessages: agents.autopilotTranscriptMessages,
          autopilotPlannerProvider: agents.autopilotPlannerProvider,
          autopilotPlannerModel: agents.autopilotPlannerModel,
          ttsEnabled: agents.ttsEnabled,
        },
        slack: {
          enabled: slack.enabled,
          botToken: slack.botToken,
          appToken: slack.appToken,
          channels: slack.channels,
          channelWorkspaceMap: slack.channelWorkspaceMap,
          requireMention: slack.requireMention,
          defaultWorkingDirectory: slack.defaultWorkingDirectory,
        },
        sandbox: {
          security: sandbox.security,
          runOnHost: sandbox.runOnHost,
          containerPrune: sandbox.containerPrune,
          worktreeSettings: sandbox.worktreeSettings,
        },
        env: { envSafelist: env.envSafelist, envVars: env.envVars },
        recording: rec.recording,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      keys.anthropic,
      keys.openai,
      keys.google,
      keys.openrouter,
      keys.voyage,
      keys.mistral,
      keys.tailscaleAuthKey,
      keys.tailscaleFunnel,
      keys.githubToken,
      memory.embeddingProvider,
      memory.embeddingModel,
      memory.localModelPath,
      memory.memorySearch,
      memory.extraMemoryPaths,
      appearance.devMode,
      agents.queueSilenceFallbackMs,
      agents.providerOrder,
      agents.persistDebugLogs,
      agents.logRetentionDays,
      agents.autopilotEnabled,
      agents.autopilotMaxConsecutiveTurns,
      agents.autopilotTranscriptMessages,
      agents.autopilotPlannerProvider,
      agents.autopilotPlannerModel,
      agents.ttsEnabled,
      slack.enabled,
      slack.botToken,
      slack.appToken,
      slack.channels,
      slack.channelWorkspaceMap,
      slack.requireMention,
      slack.defaultWorkingDirectory,
      sandbox.security,
      sandbox.runOnHost,
      sandbox.containerPrune,
      sandbox.worktreeSettings,
      env.envSafelist,
      env.envVars,
      rec.recording,
    ]
  );

  useAutoSave(settingsSnapshot, save, loadedSettings !== null);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await window.electronAPI.settings.set({
        apiKeys: {
          anthropic: keys.anthropic.trim() || undefined,
          openai: keys.openai.trim() || undefined,
          google: keys.google.trim() || undefined,
          openrouter: keys.openrouter.trim() || undefined,
          voyage: keys.voyage.trim() || undefined,
          mistral: keys.mistral.trim() || undefined,
        },
        embeddingProvider: memory.embeddingProvider,
        embeddingModel: memory.embeddingModel.trim() || undefined,
        localModelPath: memory.localModelPath.trim() || null,
        memorySearch: Object.keys(memory.memorySearch).length > 0 ? memory.memorySearch : undefined,
        extraMemoryPaths: memory.extraMemoryPaths.length > 0 ? memory.extraMemoryPaths : undefined,
        tailscaleAuthKey: keys.tailscaleAuthKey.trim() || null,
        tailscaleFunnel: keys.tailscaleFunnel,
        githubToken: keys.githubToken.trim() || null,
        devMode: appearance.devMode,
        runOnHost: sandbox.runOnHost,
        sandbox: { ...DEFAULT_SANDBOX_SETTINGS, ...sandbox.security },
        queueSilenceFallbackMs: Number.isFinite(agents.queueSilenceFallbackMs)
          ? Math.max(200, Math.floor(agents.queueSilenceFallbackMs))
          : 1_500,
        providerOrder: agents.providerOrder,
        persistDebugLogs: agents.persistDebugLogs,
        logRetentionDays: Number.isFinite(agents.logRetentionDays)
          ? Math.min(365, Math.max(1, Math.floor(agents.logRetentionDays)))
          : 30,
        autopilot: {
          ...(loadedSettings?.autopilot ?? {}),
          enabled: agents.autopilotEnabled,
          maxConsecutiveTurns: Number.isFinite(agents.autopilotMaxConsecutiveTurns)
            ? Math.max(1, Math.floor(agents.autopilotMaxConsecutiveTurns))
            : 3,
          transcriptMessages: Number.isFinite(agents.autopilotTranscriptMessages)
            ? Math.max(1, Math.floor(agents.autopilotTranscriptMessages))
            : 12,
          plannerProvider: agents.autopilotPlannerProvider,
          plannerModel: agents.autopilotPlannerModel,
        },
        slack: {
          enabled: slack.enabled,
          botToken: slack.botToken.trim() || null,
          appToken: slack.appToken.trim() || null,
          watchedChannelIds: slack.channels.map((item) => item.trim()).filter(Boolean),
          channelWorkspaceMap: Object.fromEntries(
            Object.entries(slack.channelWorkspaceMap)
              .map(([channelId, workspace]) => [channelId.trim().toUpperCase(), workspace.trim()] as const)
              .filter(([, workspace]) => Boolean(workspace))
          ),
          requireMention: slack.requireMention,
          defaultWorkingDirectory: slack.defaultWorkingDirectory.trim() || null,
        },
        containerPrune: {
          idleHours: Number.isFinite(sandbox.containerPrune.idleHours)
            ? Math.max(0, sandbox.containerPrune.idleHours)
            : 0,
          maxAgeDays: Number.isFinite(sandbox.containerPrune.maxAgeDays)
            ? Math.max(0, sandbox.containerPrune.maxAgeDays)
            : 0,
        },
        voice: { ttsEnabled: agents.ttsEnabled },
        envSafelist: env.envSafelist.length > 0 ? env.envSafelist : undefined,
        envVars: Object.keys(env.envVars).length > 0 ? env.envVars : undefined,
        worktrees: sandbox.worktreeSettings,
        recording:
          (rec.recording.templates?.length ?? 0) > 0 || rec.recording.activeTemplateId !== undefined
            ? rec.recording
            : undefined,
      });
      setSaved(true);
      clearTimeout(savedTimerRef.current ?? undefined);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
      if (slack.enabled && slack.botToken.trim() && slack.appToken.trim()) {
        slack.discoverChannels().catch((err) => {
          console.warn('Failed to discover Slack channels', err);
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return {
    keys,
    appearance,
    memory,
    agents,
    slack,
    sandbox,
    env,
    recording: rec,
    save,
    saving,
    saved,
  };
}
