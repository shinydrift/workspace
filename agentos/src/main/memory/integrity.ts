import type { Database } from 'better-sqlite3';
import { hashText } from './utils';

/**
 * Compute the Merkle root for a project: sha256 of sorted chunk IDs
 * (filtered by project_ids membership) + sorted non-null entity content_hash values.
 */
export function computeMerkleRoot(db: Database, projectId: string): string {
  const chunkIds = (
    db
      .prepare(
        `SELECT id FROM chunks
         WHERE EXISTS (SELECT 1 FROM json_each(project_ids) WHERE value = ?)
         ORDER BY id ASC`
      )
      .all(projectId) as { id: string }[]
  ).map((r) => r.id);

  const entityHashes = (
    db
      .prepare(
        `SELECT content_hash FROM entities
         WHERE project_id = ? AND content_hash IS NOT NULL
         ORDER BY content_hash ASC`
      )
      .all(projectId) as { content_hash: string }[]
  ).map((r) => r.content_hash);

  return hashText(JSON.stringify([chunkIds, entityHashes]));
}

/** Persist the Merkle root for a project and clear the dirty flag. */
export function persistMerkleRoot(db: Database, projectId: string): string {
  const root = computeMerkleRoot(db, projectId);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_' || ?, ?)").run(projectId, root);
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_dirty_' || ?, 'false')").run(projectId);
  return root;
}

/** Mark the Merkle root dirty for a project (called after any write). */
export function markMerkleRootDirty(db: Database, projectId: string): void {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_dirty_' || ?, 'true')").run(projectId);
}

/**
 * Verify integrity: recompute root and compare against stored value.
 * Returns false immediately if the stored root is missing.
 * Returns false if `merkle_root_dirty` is true without recomputing (fast path).
 * Returns true only after a fresh recompute confirms a match.
 */
export function verifyIntegrity(db: Database, projectId: string): boolean {
  const dirtyRow = db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_dirty_' || ?").get(projectId) as
    | { value: string }
    | undefined;

  // If no stored root at all, integrity is unknown → false
  const storedRow = db.prepare("SELECT value FROM meta WHERE key = 'merkle_root_' || ?").get(projectId) as
    | { value: string }
    | undefined;
  if (!storedRow) return false;

  // Fast path: dirty flag set → don't bother recomputing
  if (dirtyRow?.value === 'true') return false;

  const recomputed = computeMerkleRoot(db, projectId);
  const matches = recomputed === storedRow.value;
  if (matches) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('merkle_root_dirty_' || ?, 'false')").run(projectId);
  }
  return matches;
}
