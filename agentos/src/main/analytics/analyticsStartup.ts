import path from 'path';
import fs from 'fs';
import { eventLogger } from '../utils/eventLog';
import { getErrorMessage } from '../../shared/utils/errorMessage';
import { safeDb } from './analyticsHelpers';
import { getAnalyticsDb, analyticsDbDir } from './db';
import { getAllProjects } from '../threads/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSQLite3 = require('better-sqlite3') as typeof import('better-sqlite3');

const MIGRATION_KEY = 'analytics_v1_migrated';

// One-time import of data from the old dual-DB layout (global.sqlite + {projectId}.sqlite)
// into the single analytics.sqlite file. Guarded by a flag in analytics_meta.
function migrateToAnalyticsDb(projectIds: string[]): void {
  try {
    const db = getAnalyticsDb();
    const done = (
      db.prepare('SELECT value FROM analytics_meta WHERE key = ?').get(MIGRATION_KEY) as { value: string } | undefined
    )?.value;
    if (done === 'done') return;

    if (!analyticsDbDir) return;

    const globalPath = path.join(analyticsDbDir, 'global.sqlite');

    db.transaction(() => {
      // Import from old global.sqlite
      if (fs.existsSync(globalPath)) {
        const oldGlobal = new BetterSQLite3(globalPath, { readonly: true });
        try {
          const pdsRows = oldGlobal.prepare('SELECT * FROM project_daily_stats').all() as Record<string, unknown>[];
          const pdsInsert = db.prepare(
            `INSERT OR IGNORE INTO project_daily_stats
               (date, project_id, model, input_tokens, output_tokens, cost_usd_micro, cache_read_tokens, cache_creation_tokens, session_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const r of pdsRows) {
            pdsInsert.run(
              r.date,
              r.project_id,
              r.model,
              r.input_tokens,
              r.output_tokens,
              r.cost_usd_micro,
              r.cache_read_tokens ?? 0,
              r.cache_creation_tokens ?? 0,
              r.session_count ?? 0
            );
          }

          const ptRows = oldGlobal.prepare('SELECT * FROM project_totals').all() as Record<string, unknown>[];
          const ptInsert = db.prepare(
            `INSERT OR IGNORE INTO project_totals (project_id, memory_get_count) VALUES (?, ?)`
          );
          for (const r of ptRows) ptInsert.run(r.project_id, r.memory_get_count ?? 0);

          const ptsRows = oldGlobal.prepare('SELECT * FROM project_tool_stats').all() as Record<string, unknown>[];
          const ptsInsert = db.prepare(
            `INSERT OR IGNORE INTO project_tool_stats (project_id, tool_name, count, success_count, error_count)
             VALUES (?, ?, ?, ?, ?)`
          );
          for (const r of ptsRows) {
            ptsInsert.run(r.project_id, r.tool_name, r.count ?? 0, r.success_count ?? 0, r.error_count ?? 0);
          }
        } catch (err) {
          eventLogger.warn('analytics', 'Failed to import from global.sqlite during migration', {
            error: getErrorMessage(err),
          });
        } finally {
          oldGlobal.close();
        }
      }

      // Import from old per-project session DBs
      for (const projectId of projectIds) {
        const sessionPath = path.join(analyticsDbDir!, `${projectId}.sqlite`);
        if (!fs.existsSync(sessionPath)) continue;
        const oldDb = new BetterSQLite3(sessionPath, { readonly: true });
        try {
          const smRows = oldDb.prepare('SELECT * FROM session_metrics').all() as Record<string, unknown>[];
          const smInsert = db.prepare(
            `INSERT OR IGNORE INTO session_metrics
               (thread_id, project_id, provider, model, started_at, ended_at,
                input_tokens, output_tokens, turn_count, tool_call_count, cost_usd_micro,
                cache_read_tokens, cache_creation_tokens, memory_get_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const r of smRows) {
            smInsert.run(
              r.thread_id,
              r.project_id,
              r.provider,
              r.model ?? null,
              r.started_at,
              r.ended_at ?? null,
              r.input_tokens ?? 0,
              r.output_tokens ?? 0,
              r.turn_count ?? 0,
              r.tool_call_count ?? 0,
              r.cost_usd_micro ?? 0,
              r.cache_read_tokens ?? 0,
              r.cache_creation_tokens ?? 0,
              r.memory_get_count ?? 0
            );
          }

          const arRows = oldDb.prepare('SELECT * FROM automation_runs').all() as Record<string, unknown>[];
          const arInsert = db.prepare(
            `INSERT OR IGNORE INTO automation_runs
               (id, job_id, thread_id, project_id, started_at, completed_at, status,
                error_message, input_tokens, output_tokens, turn_count, tool_call_count, cost_usd_micro)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const r of arRows) {
            arInsert.run(
              r.id,
              r.job_id,
              r.thread_id,
              r.project_id,
              r.started_at,
              r.completed_at ?? null,
              r.status,
              r.error_message ?? null,
              r.input_tokens ?? 0,
              r.output_tokens ?? 0,
              r.turn_count ?? 0,
              r.tool_call_count ?? 0,
              r.cost_usd_micro ?? 0
            );
          }
        } catch (err) {
          eventLogger.warn('analytics', 'Failed to import session DB during migration', {
            projectId,
            error: getErrorMessage(err),
          });
        } finally {
          oldDb.close();
        }
      }

      db.prepare("INSERT OR REPLACE INTO analytics_meta (key, value) VALUES (?, 'done')").run(MIGRATION_KEY);
    })();

    // Delete old source files after successful migration
    try {
      if (fs.existsSync(globalPath)) fs.unlinkSync(globalPath);
      for (const projectId of projectIds) {
        const sessionPath = path.join(analyticsDbDir!, `${projectId}.sqlite`);
        if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
      }
    } catch (err) {
      eventLogger.warn('analytics', 'Failed to delete old analytics files after migration', {
        error: getErrorMessage(err),
      });
    }
  } catch (err) {
    eventLogger.error('analytics', 'Failed to migrate to analytics DB', { error: getErrorMessage(err) });
  }
}

// One-time backfill: populate session_count for rows written before the column was added.
function backfillSessionCounts(): void {
  try {
    const db = safeDb();
    if (!db) return;

    const { s } = db.prepare('SELECT COALESCE(SUM(session_count), 0) AS s FROM project_daily_stats').get() as {
      s: number;
    };
    if (s > 0) return;

    const projectIds = db.prepare('SELECT DISTINCT project_id FROM project_daily_stats').all() as {
      project_id: string;
    }[];
    if (projectIds.length === 0) return;

    const updateStmt = db.prepare(
      `UPDATE project_daily_stats SET session_count = ?
       WHERE project_id = ? AND date = ?
         AND model = (SELECT model FROM project_daily_stats WHERE project_id = ? AND date = ? ORDER BY model LIMIT 1)`
    );

    for (const { project_id } of projectIds) {
      const rows = db
        .prepare(
          `SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime') AS date,
                  COUNT(*) AS cnt
           FROM session_metrics
           WHERE project_id = ?
           GROUP BY 1`
        )
        .all(project_id) as { date: string; cnt: number }[];
      for (const { date, cnt } of rows) {
        updateStmt.run(cnt, project_id, date, project_id, date);
      }
    }
  } catch (err) {
    eventLogger.error('analytics', 'Failed to backfill session counts', { error: getErrorMessage(err) });
  }
}

function backfillProjectTotals(projectIds: string[]): void {
  try {
    const db = safeDb();
    if (!db) return;

    const { s } = db.prepare('SELECT COALESCE(SUM(memory_get_count), 0) AS s FROM project_totals').get() as {
      s: number;
    };
    if (s > 0) return;

    if (projectIds.length === 0) return;

    const upsert = db.prepare(
      `INSERT INTO project_totals (project_id, memory_get_count)
       VALUES (?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         memory_get_count = excluded.memory_get_count`
    );

    for (const projectId of projectIds) {
      const row = db
        .prepare('SELECT COALESCE(SUM(memory_get_count), 0) AS n FROM session_metrics WHERE project_id = ?')
        .get(projectId) as { n: number };
      if (row.n > 0) upsert.run(projectId, row.n);
    }
  } catch (err) {
    eventLogger.error('analytics', 'Failed to backfill project totals', { error: getErrorMessage(err) });
  }
}

export function runStartupMaintenance(): void {
  const t0 = performance.now();
  const projectIds = getAllProjects().map((p) => p.id);
  const projectCount = projectIds.length;

  migrateToAnalyticsDb(projectIds);
  backfillSessionCounts();
  backfillProjectTotals(projectIds);

  const elapsed = performance.now() - t0;
  eventLogger.debug('analytics', 'Startup repair scan complete', {
    elapsed_ms: Math.round(elapsed),
    project_count: projectCount,
  });

  if (elapsed > 500) {
    eventLogger.warn('analytics', 'Startup repair scan exceeded 500ms', {
      elapsed_ms: Math.round(elapsed),
      project_count: projectCount,
    });
  }
}
