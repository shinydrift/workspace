import { useState } from 'react';
import type React from 'react';
import type { AttachedFile } from '../components/prompt/AttachedFileList';

const MAX_DIMENSION = 1568;
const MAX_BYTES = 5 * 1024 * 1024;

function canvasToBuffer(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error('toBlob failed'))),
      mimeType,
      quality
    );
  });
}

async function resizeImageFile(file: File): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
  // createImageBitmap decodes the File directly — no blob URL, so the packaged-app CSP
  // (img-src without blob:) can't block it the way an <img src="blob:…"> load can.
  // Null means the image can't be decoded (SVG, HEIC, corrupt data, …) — attach it as-is.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const { width: w, height: h } = bitmap;

    if (w <= MAX_DIMENSION && h <= MAX_DIMENSION && file.size <= MAX_BYTES) {
      return { data: await file.arrayBuffer(), mimeType: file.type };
    }

    const scale = Math.min(MAX_DIMENSION / w, MAX_DIMENSION / h, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // Preserve PNG format when only resizing dimensions (no lossy compression needed).
    // Use JPEG only when file size still exceeds the limit after resize.
    if (file.type === 'image/png') {
      const buf = await canvasToBuffer(canvas, 'image/png', 1);
      if (buf.byteLength <= MAX_BYTES) return { data: buf, mimeType: 'image/png' };
    }

    // JPEG with quality fallback: try 0.85 first, then 0.6 if still over limit.
    for (const quality of [0.85, 0.6]) {
      const buf = await canvasToBuffer(canvas, 'image/jpeg', quality);
      if (buf.byteLength <= MAX_BYTES) return { data: buf, mimeType: 'image/jpeg' };
    }

    // Last resort: return at lowest quality.
    return { data: await canvasToBuffer(canvas, 'image/jpeg', 0.6), mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

async function processFile(file: File): Promise<AttachedFile> {
  if (!file.type.startsWith('image/')) {
    return { name: file.name, data: await file.arrayBuffer() };
  }
  const resized = await resizeImageFile(file);
  if (!resized) {
    return { name: file.name, data: await file.arrayBuffer() };
  }
  const { data, mimeType } = resized;
  const name =
    mimeType === 'image/jpeg' && file.type !== 'image/jpeg' ? file.name.replace(/\.[^.]+$/, '.jpg') : file.name;
  return { name, data };
}

export function useAttachedFiles(setError: (msg: string) => void) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = '';
    Promise.all(files.map(processFile))
      .then((loaded) => setAttachedFiles((prev) => [...prev, ...loaded]))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to read file'));
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return { attachedFiles, setAttachedFiles, onFileInputChange, removeAttachedFile };
}
