import {
  type ClaudeAuth,
  type HostKind,
  type ModelInfo,
  type ModelTier,
  type OpenAIAuth,
  type Provider,
  type Settings,
  TASK_TIER,
  type TaskKind,
} from "@legible/domain"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, RefreshCw, X } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { usd } from "../components/Inline"
import {
  Badge,
  Button,
  Callout,
  Card,
  cn,
  Input,
  Kbd,
  Radio,
  Select,
  Switch,
  Tab,
  Tabs,
  Titlebar,
} from "../components/ui"
import { useClient } from "../context"
import { useUI } from "../state"

const SECTIONS: [string, string][] = [
  ["providers", "Providers"],
  ["tiers", "Model tiers"],
  ["judges", "Judgment models"],
  ["understanding", "Walkthrough & Brief"],
  ["hosts", "Hosts & accounts"],
  ["spend", "Spend"],
  ["diff", "Diff viewer"],
  ["editor", "Editor"],
  ["appearance", "Appearance"],
  ["privacy", "Privacy"],
]

const TIER_WORK: Record<ModelTier, string> = {
  strong: "Domain Changes; Lenses, Verification and Change Requests (M4–M5)",
  mid: "Intent, Walkthrough; Conversations (M5)",
  fast: "Explanations, judgments, Description Gap wording",
}

/** Kinds of work the user can give their own model (Advanced). */
const TASK_LABEL: Partial<Record<TaskKind, string>> = {
  explanation: "Explanations",
  intent: "Intent",
  walkthrough: "Walkthrough",
  domain_changes: "Domain Changes",
  wording: "Description Gap wording",
  judgment: "Judgments (fast-tier fallback)",
}

const PROVIDER_NAME: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
}

const settingRow =
  "flex flex-wrap items-center gap-3.5 border-b px-[18px] py-3.5 last:border-b-0"
const fieldLabel = "text-sm font-medium"

export function SettingsView({
  initialSection,
}: {
  initialSection: string | null
}) {
  const client = useClient()
  const qc = useQueryClient()
  const go = useUI((s) => s.go)
  const returnTo = useUI((s) => s.returnTo)
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => client.call("settings.get", {}),
  })
  const [active, setActive] = useState(initialSection ?? "providers")

  const save = useMutation({
    mutationFn: (s: Settings) => client.call("settings.save", { settings: s }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s)
      void qc.invalidateQueries({ queryKey: ["runtimeStatus"] })
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })
  const update = (fn: (s: Settings) => Settings) =>
    settings.data && save.mutate(fn(structuredClone(settings.data)))

  useEffect(() => {
    if (initialSection)
      document.getElementById(initialSection)?.scrollIntoView()
  }, [initialSection])

  return (
    <>
      <Titlebar>
        <span className="grow text-sm font-semibold">Settings</span>
        {save.isPending && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        <Button
          variant="muted"
          size="sm"
          onClick={() => go(returnTo ?? { name: "home" })}
        >
          Close <Kbd keys={["esc"]} />
        </Button>
      </Titlebar>
      <div className="flex min-h-0 flex-auto">
        <nav
          aria-label="Settings sections"
          className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r bg-sidebar px-3 py-5"
        >
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                "flex h-8 items-center rounded-md px-2.5 text-left text-base font-medium text-muted-foreground hover:bg-hover",
                active === id && "bg-accent text-foreground",
              )}
              onClick={() => {
                setActive(id)
                document
                  .getElementById(id)
                  ?.scrollIntoView({ behavior: "smooth" })
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
              <Judges settings={settings.data} update={update} />
              <Understanding settings={settings.data} update={update} />
              <Hosts />
              <Spend settings={settings.data} update={update} />
              <Section
                id="diff"
                title="Diff viewer"
                description="Defaults for new Reviews. Each Review can switch with ⌥S and W."
              >
                <Card>
                  <div className={settingRow}>
                    <span className="grow text-sm">Layout</span>
                    <Tabs label="Default layout">
                      {(["unified", "split"] as const).map((l) => (
                        <Tab
                          key={l}
                          selected={settings.data.diff.layout === l}
                          onClick={() =>
                            update((s) => ({
                              ...s,
                              diff: { ...s.diff, layout: l },
                            }))
                          }
                        >
                          {l === "unified" ? "Unified" : "Split"}
                        </Tab>
                      ))}
                    </Tabs>
                  </div>
                  <div className={settingRow}>
                    <span className="grow text-sm">
                      Hide whitespace-only changes
                    </span>
                    <Switch
                      checked={settings.data.diff.ignoreWhitespace}
                      label="Hide whitespace-only changes"
                      onChange={(v) =>
                        update((s) => ({
                          ...s,
                          diff: { ...s.diff, ignoreWhitespace: v },
                        }))
                      }
                    />
                  </div>
                  <div className={settingRow}>
                    <span className="grow text-sm">
                      Context lines around each change
                    </span>
                    <NumberField
                      value={settings.data.diff.contextLines}
                      min={0}
                      max={20}
                      label="Context lines"
                      onCommit={(v) =>
                        update((s) => ({
                          ...s,
                          diff: { ...s.diff, contextLines: v },
                        }))
                      }
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
                      onChange={(e) =>
                        update((s) => ({
                          ...s,
                          editor: e.target.value as Settings["editor"],
                        }))
                      }
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
                      {(["system", "dark", "light"] as const).map((t) => (
                        <Tab
                          key={t}
                          selected={settings.data.theme === t}
                          onClick={() => update((s) => ({ ...s, theme: t }))}
                        >
                          {t[0]?.toUpperCase()}
                          {t.slice(1)}
                        </Tab>
                      ))}
                    </Tabs>
                  </div>
                </Card>
              </Section>
              <Privacy settings={settings.data} update={update} />
            </div>
          )}
        </main>
      </div>
    </>
  )
}

function Privacy({
  settings,
  update,
}: {
  settings: Settings
  update: (f: (s: Settings) => Settings) => void
}) {
  const client = useClient()
  const info = useQuery({
    queryKey: ["appInfo"],
    queryFn: () => client.call("app.info", {}),
  })
  const reporting = info.data?.errorReporting
  return (
    <Callout
      id="privacy"
      className="flex flex-col gap-3 px-[18px] py-4"
      aria-labelledby="priv-h"
    >
      <h2 className="text-base font-semibold" id="priv-h">
        Where your code goes
      </h2>
      <p className="text-sm text-muted-foreground">
        Only to your git host (to fetch Pull Requests) and to Claude when you
        ask for an Explanation. Legible collects no telemetry. Explanations only
        read code through Legible's own read-only tools: agents get no shell, no
        file edits, no network, and never load the reviewed repository's Claude
        settings, hooks or MCP servers.
      </p>
      {reporting?.available && (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <div className="flex items-center gap-3">
            <span className="grow text-sm font-medium">Send error reports</span>
            {reporting.forced ? (
              <Badge tone="ok">On for this run</Badge>
            ) : (
              <Switch
                checked={settings.privacy.crashReports}
                label="Send error reports"
                onChange={(v) =>
                  update((s) => ({
                    ...s,
                    privacy: { ...s.privacy, crashReports: v },
                  }))
                }
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Sends errors and crashes to Sentry so they can be fixed: the error
            message, where in Legible it happened, your OS and app version, and
            for a crash, a memory dump that can include code that was open.
            Never your code, diffs, prompts, Explanations, repository names or
            tokens otherwise.
            {reporting.forced &&
              " This run has a Sentry DSN in its environment, which turns them on."}
          </p>
        </div>
      )}
      {reporting && !reporting.available && (
        <p className="text-sm text-muted-foreground">
          This build can't send error reports.
        </p>
      )}
    </Callout>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-3.5"
      aria-labelledby={`${id}-h`}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold" id={`${id}-h`}>
          {title}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
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
  value: number
  min: number
  max: number
  step?: number
  label: string
  onCommit: (v: number) => void
  prefix?: string
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= min && n <= max) onCommit(n)
    else setV(String(value))
  }
  return (
    <span className="flex items-center gap-1">
      {prefix && (
        <span className="text-sm text-muted-foreground">{prefix}</span>
      )}
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
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </span>
  )
}

function SecretField({
  name,
  placeholder,
  label,
}: {
  name: string
  placeholder: string
  label: string
}) {
  const client = useClient()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ["secrets"],
    queryFn: () => client.call("secrets.status", {}),
  })
  const [value, setValue] = useState("")
  const set = useMutation({
    mutationFn: (v: string | null) =>
      client.call("secrets.set", { name, value: v }),
    onSuccess: () => {
      setValue("")
      void qc.invalidateQueries({ queryKey: ["secrets"] })
      void qc.invalidateQueries({ queryKey: ["runtimeStatus"] })
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })
  const saved = Boolean(status.data?.[name])
  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="font-mono text-sm"
        type="password"
        aria-label={label}
        placeholder={saved ? "Saved in the keychain" : placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value && set.mutate(value)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={!value}
        onClick={() => set.mutate(value)}
      >
        Save
      </Button>
      {saved && (
        <Button variant="muted" size="sm" onClick={() => set.mutate(null)}>
          Remove
        </Button>
      )}
    </div>
  )
}

function Providers({
  settings,
  update,
}: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
}) {
  const client = useClient()
  const status = useQuery({
    queryKey: ["runtimeStatus"],
    queryFn: () => client.call("runtime.status", {}),
  })
  const auth = settings.claude.auth
  const setAuth = (a: ClaudeAuth) =>
    update((s) => ({ ...s, claude: { ...s.claude, auth: a } }))
  const usage: ClaudeAuth = auth === "claude-code" ? "anthropic-api" : auth
  const [path, setPath] = useState(settings.claude.executablePath ?? "")
  const readyBadge = (ok: string) =>
    status.data && (
      <Badge tone={status.data.ready ? "ok" : "elevated"}>
        {status.data.ready ? ok : "Not ready"}
      </Badge>
    )

  return (
    <Section
      id="providers"
      title="Providers"
      description="Connect Claude, OpenAI, or both; each Model Tier picks one. Keys are stored in the OS keychain."
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        <Card aria-labelledby="claude-h" className="flex flex-col">
          <div className="flex items-center gap-2 px-[18px] pt-4">
            <h3 className="grow text-base font-semibold" id="claude-h">
              Claude
            </h3>
            <Badge tone="secondary">Default</Badge>
            <Switch
              checked={settings.claude.enabled}
              label="Use Claude"
              onChange={(v) =>
                update((s) => ({ ...s, claude: { ...s.claude, enabled: v } }))
              }
            />
          </div>
          <div className="flex flex-col gap-3.5 px-[18px] py-4">
            <label
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-lg border bg-inset p-3",
                auth === "claude-code" && "border-ring",
              )}
            >
              <div className="flex items-center gap-2">
                <Radio
                  name="claude-auth"
                  checked={auth === "claude-code"}
                  onChange={() => setAuth("claude-code")}
                />
                <span className="grow text-sm font-semibold">
                  Use my Claude Code
                </span>
                {auth === "claude-code" && readyBadge("Connected")}
              </div>
              <p className="text-xs text-muted-foreground">
                Legible runs your installed, signed-in{" "}
                <span className="font-mono">claude</span> with your own
                subscription. It never reads or stores its credentials.
              </p>
              {auth === "claude-code" && (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {status.isFetching ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : status.data?.ready ? (
                      <Check className="size-3" />
                    ) : (
                      <X className="size-3" />
                    )}
                    <span
                      className="grow truncate"
                      title={status.data?.executablePath ?? ""}
                    >
                      {status.data?.detail ?? "Checking…"}
                      {status.data?.executablePath
                        ? ` · ${status.data.executablePath}`
                        : ""}
                    </span>
                    <Button
                      variant="muted"
                      size="xs"
                      onClick={() => void status.refetch()}
                    >
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
                    onBlur={() =>
                      update((s) => ({
                        ...s,
                        claude: {
                          ...s.claude,
                          executablePath: path.trim() || null,
                        },
                      }))
                    }
                  />
                </>
              )}
            </label>

            <div
              className={cn(
                "flex flex-col gap-2.5 rounded-lg border bg-inset p-3",
                auth !== "claude-code" && "border-ring",
              )}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <Radio
                  name="claude-auth"
                  checked={auth !== "claude-code"}
                  onChange={() => setAuth(usage)}
                />
                <span className="grow text-sm font-semibold">Usage-based</span>
                {auth !== "claude-code" && readyBadge("Configured")}
              </label>
              {auth !== "claude-code" && (
                <>
                  <Tabs label="Usage-based option" className="self-start">
                    {(
                      [
                        ["anthropic-api", "Anthropic API"],
                        ["bedrock", "Bedrock"],
                        ["vertex", "Vertex"],
                        ["foundry", "Foundry"],
                      ] as const
                    ).map(([a, label]) => (
                      <Tab
                        key={a}
                        selected={auth === a}
                        onClick={() => setAuth(a)}
                      >
                        {label}
                      </Tab>
                    ))}
                  </Tabs>
                  {auth === "anthropic-api" && (
                    <SecretField
                      name="anthropic-api-key"
                      placeholder="sk-ant-…"
                      label="Anthropic API key"
                    />
                  )}
                  {auth === "bedrock" && (
                    <div className="flex flex-col gap-2">
                      <TextSetting
                        label="AWS region"
                        value={settings.claude.bedrock.region}
                        onCommit={(v) =>
                          update((s) => ({
                            ...s,
                            claude: {
                              ...s.claude,
                              bedrock: { ...s.claude.bedrock, region: v },
                            },
                          }))
                        }
                      />
                      <TextSetting
                        label="AWS profile (optional)"
                        value={settings.claude.bedrock.profile}
                        onCommit={(v) =>
                          update((s) => ({
                            ...s,
                            claude: {
                              ...s.claude,
                              bedrock: { ...s.claude.bedrock, profile: v },
                            },
                          }))
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        Uses your AWS credentials chain (profile, SSO, or
                        environment).
                      </span>
                    </div>
                  )}
                  {auth === "vertex" && (
                    <div className="flex flex-col gap-2">
                      <TextSetting
                        label="GCP project ID"
                        value={settings.claude.vertex.projectId}
                        onCommit={(v) =>
                          update((s) => ({
                            ...s,
                            claude: {
                              ...s.claude,
                              vertex: { ...s.claude.vertex, projectId: v },
                            },
                          }))
                        }
                      />
                      <TextSetting
                        label="Region"
                        value={settings.claude.vertex.region}
                        onCommit={(v) =>
                          update((s) => ({
                            ...s,
                            claude: {
                              ...s.claude,
                              vertex: { ...s.claude.vertex, region: v },
                            },
                          }))
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        Uses Application Default Credentials (gcloud auth
                        application-default login).
                      </span>
                    </div>
                  )}
                  {auth === "foundry" && (
                    <div className="flex flex-col gap-2">
                      <TextSetting
                        label="Foundry resource"
                        value={settings.claude.foundry.resource}
                        onCommit={(v) =>
                          update((s) => ({
                            ...s,
                            claude: { ...s.claude, foundry: { resource: v } },
                          }))
                        }
                      />
                      <SecretField
                        name="foundry-api-key"
                        placeholder="Foundry API key"
                        label="Foundry API key"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>

        <OpenAICard settings={settings} update={update} />
      </div>
    </Section>
  )
}

function TextSetting({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      <Input
        className="font-mono text-sm"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v.trim())}
        onKeyDown={(e) => e.key === "Enter" && onCommit(v.trim())}
      />
    </label>
  )
}

function ModelSelect({
  models,
  value,
  connected,
  label,
  onChange,
  allowDefault = false,
}: {
  models: ModelInfo[]
  value: { provider: Provider; model: string } | null
  connected: Record<Provider, boolean>
  label: string
  onChange: (v: { provider: Provider; model: string } | null) => void
  allowDefault?: boolean
}) {
  return (
    <Select
      aria-label={label}
      className="w-[240px]"
      value={value ? `${value.provider}:${value.model}` : ""}
      onChange={(e) => {
        const [provider, ...rest] = e.target.value.split(":")
        onChange(
          provider
            ? { provider: provider as Provider, model: rest.join(":") }
            : null,
        )
      }}
    >
      {allowDefault && <option value="">Tier default</option>}
      {(["anthropic", "openai"] as const).map((p) => (
        <optgroup
          key={p}
          label={`${PROVIDER_NAME[p]}${connected[p] ? "" : " (not connected)"}`}
        >
          {models
            .filter((m) => m.provider === p)
            .map((m) => (
              <option key={m.id} value={`${p}:${m.id}`}>
                {m.displayName}
                {m.status === "experimental" ? " (experimental)" : ""}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  )
}

function Tiers({
  settings,
  update,
}: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
}) {
  const client = useClient()
  const models = useQuery({
    queryKey: ["models"],
    queryFn: () => client.call("models.list", {}),
  })
  const [advanced, setAdvanced] = useState(
    Object.keys(settings.tasks).length > 0,
  )
  const connected = {
    anthropic: settings.claude.enabled,
    openai: settings.openai.enabled,
  }
  const onlyOpenAI = !connected.anthropic && connected.openai
  return (
    <Section
      id="tiers"
      title="Model tiers"
      description="Each kind of agent work runs on a tier, and each tier on any connected provider's model. Tiers don't have to share a provider."
    >
      {onlyOpenAI && settings.tiers.mid.provider === "anthropic" && (
        <Callout tone="ask" className="flex items-center gap-2 px-3 py-2">
          <span className="grow text-sm">
            Claude is off, so work falls back to OpenAI's defaults.
          </span>
          <Button
            size="xs"
            onClick={() =>
              update((s) => ({
                ...s,
                tiers: {
                  strong: { provider: "openai", model: "gpt-6-astra" },
                  mid: { provider: "openai", model: "gpt-6.1-sol" },
                  fast: { provider: "openai", model: "gpt-6-luna" },
                },
              }))
            }
          >
            Use OpenAI for every tier
          </Button>
        </Callout>
      )}
      <Card>
        {(["fast", "mid", "strong"] as const).map((tier) => {
          const current = settings.tiers[tier]
          const info = models.data?.find(
            (m) => m.id === current.model && m.provider === current.provider,
          )
          return (
            <div key={tier} className={settingRow}>
              <div className="flex min-w-60 grow flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  {tier[0]?.toUpperCase() + tier.slice(1)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {TIER_WORK[tier]}
                </span>
              </div>
              {info && (
                <Badge tone={info.status === "recommended" ? "ok" : "outline"}>
                  {info.status}
                </Badge>
              )}
              {info && (
                <span className="w-7 font-mono text-xs text-muted-foreground">
                  {"$".repeat(info.costRank)}
                </span>
              )}
              <ModelSelect
                models={models.data ?? []}
                value={current}
                connected={connected}
                label={`${tier} tier model`}
                onChange={(v) =>
                  v &&
                  update((s) => ({ ...s, tiers: { ...s.tiers, [tier]: v } }))
                }
              />
            </div>
          )
        })}
      </Card>
      <button
        type="button"
        className="self-start text-sm text-muted-foreground hover:text-foreground"
        aria-expanded={advanced}
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? "▾" : "▸"} Advanced: a model for one kind of work
      </button>
      {advanced && (
        <Card>
          {(Object.keys(TASK_LABEL) as TaskKind[]).map((kind) => (
            <div key={kind} className={settingRow}>
              <div className="flex min-w-60 grow flex-col gap-0.5">
                <span className="text-sm">{TASK_LABEL[kind]}</span>
                <span className="text-xs text-muted-foreground">
                  Tier: {TASK_TIER[kind]}
                </span>
              </div>
              <ModelSelect
                models={models.data ?? []}
                value={settings.tasks[kind] ?? null}
                connected={connected}
                allowDefault
                label={`${TASK_LABEL[kind]} model`}
                onChange={(v) =>
                  update((s) => {
                    const tasks = { ...s.tasks }
                    if (v) tasks[kind] = v
                    else delete tasks[kind]
                    return { ...s, tasks }
                  })
                }
              />
            </div>
          ))}
        </Card>
      )}
      <p className="px-0.5 text-xs text-muted-foreground">
        Recommended models passed Legible's evals for their tier; experimental
        ones haven't yet. Every OpenAI model is experimental until the evals run
        on it. Explanations aim for under five seconds on the fast tier.
      </p>
    </Section>
  )
}

function OpenAICard({
  settings,
  update,
}: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
}) {
  const client = useClient()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ["runtimeStatus", "openai"],
    queryFn: () => client.call("runtime.status", { provider: "openai" }),
    enabled: settings.openai.enabled,
  })
  const account = useQuery({
    queryKey: ["openaiAccount"],
    queryFn: () => client.call("openai.account", {}),
  })
  const signIn = useMutation({
    mutationFn: () => client.call("openai.signIn", {}),
    onSuccess: (a) => {
      qc.setQueryData(["openaiAccount"], a)
      void qc.invalidateQueries({ queryKey: ["runtimeStatus"] })
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })
  const signOut = useMutation({
    mutationFn: () => client.call("openai.signOut", {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["openaiAccount"] })
      void qc.invalidateQueries({ queryKey: ["runtimeStatus"] })
    },
  })
  const auth = settings.openai.auth
  const setAuth = (a: OpenAIAuth) =>
    update((s) => ({ ...s, openai: { ...s.openai, auth: a } }))
  const on = settings.openai.enabled
  return (
    <Card aria-labelledby="oai-h" className="flex flex-col">
      <div className="flex items-center gap-2 px-[18px] pt-4">
        <h3 className="grow text-base font-semibold" id="oai-h">
          OpenAI
        </h3>
        {on && status.data && (
          <Badge tone={status.data.ready ? "ok" : "elevated"}>
            {status.data.ready ? "Connected" : "Not ready"}
          </Badge>
        )}
        <Switch
          checked={on}
          label="Use OpenAI"
          onChange={(v) =>
            update((s) => ({ ...s, openai: { ...s.openai, enabled: v } }))
          }
        />
      </div>
      <div
        className={cn(
          "flex flex-col gap-3.5 px-[18px] py-4",
          !on && "pointer-events-none opacity-60",
        )}
      >
        <label
          className={cn(
            "flex cursor-pointer flex-col gap-2 rounded-lg border bg-inset p-3",
            auth === "chatgpt" && "border-ring",
          )}
        >
          <div className="flex items-center gap-2">
            <Radio
              name="openai-auth"
              checked={auth === "chatgpt"}
              onChange={() => setAuth("chatgpt")}
            />
            <span className="grow text-sm font-semibold">
              Continue with ChatGPT
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Uses your ChatGPT Plus or Pro plan through OpenAI's sign-in for
            open-source apps. Tokens stay in the keychain.
          </p>
          {auth === "chatgpt" &&
            (!account.data?.available ? (
              <span className="text-xs text-muted-foreground">
                This build can't sign in with ChatGPT yet: it needs the client
                id OpenAI registers for Legible. Use an API key for now.
              </span>
            ) : account.data.signedIn ? (
              <span className="flex items-center gap-2 text-xs">
                <Check className="size-3" />
                <span className="grow">
                  Signed in
                  {account.data.email ? ` as ${account.data.email}` : ""}
                  {account.data.plan ? ` · ${account.data.plan}` : ""}
                </span>
                <Button
                  variant="muted"
                  size="xs"
                  onClick={() => signOut.mutate()}
                >
                  Sign out
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                className="self-start"
                disabled={signIn.isPending}
                onClick={() => signIn.mutate()}
              >
                {signIn.isPending && <Loader2 className="animate-spin" />}
                Continue with ChatGPT
              </Button>
            ))}
        </label>
        <div
          className={cn(
            "flex flex-col gap-2.5 rounded-lg border bg-inset p-3",
            auth === "api-key" && "border-ring",
          )}
        >
          <label className="flex cursor-pointer items-center gap-2">
            <Radio
              name="openai-auth"
              checked={auth === "api-key"}
              onChange={() => setAuth("api-key")}
            />
            <span className="grow text-sm font-semibold">OpenAI API key</span>
          </label>
          {auth === "api-key" && (
            <SecretField
              name="openai-api-key"
              placeholder="sk-…"
              label="OpenAI API key"
            />
          )}
        </div>
        {on && status.data && !status.data.ready && (
          <span className="text-xs text-muted-foreground">
            {status.data.detail}
          </span>
        )}
      </div>
    </Card>
  )
}

function Judges({
  settings,
  update,
}: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
}) {
  const j = settings.judge
  return (
    <Section
      id="judges"
      title="Judgment models"
      description="Legible makes many small pick-one and yes/no judgments: Scope tagging, Description Gap checks, Risk signals. A judgment model makes them faster, cheaper and better calibrated. Without one, the fast tier's model judges."
    >
      <Card>
        <div className={settingRow}>
          <div className="flex min-w-60 grow flex-col gap-0.5">
            <span className="text-sm font-semibold">TypeSafe Jev</span>
            <span className="text-xs text-muted-foreground">
              Sends Step names and narratives, file paths, changed Symbol names,
              the Intent, and the PR title and description to api.typesafe.ai.
              Never the code itself.
            </span>
          </div>
          <Switch
            checked={j.jev.enabled}
            label="Use TypeSafe Jev"
            onChange={(v) =>
              update((s) => ({
                ...s,
                judge: { ...s.judge, jev: { ...s.judge.jev, enabled: v } },
              }))
            }
          />
        </div>
        {j.jev.enabled && (
          <div className={cn(settingRow, "flex-col items-stretch")}>
            <SecretField
              name="typesafe-api-key"
              placeholder="TypeSafe API key"
              label="TypeSafe API key"
            />
            <TextSetting
              label="Model (pin a version to keep thresholds stable)"
              value={j.jev.model}
              onCommit={(v) =>
                update((s) => ({
                  ...s,
                  judge: {
                    ...s.judge,
                    jev: { ...s.judge.jev, model: v || "jev-latest" },
                  },
                }))
              }
            />
          </div>
        )}
        <div className={settingRow}>
          <div className="flex min-w-60 grow flex-col gap-0.5">
            <span className="text-sm font-semibold">OpenAI Decisions</span>
            <span className="text-xs text-muted-foreground">
              Uses your OpenAI API key and sends the same as above to OpenAI.
            </span>
          </div>
          <Switch
            checked={j.decisions.enabled}
            label="Use OpenAI Decisions"
            onChange={(v) =>
              update((s) => ({
                ...s,
                judge: { ...s.judge, decisions: { enabled: v } },
              }))
            }
          />
        </div>
        {j.jev.enabled && j.decisions.enabled && (
          <div className={settingRow}>
            <span className="grow text-sm">Ask first</span>
            <Tabs label="Judge order" className="h-7 p-0.5">
              {(["jev", "decisions"] as const).map((b) => (
                <Tab
                  key={b}
                  selected={j.order[0] === b}
                  className="px-2"
                  onClick={() =>
                    update((s) => ({
                      ...s,
                      judge: {
                        ...s.judge,
                        order: [b, b === "jev" ? "decisions" : "jev"],
                      },
                    }))
                  }
                >
                  {b === "jev" ? "TypeSafe" : "OpenAI Decisions"}
                </Tab>
              ))}
            </Tabs>
          </div>
        )}
      </Card>
    </Section>
  )
}

function Understanding({
  settings,
  update,
}: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
}) {
  return (
    <Section
      id="understanding"
      title="Walkthrough & Brief"
      description="When a Review opens, Legible works out its Intent, plans a Walkthrough, and writes the Change Brief."
    >
      <Card>
        <div className={settingRow}>
          <div className="flex min-w-60 grow flex-col gap-0.5">
            <span className="text-sm font-semibold">Build automatically</span>
            <span className="text-xs text-muted-foreground">
              Off: build them from the Brief when you want them.
            </span>
          </div>
          <Switch
            checked={settings.understanding.auto}
            label="Build automatically"
            onChange={(v) =>
              update((s) => ({ ...s, understanding: { auto: v } }))
            }
          />
        </div>
        <div className={settingRow}>
          <div className="flex min-w-60 grow flex-col gap-0.5">
            <span className="text-sm font-semibold">
              Read Agent Transcripts
            </span>
            <span className="text-xs text-muted-foreground">
              Finds the Claude Code (~/.claude/projects) and Codex
              (~/.codex/sessions) sessions run in the repository's folder while
              it changed, and reads their prompts, plans and corrections as
              Intent. Nothing else in those folders is read.
            </span>
          </div>
          <Switch
            checked={settings.intent.readTranscripts}
            label="Read Agent Transcripts"
            onChange={(v) =>
              update((s) => ({ ...s, intent: { readTranscripts: v } }))
            }
          />
        </div>
      </Card>
    </Section>
  )
}

function Hosts() {
  const client = useClient()
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ["hosts"],
    queryFn: () => client.call("hosts.list", {}),
  })
  const [hostname, setHostname] = useState("github.com")
  const [kind, setKind] = useState<HostKind>("github")
  const [source, setSource] = useState<"gh" | "glab" | "token">("gh")
  const [token, setToken] = useState("")
  const connect = useMutation({
    mutationFn: () =>
      client.call("hosts.connect", {
        hostname: hostname.trim(),
        kind,
        source,
        token: source === "token" ? token : null,
      }),
    onSuccess: (a) => {
      setToken("")
      void qc.invalidateQueries({ queryKey: ["hosts"] })
      void qc.invalidateQueries({ queryKey: ["settings"] })
      if (!a.connected) useUI.getState().toast(a.detail)
    },
    onError: (e: Error) => useUI.getState().toast(e.message),
  })
  const disconnect = useMutation({
    mutationFn: (h: string) => client.call("hosts.disconnect", { hostname: h }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["hosts"] })
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
  })

  return (
    <Section
      id="hosts"
      title="Hosts & accounts"
      description="Used to read Pull Requests and merge requests. Public repositories work without an account; private ones need read access."
    >
      <Card>
        {(list.data ?? []).map((a) => (
          <div key={a.hostname} className={settingRow}>
            <span className="w-[200px] text-sm font-semibold">
              {a.hostname}
            </span>
            <span className="grow text-xs text-muted-foreground">
              {a.detail}
            </span>
            <Badge tone={a.connected ? "ok" : "elevated"}>
              {a.connected ? "Connected" : "Not connected"}
            </Badge>
            <Button
              variant="muted"
              size="xs"
              onClick={() => disconnect.mutate(a.hostname)}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className={cn(settingRow, "items-end")}>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Host</span>
            <Input
              className="w-[200px] font-mono text-sm"
              value={hostname}
              onChange={(e) => {
                setHostname(e.target.value)
                const gl = e.target.value.includes("gitlab")
                setKind(gl ? "gitlab" : "github")
                setSource((s) => (s === "token" ? s : gl ? "glab" : "gh"))
              }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Type</span>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as HostKind)}
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Credentials</span>
            <Select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "gh" | "glab" | "token")
              }
            >
              {kind === "github" ? (
                <option value="gh">Reuse gh CLI login</option>
              ) : (
                <option value="glab">Reuse glab CLI login</option>
              )}
              <option value="token">Personal access token</option>
            </Select>
          </label>
          {source === "token" && (
            <label className="flex grow flex-col gap-1">
              <span className={fieldLabel}>Token (read access)</span>
              <Input
                className="font-mono text-sm"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={
              connect.isPending ||
              !hostname.trim() ||
              (source === "token" && !token)
            }
            onClick={() => connect.mutate()}
          >
            {connect.isPending && <Loader2 className="animate-spin" />}
            Connect
          </Button>
        </div>
      </Card>
      <p className="px-0.5 text-xs text-muted-foreground">
        Choosing the gh or glab CLI lets Legible ask it for a token each time;
        it never copies the CLI's credentials. Pasted tokens are stored in the
        keychain.
      </p>
    </Section>
  )
}

function Spend({
  settings,
  update,
}: {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
}) {
  const client = useClient()
  const spend = useQuery({
    queryKey: ["spend", null],
    queryFn: () => client.call("spend.summary", { reviewId: null }),
  })
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
            onCommit={(v) =>
              update((s) => ({
                ...s,
                spend: { ...s.spend, explanationCapUsd: v },
              }))
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow text-sm">
            Cap per Walkthrough and Brief (one Iteration)
          </span>
          <NumberField
            value={settings.spend.understandingCapUsd}
            min={0.05}
            max={50}
            step={0.25}
            prefix="$"
            label="Cap per Walkthrough and Brief"
            onCommit={(v) =>
              update((s) => ({
                ...s,
                spend: { ...s.spend, understandingCapUsd: v },
              }))
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grow text-sm">Agent runs at once</span>
          <NumberField
            value={settings.agents.concurrency}
            min={1}
            max={16}
            label="Concurrent agent runs"
            onCommit={(v) =>
              update((s) => ({ ...s, agents: { concurrency: v } }))
            }
          />
        </div>
        <hr className="border-0 border-t" />
        <div className="flex items-center">
          <span className="grow text-sm">This month</span>
          <span className="font-mono text-sm font-semibold">
            {usd(spend.data?.monthUsd ?? 0)}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {spend.data?.runsThisMonth ?? 0} agent runs this month.
        </span>
      </Card>
    </Section>
  )
}
