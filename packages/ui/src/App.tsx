import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type Command, useKeyboard } from './commands';
import { useClient } from './context';
import { Palette } from './overlays/Palette';
import { Shortcuts } from './overlays/Shortcuts';
import { Toasts } from './overlays/Toasts';
import { useUI } from './state';
import { Home } from './views/Home';
import { ReviewView } from './views/Review';
import { SettingsView } from './views/Settings';

export function App() {
  const client = useClient();
  const qc = useQueryClient();
  const view = useUI((s) => s.view);
  const palette = useUI((s) => s.palette);
  const shortcuts = useUI((s) => s.shortcuts);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => client.call('settings.get', {}) });

  // Theme
  const theme = settings.data?.theme ?? 'system';
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // Diff defaults from Settings, once loaded.
  const diffDefaults = settings.data?.diff;
  useEffect(() => {
    if (diffDefaults) useUI.getState().set({ layout: diffDefaults.layout, ignoreWhitespace: diffDefaults.ignoreWhitespace });
  }, [diffDefaults]);

  // Events from main
  useEffect(() => {
    const ui = useUI.getState();
    const offs = [
      client.on('job.updated', (job) => {
        useUI.getState().upsertJob(job);
        if (job.status === 'done' || job.status === 'error') {
          void qc.invalidateQueries({ queryKey: ['spend'] });
          void qc.invalidateQueries({ queryKey: ['history', job.reviewId] });
        }
      }),
      client.on('review.changesAvailable', ({ reviewId, detail }) => {
        const s = useUI.getState();
        s.set({ changesAvailable: { ...s.changesAvailable, [reviewId]: detail } });
      }),
      client.on('app.openReview', ({ reviewId }) => {
        void qc.invalidateQueries({ queryKey: ['reviews'] });
        void qc.invalidateQueries({ queryKey: ['review', reviewId] });
        void qc.invalidateQueries({ queryKey: ['changeSet', reviewId] });
        useUI.getState().go({ name: 'review', reviewId });
      }),
      client.on('app.error', ({ message }) => ui.toast(message)),
      client.on('app.command', ({ command }) => {
        const s = useUI.getState();
        if (command === 'settings') s.go({ name: 'settings', section: null });
        else if (command === 'home') s.go({ name: 'home' });
        else if (command === 'palette') s.set({ palette: true });
        else if (command === 'shortcuts') s.set({ shortcuts: true });
        else window.dispatchEvent(new CustomEvent('legible-command', { detail: command }));
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [client, qc]);

  const global: Command[] = [
    {
      id: 'palette',
      title: 'Command palette',
      group: 'App',
      keys: ['mod+k'],
      run: () => useUI.getState().set({ palette: !useUI.getState().palette }),
    },
    {
      id: 'settings',
      title: 'Settings',
      group: 'App',
      keys: ['mod+,'],
      run: () => useUI.getState().go({ name: 'settings', section: null }),
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      group: 'App',
      keys: ['?'],
      run: () => useUI.getState().set({ shortcuts: !useUI.getState().shortcuts }),
    },
    {
      id: 'escape',
      title: 'Close',
      group: 'App',
      keys: ['escape'],
      paletteHidden: true,
      enabled: () => useUI.getState().palette || useUI.getState().shortcuts || useUI.getState().view.name === 'settings',
      run: () => {
        const s = useUI.getState();
        if (s.palette || s.shortcuts) s.set({ palette: false, shortcuts: false });
        else if (s.view.name === 'settings') s.go(s.returnTo ?? { name: 'home' });
      },
    },
  ];
  useKeyboard(global);

  return (
    <div className={`flex h-full flex-col platform-${client.platform}`}>
      {view.name === 'home' && <Home />}
      {view.name === 'review' && <ReviewView key={view.reviewId} reviewId={view.reviewId} />}
      {view.name === 'settings' && <SettingsView initialSection={view.section} />}
      {palette && <Palette />}
      {shortcuts && <Shortcuts />}
      <Toasts />
    </div>
  );
}
