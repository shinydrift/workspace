import React, { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSettings } from '../../contexts/SettingsContext';
import { useLogsStore } from '../../store/logsStore';
import { timeAgo } from '../../lib/utils';

type EmbeddingProvider = 'auto' | 'openai' | 'google' | 'voyage' | 'mistral' | 'local';

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  google: 'gemini-embedding-001',
  voyage: 'voyage-4-large',
  mistral: 'mistral-embed',
};

export function EmbeddingProviderSection() {
  const { memory, keys } = useSettings();
  const logs = useLogsStore((s) => s.logs);
  const lastEmbed = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const e = logs[i];
      if (e.subsystem === 'memory' && e.message === 'Indexed') return e;
    }
    return null;
  }, [logs]);

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="embeddingProvider">Embedding provider</Label>
        <Select
          value={memory.embeddingProvider}
          onValueChange={(v) => memory.setEmbeddingProvider(v as EmbeddingProvider)}
        >
          <SelectTrigger id="embeddingProvider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (use first configured key)</SelectItem>
            <SelectItem value="openai">OpenAI (text-embedding-3-small)</SelectItem>
            <SelectItem value="google">Google (gemini-embedding-001)</SelectItem>
            <SelectItem value="voyage">Voyage (voyage-4-large)</SelectItem>
            <SelectItem value="mistral">Mistral (mistral-embed)</SelectItem>
            <SelectItem value="local">Local (node-llama-cpp, downloads ~300 MB)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {memory.embeddingProvider !== 'auto' && memory.embeddingProvider !== 'local' && (
        <div className="space-y-2">
          <Label htmlFor="embeddingModel">Model override</Label>
          <Input
            id="embeddingModel"
            value={memory.embeddingModel}
            onChange={(e) => memory.setEmbeddingModel(e.target.value)}
            placeholder={PROVIDER_DEFAULT_MODELS[memory.embeddingProvider] ?? ''}
          />
          <p className="text-xs text-muted-foreground">Leave blank to use the default model for this provider.</p>
        </div>
      )}

      {(memory.embeddingProvider === 'voyage' || memory.embeddingProvider === 'auto') && (
        <div className="space-y-2">
          <Label htmlFor="voyage">Voyage API key</Label>
          <Input
            id="voyage"
            type="password"
            value={keys.voyage}
            onChange={(e) => keys.setVoyage(e.target.value)}
            placeholder="pa-..."
          />
        </div>
      )}

      {(memory.embeddingProvider === 'mistral' || memory.embeddingProvider === 'auto') && (
        <div className="space-y-2">
          <Label htmlFor="mistral">Mistral API key</Label>
          <Input
            id="mistral"
            type="password"
            value={keys.mistral}
            onChange={(e) => keys.setMistral(e.target.value)}
            placeholder="..."
          />
        </div>
      )}

      {memory.embeddingProvider === 'local' && (
        <div className="space-y-2">
          <Label htmlFor="localModelPath">Local model path (GGUF)</Label>
          <Input
            id="localModelPath"
            value={memory.localModelPath}
            onChange={(e) => memory.setLocalModelPath(e.target.value)}
            placeholder="Leave blank to auto-download embeddinggemma-300m"
          />
          <p className="text-xs text-muted-foreground">
            Accepts a local file path or a HuggingFace URL like <code>hf:org/repo/model.gguf</code>.
          </p>
        </div>
      )}

      {lastEmbed && (
        <p className="text-xs text-muted-foreground">
          Last indexed · {String(lastEmbed.meta?.files ?? '')} files · {String(lastEmbed.meta?.chunks ?? '')} chunks ·{' '}
          {String(lastEmbed.meta?.source ?? '')} · {timeAgo(lastEmbed.ts)}
        </p>
      )}
    </>
  );
}
