import type { ClaudeAuth, HostKind, ModelTier, Settings } from '@legible/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { usd } from '../components/Inline';
import { Badge, Button, Callout, Card, cn, Input, Kbd, Radio, Select, Switch, Tab, Tabs, Titlebar } from '../components/ui';
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

const settingRow = 'flex flex-wrap items-center gap-3.5 border-b px-[18px] py-3.5 last:border-b-0';
const fieldLabel = 'text-sm font-medium';

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
      <Titlebar>
        <span className="grow text-sm font-semibold">Settings</span>
        {save.isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <Button variant="muted" size="sm" onClick={() => go(returnTo ?? { name: 'home' })}>
          Close <Kbd keys={['esc']} />
        </Button>
      </Titlebar>
      <div className="flex min-h-0 flex-auto">
        <nav aria-label="Settings sections" className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r bg-sidebar px-3 py-5">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                'flex h-8 items-center rounded-md px-2.5 text-left text-base font-medium text-muted-foreground hover:bg-hover',
                active === id && 'bg-accent text-foreground',
              )}
              onClick={() => {
                setActive(id);
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="flex-auto overflow-auto px-6 pt-7 pb-16">
          {settings.data && (
            <div className="mx-auto flex max-w-[860px] flex-col gap-9">
              <Providers settings={settings.data} update={update} />
              <Tiers settings={settings.data} update={update} />
              <Hosts />
              <Spend settings={settings.data} update={update} />
              <Section id="diff" title="Diff viewer" description="Defaults for new Reviews. Each Review can switch with ⌥S and W.">
                <Card>
                  <div className={settingRow}>
                    <span className="grow text-sm">Layout</span>
                    <Tabs label="Default layout">
                      {(['unified', 'split'] as const).map((l) => (
                        <Tab
                          key={l}
                          selected={settings.data.diff.layout === l}
                          onClick={() => update((s) => ({ ...s, diff: { ...s.diff, layout: l } }))}
                        >
                          {l === 'unified' ? 'Unified' : 'Split'}
                        </Tab>
                      ))}
                    </Tabs>
                  </div>
                  <div className={settingRow}>
                    <span className="grow text-sm">Hide whitespace-only changes</span>
                    <Switch
                      checked={settings.data.diff.ignoreWhitespace}
                      label="Hide whitespace-only changes"
                      onChange={(v) => update((s) => ({ ...s, diff: { ...s.diff, ignoreWhitespace: v } }))}
                    />
                  </div>
                  <div className={settingRow}>
                    <span className="grow text-sm">Context lines around each change</span>
                    <NumberField
                      value={settings.data.diff.contextLines}
                      min={0}
                      max={20}
                      label="Context lines"
                      onCommit={(v) => update((s) => ({ ...s, diff: { ...s.diff, contextLines: v } }))}
                    />
                  </div>
                </Card>
              </Section>
              <Section
                id="editor"
                title="Editor"
                description="Where “Open in editor” (o) opens the current line. Only for Reviews of a local working tree."
              >
                <Card>
                  <div className={settingRow}>
                    <span className="grow text-sm">Editor</span>
                    <Select
                      aria-label="Editor"
                      value={settings.data.editor}
                      onChange={(e) => update((s) => ({ ...s, editor: e.target.value as Settings['editor'] }))}
                    >
                      <option value="vscode">VS Code</option>
                      <option value="cursor">Cursor</option>
                      <option value="zed">Zed</option>
                      <option value="idea">JetBrains IDE</option>
                      <option value="env">$VISUAL / $EDITOR</option>
                    </Select>
                  </div>
                </Card>
              </Section>
              <Section id="appearance" title="Appearance">
                <Card>
                  <div className={settingRow}>
                    <span className="grow text-sm">Theme</span>
                    <Tabs label="Theme">
                      {(['system', 'dark', 'light'] as const).map((t) => (
                        <Tab key={t} selected={settings.data.theme === t} onClick={() => update((s) => ({ ...s, theme: t }))}>
                          {t[0]?.toUpperCase()}
                          {t.slice(1)}
                        </Tab>
                      ))}
                    </Tabs>
                  </div>
                </Card>
              </Section>
              <Callout id="privacy" className="flex flex-col gap-2 px-[18px] py-4" aria-labelledby="priv-h">
                <h2 className="text-base font-semibold" id="priv-h">
                  Where your code goes
                </h2>
                <p className="text-sm text-muted-foreground">
                  Only to your git host (to fetch Pull Requests) and to Claude when you ask for an Explanation. Legible collects no
                  telemetry and sends no crash reports. Explanations only read code through Legible's own read-only tools: agents get no
                  shell, no file edits, no network, and never load the reviewed repository's Claude settings, hooks or MCP servers.
                </p>
              </Callout>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3.5" aria-labelledby={`${id}-h`}>
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold" id={`${id}-h`}>
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
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
    <span className="flex items-center gap-1">
      {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
      <Input
        className="w-[90px] text-right font-mono"
        aria-label={label}
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
    <div className="flex items-center gap-1.5">
      <Input
        className="font-mono text-sm"
        type="password"
        aria-label={label}
        placeholder={saved ? 'Saved in the keychain' : placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value && set.mutate(value)}
      />
      <Button variant="outline" size="sm" disabled={!value} onClick={() => set.mutate(value)}>
        Save
      </Button>
      {saved && (
        <Button variant="muted" size="sm" onClick={() => set.mutate(null)}>
          Remove
        </Button>
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
  const readyBadge = (ok: string) =>
    status.data && <Badge tone={status.data.ready ? 'ok' : 'elevated'}>{status.data.ready ? ok : 'Not ready'}</Badge>;

  return (
    <Section
      id="providers"
      title="Providers"
      description="Explanations run on Claude. Keys are stored in the OS keychain and passed to Claude only as environment variables."
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        <Card aria-labelledby="claude-h" className="flex flex-col">
          <div className="flex items-center gap-2 px-[18px] pt-4">
            <h3 className="grow text-base font-semibold" id="claude-h">
              Claude
            </h3>
            <Badge tone="secondary">Default</Badge>
          </div>
          <div className="flex flex-col gap-3.5 px-[18px] py-4">
            <label
              className={cn('flex cursor-pointer flex-col gap-2 rounded-lg border bg-inset p-3', auth === 'claude-code' && 'border-ring')}
            >
              <div className="flex items-center gap-2">
                <Radio name="claude-auth" checked={auth === 'claude-code'} onChange={() => setAuth('claude-code')} />
                <span className="grow text-sm font-semibold">Use my Claude Code</span>
                {auth === 'claude-code' && readyBadge('Connected')}
              </div>
              <p className="text-xs text-muted-foreground">
                Legible runs your installed, signed-in <span className="font-mono">claude</span> with your own subscription. It never reads
                or stores its credentials.
              </p>
              {auth === 'claude-code' && (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {status.isFetching ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : status.data?.ready ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    <span className="grow truncate" title={status.data?.executablePath ?? ''}>
                      {status.data?.detail ?? 'Checking…'}
                      {status.data?.executablePath ? ` · ${status.data.executablePath}` : ''}
                    </span>
                    <Button variant="muted" size="xs" onClick={() => void status.refetch()}>
                      <RefreshCw />
                      Recheck
                    </Button>
                  </div>
                  <Input
                    className="h-7 font-mono text-sm"
                    aria-label="Path to claude"
                    placeholder="Path to claude (blank = find it on your PATH)"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    onBlur={() => update((s) => ({ ...s, claude: { ...s.claude, executablePath: path.trim() || null } }))}
                  />
                </>
              )}
            </label>

            <div className={cn('flex flex-col gap-2.5 rounded-lg border bg-inset p-3', auth !== 'claude-code' && 'border-ring')}>
              <label className="flex cursor-pointer items-center gap-2">
                <Radio name="claude-auth" checked={auth !== 'claude-code'} onChange={() => setAuth(usage)} />
                <span className="grow text-sm font-semibold">Usage-based</span>
                {auth !== 'claude-code' && readyBadge('Configured')}
              </label>
              {auth !== 'claude-code' && (
                <>
                  <Tabs label="Usage-based option" className="self-start">
                    {(
                      [
                        ['anthropic-api', 'Anthropic API'],
                        ['bedrock', 'Bedrock'],
                        ['vertex', 'Vertex'],
                        ['foundry', 'Foundry'],
                      ] as const
                    ).map(([a, label]) => (
                      <Tab key={a} selected={auth === a} onClick={() => setAuth(a)}>
                        {label}
                      </Tab>
                    ))}
                  </Tabs>
                  {auth === 'anthropic-api' && <SecretField name="anthropic-api-key" placeholder="sk-ant-…" label="Anthropic API key" />}
                  {auth === 'bedrock' && (
                    <div className="flex flex-col gap-2">
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
                      <span className="text-xs text-muted-foreground">Uses your AWS credentials chain (profile, SSO, or environment).</span>
                    </div>
                  )}
                  {auth === 'vertex' && (
                    <div className="flex flex-col gap-2">
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
                      <span className="text-xs text-muted-foreground">
                        Uses Application Default Credentials (gcloud auth application-default login).
                      </span>
                    </div>
                  )}
                  {auth === 'foundry' && (
                    <div className="flex flex-col gap-2">
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
        </Card>

        <Card aria-labelledby="oai-h" className="flex flex-col opacity-70">
          <div className="flex items-center gap-2 px-[18px] pt-4">
            <h3 className="grow text-base font-semibold" id="oai-h">
              OpenAI
            </h3>
            <Badge tone="muted">Coming in M3</Badge>
          </div>
          <p className="px-[18px] py-4 text-sm text-muted-foreground">
            Continue with ChatGPT or an OpenAI API key, with models chosen per tier. Arrives with the Walkthrough and Change Brief.
          </p>
        </Card>
      </div>
    </Section>
  );
}

function TextSetting({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      <Input
        className="font-mono text-sm"
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
      <Card>
        {(['fast', 'mid', 'strong'] as const).map((tier) => {
          const current = settings.tiers[tier];
          const info = models.data?.find((m) => m.id === current.model);
          return (
            <div key={tier} className={settingRow}>
              <div className="flex min-w-60 grow flex-col gap-0.5">
                <span className="text-sm font-semibold">{tier[0]?.toUpperCase() + tier.slice(1)}</span>
                <span className="text-xs text-muted-foreground">{TIER_WORK[tier]}</span>
              </div>
              {info && <Badge tone={info.status === 'recommended' ? 'ok' : 'outline'}>{info.status}</Badge>}
              {info && <span className="w-7 font-mono text-xs text-muted-foreground">{'$'.repeat(info.costRank)}</span>}
              <Select
                aria-label={`${tier} tier model`}
                className="w-[220px]"
                value={current.model}
                onChange={(e) => update((s) => ({ ...s, tiers: { ...s.tiers, [tier]: { provider: 'anthropic', model: e.target.value } } }))}
              >
                {(models.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.status === 'experimental' ? ' (experimental)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </Card>
      <p className="px-0.5 text-xs text-muted-foreground">
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
      <Card>
        {(list.data ?? []).map((a) => (
          <div key={a.hostname} className={settingRow}>
            <span className="w-[200px] text-sm font-semibold">{a.hostname}</span>
            <span className="grow text-xs text-muted-foreground">{a.detail}</span>
            <Badge tone={a.connected ? 'ok' : 'elevated'}>{a.connected ? 'Connected' : 'Not connected'}</Badge>
            <Button variant="muted" size="xs" onClick={() => disconnect.mutate(a.hostname)}>
              Remove
            </Button>
          </div>
        ))}
        <div className={cn(settingRow, 'items-end')}>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Host</span>
            <Input
              className="w-[200px] font-mono text-sm"
              value={hostname}
              onChange={(e) => {
                setHostname(e.target.value);
                const gl = e.target.value.includes('gitlab');
                setKind(gl ? 'gitlab' : 'github');
                setSource((s) => (s === 'token' ? s : gl ? 'glab' : 'gh'));
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Type</span>
            <Select value={kind} onChange={(e) => setKind(e.target.value as HostKind)}>
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Credentials</span>
            <Select value={source} onChange={(e) => setSource(e.target.value as 'gh' | 'glab' | 'token')}>
              {kind === 'github' ? <option value="gh">Reuse gh CLI login</option> : <option value="glab">Reuse glab CLI login</option>}
              <option value="token">Personal access token</option>
            </Select>
          </label>
          {source === 'token' && (
            <label className="flex grow flex-col gap-1">
              <span className={fieldLabel}>Token (read access)</span>
              <Input className="font-mono text-sm" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={connect.isPending || !hostname.trim() || (source === 'token' && !token)}
            onClick={() => connect.mutate()}
          >
            {connect.isPending && <Loader2 className="animate-spin" />}
            Connect
          </Button>
        </div>
      </Card>
      <p className="px-0.5 text-xs text-muted-foreground">
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
      <Card className="flex flex-col gap-4 px-[18px] py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow text-sm">Cap per Explanation</span>
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
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow text-sm">Agent runs at once</span>
          <NumberField
            value={settings.agents.concurrency}
            min={1}
            max={16}
            label="Concurrent agent runs"
            onCommit={(v) => update((s) => ({ ...s, agents: { concurrency: v } }))}
          />
        </div>
        <hr className="border-0 border-t" />
        <div className="flex items-center">
          <span className="grow text-sm">This month</span>
          <span className="font-mono text-sm font-semibold">{usd(spend.data?.monthUsd ?? 0)}</span>
        </div>
        <span className="text-xs text-muted-foreground">{spend.data?.runsThisMonth ?? 0} agent runs this month.</span>
      </Card>
    </Section>
  );
}
