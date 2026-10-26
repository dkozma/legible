import type { ErrorEvent } from "@sentry/electron/main"
import { describe, expect, it } from "vitest"

import { createReportGate } from "../src/main/reportGate"
import { keepBreadcrumb, scrubEvent, scrubString } from "../src/main/scrub"

const home = "/Users/dkozma"

describe("scrubbing error reports", () => {
  it("replaces the home directory and redacts tokens and credentials", () => {
    const s = scrubString(
      [
        `git failed in ${home}/Projects/secret-repo`,
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
        "glpat-abcdefghijklmnopqrst",
        "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
        "https://user:hunter2@gitlab.example.com/acme/app.git",
        "PRIVATE-TOKEN: abc123def456",
      ].join("\n"),
      home,
    )
    expect(s).toContain("~/Projects/secret-repo")
    expect(s).not.toContain(home)
    for (const leaked of [
      "ghp_abc",
      "github_pat_11",
      "glpat-abc",
      "sk-ant-api03",
      "eyJhbGciOiJIUzI1NiJ9",
      "hunter2",
      "abc123def456",
    ])
      expect(s).not.toContain(leaked)
  })

  it("drops identity and request data, and keeps only Legible's and Electron's breadcrumbs", () => {
    const event = {
      type: undefined,
      message: `Failed in ${home}/x`,
      user: { ip_address: "1.2.3.4" },
      server_name: "daves-macbook",
      request: { url: "https://api.github.com/repos/acme/secret/pulls/1" },
      breadcrumbs: [
        { category: "console", message: "const secret = 1" },
        {
          category: "http",
          data: { url: "https://api.github.com/repos/acme/secret" },
        },
        { category: "ui.click", message: "div.diff-line" },
        { category: "electron", message: "app.ready" },
        { category: "legible", message: `opened ${home}/repo` },
      ],
      exception: {
        values: [
          {
            type: "Error",
            value: `ENOENT ${home}/repo/a.ts`,
            stacktrace: {
              frames: [{ filename: `${home}/app/out/main/index.js` }],
            },
          },
        ],
      },
    } as unknown as ErrorEvent
    const out = scrubEvent(event, home)
    expect(out.user).toBeUndefined()
    expect(out.server_name).toBeUndefined()
    expect(out.request).toBeUndefined()
    expect(out.breadcrumbs?.map((b) => b.category)).toEqual([
      "electron",
      "legible",
    ])
    expect(JSON.stringify(out)).not.toContain(home)
    expect(out.exception?.values?.[0]?.value).toBe("ENOENT ~/repo/a.ts")
  })

  it("keeps breadcrumbs by category only", () => {
    expect(keepBreadcrumb({ category: "legible" })).toBe(true)
    expect(keepBreadcrumb({ category: "console" })).toBe(false)
    expect(keepBreadcrumb({})).toBe(false)
  })
})

describe("the report gate", () => {
  function setup(max = 30) {
    const sent: string[] = []
    const gate = createReportGate<string, { ok?: boolean }>({}, max)
    const transport = gate.wrap(() => ({
      send: async (e: string) => {
        sent.push(e)
        return { ok: true }
      },
      flush: async () => true,
    }))(undefined)
    return { gate, transport, sent }
  }

  it("holds reports until the choice is known, then sends them", async () => {
    const { gate, transport, sent } = setup()
    const pending = transport.send("startup crash")
    await Promise.resolve()
    expect(sent).toEqual([])
    gate.set(true)
    expect(await pending).toEqual({ ok: true })
    await transport.send("later")
    expect(sent).toEqual(["startup crash", "later"])
  })

  it("drops everything when reports are off", async () => {
    const { gate, transport, sent } = setup()
    const pending = transport.send("held")
    gate.set(false)
    expect(await pending).toEqual({})
    await transport.send("after")
    expect(sent).toEqual([])
  })

  it("holds at most a bounded number of reports", async () => {
    const { gate, transport, sent } = setup(2)
    const held = ["a", "b", "c"].map((e) => transport.send(e))
    gate.set(true)
    await Promise.all(held)
    expect(sent).toEqual(["a", "b"])
  })
})
