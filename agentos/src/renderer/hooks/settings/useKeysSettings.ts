import type { AppSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useKeysSettings(settings: AppSettings | null) {
  const [anthropic, setAnthropic] = useSettingsField(settings, (s) => s.apiKeys?.anthropic ?? '', '');
  const [openai, setOpenai] = useSettingsField(settings, (s) => s.apiKeys?.openai ?? '', '');
  const [google, setGoogle] = useSettingsField(settings, (s) => s.apiKeys?.google ?? '', '');
  const [openrouter, setOpenrouter] = useSettingsField(settings, (s) => s.apiKeys?.openrouter ?? '', '');
  const [voyage, setVoyage] = useSettingsField(settings, (s) => s.apiKeys?.voyage ?? '', '');
  const [mistral, setMistral] = useSettingsField(settings, (s) => s.apiKeys?.mistral ?? '', '');
  const [tailscaleAuthKey, setTailscaleAuthKey] = useSettingsField(settings, (s) => s.tailscale?.authKey ?? '', '');
  const [tailscaleFunnel, setTailscaleFunnel] = useSettingsField(settings, (s) => Boolean(s.tailscale?.funnel), false);
  const [githubToken, setGithubToken] = useSettingsField(settings, (s) => s.apiKeys?.github ?? '', '');

  return {
    anthropic,
    setAnthropic,
    openai,
    setOpenai,
    google,
    setGoogle,
    openrouter,
    setOpenrouter,
    voyage,
    setVoyage,
    mistral,
    setMistral,
    tailscaleAuthKey,
    setTailscaleAuthKey,
    tailscaleFunnel,
    setTailscaleFunnel,
    githubToken,
    setGithubToken,
  };
}
