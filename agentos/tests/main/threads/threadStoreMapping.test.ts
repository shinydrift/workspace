/**
 * Parity between the drizzle `threads` table and threadStore's two hand-written mappers.
 *
 * Regression: `run_on_host` (the per-thread sandbox pick) existed on the Thread type and was set at
 * creation, but had no column and no mapper entry — so it was dropped on save. ThreadRuntime.start
 * re-reads the thread from SQLite, saw `undefined`, and silently fell back to the project/app
 * setting, making the chat-level sandbox toggle a no-op.
 *
 * A column that only one mapper knows about is unreadable (or unwritable) in exactly that way, so
 * this asserts every column is named in both directions rather than pinning the one field.
 *
 * threadStore.ts can't be imported here — it pulls in better-sqlite3 and electron — so the mappers
 * are checked as source text.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableColumns } from 'drizzle-orm';
import { threads } from '../../../src/main/threads/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../../src/main/threads/threadStore.ts'), 'utf8');

function body(fnSignature: string): string {
  const start = SOURCE.indexOf(fnSignature);
  assert.notEqual(start, -1, `threadStore.ts no longer contains "${fnSignature}"`);
  const end = SOURCE.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `could not find the end of "${fnSignature}"`);
  return SOURCE.slice(start, end);
}

const COLUMNS = Object.keys(getTableColumns(threads));

test('every threads column is read back by rowToThread', () => {
  const rowToThread = body('function rowToThread(');
  for (const column of COLUMNS) {
    assert.ok(rowToThread.includes(`${column}:`), `rowToThread does not map "${column}"`);
  }
});

test('every threads column is written by threadToInsert', () => {
  const threadToInsert = body('function threadToInsert(');
  for (const column of COLUMNS) {
    assert.ok(threadToInsert.includes(`${column}:`), `threadToInsert does not map "${column}"`);
  }
});

test('runOnHost is a persisted column, not just a Thread field', () => {
  assert.equal(threads.runOnHost.name, 'run_on_host');
});

test('runOnHost is patchable as a boolean column', () => {
  // patchToSet throws on a boolean that isn't declared here, so an unlisted key would make
  // updateThread({ runOnHost }) — the chat-level toggle's write path — fail at runtime.
  const booleanKeys = body('const BOOLEAN_PATCH_KEYS');
  assert.ok(booleanKeys.includes('runOnHost'));
});
