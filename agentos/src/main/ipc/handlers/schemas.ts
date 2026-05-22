import { z } from 'zod';

// Primitives reused across handlers
export const threadId = z.string().min(1).max(128);
export const filePath = z.string().min(1).max(4096);
export const shortId = z.string().min(1).max(128);
export const shortName = z.string().min(1).max(256);
export const chunkId = z.string().min(1).max(512);

// Common composite schemas
export const ThreadIdSchema = z.object({ threadId });
export const ProjectIdSchema = z.object({ projectId: shortId });
