// Versioned schema migrations. Each entry runs once, in order; the applied
// version lives in PRAGMA user_version. Never edit a shipped migration — add one.

export const MIGRATIONS: string[] = [
  // 1 — M1 schema
  `
  CREATE TABLE repos (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    git_dir TEXT NOT NULL UNIQUE,
    work_tree TEXT,
    remote_url TEXT,
    host TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('working_tree', 'refs', 'pull_request')),
    base_ref TEXT,
    head_ref TEXT,
    pr_url TEXT,
    pr_number INTEGER,
    mode TEXT NOT NULL CHECK (mode IN ('author', 'reviewer')),
    intent_text TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX reviews_updated ON reviews(updated_at DESC);

  CREATE TABLE iterations (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'push', 'refs')),
    base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    head_tree TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (review_id, seq)
  );

  CREATE TABLE viewed_files (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    file_key TEXT NOT NULL,
    viewed_at TEXT NOT NULL,
    PRIMARY KEY (review_id, file_key)
  );

  CREATE TABLE explanations (
    cache_key TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
    target_json TEXT NOT NULL,
    label TEXT NOT NULL,
    body_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tier TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    cost_usd REAL,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX explanations_review ON explanations(review_id, created_at DESC);

  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    review_id TEXT REFERENCES reviews(id) ON DELETE SET NULL,
    task_kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tier TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    status TEXT NOT NULL,
    error TEXT
  );
  CREATE INDEX agent_runs_started ON agent_runs(started_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE review_state (
    review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL
  );
  `,
  // 2 — M3: Intent, Walkthrough, Change Brief, Judge cache
  `
  CREATE TABLE intents (
    review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    body_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE transcript_choices (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    transcript_id TEXT NOT NULL,
    selected INTEGER NOT NULL,
    PRIMARY KEY (review_id, transcript_id)
  );

  CREATE TABLE walkthroughs (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    iteration_id TEXT NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
    body_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (review_id, iteration_id)
  );

  CREATE TABLE briefs (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    iteration_id TEXT NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
    body_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (review_id, iteration_id)
  );

  CREATE TABLE viewed_steps (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    viewed_at TEXT NOT NULL,
    PRIMARY KEY (review_id, step_id)
  );

  CREATE TABLE judgments (
    cache_key TEXT PRIMARY KEY,
    backend TEXT NOT NULL,
    model TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
]
