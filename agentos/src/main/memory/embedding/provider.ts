import crypto from 'crypto';
import type { AppSettings } from '../../../shared/types';

export type EmbeddingProviderId = 'openai' | 'google' | 'voyage' | 'mistral' | 'local';

export interface EmbeddingProvider {
  id: EmbeddingProviderId;
  model: string;
  dims: number;
  // Stable hash of provider config — used as cache key.
  providerKey: string;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ─── Retry helper ────────────────────────────────────────────────────────────

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1000 * attempt);
      });
    }
    const response = await fetch(url, init);
    const retryable = !response.ok && (response.status === 429 || response.status >= 500);
    if (!retryable || attempt === 1) return response;
  }
  return fetch(url, init);
}

function providerKey(data: Record<string, string>): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
}

// ─── Shared REST provider factory (OpenAI-compatible response shape) ─────────
// Used for providers whose batch endpoint returns { data: [{ embedding }] }.

interface RestProviderOpts {
  id: EmbeddingProviderId;
  model: string;
  dims: number;
  url: string;
  headers: Record<string, string>;
  buildBody: (texts: string[]) => object;
  // Override providerKey hash inputs (default: { id, model, dims }).
  pkData?: Record<string, string>;
}

function createRestProvider(opts: RestProviderOpts): EmbeddingProvider {
  const { id, model, dims, url, headers, buildBody } = opts;
  return {
    id,
    model,
    dims,
    providerKey: providerKey(opts.pkData ?? { id, model, dims: String(dims) }),
    async embedQuery(text) {
      return (await this.embedBatch([text]))[0] ?? [];
    },
    async embedBatch(texts) {
      const response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(buildBody(texts)) });
      if (!response.ok) throw new Error(`${id} embeddings: ${response.status} ${await response.text()}`);
      const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      return (payload.data ?? []).map((item) => item.embedding ?? []);
    },
  };
}

// ─── OpenAI provider ─────────────────────────────────────────────────────────

function createOpenAiProvider(apiKey: string, dims = 768): EmbeddingProvider {
  const model = 'text-embedding-3-small';
  return createRestProvider({
    id: 'openai',
    model,
    dims,
    url: 'https://api.openai.com/v1/embeddings',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    buildBody: (texts) => ({ model, input: texts, dimensions: dims, encoding_format: 'float' }),
  });
}

// ─── Google provider ─────────────────────────────────────────────────────────

function resolveGeminiHeaders(apiKey: string): Record<string, string> {
  if (apiKey.startsWith('{')) {
    try {
      const parsed = JSON.parse(apiKey) as { token?: string };
      if (typeof parsed.token === 'string')
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${parsed.token}` };
    } catch {
      /* fall through */
    }
  }
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

function createGoogleProvider(apiKey: string, dims = 768): EmbeddingProvider {
  const model = 'models/gemini-embedding-001';
  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  const headers = resolveGeminiHeaders(apiKey);
  return {
    id: 'google',
    model,
    dims,
    providerKey: providerKey({ id: 'google', model, dims: String(dims) }),
    async embedQuery(text) {
      const response = await fetchWithRetry(`${baseUrl}/${model}:embedContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: dims,
        }),
      });
      if (!response.ok) throw new Error(`Google embeddings: ${response.status} ${await response.text()}`);
      const payload = (await response.json()) as { embedding?: { values?: number[] } };
      return payload.embedding?.values ?? [];
    },
    async embedBatch(texts) {
      if (texts.length === 1) return [await this.embedQuery(texts[0]!)];
      const response = await fetchWithRetry(`${baseUrl}/${model}:batchEmbedContents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: dims,
          })),
        }),
      });
      if (!response.ok) throw new Error(`Google embeddings: ${response.status} ${await response.text()}`);
      const payload = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
      return (payload.embeddings ?? []).map((item) => item.values ?? []);
    },
  };
}

// ─── Voyage provider ─────────────────────────────────────────────────────────

function createVoyageProvider(apiKey: string, dims = 768): EmbeddingProvider {
  const model = 'voyage-4-large';
  return createRestProvider({
    id: 'voyage',
    model,
    dims,
    url: 'https://api.voyageai.com/v1/embeddings',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    buildBody: (texts) => ({ model, input: texts, input_type: 'query', output_dimension: dims }),
  });
}

// ─── Mistral provider ────────────────────────────────────────────────────────

function createMistralProvider(apiKey: string): EmbeddingProvider {
  const model = 'mistral-embed';
  const dims = 1024; // mistral-embed doesn't support dimension reduction
  return createRestProvider({
    id: 'mistral',
    model,
    dims,
    url: 'https://api.mistral.ai/v1/embeddings',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    buildBody: (texts) => ({ model, input: texts, encoding_format: 'float' }),
    pkData: { id: 'mistral', model },
  });
}

// ─── Local provider (node-llama-cpp) ─────────────────────────────────────────

let localProvider: EmbeddingProvider | null | undefined; // undefined = not initialized
// In-flight load promise so concurrent first-callers share one loadModel call
// instead of each spinning up their own (model load is 5-30s and the resolveModelFile
// call may download a multi-hundred-MB GGUF).
let localProviderLoading: Promise<EmbeddingProvider | null> | null = null;

async function createLocalProvider(modelPath?: string | null): Promise<EmbeddingProvider | null> {
  if (localProvider !== undefined) return localProvider;
  if (localProviderLoading) return localProviderLoading;
  localProviderLoading = (async () => {
    try {
      // Lazy import — node-llama-cpp is a heavy native module
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const llamaCpp = (await import('node-llama-cpp')) as any;
      const llama = await llamaCpp.getLlama({ logLevel: 'error' });
      const hfPath =
        modelPath?.trim() || 'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf';
      // resolveModelFile handles hf: URLs (downloads if needed) and returns an absolute path.
      // loadModel only accepts absolute paths, not hf: URLs.
      const resolvedModelPath: string = await llamaCpp.resolveModelFile(hfPath);
      const model = await llama.loadModel({ modelPath: resolvedModelPath });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = await model.createEmbeddingContext();
      const dims = (typeof ctx.embeddingDimensions === 'number' ? ctx.embeddingDimensions : null) ?? 768;

      localProvider = {
        id: 'local',
        model: resolvedModelPath,
        dims,
        providerKey: providerKey({ id: 'local', modelPath: resolvedModelPath }),
        async embedQuery(text) {
          return (await this.embedBatch([text]))[0] ?? [];
        },
        async embedBatch(texts) {
          // Serial loop: node-llama-cpp's embedding context is a single resource
          // and parallel submission via Promise.all has not been verified safe
          // (would need a benchmark + memory check). Each await still yields the
          // event loop between texts, which is the important property here.
          const results: number[][] = [];
          for (const text of texts) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw: any = await ctx.getEmbeddingFor(text);
            const vec: number[] = Array.from(raw.vector as ArrayLike<number>);
            const norm = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0)) || 1;
            results.push(vec.map((v: number) => v / norm));
          }
          return results;
        },
      };
      return localProvider;
    } catch {
      localProvider = null;
      return null;
    } finally {
      localProviderLoading = null;
    }
  })();
  return localProviderLoading;
}

// ─── Fallback cascade ────────────────────────────────────────────────────────

// Create the best available embedding provider given the current settings.
// Returns null when no provider is configured (FTS-only mode).
export async function createEmbeddingProvider(settings: AppSettings): Promise<EmbeddingProvider | null> {
  const requested = settings.embeddingProvider ?? 'local';
  const keys = settings.apiKeys ?? {};

  // Helper: try a single factory, return null on auth failure, rethrow on other errors
  async function tryProvider(
    factory: () => EmbeddingProvider | Promise<EmbeddingProvider | null>
  ): Promise<EmbeddingProvider | null> {
    try {
      return await factory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 401/403 = auth failure → skip; other errors = rethrow
      if (/401|403|Unauthorized|Forbidden|Invalid API key/i.test(msg)) return null;
      throw err;
    }
  }

  if (requested !== 'auto') {
    // Try exactly the requested provider
    switch (requested) {
      case 'openai':
        return tryProvider(() => (keys.openai ? createOpenAiProvider(keys.openai) : null));
      case 'google':
        return tryProvider(() => (keys.google ? createGoogleProvider(keys.google) : null));
      case 'voyage':
        return tryProvider(() => (keys.voyage ? createVoyageProvider(keys.voyage) : null));
      case 'mistral':
        return tryProvider(() => (keys.mistral ? createMistralProvider(keys.mistral) : null));
      case 'local':
        return tryProvider(() => createLocalProvider(settings.localModelPath));
      default:
        return null;
    }
  }

  // Auto: try providers in order of available credentials
  const candidates: Array<() => Promise<EmbeddingProvider | null>> = [];
  if (keys.openai?.trim()) candidates.push(() => tryProvider(() => createOpenAiProvider(keys.openai!)));
  if (keys.google?.trim()) candidates.push(() => tryProvider(() => createGoogleProvider(keys.google!)));
  if (keys.voyage?.trim()) candidates.push(() => tryProvider(() => createVoyageProvider(keys.voyage!)));
  if (keys.mistral?.trim()) candidates.push(() => tryProvider(() => createMistralProvider(keys.mistral!)));
  candidates.push(() => createLocalProvider(settings.localModelPath));

  for (const candidate of candidates) {
    const provider = await candidate();
    if (provider) return provider;
  }
  return null; // FTS-only mode
}
