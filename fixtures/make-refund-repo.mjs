#!/usr/bin/env node
// Generates the "refund window + partial refunds" fixture repository from the
// M0 design brief: an agent-written feature spanning migration → service →
// API → client store → UI, with one Unrequested audit-log change, a moved
// helper, a formatting-only file, a lockfile bump, and uncommitted edits.
//
// Usage: node fixtures/make-refund-repo.mjs [targetDir]
// Default target: fixtures/.generated/refunds

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? join(here, '.generated', 'refunds'));

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'author@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
let clock = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
const git = (...args) => {
  clock += 3600;
  return execFileSync('git', args, {
    cwd: target,
    env: { ...env, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
};
const write = (path, text) => {
  const p = join(target, path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text.replace(/^\n/, ''));
};
const rm = (path) => rmSync(join(target, path), { force: true });

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Fixture Author');
git('config', 'user.email', 'author@example.com');

// ---------------------------------------------------------------- Base (main)

write(
  'package.json',
  `
{
  "name": "storefront",
  "version": "1.4.0",
  "private": true,
  "dependencies": {
    "money-math": "^2.1.0"
  }
}
`,
);
write(
  'pnpm-lock.yaml',
  `
lockfileVersion: '9.0'
packages:
  money-math@2.1.0:
    resolution: {integrity: sha512-aaaa}
`,
);
write(
  'db/migrations/0007_refunds.sql',
  `
CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`,
);
write(
  'src/refunds/RefundPolicy.ts',
  `
import type { Order } from '../orders/Order';

export const REFUND_WINDOW_DAYS = 30;

export class RefundPolicy {
  assertWithinWindow(order: Order, now: Date = new Date()): void {
    const ageMs = now.getTime() - order.purchasedAt.getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays > REFUND_WINDOW_DAYS) {
      throw new RefundWindowClosed(order.id, REFUND_WINDOW_DAYS);
    }
  }
}

export class RefundWindowClosed extends Error {
  constructor(orderId: string, days: number) {
    super(\`Order \${orderId} is older than \${days} days\`);
  }
}
`,
);
write(
  'src/refunds/RefundService.ts',
  `
import { auditLog } from '../audit/auditLog';
import type { Gateway } from '../payments/Gateway';
import type { OrderRepository } from '../orders/OrderRepository';
import { RefundPolicy } from './RefundPolicy';
import { formatCents } from './refundUtils';

export interface Operator {
  id: string;
  name: string;
}

export class RefundService {
  constructor(
    private orders: OrderRepository,
    private gateway: Gateway,
    private policy = new RefundPolicy(),
  ) {}

  async refundOrder(orderId: string, operator: Operator) {
    const order = await this.orders.get(orderId);
    this.policy.assertWithinWindow(order);
    const refund = await this.gateway.refund(order.paymentId, order.totalCents);
    await auditLog('refund.issued', { orderId, operator: operator.id });
    return refund;
  }

  describe(orderId: string, cents: number): string {
    return \`Refund of \${formatCents(cents)} for \${orderId}\`;
  }
}
`,
);
write(
  'src/refunds/refundUtils.ts',
  `
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return \`$\${dollars}.\${rest}\`;
}

export function sumCents(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
`,
);
write(
  'src/api/refunds.ts',
  `
import type { Request, Response } from '../http';
import { service } from '../services';

export async function postRefund(req: Request, res: Response) {
  const { orderId } = req.body;
  const refund = await service.refunds.refundOrder(orderId, req.operator);
  res.status(201).json(refund);
}
`,
);
write(
  'src/client/refundStore.ts',
  `
export interface RefundState {
  pending: boolean;
  error: string | null;
}

export const initialRefundState: RefundState = { pending: false, error: null };

export async function submitRefund(orderId: string): Promise<void> {
  const res = await fetch('/api/refunds', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
  if (!res.ok) throw new Error('Refund failed');
}
`,
);
write(
  'src/ui/RefundDialog.tsx',
  `
import { submitRefund } from '../client/refundStore';

export function RefundDialog({ orderId, onClose }: { orderId: string; onClose(): void }) {
  return (
    <dialog open>
      <p>Refund the full order?</p>
      <button onClick={() => submitRefund(orderId).then(onClose)}>Refund</button>
    </dialog>
  );
}
`,
);
write(
  'src/config/limits.ts',
  `
export const limits = {
    maxRefundsPerDay: 50,
    maxRefundCents: 500000,
};
`,
);
write(
  'README.md',
  `
# Storefront

Order management and refunds.
`,
);
git('add', '-A');
git('commit', '-q', '-m', 'Storefront with full refunds');

// -------------------------------------------------- Feature branch (agent work)

git('checkout', '-q', '-b', 'feature/partial-refunds');

write(
  'package.json',
  `
{
  "name": "storefront",
  "version": "1.4.0",
  "private": true,
  "dependencies": {
    "money-math": "^2.2.0"
  }
}
`,
);
write(
  'pnpm-lock.yaml',
  `
lockfileVersion: '9.0'
packages:
  money-math@2.2.0:
    resolution: {integrity: sha512-bbbb}
`,
);
write(
  'db/migrations/0008_partial_refunds.sql',
  `
ALTER TABLE refunds ADD COLUMN includes_shipping INTEGER NOT NULL DEFAULT 0;
ALTER TABLE refunds ADD COLUMN sequence INTEGER NOT NULL DEFAULT 1;
CREATE INDEX refunds_order_id ON refunds(order_id);
`,
);
write(
  'src/refunds/RefundPolicy.ts',
  `
import type { Order } from '../orders/Order';

export const REFUND_WINDOW_DAYS = 60;

export class RefundPolicy {
  assertWithinWindow(order: Order, now: Date = new Date()): void {
    const ageMs = now.getTime() - order.purchasedAt.getTime();
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    if (ageDays >= REFUND_WINDOW_DAYS) {
      throw new RefundWindowClosed(order.id, REFUND_WINDOW_DAYS);
    }
  }
}

export class RefundWindowClosed extends Error {
  constructor(orderId: string, days: number) {
    super(\`Order \${orderId} is older than \${days} days\`);
  }
}
`,
);
write(
  'src/refunds/RefundService.ts',
  `
import type { EventBus } from '../events/EventBus';
import type { Gateway } from '../payments/Gateway';
import type { OrderRepository } from '../orders/OrderRepository';
import { formatCents, sumCents } from './refund-math';
import { RefundPolicy } from './RefundPolicy';
import type { RefundRepository } from './RefundRepository';

export interface Operator {
  id: string;
  name: string;
}

export interface RefundBalance {
  paidCents: number;
  refundedCents: number;
  remainingCents: number;
  count: number;
}

export class RefundExceedsBalance extends Error {
  constructor(requested: number, remaining: number) {
    super(\`Requested \${formatCents(requested)} but only \${formatCents(remaining)} remains\`);
  }
}

export class RefundService {
  constructor(
    private orders: OrderRepository,
    private refunds: RefundRepository,
    private gateway: Gateway,
    private events: EventBus,
    private policy = new RefundPolicy(),
  ) {}

  async calculateRefundable(orderId: string): Promise<RefundBalance> {
    const order = await this.orders.get(orderId);
    const issued = await this.refunds.listForOrder(orderId);
    const refundedCents = sumCents(issued.map((r) => Math.round(r.amountCents)));
    return {
      paidCents: order.totalCents,
      refundedCents,
      remainingCents: order.totalCents - refundedCents,
      count: issued.length,
    };
  }

  async refundOrder(orderId: string, operator: Operator, amountCents?: number) {
    const order = await this.orders.get(orderId);
    this.policy.assertWithinWindow(order);
    const balance = await this.calculateRefundable(orderId);
    const requested = amountCents ?? balance.remainingCents;
    if (requested > balance.remainingCents) {
      throw new RefundExceedsBalance(requested, balance.remainingCents);
    }
    const isFinal = requested === balance.remainingCents;
    const refund = await this.gateway.refund(order.paymentId, requested, {
      includeShipping: isFinal,
      idempotencyKey: \`\${orderId}:\${balance.count}\`,
    });
    await this.refunds.record(orderId, requested, isFinal, balance.count + 1);
    this.events.emit('refund.issued', { orderId, amount: requested });
    return refund;
  }

  describe(orderId: string, cents: number): string {
    return \`Refund of \${formatCents(cents)} for \${orderId}\`;
  }
}
`,
);
rm('src/refunds/refundUtils.ts');
write(
  'src/refunds/refund-math.ts',
  `
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return \`$\${dollars}.\${rest}\`;
}

export function sumCents(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
`,
);
write(
  'src/refunds/RefundRepository.ts',
  `
export interface RefundRecord {
  orderId: string;
  amountCents: number;
  includesShipping: boolean;
  sequence: number;
}

export interface RefundRepository {
  listForOrder(orderId: string): Promise<RefundRecord[]>;
  record(orderId: string, amountCents: number, includesShipping: boolean, sequence: number): Promise<void>;
}
`,
);
write(
  'src/audit/RefundAuditSubscriber.ts',
  `
import { auditLog } from './auditLog';
import type { EventBus } from '../events/EventBus';

/** Writes audit entries for refunds from the event stream. */
export function subscribeRefundAudit(events: EventBus) {
  events.on('refund.issued', async (e: { orderId: string; amount: number }) => {
    await auditLog('refund.issued', { orderId: e.orderId, amount: e.amount });
  });
}
`,
);
write(
  'src/api/refunds.ts',
  `
import type { Request, Response } from '../http';
import { service } from '../services';

export async function postRefund(req: Request, res: Response) {
  const { orderId, amountCents } = req.body;
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    res.status(400).json({ error: 'amountCents must be a positive integer' });
    return;
  }
  const refund = await service.refunds.refundOrder(orderId, req.operator, amountCents);
  res.status(201).json(refund);
}
`,
);
write(
  'src/client/refundStore.ts',
  `
export interface RefundState {
  pending: boolean;
  error: string | null;
  refundedCents: number;
}

export const initialRefundState: RefundState = { pending: false, error: null, refundedCents: 0 };

export async function submitRefund(orderId: string, amountCents?: number): Promise<void> {
  const res = await fetch('/api/refunds', {
    method: 'POST',
    body: JSON.stringify({ orderId, amountCents }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Refund failed');
  }
}
`,
);
write(
  'src/ui/RefundDialog.tsx',
  `
import { useState } from 'react';
import { submitRefund } from '../client/refundStore';

export function RefundDialog({ orderId, remainingCents, onClose }: { orderId: string; remainingCents: number; onClose(): void }) {
  const [amount, setAmount] = useState(remainingCents);
  const [error, setError] = useState<string | null>(null);
  return (
    <dialog open>
      <label>
        Amount
        <input type="number" min={1} max={remainingCents} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => submitRefund(orderId, amount).then(onClose, (e) => setError(e.message))}>Refund</button>
    </dialog>
  );
}
`,
);
write(
  'src/config/limits.ts',
  `
export const limits = {
  maxRefundsPerDay: 50,
  maxRefundCents: 500000,
};
`,
);
git('add', '-A');
git('commit', '-q', '-m', 'Partial refunds and a 60-day window');

// Uncommitted work the agent left in the working tree.
write(
  'src/refunds/RefundService.test.ts',
  `
import { describe, expect, it } from 'vitest';
import { RefundService } from './RefundService';

describe('refundOrder', () => {
  it('refunds part of the balance without shipping', async () => {
    const { service, gateway } = setup({ totalCents: 10000 });
    await service.refundOrder('o1', operator, 2000);
    expect(gateway.refund).toHaveBeenCalledWith('p1', 2000, { includeShipping: false, idempotencyKey: 'o1:0' });
  });

  it('rejects refunds above the remaining balance', async () => {
    const { service } = setup({ totalCents: 1000 });
    await expect(service.refundOrder('o1', operator, 2000)).rejects.toThrow('only $10.00 remains');
  });
});
`,
);
write(
  'README.md',
  `
# Storefront

Order management and refunds. Refunds are allowed within 60 days and can be partial.
`,
);

process.stdout.write(`${target}\n`);
