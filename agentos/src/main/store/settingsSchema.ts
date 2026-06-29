// The AppSettings patch schema is derived from the canonical config schema; types,
// validation, and merge all follow from src/shared/config/schema.ts. The previous
// hand-maintained schema + compile-time key-parity assertion are no longer needed
// because the type is inferred from the schema (drift is impossible by construction).
export { appSettingsPatchSchema as AppSettingsPatchSchema } from '../../shared/config/schema';
