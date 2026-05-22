import type { ElectronAPI } from '../preload/index';

declare global {
  interface Window {
    electronAPI: ElectronAPI | undefined;
  }
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.svg?url' {
  const src: string;
  export default src;
}
