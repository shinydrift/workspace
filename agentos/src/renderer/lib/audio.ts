// Static file (not an inline blob) so the packaged-app CSP can keep script-src 'self'.
// Vite emits pcmWorklet.js as an asset and rewrites this URL at build time; ?no-inline
// prevents it from becoming a data: URL, which script-src 'self' would also block.
const pcmWorkletUrl = new URL('./pcmWorklet.js?no-inline', import.meta.url).href;

/** Abstraction over ScriptProcessorNode (fallback) and AudioWorkletNode. */
export interface AudioCapture {
  stop: () => void;
}

/**
 * Attach audio capture to the given source node, calling onChunk for each PCM
 * frame. Tries AudioWorkletNode first; falls back to the deprecated
 * ScriptProcessorNode if worklet loading fails.
 */
export async function attachAudioCapture(
  audioCtx: AudioContext,
  source: AudioNode,
  onChunk: (chunk: Float32Array) => void
): Promise<AudioCapture> {
  try {
    await audioCtx.audioWorklet.addModule(pcmWorkletUrl);

    const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor');
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
    source.connect(worklet);
    const silencer = audioCtx.createGain();
    silencer.gain.value = 0;
    worklet.connect(silencer);
    silencer.connect(audioCtx.destination);
    return {
      stop: () => {
        worklet.port.onmessage = null;
        worklet.disconnect();
        silencer.disconnect();
      },
    };
  } catch (err) {
    // Fallback: ScriptProcessorNode (deprecated but works in all Chromium versions)
    console.warn('[audio] AudioWorklet module load failed, falling back to ScriptProcessorNode', err);
    return attachScriptProcessorFallback(audioCtx, source, onChunk);
  }
}

function attachScriptProcessorFallback(
  audioCtx: AudioContext,
  source: AudioNode,
  onChunk: (chunk: Float32Array) => void
): AudioCapture {
  const sp = audioCtx.createScriptProcessor(4096, 1, 1);
  sp.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(sp);
  const silencer = audioCtx.createGain();
  silencer.gain.value = 0;
  sp.connect(silencer);
  silencer.connect(audioCtx.destination);
  return {
    stop: () => {
      sp.onaudioprocess = null;
      sp.disconnect();
    },
  };
}

/**
 * Resample PCM chunks to 16 kHz mono using OfflineAudioContext.
 * Returns a single Float32Array at 16 kHz ready for encodePcmAsWav.
 */
export async function resamplePcmTo16kHz(chunks: Float32Array[], sourceSampleRate: number): Promise<Float32Array> {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  if (sourceSampleRate === 16000) {
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    return merged;
  }
  const srcBuffer = new AudioBuffer({ length: totalLength, sampleRate: sourceSampleRate, numberOfChannels: 1 });
  const channel = srcBuffer.getChannelData(0);
  let offset = 0;
  for (const c of chunks) {
    channel.set(c, offset);
    offset += c.length;
  }
  const targetLength = Math.ceil(totalLength * (16000 / sourceSampleRate));
  const offlineCtx = new OfflineAudioContext(1, targetLength, 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = srcBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/** Encode raw PCM chunks as a 16-bit mono WAV buffer. */
export function encodePcmAsWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const buf = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buf);
  const str = (off: number, s: string) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));

  str(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  let off = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}
