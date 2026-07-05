let currentAudio: HTMLAudioElement | null = null;

export function claimRecordingPlayback(audio: HTMLAudioElement): void {
  if (currentAudio && currentAudio !== audio) currentAudio.pause();
  currentAudio = audio;
}

export function releaseRecordingPlayback(audio: HTMLAudioElement): void {
  if (currentAudio === audio) currentAudio = null;
}
