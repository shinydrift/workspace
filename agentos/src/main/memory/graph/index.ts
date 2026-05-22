export {
  GraphQueryEngine,
  entityId,
  edgeId,
  assertEntityWithObservation,
  parseJsonArray,
  computeEntityContentHash,
  propagateContentHash,
  type EntityType,
  type EdgeRelation,
  type EntityNode,
  type EdgeRecord,
  type GraphQueryResult,
  type EntityUpsertStmts,
} from './core';
export { linkEntities, addObservation } from './ops';
export { MemoryGraphService } from './service';
