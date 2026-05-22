import type { AppSettings, MemorySearchSettings } from '../../../shared/types';
import { useSettingsField } from './useSettingsField';

export function useMemorySettings(settings: AppSettings | null) {
  const [embeddingProvider, setEmbeddingProvider] = useSettingsField(
    settings,
    (s) => s.embeddingProvider ?? 'auto',
    'local' as 'auto' | 'openai' | 'google' | 'voyage' | 'mistral' | 'local'
  );
  const [embeddingModel, setEmbeddingModel] = useSettingsField(settings, (s) => s.embeddingModel ?? '', '');
  const [localModelPath, setLocalModelPath] = useSettingsField(settings, (s) => s.localModelPath ?? '', '');
  const [memorySearch, setMemorySearch] = useSettingsField<MemorySearchSettings>(
    settings,
    (s) => s.memorySearch ?? {},
    {}
  );
  const [extraMemoryPaths, setExtraMemoryPaths] = useSettingsField(
    settings,
    (s) => s.extraMemoryPaths ?? [],
    [] as string[]
  );
  return {
    embeddingProvider,
    setEmbeddingProvider,
    embeddingModel,
    setEmbeddingModel,
    localModelPath,
    setLocalModelPath,
    memorySearch,
    setMemorySearch,
    extraMemoryPaths,
    setExtraMemoryPaths,
  };
}
