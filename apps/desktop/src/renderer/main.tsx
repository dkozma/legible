import type { LegibleBridge } from '@legible/ipc';
import { mountApp } from '@legible/ui';

declare global {
  interface Window {
    legible: LegibleBridge;
  }
}

mountApp(document.getElementById('root') as HTMLElement, window.legible);
