// End-to-end: error reports (ADR 0013) against a stand-in Sentry server.
// The fake agent fails every Explanation the way a real run can.

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test"

const here = dirname(fileURLToPath(import.meta.url))
let app: ElectronApplication
let page: Page
let repoDir: string
let dataDir: string
let server: Server
/** Every envelope the app sent, as text. */
const received: string[] = []

/** Parsed event payloads from the envelopes received so far. */
function events(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const body of received) {
    const lines = body.split("\n")
    for (let i = 1; i + 1 < lines.length; i += 2) {
      try {
        const header = JSON.parse(lines[i] as string) as { type?: string }
        if (header.type === "event")
          out.push(
            JSON.parse(lines[i + 1] as string) as Record<string, unknown>,
          )
      } catch {
        // Attachments and other items aren't JSON lines.
      }
    }
  }
  return out
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      const raw = Buffer.concat(chunks)
      const body =
        req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw
      received.push(body.toString("utf8"))
      res.writeHead(200, { "content-type": "application/json" })
      res.end("{}")
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const port = (server.address() as { port: number }).port

  repoDir = mkdtempSync(join(tmpdir(), "legible-e2e-repo-"))
  dataDir = mkdtempSync(join(tmpdir(), "legible-e2e-data-"))
  execFileSync("node", [
    resolve(here, "../../../fixtures/make-refund-repo.mjs"),
    repoDir,
  ])
  app = await electron.launch({
    args: [resolve(here, "../out/main/index.js"), repoDir],
    env: {
      ...process.env,
      LEGIBLE_USER_DATA: dataDir,
      LEGIBLE_FAKE_AGENT: "fail",
      LEGIBLE_NO_UPDATE: "1",
      LEGIBLE_SENTRY_DSN: `http://publickey@127.0.0.1:${port}/1`,
    },
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByTestId("diff")).toContainText("REFUND_WINDOW_DAYS", {
    timeout: 30_000,
  })
})

test.afterAll(async () => {
  await app?.close()
  server?.close()
  rmSync(repoDir, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

test("reports a failed Explanation with what produced it, but no code", async () => {
  await page.getByTestId("diff").click({ position: { x: 600, y: 200 } })
  await page.keyboard.press("j")
  await page.keyboard.press("e")
  await expect(page.getByRole("alert")).toContainText("expected shape", {
    timeout: 15_000,
  })
  await expect
    .poll(
      () =>
        events().filter(
          (e) => (e.tags as Record<string, string>)?.task === "explanation",
        ).length,
      {
        timeout: 15_000,
      },
    )
    .toBe(1)
  const event = events().find(
    (e) => (e.tags as Record<string, string>)?.task === "explanation",
  ) as {
    tags: Record<string, string>
    extra: Record<string, unknown>
    fingerprint: string[]
  }
  expect(event.tags).toMatchObject({
    "agent.code": "structured_output",
    "agent.model": "claude-haiku-5-5",
    "file.language": "typescript",
    "target.kind": "range",
  })
  expect(event.extra.headLineCount).toEqual(expect.any(Number))
  expect(event.fingerprint[1]).toBe("structured_output")
})

test("reports renderer errors through the main process, scrubbed", async () => {
  await page.evaluate((home) => {
    setTimeout(() => {
      throw new Error(`renderer failure reading ${home}/secret-project/a.ts`)
    })
  }, homedir())
  await expect
    .poll(
      () =>
        events().some((e) =>
          JSON.stringify(e).includes(
            "renderer failure reading ~/secret-project",
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true)
})

test("never sends code, the repository path, the home directory or usage sessions", async () => {
  const all = received.join("\n")
  expect(all.length).toBeGreaterThan(0)
  expect(all).not.toContain("REFUND_WINDOW_DAYS")
  expect(all).not.toContain("amountCents")
  expect(all).not.toContain(repoDir)
  expect(all).not.toContain(homedir())
  expect(all).not.toContain('"type":"session"')
})

test("shows that reports are on for this run", async () => {
  await page.keyboard.press("ControlOrMeta+,")
  await page.getByRole("button", { name: "Privacy" }).click()
  await expect(page.locator("#privacy")).toContainText("On for this run")
})
