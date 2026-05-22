import { getStore } from '../../store/index';

export const GLOBAL_IMAGE_NAME = 'agentos-sandbox:latest';
export const MIN_CODEX_CLI_VERSION = '0.107.0';

export function markSandboxImageBuilt(sandboxHash: string): void {
  getStore().set('meta', {
    ...getStore().get('meta'),
    sandboxImageHash: sandboxHash,
    sandboxImageBuiltAt: Date.now(),
  });
}
