import type { ClaudeAuth, HostKind, ModelTier, Settings } from '@legible/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { usd } from '../components/Inline';
import { useClient } from '../context';
import { useUI } from '../state';

const SECTIONS: [string, string][] = [
  ['providers', 'Providers'],
  ['tiers', 'Model tiers'],
  ['hosts', 'Hosts & accounts'],
  ['spend', 'Spend'],
  ['diff', 'Diff viewer'],
  ['editor', 'Editor'],
  ['appearance', 'Appearance'],
  ['privacy', 'Privacy'],
];

const TIER_WORK: Record<ModelTier, string> = {
  strong: 'Lenses, Verification, Change Requests, Scenario traces, Domain Changes (from M3–M5)',
  mid: 'Walkthrough, Change Brief, Conversations (from M3)',
  fast: 'Explanations',
};

export function SettingsView({ initialSection }: { initialSection: string | null }) {
  const client = useClient();
  const qc = useQueryClient();
  const go = useUI((s) => s.go);
  const returnTo = useUI((s) => s.returnTo);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => client.call('settings.get', {}) });
  const [active, setActive] = useState(initialSection ?? 'providers');

  const save = useMutation({
    mutationFn: (s: Settings) => client.call('settings.save', { settings: s }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      void qc.invalidateQueries({ queryKey: ['runtimeStatus'] });
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  });
  const update = (fn: (s: Settings) => Settings) => settings.data && save.mutate(fn(structuredClone(settings.data)));

  useEffect(() => {
    if (initialSection) document.getElementById(initialSection)?.scrollIntoView();
  }, [initialSection]);

  return (
    <>
      <header className="titlebar">
        <span className="b sm grow">Settings</span>
        {save.isPending && <Loader2 className="i i-sm spin muted" />}
        <button className="btn btn-ghost btn-sm muted" type="button" onClick={() => go(returnTo ?? { name: 'home' })}>
          Close <span className="kbd">esc</span>
        </button>
      </header>
      <div className="main">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`nav-item${active === id ? ' active' : ''}`}
              onClick={() => {
                setActive(id);
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="settings-main">
          {settings.data && (
            <div className="settings-inner">
              <Providers settings={settings.data} update={update} />
              <Tiers settings={settings.data} update={update} />
              <Hosts />
              <Spend settings={settings.data} update={update} />
              <Section id="diff" title="Diff viewer" description="Defaults for new Reviews. Each Review can switch with ⌥S and W.">
                <div className="card">
                  <div className="setting-row">
                    <span className="sm grow">Layout</span>
                    <div className="tabs" role="tablist" aria-label="Default layout">
                      {(['unified', 'split'] as const).map((l) => (
                        <button
                          key={l}
                          className="tab"
                          type="button"
                          role="tab"
                          aria-selected={settings.data.diff.layout === l}
                          onClick={() => update((s) => ({ ...s, diff: { ...s.diff, layout: l } }))}
                        >
                          {l === 'unified' ? 'Unified' : 'Split'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <span className="sm grow">Hide whitespace-only changes</span>
                    <Toggle
                      on={settings.data.diff.ignoreWhitespace}
                      label="Hide whitespace-only changes"
                      onChange={(v) => update((s) => ({ ...s, diff: { ...s.diff, ignoreWhitespace: v } }))}
                    />
                  </div>
                  <div className="setting-row">
                    <span className="sm grow">Context lines around each change</span>
                    <NumberField
                      value={settings.data.diff.contextLines}
                      min={0}
                      max={20}
                      label="Context lines"
                      onCommit={(v) => update((s) => ({ ...s, diff: { ...s.diff, contextLines: v } }))}
                    />
                  </div>
                </div>
              </Section>
              <Section
                id="editor"
                title="Editor"
                description="Where “Open in editor” (o) opens the current line. Only for Reviews of a local working tree."
              >
                <div className="card">
                  <div className="setting-row">
                    <span className="sm grow">Editor</span>
                    <select
                      className="select"
                      aria-label="Editor"
                      value={settings.data.editor}
                      onChange={(e) => update((s) => ({ ...s, editor: e.target.value as Settings['editor'] }))}
                    >
                      <option value="vscode">VS Code</option>
                      <option value="cursor">Cursor</option>
                      <option value="zed">Zed</option>
                      <option value="idea">JetBrains IDE</option>
                      <option value="env">$VISUAL / $EDITOR</option>
                    </select>
                  </div>
                </div>
              </Section>
              <Section id="appearance" title="Appearance">
                <div className="card">
                  <div className="setting-row">
                    <span className="sm grow">Theme</span>
                    <div className="tabs" role="tablist" aria-label="Theme">
                      {(['system', 'dark', 'light'] as const).map((t) => (
                        <button
                          key={t}
                          className="tab"
                          type="button"
                          role="tab"
                          aria-selected={settings.data.theme === t}
                          onClick={() => update((s) => ({ ...s, theme: t }))}
                        >
                          {t[0]?.toUpperCase()}
                          {t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Section>
              <section id="privacy" className="inset col" style={{ gap: 8, padding: '16px 18px' }} aria-labelledby="priv-h">
                <h2 className="h3" id="priv-h">
                  Where your code goes
                </h2>
                <p className="sm muted">
                  Only to your git host (to fetch Pull Requests) and to Claude when you ask for an Explanation. Legible collects no
                  telemetry and sends no crash reports. Explanations only read code through Legible's own read-only tools: agents get no
                  shell, no file edits, no network, and never load the reviewed repository's Claude settings, hooks or MCP servers.
                </p>
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="col" style={{ gap: 14 }} aria-labelledby={`${id}-h`}>
      <div className="col" style={{ gap: 4 }}>
        <h2 className="h2" id={`${id}-h`}>
          {title}
        </h2>
        {description && <p className="sm muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" type="button" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  label,
  onCommit,
  prefix,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onCommit: (v: number) => void;
  prefix?: string;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
    else setV(String(value));
  };
  return (
    <span className="row" style={{ gap: 4 }}>
      {prefix && <span className="sm muted">{prefix}</span>}
      <input
        className="input mono"
        aria-label={label}
        style={{ width: 90, textAlign: 'right' }}
        type="number"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </span>
  );
}

function SecretField({ name, placeholder, label }: { name: string; placeholder: string; label: string }) {
  const client = useClient();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['secrets'], queryFn: () => client.call('secrets.status', {}) });
  const [value, setValue] = useState('');
  const set = useMutation({
    mutationFn: (v: string | null) => client.call('secrets.set', { name, value: v }),
    onSuccess: () => {
      setValue('');
      void qc.invalidateQueries({ queryKey: ['secrets'] });
      void qc.invalidateQueries({ queryKey: ['runtimeStatus'] });
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  });
  const saved = Boolean(status.data?.[name]);
  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        className="input mono"
        style={{ fontSize: 12 }}
        type="password"
        aria-label={label}
        placeholder={saved ? 'Saved in the keychain' : placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value && set.mutate(value)}
      />
      <button className="btn btn-outline btn-sm" type="button" disabled={!value} onClick={() => set.mutate(value)}>
        Save
      </button>
      {saved && (
        <button className="btn btn-ghost btn-sm muted" type="button" onClick={() => set.mutate(null)}>
          Remove
        </button>
      )}
    </div>
  );
}

function Providers({ settings, update }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void }) {
  const client = useClient();
  const status = useQuery({ queryKey: ['runtimeStatus'], queryFn: () => client.call('runtime.status', {}) });
  const auth = settings.claude.auth;
  const setAuth = (a: ClaudeAuth) => update((s) => ({ ...s, claude: { ...s.claude, auth: a } }));
  const usage: ClaudeAuth = auth === 'claude-code' ? 'anthropic-api' : auth;
  const [path, setPath] = useState(settings.claude.executablePath ?? '');

  return (
    <Section
      id="providers"
      title="Providers"
      description="Explanations run on Claude. Keys are stored in the OS keychain and passed to Claude only as environment variables."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <article className="card col" aria-labelledby="claude-h">
          <div className="card-head row">
            <h3 className="h3 grow" id="claude-h">
              Claude
            </h3>
            <span className="badge badge-secondary">Default</span>
          </div>
          <div className="card-body col" style={{ gap: 14 }}>
            <label
              className="inset col"
              style={{ padding: 12, gap: 8, cursor: 'pointer', borderColor: auth === 'claude-code' ? 'var(--ring)' : undefined }}
            >
              <div className="row">
                <input
                  type="radio"
                  className="rb"
                  name="claude-auth"
                  checked={auth === 'claude-code'}
                  onChange={() => setAuth('claude-code')}
                />
                <span className="sm b grow">Use my Claude Code</span>
                {auth === 'claude-code' && status.data && (
                  <span className={`badge ${status.data.ready ? 'badge-ok' : 'badge-elev'}`}>
                    {status.data.ready ? 'Connected' : 'Not ready'}
                  </span>
                )}
              </div>
              <p className="xs muted">
                Legible runs your installed, signed-in <span className="mono">claude</span> with your own subscription. It never reads or
                stores its credentials.
              </p>
              {auth === 'claude-code' && (
                <>
                  <div className="row xs muted" style={{ gap: 8 }}>
                    {status.isFetching ? (
                      <Loader2 className="i i-xs spin" />
                    ) : status.data?.ready ? (
                      <Check className="i i-xs" />
                    ) : (
                      <X className="i i-xs" />
                    )}
                    <span className="grow truncate" title={status.data?.executablePath ?? ''}>
                      {status.data?.detail ?? 'Checking…'}
                      {status.data?.executablePath ? ` · ${status.data.executablePath}` : ''}
                    </span>
                    <button className="btn btn-ghost btn-xs muted" type="button" onClick={() => status.refetch()}>
                      <RefreshCw className="i i-xs" />
                      Recheck
                    </button>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input mono"
                      style={{ fontSize: 12, height: 28 }}
                      aria-label="Path to claude"
                      placeholder="Path to claude (blank = find it on your PATH)"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      onBlur={() => update((s) => ({ ...s, claude: { ...s.claude, executablePath: path.trim() || null } }))}
                    />
                  </div>
                </>
              )}
            </label>

            <div className="inset col" style={{ padding: 12, gap: 10, borderColor: auth !== 'claude-code' ? 'var(--ring)' : undefined }}>
              <label className="row" style={{ cursor: 'pointer' }}>
                <input type="radio" className="rb" name="claude-auth" checked={auth !== 'claude-code'} onChange={() => setAuth(usage)} />
                <span className="sm b grow">Usage-based</span>
                {auth !== 'claude-code' && status.data && (
                  <span className={`badge ${status.data.ready ? 'badge-ok' : 'badge-elev'}`}>
                    {status.data.ready ? 'Configured' : 'Not ready'}
                  </span>
                )}
              </label>
              {auth !== 'claude-code' && (
                <>
                  <div className="tabs" role="tablist" aria-label="Usage-based option" style={{ alignSelf: 'flex-start' }}>
                    {(
                      [
                        ['anthropic-api', 'Anthropic API'],
                        ['bedrock', 'Bedrock'],
                        ['vertex', 'Vertex'],
                        ['foundry', 'Foundry'],
                      ] as const
                    ).map(([a, label]) => (
                      <button key={a} className="tab" role="tab" type="button" aria-selected={auth === a} onClick={() => setAuth(a)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {auth === 'anthropic-api' && <SecretField name="anthropic-api-key" placeholder="sk-ant-…" label="Anthropic API key" />}
                  {auth === 'bedrock' && (
                    <div className="col" style={{ gap: 8 }}>
                      <TextSetting
                        label="AWS region"
                        value={settings.claude.bedrock.region}
                        onCommit={(v) => update((s) => ({ ...s, claude: { ...s.claude, bedrock: { ...s.claude.bedrock, region: v } } }))}
                      />
                      <TextSetting
                        label="AWS profile (optional)"
                        value={settings.claude.bedrock.profile}
                        onCommit={(v) => update((s) => ({ ...s, claude: { ...s.claude, bedrock: { ...s.claude.bedrock, profile: v } } }))}
                      />
                      <span className="xs muted">Uses your AWS credentials chain (profile, SSO, or environment).</span>
                    </div>
                  )}
                  {auth === 'vertex' && (
                    <div className="col" style={{ gap: 8 }}>
                      <TextSetting
                        label="GCP project ID"
                        value={settings.claude.vertex.projectId}
                        onCommit={(v) => update((s) => ({ ...s, claude: { ...s.claude, vertex: { ...s.claude.vertex, projectId: v } } }))}
                      />
                      <TextSetting
                        label="Region"
                        value={settings.claude.vertex.region}
                        onCommit={(v) => update((s) => ({ ...s, claude: { ...s.claude, vertex: { ...s.claude.vertex, region: v } } }))}
                      />
                      <span className="xs muted">Uses Application Default Credentials (gcloud auth application-default login).</span>
                    </div>
                  )}
                  {auth === 'foundry' && (
                    <div className="col" style={{ gap: 8 }}>
                      <TextSetting
                        label="Foundry resource"
                        value={settings.claude.foundry.resource}
                        onCommit={(v) => update((s) => ({ ...s, claude: { ...s.claude, foundry: { resource: v } } }))}
                      />
                      <SecretField name="foundry-api-key" placeholder="Foundry API key" label="Foundry API key" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </article>

        <article className="card col" aria-labelledby="oai-h" style={{ opacity: 0.7 }}>
          <div className="card-head row">
            <h3 className="h3 grow" id="oai-h">
              OpenAI
            </h3>
            <span className="badge badge-muted">Coming in M3</span>
          </div>
          <div className="card-body col" style={{ gap: 10 }}>
            <p className="sm muted">
              Continue with ChatGPT or an OpenAI API key, with models chosen per tier. Arrives with the Walkthrough and Change Brief.
            </p>
          </div>
        </article>
      </div>
    </Section>
  );
}

function TextSetting({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="col" style={{ gap: 4 }}>
      <span className="label">{label}</span>
      <input
        className="input mono"
        style={{ fontSize: 12 }}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v.trim())}
        onKeyDown={(e) => e.key === 'Enter' && onCommit(v.trim())}
      />
    </label>
  );
}

function Tiers({ settings, update }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void }) {
  const client = useClient();
  const models = useQuery({ queryKey: ['models'], queryFn: () => client.call('models.list', {}) });
  return (
    <Section id="tiers" title="Model tiers" description="Each kind of agent work runs on a tier. Pick any Claude model for each.">
      <div className="card">
        {(['fast', 'mid', 'strong'] as const).map((tier) => {
          const current = settings.tiers[tier];
          const info = models.data?.find((m) => m.id === current.model);
          return (
            <div key={tier} className="setting-row">
              <div className="col grow" style={{ gap: 2, minWidth: 240 }}>
                <span className="sm b">{tier[0]?.toUpperCase() + tier.slice(1)}</span>
                <span className="xs muted">{TIER_WORK[tier]}</span>
              </div>
              {info && <span className={`badge ${info.status === 'recommended' ? 'badge-ok' : 'badge-outline'}`}>{info.status}</span>}
              {info && (
                <span className="mono xs muted" style={{ width: 28 }}>
                  {'$'.repeat(info.costRank)}
                </span>
              )}
              <select
                className="select"
                aria-label={`${tier} tier model`}
                style={{ width: 220 }}
                value={current.model}
                onChange={(e) => update((s) => ({ ...s, tiers: { ...s.tiers, [tier]: { provider: 'anthropic', model: e.target.value } } }))}
              >
                {(models.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.status === 'experimental' ? ' (experimental)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="xs muted" style={{ padding: '0 2px' }}>
        Recommended models are the defaults Legible is tuned for; experimental ones aren't evaluated yet. Explanations aim for under five
        seconds on the fast tier.
      </p>
    </Section>
  );
}

function Hosts() {
  const client = useClient();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['hosts'], queryFn: () => client.call('hosts.list', {}) });
  const [hostname, setHostname] = useState('github.com');
  const [kind, setKind] = useState<HostKind>('github');
  const [source, setSource] = useState<'gh' | 'glab' | 'token'>('gh');
  const [token, setToken] = useState('');
  const connect = useMutation({
    mutationFn: () => client.call('hosts.connect', { hostname: hostname.trim(), kind, source, token: source === 'token' ? token : null }),
    onSuccess: (a) => {
      setToken('');
      void qc.invalidateQueries({ queryKey: ['hosts'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
      if (!a.connected) useUI.getState().toast(a.detail);
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  });
  const disconnect = useMutation({
    mutationFn: (h: string) => client.call('hosts.disconnect', { hostname: h }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hosts'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  return (
    <Section
      id="hosts"
      title="Hosts & accounts"
      description="Used to read Pull Requests and merge requests. Public repositories work without an account; private ones need read access."
    >
      <div className="card">
        {(list.data ?? []).map((a) => (
          <div key={a.hostname} className="setting-row">
            <span className="sm b" style={{ width: 200 }}>
              {a.hostname}
            </span>
            <span className="xs muted grow">{a.detail}</span>
            <span className={`badge ${a.connected ? 'badge-ok' : 'badge-elev'}`}>{a.connected ? 'Connected' : 'Not connected'}</span>
            <button className="btn btn-ghost btn-xs muted" type="button" onClick={() => disconnect.mutate(a.hostname)}>
              Remove
            </button>
          </div>
        ))}
        <div className="setting-row" style={{ alignItems: 'flex-end' }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="label">Host</span>
            <input
              className="input mono"
              style={{ width: 200, fontSize: 12 }}
              value={hostname}
              onChange={(e) => {
                setHostname(e.target.value);
                const gl = e.target.value.includes('gitlab');
                setKind(gl ? 'gitlab' : 'github');
                setSource((s) => (s === 'token' ? s : gl ? 'glab' : 'gh'));
              }}
            />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="label">Type</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as HostKind)}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="label">Credentials</span>
            <select className="select" value={source} onChange={(e) => setSource(e.target.value as 'gh' | 'glab' | 'token')}>
              {kind === 'github' ? <option value="gh">Reuse gh CLI login</option> : <option value="glab">Reuse glab CLI login</option>}
              <option value="token">Personal access token</option>
            </select>
          </label>
          {source === 'token' && (
            <label className="col grow" style={{ gap: 4 }}>
              <span className="label">Token (read access)</span>
              <input
                className="input mono"
                style={{ fontSize: 12 }}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          )}
          <button
            className="btn btn-outline btn-sm"
            type="button"
            disabled={connect.isPending || !hostname.trim() || (source === 'token' && !token)}
            onClick={() => connect.mutate()}
          >
            {connect.isPending && <Loader2 className="i i-sm spin" />}
            Connect
          </button>
        </div>
      </div>
      <p className="xs muted" style={{ padding: '0 2px' }}>
        Choosing the gh or glab CLI lets Legible ask it for a token each time; it never copies the CLI's credentials. Pasted tokens are
        stored in the keychain.
      </p>
    </Section>
  );
}

function Spend({ settings, update }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void }) {
  const client = useClient();
  const spend = useQuery({ queryKey: ['spend', null], queryFn: () => client.call('spend.summary', { reviewId: null }) });
  return (
    <Section
      id="spend"
      title="Spend"
      description="Every agent run has a hard cap. With “Use my Claude Code”, costs are estimates against your subscription."
    >
      <div className="card card-body col" style={{ gap: 16 }}>
        <div className="row wrap" style={{ gap: 12 }}>
          <span className="sm grow">Cap per Explanation</span>
          <NumberField
            value={settings.spend.explanationCapUsd}
            min={0.01}
            max={10}
            step={0.05}
            prefix="$"
            label="Cap per Explanation"
            onCommit={(v) => update((s) => ({ ...s, spend: { ...s.spend, explanationCapUsd: v } }))}
          />
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <span className="sm grow">Agent runs at once</span>
          <NumberField
            value={settings.agents.concurrency}
            min={1}
            max={16}
            label="Concurrent agent runs"
            onCommit={(v) => update((s) => ({ ...s, agents: { concurrency: v } }))}
          />
        </div>
        <hr className="sep" />
        <div className="row">
          <span className="sm grow">This month</span>
          <span className="mono sm b">{usd(spend.data?.monthUsd ?? 0)}</span>
        </div>
        <span className="xs muted">{spend.data?.runsThisMonth ?? 0} agent runs this month.</span>
      </div>
    </Section>
  );
}
