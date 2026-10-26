// End-to-end: the real Electron app on the fixture repository, with the fake
// agent runtime so no model is called.

import { execFileSync } from "node:child_process"
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test"

const here = dirname(fileURLToPath(import.meta.url))
const shots = process.env.LEGIBLE_SCREENSHOTS
let app: ElectronApplication
let page: Page
let repoDir: string
let dataDir: string

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

test.beforeAll(async () => {
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
      LEGIBLE_FAKE_AGENT: "1",
      LEGIBLE_NO_UPDATE: "1",
    },
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
})

test.afterAll(async () => {
  await app?.close()
  rmSync(repoDir, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

test("opens the working tree passed on the command line as a Review", async () => {
  await expect(
    page.getByRole("navigation", { name: "Location" }),
  ).toContainText("feature/partial-refunds", { timeout: 30_000 })
  const tree = page.getByTestId("tree-file")
  await expect(tree.filter({ hasText: "RefundService.ts" })).toHaveCount(1)
  // Untracked file from the Snapshot, rename, and lockfile.
  await expect(tree.filter({ hasText: "RefundService.test.ts" })).toHaveCount(1)
  await expect(tree.filter({ hasText: "refund-math.ts" })).toHaveCount(1)
  await expect(tree.filter({ hasText: "pnpm-lock.yaml" })).toContainText(
    "lockfile",
  )
  // Formatting-only file is proven Structural.
  await expect(tree.filter({ hasText: "limits.ts" })).toContainText(
    "structural",
  )
  await expect(page.getByTestId("diff")).toContainText("REFUND_WINDOW_DAYS")
  await shot("01-review")
})

test("explains the current hunk with e", async () => {
  await page.getByTestId("diff").click({ position: { x: 600, y: 200 } })
  await page.keyboard.press("j")
  await page.keyboard.press("e")
  await expect(page.getByTestId("explanation")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("explanation")).toContainText("Before")
  await expect(page.getByTestId("explanation")).toContainText("Watch out")
  await shot("02-explanation")
  // Same target again comes from the cache.
  await page.keyboard.press("e")
  await expect(page.getByTestId("explanation")).toContainText("cached", {
    timeout: 10_000,
  })
})

test("links code in Explanations to its Symbol, and the mouse's back button returns", async () => {
  const explanation = page.getByTestId("explanation")
  const link = explanation
    .getByTestId("code-link")
    .filter({ hasText: "calculateRefundable()" })
  await expect(link).toBeVisible({ timeout: 15_000 })
  const diff = page.getByTestId("diff")
  const before = await diff.evaluate((el) => el.scrollTop)

  await link.hover()
  await expect(page.getByRole("tooltip")).toContainText(
    "RefundService.calculateRefundable",
  )
  await shot("02b-code-link")
  await link.click()
  const definition = page
    .locator("[data-code]")
    .filter({ hasText: "async calculateRefundable(orderId: string)" })
  await expect(definition).toBeInViewport()
  // The code is in the diff, so the Explanation stays open beside it.
  await expect(page.getByRole("tab", { name: "Explain" })).toHaveAttribute(
    "aria-selected",
    "true",
  )

  // Playwright can't press side buttons; send what Chromium sends for them.
  const side = (button: number) =>
    page.evaluate((b) => {
      window.dispatchEvent(new MouseEvent("mousedown", { button: b }))
      window.dispatchEvent(new MouseEvent("mouseup", { button: b }))
    }, button)
  await side(3)
  await expect
    .poll(() => diff.evaluate((el) => el.scrollTop))
    .toBeCloseTo(before, -1)
  await side(4)
  await expect(definition).toBeInViewport()
  // Leave the view where this test found it, for the tests that follow.
  await side(3)
  await expect
    .poll(() => diff.evaluate((el) => el.scrollTop))
    .toBeCloseTo(before, -1)
})

test("selects lines by dragging line numbers and explains them", async () => {
  // Head line numbers (the second number column) of added lines.
  const head = (i: number) =>
    page.locator('[data-kind="add"]').nth(i).getByTestId("head-line-number")
  await head(0).click()
  await head(2).click({ modifiers: ["Shift"] })
  await expect(page.locator("[data-selected]")).toHaveCount(3)
  await page.keyboard.press("e")
  await expect(page.getByTestId("explanation")).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-selected]")).toHaveCount(0)
})

test("switches to split view and marks files viewed", async () => {
  await page.keyboard.press("Alt+s")
  await expect(page.getByTestId("split-row").first()).toBeVisible()
  await shot("03-split")
  await page.keyboard.press("Alt+s")
  await expect(page.getByTestId("split-row")).toHaveCount(0)

  const before = await page
    .locator('[data-testid="viewed-toggle"][aria-pressed="true"]')
    .count()
  await page.getByTestId("viewed-toggle").first().click()
  await expect(
    page.locator('[data-testid="viewed-toggle"][aria-pressed="true"]'),
  ).toHaveCount(before + 1)
  await expect(page.getByText(/1 of \d+ files viewed/)).toBeVisible()
})

test("opens a file from the command palette", async () => {
  // ⌘ on macOS, Ctrl elsewhere, like the app.
  await page.keyboard.press("ControlOrMeta+k")
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible()
  await page.keyboard.type("policy")
  await shot("04-palette")
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toHaveCount(0)
  await expect(
    page.getByTestId("file-head").filter({ hasText: "RefundPolicy.ts" }),
  ).toBeInViewport()
})

/** Clicks the middle of `word` inside a line of code, with optional modifiers. */
async function clickWord(
  line: ReturnType<Page["locator"]>,
  word: string,
  modifiers: ("ControlOrMeta" | "Shift")[] = [],
) {
  const box = await line.evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const n = walker.currentNode as Text
      const i = n.data.indexOf(w)
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + w.length)
      const b = r.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    return null
  }, word)
  if (!box) throw new Error(`"${word}" isn't on that line`)
  await page.mouse.move(box.x, box.y)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.down()
  await page.mouse.up()
  for (const m of modifiers.toReversed()) await page.keyboard.up(m)
}

test("follows Connections: ⌘-click to a definition, Connection changes, Trail back", async () => {
  const panel = page.getByTestId("connections-panel")
  await page.getByRole("tab", { name: "Connections" }).click()
  await page.keyboard.press("ControlOrMeta+k")
  await page.keyboard.type("RefundService.ts")
  await page.keyboard.press("Enter")

  // A plain click on a line inside refundOrder shows its Connections.
  const call = page
    .locator("[data-code]")
    .filter({ hasText: "await this.calculateRefundable(orderId)" })
    .first()
  // Vertically only: scrolling the line sideways would put its start under the sticky gutter.
  await call.evaluate((el) => {
    el.closest("[data-row]")?.scrollIntoView({ block: "center" })
    const diff = el.closest<HTMLElement>('[data-testid="diff"]')
    if (diff) diff.scrollLeft = 0
  })
  await clickWord(call, "balance")
  const changes = panel.getByTestId("connection-change")
  await expect(panel.getByRole("heading")).toContainText("refundOrder", {
    timeout: 15_000,
  })
  await expect(
    changes
      .filter({ hasText: "No longer calls" })
      .filter({ hasText: "auditLog" }),
  ).toHaveCount(1)
  await expect(
    changes
      .filter({ hasText: "Now calls" })
      .filter({ hasText: "calculateRefundable" }),
  ).toHaveCount(1)
  await shot("08-connections")

  // ⌘-click the call: goes to the definition and joins the Trail.
  const t0 = Date.now()
  await clickWord(call, "calculateRefundable", ["ControlOrMeta"])
  await expect(panel.getByRole("heading")).toContainText("calculateRefundable")
  expect(Date.now() - t0).toBeLessThan(2000)
  await expect(
    page
      .locator("[data-code]")
      .filter({ hasText: "async calculateRefundable(orderId: string)" }),
  ).toBeInViewport()
  await expect(panel.getByRole("navigation", { name: "Trail" })).toContainText(
    "refundOrder",
  )
  await shot("09-definition")

  await page.keyboard.press("ControlOrMeta+[")
  await expect(panel.getByRole("heading")).toContainText("refundOrder")

  // Explain the Symbol, then one of its Connections.
  await panel.getByRole("button", { name: "Explain method" }).click()
  const explanation = page.getByTestId("explanation")
  await expect(explanation).toBeVisible({ timeout: 15_000 })
  await expect(explanation).toContainText("RefundService.refundOrder · method")
  await page.getByRole("tab", { name: "Connections" }).click()
  await panel
    .getByTestId("connection")
    .filter({ hasText: "calculateRefundable" })
    .hover()
  await panel
    .getByRole("button", {
      name: /^Explain how refundOrder calls calculateRefundable/,
    })
    .click()
  await expect(explanation).toContainText(
    "RefundService.refundOrder calls RefundService.calculateRefundable",
    { timeout: 15_000 },
  )
  await shot("10-connection-explanation")
})

test("offers a refresh when the working tree changes, never applying it silently", async () => {
  const apiFile = page
    .getByTestId("tree-file")
    .filter({ hasText: /^.?refunds\.ts/ })
  await expect(apiFile).toContainText("+6")
  appendFileSync(
    join(repoDir, "src/api/refunds.ts"),
    "\nexport const REFUNDS_API_VERSION = 2;\n",
  )
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "New changes since this Snapshot" }),
  ).toBeVisible({ timeout: 20_000 })
  // Nothing moves until the user asks.
  await expect(apiFile).toContainText("+6")
  await shot("05-banner")
  await page.getByRole("button", { name: "Refresh" }).click()
  await expect(apiFile).toContainText("+8", { timeout: 15_000 })
  await expect(page.getByLabel("Iteration")).toBeVisible()
})

test("shows settings and the keyboard overlay", async () => {
  await page.keyboard.press("ControlOrMeta+,")
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible()
  await shot("06-settings")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible()
  await page.keyboard.press("?")
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible()
  await page.keyboard.press("Escape")
})

test("lists the Review on the home screen", async () => {
  await page.getByRole("button", { name: "Reviews" }).click()
  await expect(page.getByText("Open a Review")).toBeVisible()
  const row = page.getByRole("button", { name: /^feature\/partial-refunds/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText("Iteration 2")
  await shot("07-home")
})
