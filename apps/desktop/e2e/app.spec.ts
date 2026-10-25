// End-to-end: the real Electron app on the fixture repository, with the fake
// agent runtime so no model is called.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ElectronApplication, _electron as electron, expect, type Page, test } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.LEGIBLE_SCREENSHOTS;
let app: ElectronApplication;
let page: Page;
let repoDir: string;
let dataDir: string;

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

test.beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'legible-e2e-repo-'));
  dataDir = mkdtempSync(join(tmpdir(), 'legible-e2e-data-'));
  execFileSync('node', [resolve(here, '../../../fixtures/make-refund-repo.mjs'), repoDir]);
  app = await electron.launch({
    args: [resolve(here, '../out/main/index.js'), repoDir],
    env: { ...process.env, LEGIBLE_USER_DATA: dataDir, LEGIBLE_FAKE_AGENT: '1', LEGIBLE_NO_UPDATE: '1' },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

test('opens the working tree passed on the command line as a Review', async () => {
  await expect(page.getByRole('navigation', { name: 'Location' })).toContainText('feature/partial-refunds', { timeout: 30_000 });
  const tree = page.getByTestId('tree-file');
  await expect(tree.filter({ hasText: 'RefundService.ts' })).toHaveCount(1);
  // Untracked file from the Snapshot, rename, and lockfile.
  await expect(tree.filter({ hasText: 'RefundService.test.ts' })).toHaveCount(1);
  await expect(tree.filter({ hasText: 'refund-math.ts' })).toHaveCount(1);
  await expect(tree.filter({ hasText: 'pnpm-lock.yaml' })).toContainText('lockfile');
  // Formatting-only file is proven Structural.
  await expect(tree.filter({ hasText: 'limits.ts' })).toContainText('structural');
  await expect(page.getByTestId('diff')).toContainText('REFUND_WINDOW_DAYS');
  await shot('01-review');
});

test('explains the current hunk with e', async () => {
  await page.getByTestId('diff').click({ position: { x: 600, y: 200 } });
  await page.keyboard.press('j');
  await page.keyboard.press('e');
  await expect(page.getByTestId('explanation')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('explanation')).toContainText('Before');
  await expect(page.getByTestId('explanation')).toContainText('Watch out');
  await shot('02-explanation');
  // Same target again comes from the cache.
  await page.keyboard.press('e');
  await expect(page.getByTestId('explanation')).toContainText('cached', { timeout: 10_000 });
});

test('selects lines by dragging line numbers and explains them', async () => {
  // Head line numbers (the second number column) of added lines.
  const head = (i: number) => page.locator('[data-kind="add"]').nth(i).getByTestId('head-line-number');
  await head(0).click();
  await head(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-selected]')).toHaveCount(3);
  await page.keyboard.press('e');
  await expect(page.getByTestId('explanation')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-selected]')).toHaveCount(0);
});

test('switches to split view and marks files viewed', async () => {
  await page.keyboard.press('Alt+s');
  await expect(page.getByTestId('split-row').first()).toBeVisible();
  await shot('03-split');
  await page.keyboard.press('Alt+s');
  await expect(page.getByTestId('split-row')).toHaveCount(0);

  const before = await page.locator('[data-testid="viewed-toggle"][aria-pressed="true"]').count();
  await page.getByTestId('viewed-toggle').first().click();
  await expect(page.locator('[data-testid="viewed-toggle"][aria-pressed="true"]')).toHaveCount(before + 1);
  await expect(page.getByText(/1 of \d+ files viewed/)).toBeVisible();
});

test('opens a file from the command palette', async () => {
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.type('policy');
  await shot('04-palette');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  await expect(page.getByTestId('file-head').filter({ hasText: 'RefundPolicy.ts' })).toBeInViewport();
});

test('offers a refresh when the working tree changes, never applying it silently', async () => {
  const apiFile = page.getByTestId('tree-file').filter({ hasText: /^.?refunds\.ts/ });
  await expect(apiFile).toContainText('+6');
  appendFileSync(join(repoDir, 'src/api/refunds.ts'), '\nexport const REFUNDS_API_VERSION = 2;\n');
  await expect(page.getByRole('status').filter({ hasText: 'New changes since this Snapshot' })).toBeVisible({ timeout: 20_000 });
  // Nothing moves until the user asks.
  await expect(apiFile).toContainText('+6');
  await shot('05-banner');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(apiFile).toContainText('+8', { timeout: 15_000 });
  await expect(page.getByLabel('Iteration')).toBeVisible();
});

test('shows settings and the keyboard overlay', async () => {
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
  await shot('06-settings');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Location' })).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('lists the Review on the home screen', async () => {
  await page.getByRole('button', { name: 'Reviews' }).click();
  await expect(page.getByText('Open a Review')).toBeVisible();
  const row = page.getByRole('button', { name: /^feature\/partial-refunds/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Iteration 2');
  await shot('07-home');
});
