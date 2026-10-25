import type { ReviewSummary } from "@legible/domain"
import type { RepoInspection } from "@legible/ipc"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  FolderGit2,
  GitPullRequest,
  Loader2,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import { ClientError } from "../client"
import { relativeTime } from "../components/Inline"
import {
  Badge,
  Button,
  Callout,
  Card,
  Input,
  Radio,
  Select,
  Tab,
  Tabs,
  Titlebar,
} from "../components/ui"
import { useClient } from "../context"
import { useUI } from "../state"

export function Home() {
  const client = useClient()
  const go = useUI((s) => s.go)
  const reviews = useQuery({
    queryKey: ["reviews"],
    queryFn: () => client.call("review.list", {}),
    staleTime: 0,
  })
  const status = useQuery({
    queryKey: ["runtimeStatus"],
    queryFn: () => client.call("runtime.status", {}),
    staleTime: 60_000,
  })
  const info = useQuery({
    queryKey: ["appInfo"],
    queryFn: () => client.call("app.info", {}),
  })

  return (
    <>
      <Titlebar>
        <span className="grow text-sm font-semibold">Legible</span>
        <Button
          variant="muted"
          size="sm"
          onClick={() => go({ name: "settings", section: null })}
        >
          <SettingsIcon />
          Settings
        </Button>
      </Titlebar>
      <div className="flex-auto overflow-auto px-6 pt-9 pb-16">
        <div className="mx-auto flex max-w-[960px] flex-col gap-7">
          {info.data && !info.data.gitOk && (
            <Callout
              tone="critical"
              className="flex items-start gap-2 px-3.5 py-2.5"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-critical" />
              <span className="text-sm">
                Legible needs git 2.40 or newer; found {info.data.gitVersion}.
                Install a newer git (for example with Homebrew) and restart.
              </span>
            </Callout>
          )}
          {status.data && !status.data.ready && (
            <Callout
              tone="elevated"
              className="flex items-center gap-2 px-3.5 py-2.5"
            >
              <AlertTriangle className="size-3.5 shrink-0 text-elevated" />
              <span className="grow text-sm">
                Explanations need Claude. {status.data.detail}.
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => go({ name: "settings", section: "providers" })}
              >
                Open Settings
              </Button>
            </Callout>
          )}

          <OpenCard />

          <section className="flex flex-col gap-2.5" aria-labelledby="recent-h">
            <div className="flex items-center">
              <h2 className="grow text-title font-semibold" id="recent-h">
                Reviews
              </h2>
              {status.data?.ready && (
                <span className="text-xs text-muted-foreground">
                  {status.data.detail}
                </span>
              )}
            </div>
            {reviews.data && reviews.data.length === 0 && (
              <Callout className="px-4 py-[18px] text-sm text-muted-foreground">
                No Reviews yet. Open a repository with an agent's work in it, or
                paste a pull request URL.
              </Callout>
            )}
            {reviews.data && reviews.data.length > 0 && (
              <Card className="overflow-hidden">
                {reviews.data.map((r) => (
                  <ReviewRow key={r.id} review={r} />
                ))}
              </Card>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function sourceLabel(r: ReviewSummary): string {
  if (r.sourceKind === "pull_request")
    return `${r.repo.host?.includes("gitlab") ? "MR" : "PR"} #${r.prNumber}`
  if (r.sourceKind === "refs") return "Refs"
  return "Working tree"
}

function ReviewRow({ review }: { review: ReviewSummary }) {
  const client = useClient()
  const qc = useQueryClient()
  const go = useUI((s) => s.go)
  const del = useMutation({
    mutationFn: () => client.call("review.delete", { reviewId: review.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews"] }),
  })
  const open = () => go({ name: "review", reviewId: review.id })
  return (
    <div
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3.5 border-b px-4 py-3 last:border-b-0 hover:bg-hover"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{review.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {review.repo.displayName}
          {review.baseRef ? ` · vs ${review.baseRef}` : ""}
          {review.latestIteration
            ? ` · Iteration ${review.latestIteration.seq}`
            : ""}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Badge tone="muted">{sourceLabel(review)}</Badge>
        <Badge tone="outline">
          {review.mode === "author" ? "Author mode" : "Reviewer mode"}
        </Badge>
        <span className="w-20 text-right text-xs text-muted-foreground">
          {relativeTime(review.updatedAt)}
        </span>
      </div>
      <Button
        variant="muted"
        size="icon-xs"
        className="opacity-0 group-hover:opacity-100"
        aria-label={`Delete Review ${review.title}`}
        onClick={(e) => {
          e.stopPropagation()
          if (
            confirm(
              `Delete the Review “${review.title}”? Its viewed state and Explanations are removed. Your repository isn't touched.`,
            )
          )
            del.mutate()
        }}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function OpenCard() {
  const client = useClient()
  const qc = useQueryClient()
  const go = useUI((s) => s.go)
  const [tab, setTab] = useState<"local" | "pr">("local")
  const [repo, setRepo] = useState<RepoInspection | null>(null)
  const [mode, setMode] = useState<"working_tree" | "refs">("working_tree")
  const [baseRef, setBaseRef] = useState("")
  const [headRef, setHeadRef] = useState("")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<{
    message: string
    code: string | null
  } | null>(null)

  const pick = useMutation({
    mutationFn: async () => {
      const { path } = await client.call("repo.pick", {})
      if (!path) return null
      return client.call("repo.inspect", { path })
    },
    onSuccess: (r) => {
      if (!r) return
      setRepo(r)
      setError(null)
      setBaseRef(r.defaultBase ?? "")
      setHeadRef(r.branch ?? r.branches[0] ?? "")
    },
    onError: (e: Error) => setError({ message: e.message, code: null }),
  })

  const open = useMutation({
    mutationFn: () => {
      if (tab === "pr")
        return client.call("review.open", {
          source: { kind: "pull_request", url: url.trim() },
        })
      if (!repo) throw new Error("Choose a repository first.")
      if (mode === "working_tree")
        return client.call("review.open", {
          source: {
            kind: "working_tree",
            repoPath: repo.root,
            baseRef: baseRef || null,
          },
        })
      return client.call("review.open", {
        source: { kind: "refs", repoPath: repo.root, baseRef, headRef },
      })
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["reviews"] })
      go({ name: "review", reviewId: r.id })
    },
    onError: (e: Error) =>
      setError({
        message: e.message,
        code: e instanceof ClientError ? e.code : null,
      }),
  })

  return (
    <Card aria-labelledby="open-h">
      <div className="flex items-center gap-2 px-[18px] pt-4">
        <h1 className="grow text-title font-semibold" id="open-h">
          Open a Review
        </h1>
        <Tabs label="Source">
          <Tab selected={tab === "local"} onClick={() => setTab("local")}>
            <FolderGit2 />
            Local repository
          </Tab>
          <Tab selected={tab === "pr"} onClick={() => setTab("pr")}>
            <GitPullRequest />
            Pull Request
          </Tab>
        </Tabs>
      </div>
      <div className="flex flex-col gap-3.5 px-[18px] py-4">
        {tab === "local" ? (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => pick.mutate()}
                disabled={pick.isPending}
              >
                {pick.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FolderGit2 />
                )}
                {repo ? "Choose another…" : "Choose folder…"}
              </Button>
              {repo && (
                <span className="text-sm">
                  <b className="font-semibold">{repo.name}</b>{" "}
                  <span className="text-muted-foreground">
                    · {repo.branch ? `on ${repo.branch}` : "detached HEAD"}
                  </span>
                </span>
              )}
            </div>
            {repo && (
              <div className="flex flex-col gap-2.5">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Radio
                    name="mode"
                    checked={mode === "working_tree"}
                    onChange={() => setMode("working_tree")}
                  />
                  <span className="grow">
                    <b className="font-semibold">Working tree</b>{" "}
                    <span className="text-muted-foreground">
                      — everything on this branch, including uncommitted and
                      untracked files, captured as a Snapshot
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Radio
                    name="mode"
                    checked={mode === "refs"}
                    onChange={() => setMode("refs")}
                  />
                  <span className="grow">
                    <b className="font-semibold">Compare refs</b>{" "}
                    <span className="text-muted-foreground">
                      — two branches or commits, three-dot (merge-base)
                      semantics
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-2 pl-[26px] text-xs text-muted-foreground">
                  <span>Base</span>
                  <RefSelect
                    value={baseRef}
                    options={repo.branches}
                    onChange={setBaseRef}
                    label="Base ref"
                  />
                  {mode === "refs" && (
                    <>
                      <span>...</span>
                      <span>Head</span>
                      <RefSelect
                        value={headRef}
                        options={repo.branches}
                        onChange={setHeadRef}
                        label="Head ref"
                      />
                    </>
                  )}
                  {mode === "working_tree" && <span>vs the working tree</span>}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="pr-url">
              GitHub pull request or GitLab merge request URL
            </label>
            <Input
              id="pr-url"
              className="font-mono text-sm"
              placeholder="https://github.com/owner/repo/pull/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && url.trim() && open.mutate()
              }
            />
            <span className="text-xs text-muted-foreground">
              Read-only in this version. Private repositories need an account in
              Settings → Hosts.
            </span>
          </div>
        )}
        {error && (
          <Callout
            tone="critical"
            className="flex items-center gap-2 px-3 py-2 text-sm"
          >
            <span className="grow">{error.message}</span>
            {error.code === "needs_auth" && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => go({ name: "settings", section: "hosts" })}
              >
                Connect a host
              </Button>
            )}
          </Callout>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={
              open.isPending ||
              (tab === "local"
                ? !repo || (mode === "refs" && (!baseRef || !headRef))
                : !url.trim())
            }
            onClick={() => open.mutate()}
          >
            {open.isPending && <Loader2 className="animate-spin" />}
            {open.isPending
              ? tab === "pr"
                ? "Fetching…"
                : "Taking Snapshot…"
              : "Open Review"}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function RefSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  label: string
}) {
  const all = value && !options.includes(value) ? [value, ...options] : options
  return (
    <Select
      className="h-7 max-w-[260px] font-mono text-sm"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {all.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </Select>
  )
}
