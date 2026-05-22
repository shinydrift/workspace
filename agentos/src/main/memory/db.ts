// Re-export shim — implementation split into focused modules by plan 35.
// Kept for backwards compatibility with existing importers.
export { EMBEDDING_DIMS } from './schema';
export { checkVecTable, checkObsVecTable, ensureVecTable, ensureObsVecTable } from './vecSupport';
export { initDbDir, getProjectDb, closeProjectDb, closeAllDbs, deleteProjectDb } from './projectDb';
