import { describe, expect, it } from "vitest"

import {
  apiBase,
  getPullRequest,
  HostError,
  parsePullRequestUrl,
} from "../src/index"

describe("parsePullRequestUrl", () => {
  it("parses GitHub and GitHub Enterprise URLs", () => {
    expect(
      parsePullRequestUrl("https://github.com/dkozma/legible/pull/12/files"),
    ).toEqual({
      host: "github",
      hostname: "github.com",
      project: "dkozma/legible",
      number: 12,
      url: "https://github.com/dkozma/legible/pull/12",
    })
    expect(
      parsePullRequestUrl("https://ghe.acme.internal/team/app/pull/7")
        ?.hostname,
    ).toBe("ghe.acme.internal")
  })

  it("parses GitLab URLs with nested groups", () => {
    expect(
      parsePullRequestUrl(
        "https://gitlab.com/group/sub/proj/-/merge_requests/42/diffs",
      ),
    ).toMatchObject({
      host: "gitlab",
      project: "group/sub/proj",
      number: 42,
    })
  })

  it("rejects other URLs", () => {
    expect(parsePullRequestUrl("https://github.com/dkozma/legible")).toBeNull()
    expect(parsePullRequestUrl("file:///etc/passwd")).toBeNull()
    expect(parsePullRequestUrl("not a url")).toBeNull()
  })

  it("computes API bases", () => {
    expect(apiBase({ host: "github", hostname: "github.com" })).toBe(
      "https://api.github.com",
    )
    expect(apiBase({ host: "github", hostname: "ghe.x" })).toBe(
      "https://ghe.x/api/v3",
    )
    expect(apiBase({ host: "gitlab", hostname: "gitlab.com" })).toBe(
      "https://gitlab.com/api/v4",
    )
  })
})

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

describe("getPullRequest", () => {
  it("maps a GitHub pull request", async () => {
    const ref = parsePullRequestUrl("https://github.com/o/r/pull/3")
    let seenAuth: string | null = null
    const fake = (async (url: string, init?: RequestInit) => {
      seenAuth =
        ((init?.headers ?? {}) as Record<string, string>).Authorization ?? null
      expect(url).toBe("https://api.github.com/repos/o/r/pulls/3")
      return respond(200, {
        title: "Partial refunds",
        body: "Allow partial refunds.",
        state: "open",
        user: { login: "agent" },
        base: {
          ref: "main",
          sha: "a".repeat(40),
          repo: { clone_url: "https://github.com/o/r.git" },
        },
        head: {
          ref: "feature",
          sha: "b".repeat(40),
          repo: { full_name: "o/r", permissions: { push: true } },
        },
      })
    }) as typeof fetch
    const pr = await getPullRequest(ref!, "tok", fake)
    expect(seenAuth).toBe("Bearer tok")
    expect(pr).toMatchObject({
      title: "Partial refunds",
      baseRef: "main",
      headRefspec: "+refs/pull/3/head:refs/legible/pr/3/head",
      canPush: true,
    })
  })

  it("asks for auth when an anonymous request is refused", async () => {
    const ref = parsePullRequestUrl("https://github.com/o/private/pull/1")
    const fake = (async () =>
      respond(404, { message: "Not Found" })) as typeof fetch
    await expect(getPullRequest(ref!, null, fake)).rejects.toMatchObject({
      needsAuth: true,
    })
    await expect(getPullRequest(ref!, null, fake)).rejects.toBeInstanceOf(
      HostError,
    )
  })

  it("maps a GitLab merge request", async () => {
    const ref = parsePullRequestUrl("https://gitlab.com/g/p/-/merge_requests/9")
    const fake = (async (url: string) => {
      if (url.endsWith("/merge_requests/9")) {
        return respond(200, {
          title: "MR",
          description: null,
          state: "opened",
          author: { username: "a" },
          target_branch: "main",
          source_branch: "f",
          sha: "c".repeat(40),
          diff_refs: {
            base_sha: "a".repeat(40),
            head_sha: "c".repeat(40),
            start_sha: "a".repeat(40),
          },
          source_project_id: 1,
          target_project_id: 1,
        })
      }
      return respond(200, {
        http_url_to_repo: "https://gitlab.com/g/p.git",
        permissions: { project_access: { access_level: 40 } },
      })
    }) as typeof fetch
    const mr = await getPullRequest(ref!, "tok", fake)
    expect(mr).toMatchObject({
      body: "",
      headSha: "c".repeat(40),
      headRefspec: "+refs/merge-requests/9/head:refs/legible/pr/9/head",
      canPush: true,
    })
  })
})
