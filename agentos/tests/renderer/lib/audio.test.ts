import { afterEach, test, expect, vi } from 'vitest';
import { attachAudioCapture, encodePcmAsWav } from '../../../src/renderer/lib/audio';

function readAscii(buf: ArrayBuffer, offset: number, len: number): string {
  return Array.from(new Uint8Array(buf, offset, len))
    .map((b) => String.fromCharCode(b))
    .join('');
}
function readUint32LE(buf: ArrayBuffer, offset: number): number {
  return new DataView(buf).getUint32(offset, true);
}
function readUint16LE(buf: ArrayBuffer, offset: number): number {
  return new DataView(buf).getUint16(offset, true);
}
function readInt16LE(buf: ArrayBuffer, offset: number): number {
  return new DataView(buf).getInt16(offset, true);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── attachAudioCapture ────────────────────────────────────────────────────────

test('attachAudioCapture: uses AudioWorkletNode when module loads', async () => {
  const chunks: Float32Array[] = [];
  const addModule = vi.fn().mockResolvedValue(undefined);
  const source = { connect: vi.fn() };
  const audioCtx = { audioWorklet: { addModule } } as unknown as AudioContext;
  const createObjectURL = vi.fn(() => 'blob:pcm-worklet');
  const revokeObjectURL = vi.fn();

  class FakeAudioWorkletNode {
    static instances: FakeAudioWorkletNode[] = [];
    port: { onmessage: ((e: MessageEvent<Float32Array>) => void) | null } = { onmessage: null };
    disconnect = vi.fn();

    constructor(
      readonly context: AudioContext,
      readonly name: string
    ) {
      FakeAudioWorkletNode.instances.push(this);
    }
  }

  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

  const capture = await attachAudioCapture(audioCtx, source as unknown as AudioNode, (chunk) => chunks.push(chunk));
  const worklet = FakeAudioWorkletNode.instances[0];
  const chunk = new Float32Array([0.25, -0.5]);

  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(addModule).toHaveBeenCalledWith('blob:pcm-worklet');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:pcm-worklet');
  expect(worklet.name).toBe('pcm-processor');
  expect(source.connect).toHaveBeenCalledWith(worklet);

  worklet.port.onmessage?.({ data: chunk } as MessageEvent<Float32Array>);
  expect(chunks).toEqual([chunk]);

  capture.stop();
  expect(worklet.port.onmessage).toBeNull();
  expect(worklet.disconnect).toHaveBeenCalledOnce();
});

test('attachAudioCapture: falls back to ScriptProcessorNode when worklet loading fails', async () => {
  const input = new Float32Array([0.1, -0.2, 0.3]);
  const chunks: Float32Array[] = [];
  const source = { connect: vi.fn() };
  const processor = { onaudioprocess: null as ScriptProcessorNode['onaudioprocess'], connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 1 }, connect: vi.fn() };
  const destination = {};
  const audioCtx = {
    audioWorklet: { addModule: vi.fn().mockRejectedValue(new Error('no worklet')) },
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => gain),
    destination,
  } as unknown as AudioContext;

  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:pcm-worklet'), revokeObjectURL: vi.fn() });

  const capture = await attachAudioCapture(audioCtx, source as unknown as AudioNode, (chunk) => chunks.push(chunk));

  expect(audioCtx.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);
  expect(source.connect).toHaveBeenCalledWith(processor);
  expect(gain.gain.value).toBe(0);
  expect(processor.connect).toHaveBeenCalledWith(gain);
  expect(gain.connect).toHaveBeenCalledWith(destination);

  processor.onaudioprocess?.({
    inputBuffer: { getChannelData: () => input },
  } as unknown as AudioProcessingEvent);
  expect(chunks).toHaveLength(1);
  expect(Array.from(chunks[0])).toEqual(Array.from(input));
  expect(chunks[0]).not.toBe(input);

  capture.stop();
  expect(processor.onaudioprocess).toBeNull();
  expect(processor.disconnect).toHaveBeenCalledOnce();
});

// ── WAV header ────────────────────────────────────────────────────────────────

test('encodePcmAsWav: buffer size is 44 + samples*2', () => {
  const buf = encodePcmAsWav([new Float32Array(100)], 16000);
  expect(buf.byteLength).toBe(44 + 100 * 2);
});

test('encodePcmAsWav: RIFF marker at offset 0', () => {
  expect(readAscii(encodePcmAsWav([new Float32Array(4)], 16000), 0, 4)).toBe('RIFF');
});

test('encodePcmAsWav: WAVE marker at offset 8', () => {
  expect(readAscii(encodePcmAsWav([new Float32Array(4)], 16000), 8, 4)).toBe('WAVE');
});

test('encodePcmAsWav: fmt  marker at offset 12', () => {
  expect(readAscii(encodePcmAsWav([new Float32Array(4)], 16000), 12, 4)).toBe('fmt ');
});

test('encodePcmAsWav: data marker at offset 36', () => {
  expect(readAscii(encodePcmAsWav([new Float32Array(4)], 16000), 36, 4)).toBe('data');
});

test('encodePcmAsWav: chunk size field = 36 + samples*2', () => {
  expect(readUint32LE(encodePcmAsWav([new Float32Array(100)], 16000), 4)).toBe(36 + 100 * 2);
});

test('encodePcmAsWav: data subchunk size = samples*2', () => {
  expect(readUint32LE(encodePcmAsWav([new Float32Array(80)], 16000), 40)).toBe(80 * 2);
});

test('encodePcmAsWav: audio format is PCM (1)', () => {
  expect(readUint16LE(encodePcmAsWav([new Float32Array(4)], 16000), 20)).toBe(1);
});

test('encodePcmAsWav: channel count is 1 (mono)', () => {
  expect(readUint16LE(encodePcmAsWav([new Float32Array(4)], 16000), 22)).toBe(1);
});

test('encodePcmAsWav: sample rate stored correctly', () => {
  expect(readUint32LE(encodePcmAsWav([new Float32Array(4)], 44100), 24)).toBe(44100);
});

test('encodePcmAsWav: byte rate = sampleRate * 2', () => {
  expect(readUint32LE(encodePcmAsWav([new Float32Array(4)], 22050), 28)).toBe(22050 * 2);
});

test('encodePcmAsWav: block align is 2', () => {
  expect(readUint16LE(encodePcmAsWav([new Float32Array(4)], 16000), 32)).toBe(2);
});

test('encodePcmAsWav: bits per sample is 16', () => {
  expect(readUint16LE(encodePcmAsWav([new Float32Array(4)], 16000), 34)).toBe(16);
});

// ── PCM encoding ──────────────────────────────────────────────────────────────

test('encodePcmAsWav: silence (0.0) encodes as 0', () => {
  const buf = encodePcmAsWav([new Float32Array([0, 0, 0])], 16000);
  for (let i = 0; i < 3; i++) expect(readInt16LE(buf, 44 + i * 2)).toBe(0);
});

test('encodePcmAsWav: positive peak (1.0) encodes as 0x7fff', () => {
  expect(readInt16LE(encodePcmAsWav([new Float32Array([1.0])], 16000), 44)).toBe(0x7fff);
});

test('encodePcmAsWav: negative peak (-1.0) encodes as -0x8000', () => {
  expect(readInt16LE(encodePcmAsWav([new Float32Array([-1.0])], 16000), 44)).toBe(-0x8000);
});

test('encodePcmAsWav: clips values above 1.0 to 0x7fff', () => {
  expect(readInt16LE(encodePcmAsWav([new Float32Array([2.0])], 16000), 44)).toBe(0x7fff);
});

test('encodePcmAsWav: clips values below -1.0 to -0x8000', () => {
  expect(readInt16LE(encodePcmAsWav([new Float32Array([-2.0])], 16000), 44)).toBe(-0x8000);
});

test('encodePcmAsWav: multiple chunks concatenated in order', () => {
  const buf = encodePcmAsWav([new Float32Array([1.0]), new Float32Array([-1.0])], 16000);
  expect(buf.byteLength).toBe(44 + 4);
  expect(readInt16LE(buf, 44)).toBe(0x7fff);
  expect(readInt16LE(buf, 46)).toBe(-0x8000);
});

test('encodePcmAsWav: empty chunks array produces header-only buffer', () => {
  const buf = encodePcmAsWav([], 16000);
  expect(buf.byteLength).toBe(44);
  expect(readUint32LE(buf, 4)).toBe(36);
  expect(readUint32LE(buf, 40)).toBe(0);
});

test('encodePcmAsWav: total sample count spans multiple chunks', () => {
  const buf = encodePcmAsWav([new Float32Array(10), new Float32Array(20), new Float32Array(5)], 16000);
  expect(buf.byteLength).toBe(44 + 35 * 2);
  expect(readUint32LE(buf, 40)).toBe(35 * 2);
});
