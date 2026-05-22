/**
 * Tests for ipc/handlers/projectHandlers.ts — schema validation logic (inlined).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Inlined constraints from projectHandlers.ts ───────────────────────────────

function validateSaveProject(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.path !== 'string' || req.path.length < 1 || req.path.length > 4096) return false;
  if (req.name !== undefined && (typeof req.name !== 'string' || req.name.length < 1 || req.name.length > 256)) return false;
  if (req.dockerImageName !== undefined && (typeof req.dockerImageName !== 'string' || req.dockerImageName.length > 256)) return false;
  return true;
}

function validateProjectId(req) {
  if (!req || typeof req !== 'object') return false;
  return typeof req.projectId === 'string' && req.projectId.length >= 1 && req.projectId.length <= 128;
}

function validateProjectPath(req) {
  if (!req || typeof req !== 'object') return false;
  return typeof req.projectPath === 'string' && req.projectPath.length >= 1 && req.projectPath.length <= 4096;
}

function validateUpdateConfig(req) {
  if (!req || typeof req !== 'object') return false;
  if (typeof req.projectPath !== 'string' || req.projectPath.length < 1 || req.projectPath.length > 4096) return false;
  if (typeof req.key !== 'string' || req.key.length < 1 || req.key.length > 64) return false;
  if (!req.updates || typeof req.updates !== 'object' || Array.isArray(req.updates)) return false;
  return true;
}

// ── SaveProjectSchema ─────────────────────────────────────────────────────────

test('saveProject: valid minimal — path only', () => {
  assert.ok(validateSaveProject({ path: '/home/user/project' }));
});

test('saveProject: valid with name and dockerImageName', () => {
  assert.ok(validateSaveProject({ path: '/home/user/project', name: 'My Project', dockerImageName: 'my-image:latest' }));
});

test('saveProject: rejects empty path', () => {
  assert.ok(!validateSaveProject({ path: '' }));
});

test('saveProject: rejects path over 4096 chars', () => {
  assert.ok(!validateSaveProject({ path: '/'.repeat(4097) }));
});

test('saveProject: accepts path at max 4096 chars', () => {
  assert.ok(validateSaveProject({ path: '/'.repeat(4096) }));
});

test('saveProject: rejects empty name', () => {
  assert.ok(!validateSaveProject({ path: '/home/user', name: '' }));
});

test('saveProject: rejects name over 256 chars', () => {
  assert.ok(!validateSaveProject({ path: '/home/user', name: 'x'.repeat(257) }));
});

test('saveProject: accepts name at max 256 chars', () => {
  assert.ok(validateSaveProject({ path: '/home/user', name: 'x'.repeat(256) }));
});

test('saveProject: rejects dockerImageName over 256 chars', () => {
  assert.ok(!validateSaveProject({ path: '/home/user', dockerImageName: 'x'.repeat(257) }));
});

test('saveProject: accepts dockerImageName at max 256 chars', () => {
  assert.ok(validateSaveProject({ path: '/home/user', dockerImageName: 'x'.repeat(256) }));
});

test('saveProject: rejects missing path', () => {
  assert.ok(!validateSaveProject({ name: 'My Project' }));
});

test('saveProject: rejects null', () => {
  assert.ok(!validateSaveProject(null));
});

// ── ProjectIdSchema ───────────────────────────────────────────────────────────

test('projectId: accepts valid id', () => {
  assert.ok(validateProjectId({ projectId: 'proj-abc123' }));
});

test('projectId: accepts single char id', () => {
  assert.ok(validateProjectId({ projectId: 'x' }));
});

test('projectId: accepts id at max 128 chars', () => {
  assert.ok(validateProjectId({ projectId: 'x'.repeat(128) }));
});

test('projectId: rejects empty projectId', () => {
  assert.ok(!validateProjectId({ projectId: '' }));
});

test('projectId: rejects projectId over 128 chars', () => {
  assert.ok(!validateProjectId({ projectId: 'x'.repeat(129) }));
});

test('projectId: rejects missing field', () => {
  assert.ok(!validateProjectId({}));
});

test('projectId: rejects null', () => {
  assert.ok(!validateProjectId(null));
});

// ── ProjectPathSchema ─────────────────────────────────────────────────────────

test('projectPath: accepts valid path', () => {
  assert.ok(validateProjectPath({ projectPath: '/home/user/project' }));
});

test('projectPath: accepts single char path', () => {
  assert.ok(validateProjectPath({ projectPath: '/' }));
});

test('projectPath: accepts path at max 4096 chars', () => {
  assert.ok(validateProjectPath({ projectPath: '/'.repeat(4096) }));
});

test('projectPath: rejects empty path', () => {
  assert.ok(!validateProjectPath({ projectPath: '' }));
});

test('projectPath: rejects path over 4096 chars', () => {
  assert.ok(!validateProjectPath({ projectPath: '/'.repeat(4097) }));
});

test('projectPath: rejects missing field', () => {
  assert.ok(!validateProjectPath({}));
});

test('projectPath: rejects null', () => {
  assert.ok(!validateProjectPath(null));
});

// ── PROJECT_UPDATE_CONFIG schema ──────────────────────────────────────────────

test('updateConfig: valid request', () => {
  assert.ok(validateUpdateConfig({ projectPath: '/home/user/project', key: 'memory', updates: { enabled: true } }));
});

test('updateConfig: rejects empty key', () => {
  assert.ok(!validateUpdateConfig({ projectPath: '/home/user', key: '', updates: {} }));
});

test('updateConfig: rejects key over 64 chars', () => {
  assert.ok(!validateUpdateConfig({ projectPath: '/home/user', key: 'x'.repeat(65), updates: {} }));
});

test('updateConfig: accepts key at max 64 chars', () => {
  assert.ok(validateUpdateConfig({ projectPath: '/home/user', key: 'x'.repeat(64), updates: { a: 1 } }));
});

test('updateConfig: rejects array as updates', () => {
  assert.ok(!validateUpdateConfig({ projectPath: '/home/user', key: 'cfg', updates: [] }));
});

test('updateConfig: rejects null updates', () => {
  assert.ok(!validateUpdateConfig({ projectPath: '/home/user', key: 'cfg', updates: null }));
});

test('updateConfig: rejects missing key', () => {
  assert.ok(!validateUpdateConfig({ projectPath: '/home/user', updates: { a: 1 } }));
});

test('updateConfig: rejects missing projectPath', () => {
  assert.ok(!validateUpdateConfig({ key: 'cfg', updates: { a: 1 } }));
});
