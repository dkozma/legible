// Electron main process: windows, the IPC router, and wiring between services.

import { mkdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  type ClaudeRuntimeConfig,
  DEFAULT_TIERS,
  MODEL_CATALOG,
} from "@legible/agent-runtime"
import {
  DEFAULT_SETTINGS,
  type ExplanationJob,
  hostTokenSecret,
  type Settings,
} from "@legible/domain"
import { gitVersion } from "@legible/git"
import { parsePullRequestUrl } from "@legible/hosts"
import {
  CHANNELS,
  type Channel,
  type Events,
  type Req,
  type Responses,
  requests,
} from "@legible/ipc"
import { Store } from "@legible/store"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  net,
  protocol,
  shell,
  utilityProcess,
} from "electron"

import {
  AgentHostClient,
  inProcessTransport,
  type Transport,
} from "./agentHostClient"
import type { FromHost } from "./agentHostCore"
import { openInEditor } from "./editor"
import { ExplanationService } from "./explanations"
import { HostService } from "./hosts"
import { ReviewService, UserError } from "./reviews"
import { SecretStore } from "./secrets"
import { loadShellEnv } from "./shellEnv"

const here = dirname(fileURLToPath(import.meta.url))
const requireHere = createRequire(import.meta.url)

if (process.env.LEGIBLE_USER_DATA)
  app.setPath("userData", resolve(process.env.LEGIBLE_USER_DATA))
app.setName("Legible")

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ")

let mainWindow: BrowserWindow | null = null
let store: Store
let secrets: SecretStore
let reviews: ReviewService
let explanations: ExplanationService
let hosts: HostService
let agentHost: AgentHostClient
let settingsCache: Settings | null = null
const pendingOpen: string[] = []

/**
 * Folders the user chose (dialog, command line, Dock). The renderer can only
 * open repositories under one of these, or ones it already has Reviews for.
 */
const approvedRoots = new Set<string>()

async function assertApproved(path: string) {
  const abs = resolve(path)
  for (const root of approvedRoots)
    if (abs === root || abs.startsWith(`${root}${sep}`)) return
  const known = await store.listReviews()
  if (
    known.some(
      (r) =>
        r.repo.workTree &&
        (abs === r.repo.workTree || abs.startsWith(`${r.repo.workTree}${sep}`)),
    )
  )
    return
  throw new UserError("Choose the repository with “Choose folder…” first.")
}

function send<E extends keyof Events>(event: E, payload: Events[E]) {
  mainWindow?.webContents.send(event, payload)
}

async function getSettings(): Promise<Settings> {
  settingsCache ??= await store.getSettings()
  return settingsCache
}

/** The SDK's bundled `claude`, unpacked from the asar archive in packaged builds. */
function bundledClaude(): string | null {
  if (!app.isPackaged) return null
  try {
    const pkg = requireHere.resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`,
    )
    const bin = join(
      dirname(pkg),
      process.platform === "win32" ? "claude.exe" : "claude",
    )
    return bin.replace(
      `app.asar${process.platform === "win32" ? "\\" : "/"}`,
      `app.asar.unpacked${process.platform === "win32" ? "\\" : "/"}`,
    )
  } catch {
    return null
  }
}

function claudeConfig(s: Settings): ClaudeRuntimeConfig {
  const env: Record<string, string> = {}
  const key = secrets.get("anthropic-api-key")
  if (key) env.ANTHROPIC_API_KEY = key
  const foundry = secrets.get("foundry-api-key")
  if (foundry) env.ANTHROPIC_FOUNDRY_API_KEY = foundry
  const scratchDir = join(app.getPath("userData"), "scratch")
  mkdirSync(scratchDir, { recursive: true })
  return {
    auth: s.claude.auth,
    executablePath: s.claude.executablePath,
    env,
    bedrock: s.claude.bedrock,
    vertex: s.claude.vertex,
    foundry: s.claude.foundry,
    clientApp: `legible/${app.getVersion()}`,
    scratchDir,
    bundledExecutable: bundledClaude(),
  }
}

function configureAgents(s: Settings) {
  agentHost.configure({
    claude: claudeConfig(s),
    tiers: { ...DEFAULT_TIERS, ...s.tiers },
    concurrency: s.agents.concurrency,
    fake: process.env.LEGIBLE_FAKE_AGENT === "1",
  })
}

function spawnAgentHost(): Transport {
  const child = utilityProcess.fork(join(here, "agentHost.js"), [], {
    serviceName: "Legible Agent Host",
    stdio: "inherit",
  })
  return {
    // A utility process port, not window.postMessage: there's no origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    post: (m) => child.postMessage(m),
    onMessage: (cb) => child.on("message", (m: FromHost) => cb(m)),
    onExit: (cb) => child.on("exit", cb),
    kill: () => child.kill(),
  }
}

type Handlers = { [C in Channel]: (req: Req<C>) => Promise<Responses[C]> }

const handlers: Handlers = {
  "app.info": async () => {
    const g = await gitVersion().catch(() => ({
      version: "not found",
      ok: false,
    }))
    return {
      version: app.getVersion(),
      platform: process.platform,
      gitVersion: g.version,
      gitOk: g.ok,
      dataDir: app.getPath("userData"),
    }
  },
  "settings.get": () => getSettings(),
  "settings.save": async ({ settings }) => {
    const saved = await store.saveSettings(settings)
    settingsCache = saved
    configureAgents(saved)
    return saved
  },
  "secrets.status": async () => {
    const out: Record<string, boolean> = {}
    for (const n of secrets.names()) out[n] = true
    return out
  },
  "secrets.set": async ({ name, value }) => {
    await secrets.set(name, value)
    configureAgents(await getSettings())
    return { ok: true }
  },
  "runtime.status": () => agentHost.status(),
  "models.list": async () => MODEL_CATALOG,
  "repo.pick": async () => {
    const opts = {
      properties: ["openDirectory" as const],
      title: "Open a repository",
    }
    const r = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts)
    const path = r.canceled ? null : (r.filePaths[0] ?? null)
    if (path) approvedRoots.add(resolve(path))
    return { path }
  },
  "repo.inspect": async ({ path }) => {
    await assertApproved(path)
    return reviews.inspect(path)
  },
  "review.open": async ({ source }) => {
    if (source.kind !== "pull_request") await assertApproved(source.repoPath)
    const r = await reviews.open(source)
    reviews.watch(r.id)
    return r
  },
  "review.list": () => store.listReviews(),
  "review.get": ({ reviewId }) => reviews.summary(reviewId),
  "review.delete": async ({ reviewId }) => {
    await store.deleteReview(reviewId)
    return { ok: true }
  },
  "review.refresh": ({ reviewId }) => reviews.refresh(reviewId),
  "review.checkForChanges": ({ reviewId }) => reviews.checkForChanges(reviewId),
  "review.iterations": ({ reviewId }) => store.listIterations(reviewId),
  "changeSet.get": async ({ reviewId, iterationId, ignoreWhitespace }) => {
    reviews.watch(reviewId)
    await store.touchReview(reviewId)
    return reviews.changeSet(reviewId, iterationId, ignoreWhitespace)
  },
  "fileDiff.get": ({ reviewId, iterationId, fileId, ignoreWhitespace }) =>
    reviews.fileDiff(reviewId, iterationId, fileId, ignoreWhitespace),
  "viewed.list": ({ reviewId }) => store.viewedFiles(reviewId),
  "viewed.set": async ({ reviewId, fileIds, viewed }) => {
    await store.setViewed(reviewId, fileIds, viewed)
    return { ok: true }
  },
  "reviewState.get": ({ reviewId }) =>
    store.getReviewState<Record<string, unknown>>(reviewId),
  "reviewState.set": async ({ reviewId, state }) => {
    await store.setReviewState(reviewId, state)
    return { ok: true }
  },
  "explain.request": ({ reviewId, iterationId, target, force }) =>
    explanations.request(reviewId, iterationId, target, force),
  "explain.cancel": async ({ jobId }) => {
    explanations.cancel(jobId)
    return { ok: true }
  },
  "explain.jobs": async ({ reviewId }) => explanations.list(reviewId),
  "explain.history": ({ reviewId }) => store.listExplanations(reviewId),
  "spend.summary": async ({ reviewId }) => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return store.spend(reviewId, start)
  },
  "editor.open": async ({ reviewId, path, line }) => {
    const review = await reviews.summary(reviewId)
    const file = reviews.workTreePath(review, path)
    if (!file || !review.repo.workTree)
      return {
        ok: false,
        error: "This Review has no local working tree to open.",
      }
    const rel = relative(review.repo.workTree, file)
    if (rel.startsWith("..") || resolve(file) !== file)
      return { ok: false, error: "That file is outside the repository." }
    return openInEditor((await getSettings()).editor, file, line)
  },
  "hosts.list": () => hosts.list(),
  "hosts.connect": async ({ hostname, kind, source, token }) => {
    const host = hostname.toLowerCase()
    if (source === "token") {
      if (!token) throw new UserError("Paste a token first.")
      await secrets.set(hostTokenSecret(host), token)
    }
    const s = await getSettings()
    const next = {
      ...s,
      hosts: [
        ...s.hosts.filter((h) => h.hostname !== host),
        { hostname: host, kind, source },
      ],
    }
    settingsCache = await store.saveSettings(next)
    return hosts.describe(host, kind, source)
  },
  "hosts.disconnect": async ({ hostname }) => {
    const s = await getSettings()
    settingsCache = await store.saveSettings({
      ...s,
      hosts: s.hosts.filter((h) => h.hostname !== hostname),
    })
    await secrets.set(hostTokenSecret(hostname), null)
    return { ok: true }
  },
  "link.open": async ({ url }) => {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false }
    const box = {
      type: "question" as const,
      buttons: ["Open", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: "Open this link in your browser?",
      detail: url,
    }
    const r = mainWindow
      ? await dialog.showMessageBox(mainWindow, box)
      : await dialog.showMessageBox(box)
    if (r.response !== 0) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  },
}

function registerIpc() {
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      // Only our own window may call in.
      if (!mainWindow || event.sender !== mainWindow.webContents)
        return { ok: false, error: { message: "Forbidden", code: "forbidden" } }
      const parsed = requests[channel].safeParse(payload ?? {})
      if (!parsed.success)
        return {
          ok: false,
          error: {
            message: `Invalid request for ${channel}: ${parsed.error.message}`,
            code: "invalid",
          },
        }
      try {
        const value = await (
          handlers[channel] as (r: unknown) => Promise<unknown>
        )(parsed.data)
        return { ok: true, value }
      } catch (e) {
        const err = e as Error & { code?: string }
        if (!(e instanceof UserError)) console.error(`[ipc] ${channel}:`, e)
        return {
          ok: false,
          error: { message: err.message, code: err.code ?? null },
        }
      }
    })
  }
}

/** Paths and PR URLs passed on the command line (`legible .`, `legible <url>`). */
function sourcesFromArgv(argv: string[]): string[] {
  const out: string[] = []
  const args = argv.slice(app.isPackaged ? 1 : 2)
  for (const a of args) {
    if (a.startsWith("-")) continue
    if (parsePullRequestUrl(a)) {
      out.push(a)
      continue
    }
    try {
      if (statSync(a).isDirectory() && resolve(a) !== resolve(app.getAppPath()))
        out.push(resolve(a))
    } catch {
      // not a path
    }
  }
  return out
}

async function openFromCli(arg: string) {
  try {
    if (!parsePullRequestUrl(arg)) approvedRoots.add(resolve(arg))
    const source = parsePullRequestUrl(arg)
      ? { kind: "pull_request" as const, url: arg }
      : { kind: "working_tree" as const, repoPath: arg, baseRef: null }
    const r = await reviews.open(source)
    reviews.watch(r.id)
    send("app.openReview", { reviewId: r.id })
  } catch (e) {
    send("app.error", { message: (e as Error).message })
  }
}

function buildMenu() {
  const cmd = (command: string) => () => send("app.command", { command })
  const isMac = process.platform === "darwin"
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: cmd("settings"),
              },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Review…",
          accelerator: "CmdOrCtrl+O",
          click: cmd("home"),
        },
        {
          label: "Refresh Snapshot",
          accelerator: "CmdOrCtrl+R",
          click: cmd("refresh"),
        },
        ...(isMac
          ? []
          : [
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: cmd("settings"),
              },
              { role: "quit" as const },
            ]),
        ...(isMac
          ? [{ type: "separator" as const }, { role: "close" as const }]
          : []),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Command Palette",
          accelerator: "CmdOrCtrl+K",
          click: cmd("palette"),
        },
        { label: "Keyboard Shortcuts", click: cmd("shortcuts") },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged
          ? []
          : [{ role: "toggleDevTools" as const }, { role: "reload" as const }]),
      ],
    },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const isMac = process.platform === "darwin"
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Legible",
    backgroundColor: "#0a0a0a",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 14, y: 15 },
        }
      : {}),
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.on("closed", () => {
    mainWindow = null
  })
  // No navigation away from the app, no new windows; links go through link.open.
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadURL("app://legible/index.html")
  }
  mainWindow.webContents.on("did-finish-load", () => {
    for (const p of pendingOpen.splice(0)) void openFromCli(p)
  })
}

/** Best-effort: a failed update check never affects the running app. */
async function checkForUpdates() {
  if (!app.isPackaged || process.env.LEGIBLE_NO_UPDATE) return
  try {
    const { autoUpdater } = await import("electron-updater")
    await autoUpdater.checkForUpdatesAndNotify()
  } catch {
    // Try again next launch.
  }
}

function serveRenderer() {
  const root = join(here, "../renderer")
  protocol.handle("app", async (request) => {
    const url = new URL(request.url)
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (!path.startsWith(root + sep))
      return new Response("Not found", { status: 404 })
    const res = await net.fetch(pathToFileURL(path).toString())
    const headers = new Headers(res.headers)
    headers.set("Content-Security-Policy", CSP)
    headers.set("X-Content-Type-Options", "nosniff")
    return new Response(res.body, { status: res.status, headers })
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A source from the command line or the Dock opens once startup is done and a
  // loaded window can show it; until then it waits in pendingOpen.
  let started = false
  const openWhenReady = (source: string) => {
    if (started && mainWindow && !mainWindow.webContents.isLoading()) {
      void openFromCli(source)
      return
    }
    pendingOpen.push(source)
    // macOS keeps running with no window; did-finish-load drains the queue.
    if (started && !mainWindow) createWindow()
  }

  // macOS: a folder dropped on the Dock icon, or `open -a Legible <dir>`.
  app.on("open-file", (e, path) => {
    e.preventDefault()
    openWhenReady(path)
  })

  app.on("second-instance", (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    for (const s of sourcesFromArgv(argv)) openWhenReady(s)
  })

  app
    .whenReady()
    .then(async () => {
      await loadShellEnv().catch(() => undefined)
      const dataDir = app.getPath("userData")
      mkdirSync(dataDir, { recursive: true })
      store = new Store(join(dataDir, "legible.db"))
      secrets = new SecretStore(join(dataDir, "secrets.json"))
      hosts = new HostService(secrets, getSettings)
      reviews = new ReviewService(
        store,
        hosts,
        join(dataDir, "repos"),
        (reviewId, detail) =>
          send("review.changesAvailable", { reviewId, detail }),
      )
      agentHost = new AgentHostClient(
        process.env.LEGIBLE_IN_PROCESS_AGENTS === "1"
          ? inProcessTransport
          : spawnAgentHost,
      )
      configureAgents(await getSettings().catch(() => DEFAULT_SETTINGS))
      explanations = new ExplanationService(
        store,
        reviews,
        agentHost,
        getSettings,
        (job: ExplanationJob) => send("job.updated", job),
      )

      registerIpc()
      serveRenderer()
      buildMenu()
      pendingOpen.push(...sourcesFromArgv(process.argv))
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
      createWindow()
      started = true
    })
    .then(checkForUpdates, (err: unknown) => {
      // A failed start (e.g. the database can't open) would otherwise leave no window and no message.
      dialog.showErrorBox(
        "Legible couldn't start",
        err instanceof Error ? err.message : String(err),
      )
      app.exit(1)
    })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("will-quit", () => {
    agentHost?.dispose()
    reviews?.dispose()
    void store?.close()
  })
}
