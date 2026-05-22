export const COUNCIL_IPC_CHANNELS = {
  COUNCIL_LIST_CONFIGS: 'council:listConfigs',
  COUNCIL_GET_CONFIG: 'council:getConfig',
  COUNCIL_UPSERT_CONFIG: 'council:upsertConfig',
  COUNCIL_DELETE_CONFIG: 'council:deleteConfig',
  COUNCIL_RUN: 'council:run',
  COUNCIL_GET_RUN: 'council:getRun',
  COUNCIL_GET_OUTCOMES: 'council:getOutcomes',
  COUNCIL_LIST_RUNS_BY_THREAD: 'council:listRunsByThread',
} as const;
