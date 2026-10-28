import { describe, expect, it } from "vitest"

import { Parsing } from "../src/parse"

const parsing = new Parsing()

async function outline(language: string, src: string) {
  const p = await parsing.parse({ oid: null, language, lines: src.split("\n") })
  return p.outline!
}

const defs = (o: Awaited<ReturnType<typeof outline>>) =>
  o.symbols.map(
    (s) => `${s.kind} ${s.qualifiedName} ${s.startLine + 1}-${s.endLine + 1}`,
  )
const uses = (o: Awaited<ReturnType<typeof outline>>, kind?: string) =>
  o.references
    .filter((r) => !kind || r.kind === kind)
    .map(
      (r) =>
        `${r.kind} ${r.receiver ? `${r.receiver}.` : ""}${r.name}@${r.line + 1}${r.owner >= 0 ? ` in ${o.symbols[r.owner]!.qualifiedName}` : ""}`,
    )

describe("outline", () => {
  it("TypeScript: Symbols, containers, calls, types and imports", async () => {
    const o = await outline(
      "typescript",
      `import { auditLog, type Order } from "./audit"
import * as gateway from "../gateway"

export const REFUND_WINDOW_DAYS = 60

/** Refunds orders. */
export class RefundService implements Refunder {
  refund(order: Order, cents?: number): Promise<void> {
    this.check(order)
    auditLog(order.id, REFUND_WINDOW_DAYS)
    return gateway.refund(order.id, cents ?? order.total)
  }

  private check(order: Order) {}
}

export type Cents = number
export const half = (n: Cents) => n / 2
`,
    )
    expect(defs(o)).toEqual([
      "constant REFUND_WINDOW_DAYS 4-4",
      "class RefundService 7-15",
      "method RefundService.refund 8-12",
      "method RefundService.check 14-14",
      "type Cents 17-17",
      "function half 18-18",
    ])
    expect(o.symbols[2]!.signature).toBe(
      "refund(order: Order, cents?: number): Promise<void>",
    )
    expect(o.symbols[2]!.params).toBe(2)
    expect(uses(o, "calls")).toEqual([
      "calls this.check@9 in RefundService.refund",
      "calls auditLog@10 in RefundService.refund",
      "calls gateway.refund@11 in RefundService.refund",
    ])
    expect(uses(o, "implements")).toEqual([
      "implements Refunder@7 in RefundService",
    ])
    expect(uses(o, "read")).toContain(
      "read REFUND_WINDOW_DAYS@10 in RefundService.refund",
    )
    expect(uses(o, "references")).toContain(
      "references Order@8 in RefundService.refund",
    )
    expect(o.imports).toEqual([
      {
        module: "./audit",
        names: [
          { imported: "auditLog", local: "auditLog" },
          { imported: "Order", local: "Order" },
        ],
        reexport: false,
        line: 0,
      },
      {
        module: "../gateway",
        names: [{ imported: "*", local: "gateway" }],
        reexport: false,
        line: 1,
      },
    ])
  })

  it("Python: methods inside classes, self calls, from-imports", async () => {
    const o = await outline(
      "python",
      `from .audit import audit_log as log
import payments.gateway

WINDOW = 60

class RefundService(Base):
    def refund(self, order):
        self.check(order)
        log(order.id)
        payments.gateway.refund(order)

    def check(self, order):
        pass
`,
    )
    expect(defs(o)).toEqual([
      "constant WINDOW 4-4",
      "class RefundService 6-13",
      "method RefundService.refund 7-10",
      "method RefundService.check 12-13",
    ])
    expect(uses(o, "calls")).toEqual([
      "calls self.check@8 in RefundService.refund",
      "calls log@9 in RefundService.refund",
      "calls payments.gateway.refund@10 in RefundService.refund",
    ])
    expect(uses(o, "implements")).toEqual([
      "implements Base@6 in RefundService",
    ])
    expect(o.imports.map((i) => [i.module, i.names])).toEqual([
      [".audit", [{ imported: "audit_log", local: "log" }]],
      ["payments.gateway", [{ imported: "*", local: "payments.gateway" }]],
    ])
  })

  it("Go: methods named by their receiver type", async () => {
    const o = await outline(
      "go",
      `package refunds

import (
	"fmt"
	audit "github.com/acme/app/internal/audit"
)

const Window = 60

type Service struct{}

func (s *Service) Refund(id string) error {
	audit.Log(id)
	return fmt.Errorf("x %d", Window)
}
`,
    )
    expect(defs(o)).toEqual([
      "constant Window 8-8",
      "type Service 10-10",
      "method Service.Refund 12-15",
    ])
    expect(uses(o, "calls")).toEqual([
      "calls audit.Log@13 in Service.Refund",
      "calls fmt.Errorf@14 in Service.Refund",
    ])
    expect(o.imports.map((i) => [i.module, i.names[0]!.local])).toEqual([
      ["fmt", "fmt"],
      ["github.com/acme/app/internal/audit", "audit"],
    ])
  })

  it("Rust: impl methods, use paths", async () => {
    const o = await outline(
      "rust",
      `use crate::audit::{log, Entry as AuditEntry};

const WINDOW: u32 = 60;

pub struct Service;

impl Service {
    pub fn refund(&self, id: &str) {
        log(id);
        self.check();
    }
}
`,
    )
    expect(defs(o)).toEqual([
      "constant WINDOW 3-3",
      "class Service 5-5",
      "method Service.refund 8-11",
    ])
    expect(uses(o, "calls")).toEqual([
      "calls log@9 in Service.refund",
      "calls self.check@10 in Service.refund",
    ])
    expect(o.imports.map((i) => [i.module, i.names])).toEqual([
      ["crate::audit", [{ imported: "log", local: "log" }]],
      ["crate::audit", [{ imported: "Entry", local: "AuditEntry" }]],
    ])
  })

  it("Java: classes, methods, imports", async () => {
    const o = await outline(
      "java",
      `package com.acme.refunds;

import com.acme.audit.AuditLog;

public class RefundService extends Base {
  static final int WINDOW = 60;

  public void refund(Order order) {
    AuditLog.write(order);
    check(order);
  }

  void check(Order order) {}
}
`,
    )
    expect(defs(o)).toEqual([
      "class RefundService 5-14",
      "field RefundService.WINDOW 6-6",
      "method RefundService.refund 8-11",
      "method RefundService.check 13-13",
    ])
    expect(uses(o, "calls")).toEqual([
      "calls AuditLog.write@9 in RefundService.refund",
      "calls check@10 in RefundService.refund",
    ])
    expect(o.imports.map((i) => [i.module, i.names])).toEqual([
      ["com.acme.audit", [{ imported: "AuditLog", local: "AuditLog" }]],
    ])
  })

  it("TypeScript: class fields, interface and object type properties, namespaces", async () => {
    const o = await outline(
      "typescript",
      `export class Hono {
  get!: Handler
  #routes = []
  request = (path: string) => this.get(path)
}

interface Props {
  onRetry?: () => void
  label: string
}

type Options = { root: string }

export function load(opts: { inline: boolean }) {}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      h1: Props
    }
  }
}
`,
    )
    expect(defs(o)).toEqual([
      "class Hono 1-5",
      "field Hono.get 2-2",
      "field Hono.#routes 3-3",
      "method Hono.request 4-4",
      "interface Props 7-10",
      "field Props.onRetry 8-8",
      "field Props.label 9-9",
      "type Options 12-12",
      "field Options.root 12-12",
      "function load 14-14",
      "module JSX 17-21",
      "interface JSX.IntrinsicElements 18-20",
      "field JSX.IntrinsicElements.h1 19-19",
    ])
    expect(uses(o, "calls")).toEqual(["calls this.get@4 in Hono.request"])
  })

  it("Structural tier: definitions without references", async () => {
    const o = await outline(
      "yaml",
      "name: ci\non:\n  push: {}\njobs:\n  check: {}\n",
    )
    expect(defs(o)).toEqual([
      "field name 1-1",
      "field on 2-3",
      "field jobs 4-5",
    ])
    expect(o.references).toEqual([])
  })
})
