// The status lifecycle lives in one place (src/shared/threadStatusLifecycle.ts) so the badge, the
// persisted terminal status, and the Slack reaction echo can't drift. Re-exported here to keep the
// renderer's existing import paths stable.
export { deriveLiveThreadPostStatus, type LiveThreadPostStatus } from '../../shared/threadStatusLifecycle';
