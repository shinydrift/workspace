import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SettingSection } from '@/components/ui/setting-section';
import { SecretField } from '@/components/ui/secret-field';
import { SectionHeader } from './SectionHeader';
import { TailscaleFunnelAccess } from './TailscaleFunnelAccess';

interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  voyage?: string;
  mistral?: string;
  github?: string;
  tailscaleAuthKey?: string;
  tailscaleFunnel?: boolean;
}

interface AppKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  voyage?: string;
  mistral?: string;
  githubToken?: string | null;
  tailscaleAuthKey?: string | null;
  tailscaleFunnel?: boolean;
}

interface Props {
  apiKeys: ApiKeys;
  appKeys?: AppKeys;
  savingKey: string | null;
  onPatch: (patch: ApiKeys) => void;
}

function resetAction(value: string, hasAppValue: boolean, onReset: () => void): React.ReactNode {
  if (!value || !hasAppValue) return undefined;
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
      onClick={onReset}
    >
      reset to app
    </Button>
  );
}

function inheritHelper(value: string, hasAppValue: boolean): React.ReactNode {
  if (value || !hasAppValue) return undefined;
  return 'Using app setting.';
}

export function KeysSection({ apiKeys, appKeys, savingKey, onPatch }: Props) {
  const funnel = apiKeys.tailscaleFunnel ?? appKeys?.tailscaleFunnel ?? false;
  const hasTailscaleAppKey = Boolean(appKeys?.tailscaleAuthKey);

  return (
    <>
      <SectionHeader
        title="Keys"
        description="Override API keys for this project. Leave blank to use app-level keys."
      />
      <SecretField
        id="proj-key-anthropic"
        label="Anthropic (Claude)"
        value={apiKeys.anthropic ?? ''}
        placeholder={appKeys?.anthropic ? 'sk-ant-... (using app key)' : 'sk-ant-...'}
        onChange={(v) => onPatch({ ...apiKeys, anthropic: v || undefined })}
        rightAction={resetAction(apiKeys.anthropic ?? '', Boolean(appKeys?.anthropic), () =>
          onPatch({ ...apiKeys, anthropic: undefined })
        )}
        helper={inheritHelper(apiKeys.anthropic ?? '', Boolean(appKeys?.anthropic))}
      />
      <SecretField
        id="proj-key-openai"
        label="OpenAI (Codex)"
        value={apiKeys.openai ?? ''}
        placeholder={appKeys?.openai ? 'sk-... (using app key)' : 'sk-...'}
        onChange={(v) => onPatch({ ...apiKeys, openai: v || undefined })}
        rightAction={resetAction(apiKeys.openai ?? '', Boolean(appKeys?.openai), () =>
          onPatch({ ...apiKeys, openai: undefined })
        )}
        helper={inheritHelper(apiKeys.openai ?? '', Boolean(appKeys?.openai))}
      />
      <SecretField
        id="proj-key-google"
        label="Google (Gemini)"
        value={apiKeys.google ?? ''}
        placeholder={appKeys?.google ? 'AIza... (using app key)' : 'AIza...'}
        onChange={(v) => onPatch({ ...apiKeys, google: v || undefined })}
        rightAction={resetAction(apiKeys.google ?? '', Boolean(appKeys?.google), () =>
          onPatch({ ...apiKeys, google: undefined })
        )}
        helper={inheritHelper(apiKeys.google ?? '', Boolean(appKeys?.google))}
      />
      <SecretField
        id="proj-key-voyage"
        label="Voyage (embeddings)"
        value={apiKeys.voyage ?? ''}
        placeholder={appKeys?.voyage ? 'pa-... (using app key)' : 'pa-...'}
        onChange={(v) => onPatch({ ...apiKeys, voyage: v || undefined })}
        rightAction={resetAction(apiKeys.voyage ?? '', Boolean(appKeys?.voyage), () =>
          onPatch({ ...apiKeys, voyage: undefined })
        )}
        helper={inheritHelper(apiKeys.voyage ?? '', Boolean(appKeys?.voyage))}
      />
      <SecretField
        id="proj-key-mistral"
        label="Mistral (embeddings)"
        value={apiKeys.mistral ?? ''}
        placeholder={appKeys?.mistral ? '... (using app key)' : '...'}
        onChange={(v) => onPatch({ ...apiKeys, mistral: v || undefined })}
        rightAction={resetAction(apiKeys.mistral ?? '', Boolean(appKeys?.mistral), () =>
          onPatch({ ...apiKeys, mistral: undefined })
        )}
        helper={inheritHelper(apiKeys.mistral ?? '', Boolean(appKeys?.mistral))}
      />

      <Separator />

      <SettingSection title="GitHub">
        <SecretField
          id="proj-key-github"
          label="Personal Access Token"
          value={apiKeys.github ?? ''}
          placeholder={appKeys?.githubToken ? 'github_pat_... (using app key)' : 'github_pat_...'}
          onChange={(v) => onPatch({ ...apiKeys, github: v || undefined })}
          rightAction={resetAction(apiKeys.github ?? '', Boolean(appKeys?.githubToken), () =>
            onPatch({ ...apiKeys, github: undefined })
          )}
          helper={inheritHelper(apiKeys.github ?? '', Boolean(appKeys?.githubToken))}
        />
      </SettingSection>

      <Separator />

      <SettingSection title="Tailscale">
        <SecretField
          id="proj-key-tailscale"
          label="Auth Key"
          value={apiKeys.tailscaleAuthKey ?? ''}
          placeholder={hasTailscaleAppKey ? 'tskey-auth-... (using app key)' : 'tskey-auth-...'}
          onChange={(v) => onPatch({ ...apiKeys, tailscaleAuthKey: v || undefined })}
          rightAction={resetAction(apiKeys.tailscaleAuthKey ?? '', hasTailscaleAppKey, () =>
            onPatch({ ...apiKeys, tailscaleAuthKey: undefined })
          )}
          helper={inheritHelper(apiKeys.tailscaleAuthKey ?? '', hasTailscaleAppKey)}
        />
        <TailscaleFunnelAccess
          value={funnel}
          isInherited={apiKeys.tailscaleFunnel === undefined}
          onChange={(value) => onPatch({ ...apiKeys, tailscaleFunnel: value })}
        />
      </SettingSection>

      {savingKey === 'apiKeys' && <p className="text-xs text-muted-foreground">Saving…</p>}
    </>
  );
}
