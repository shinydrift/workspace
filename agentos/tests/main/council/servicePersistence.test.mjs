/**
 * This file previously tested a store-based council persistence implementation
 * (councilRuns + councilConfigs in the Electron store) that no longer exists.
 *
 * Council data is now persisted in ~/.agentos/council/council.sqlite:
 *   - Run/outcome/member logic → tested in councilFlow.test.mjs and db.test.mjs
 *   - Config CRUD + migration  → tested in councilDbConfig.test.mjs
 */
