import React from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SettingSection } from '@/components/ui/setting-section';
import { SecretField } from '@/components/ui/secret-field';
import { cn } from '@/lib/utils';
import { useSettings } from '../../contexts/SettingsContext';

export function KeysTab() {
  const { keys } = useSettings();

  return (
    <>
      <p className="text-xs text-muted-foreground">Stored locally and passed to containers as environment variables.</p>
      <SecretField
        id="key-anthropic"
        label="Anthropic (Claude)"
        value={keys.anthropic}
        onChange={keys.setAnthropic}
        placeholder="sk-ant-..."
      />
      <SecretField
        id="key-openai"
        label="OpenAI (Codex)"
        value={keys.openai}
        onChange={keys.setOpenai}
        placeholder="sk-..."
      />
      <SecretField
        id="key-google"
        label="Google (Gemini)"
        value={keys.google}
        onChange={keys.setGoogle}
        placeholder="AIza..."
      />
      <SecretField
        id="key-openrouter"
        label="OpenRouter"
        value={keys.openrouter}
        onChange={keys.setOpenrouter}
        placeholder="sk-or-v1-..."
        helper="Used when a provider entry's backend is set to OpenRouter."
      />
      <Separator />
      <SettingSection title="GitHub">
        <SecretField
          id="key-github"
          label="Personal Access Token"
          value={keys.githubToken}
          onChange={keys.setGithubToken}
          placeholder="github_pat_..."
          helper={
            <>
              Passed as <span className="font-mono">GH_TOKEN</span> to containers. Used by{' '}
              <span className="font-mono">gh</span> CLI and for git push over HTTPS.
            </>
          }
        />
      </SettingSection>
      <Separator />
      <SettingSection title="Tailscale">
        <SecretField
          id="key-tailscale"
          label="Auth Key"
          value={keys.tailscaleAuthKey}
          onChange={keys.setTailscaleAuthKey}
          placeholder="tskey-auth-..."
          helper={
            <>
              When set, each sandbox container starts Tailscale in userspace mode and joins your tailnet. Generate a
              reusable auth key at <span className="font-mono">tailscale.com/admin/settings/keys</span>.
            </>
          }
        />
        <div className="flex flex-col gap-1.5">
          <Label>Access</Label>
          <RadioGroup
            value={keys.tailscaleFunnel ? 'public' : 'private'}
            onValueChange={(v) => keys.setTailscaleFunnel(v === 'public')}
            className="flex gap-3"
          >
            {[
              { value: 'private', title: 'Private', desc: 'Only accessible within your Tailnet' },
              { value: 'public', title: 'Public', desc: 'Exposed publicly via Tailscale Funnel on port 3000' },
            ].map(({ value, title, desc }) => (
              <Label
                key={value}
                htmlFor={`access-${value}`}
                className={cn(
                  'flex-1 rounded-md border px-3 py-2 text-xs text-left cursor-pointer transition-colors',
                  (value === 'public') === keys.tailscaleFunnel
                    ? 'border-primary bg-primary/5 text-primary font-medium'
                    : 'border-input text-muted-foreground hover:border-foreground'
                )}
              >
                <RadioGroupItem value={value} id={`access-${value}`} className="sr-only" />
                <div className="font-medium">{title}</div>
                <div className="mt-0.5 text-muted-foreground">{desc}</div>
              </Label>
            ))}
          </RadioGroup>
        </div>
      </SettingSection>
    </>
  );
}
