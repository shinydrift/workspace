/**
 * The single merge path for scalar/object settings across both config layers.
 *
 * `mergeConfig(app, project)` deep-merges a project's partial overrides onto the app
 * settings, project-wins. Provider-order resolution is intentionally NOT done here:
 * it depends on a third runtime input (the per-thread model/effort snapshot) and on
 * per-provider field inheritance that a generic deep-merge cannot express — see the
 * five `getEffective*ForProvider` accessors in `effectiveProjectSettings.ts`.
 */
import type { AppSettings, ProjectConfig } from './schema';

/** Deep-merge project overrides onto app settings (project-wins). */
export function mergeConfig(app: AppSettings, project: ProjectConfig | null | undefined): AppSettings {
  if (!project) return app;
  return deepMerge(app, project) as AppSettings;
}

// Merge semantics, defined once:
//  - `undefined` override → keep the base value (the key was simply not set).
//  - explicit `null` override → wins (null is a meaningful value, e.g. cleared field).
//  - array override → replaces the base array wholesale (no element-wise merge).
//  - object override → recurse key-by-key.
//  - scalar / type-mismatch override → wins.
function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (override === null) return null;
  if (Array.isArray(override)) return override;
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = deepMerge(base[key], override[key]);
    }
    return out;
  }
  return override;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
