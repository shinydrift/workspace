import type { AppSettings, MemoryConfig } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useMemorySettings(settings: AppSettings | null) {
  const [embeddingProvider, setEmbeddingProvider] = useSettingsField(
    settings,
    (s) => s.memory?.embeddingProvider ?? 'auto',
    'local' as 'auto' | 'openai' | 'google' | 'voyage' | 'mistral' | 'local'
  );
  const [embeddingModel, setEmbeddingModel] = useSettingsField(settings, (s) => s.memory?.embeddingModel ?? '', '');
  const [localModelPath, setLocalModelPath] = useSettingsField(settings, (s) => s.memory?.localModelPath ?? '', '');
  const [memoryConfig, setMemoryConfig] = useSettingsField<MemoryConfig>(settings, (s) => s.memory ?? {}, {});
  const [extraMemoryPaths, setExtraMemoryPaths] = useSettingsField(
    settings,
    (s) => s.memory?.extraPaths ?? [],
    [] as string[]
  );
  const [importExternalSessions, setImportExternalSessions] = useSettingsField(
    settings,
    (s) => s.importExternalSessions?.enabled ?? true,
    true
  );
  return {
    embeddingProvider,
    setEmbeddingProvider,
    embeddingModel,
    setEmbeddingModel,
    localModelPath,
    setLocalModelPath,
    memoryConfig,
    setMemoryConfig,
    extraMemoryPaths,
    setExtraMemoryPaths,
    importExternalSessions,
    setImportExternalSessions,
  };
}
