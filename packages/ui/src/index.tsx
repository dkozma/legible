import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/app.css';
import type { LegibleBridge } from '@legible/ipc';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createClient, type LegibleClient } from './client';
import { Providers } from './context';

export { createClient, type LegibleClient } from './client';
export { buildRows, type Row, type RowModel, rangesForRows, rowAt } from './diff/rows';

export function mountApp(el: HTMLElement, bridge: LegibleBridge | LegibleClient) {
  const client = 'call' in bridge ? bridge : createClient(bridge);
  createRoot(el).render(
    <Providers client={client}>
      <App />
    </Providers>,
  );
}
