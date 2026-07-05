import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TrayPopover } from './tray/TrayPopover';
import { RecordingOverlay } from './components/voice-flow/RecordingOverlay';
import { ShutdownOverlay } from './components/ShutdownOverlay';
import './styles/globals.css';
import 'highlight.js/styles/github.css';

const isTray = window.location.hash === '#/tray';
const isRecordingOverlay = window.location.hash === '#/recording-overlay';
const isShutdownOverlay = window.location.hash === '#/shutdown-overlay';
const isOverlayWindow = isTray || isRecordingOverlay || isShutdownOverlay;

if (isOverlayWindow) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

const root = createRoot(document.getElementById('root')!);
root.render(
  isTray ? (
    <TrayPopover />
  ) : isRecordingOverlay ? (
    <RecordingOverlay />
  ) : isShutdownOverlay ? (
    <ShutdownOverlay />
  ) : (
    <App />
  )
);
