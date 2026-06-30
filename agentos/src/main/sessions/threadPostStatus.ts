// The status lifecycle lives in one place (src/shared/threadStatusLifecycle.ts) so the badge, the
// persisted terminal status, and the Slack reaction echo can't drift. Re-exported under the original
// name to keep this module's existing importers stable.
export { deriveTerminalThreadPostStatus as deriveThreadPostStatus } from '../../shared/threadStatusLifecycle';
