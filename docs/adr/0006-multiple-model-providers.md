# Two model Providers (Anthropic default, OpenAI optional), chosen per Model Tier

Legible supports two **Providers** for agent work: **Anthropic (Claude)**, the default, and **OpenAI**. Users can configure either or both. Each **Model Tier** (strong, mid, fast) is assigned a provider and model independently, from the models the configured providers offer. Tiers don't have to share a provider; for example, Claude for strong-tier Lenses and an OpenAI model for fast-tier Explanations. This replaces the "only Claude ships in v1" scope in [ADR 0002](./0002-agent-runtime-and-claude-auth.md). ADR 0002's Claude authentication rules still stand.

**How each provider authenticates**

| Provider | Subscription path | Usage-based path |
|---|---|---|
| Anthropic | "Use my Claude Code": the user's own signed-in `claude` binary; Legible never touches credentials (ADR 0002) | Anthropic API key, Bedrock, Vertex, Foundry |
| OpenAI | **"Continue with ChatGPT"** through OpenAI's official Sign in with ChatGPT program, which supports open-source clients (OIDC + PKCE, no client secret) for eligible Responses API requests on the user's plan | OpenAI API key |

The difference is deliberate. OpenAI offers a sanctioned in-app sign-in for open-source apps, so Legible implements it and stores the resulting tokens in the keychain. Anthropic doesn't, so Legible only uses the user's own signed-in Claude Code install.

**How agent runs stay comparable across providers.** `AgentRuntime` gets a second implementation built on the OpenAI Agents SDK over the Responses API. We chose it over the Codex SDK because it lets Legible define every tool itself. The Codex SDK brings its own coding agent and sandbox, and its MCP server mode has been removed. Legible's tools are defined once, provider-neutrally, and adapted to each runtime. That way the read-only and Revision-write permission policy is enforced in Legible's own code for both providers.

## Consequences

- Before release, Legible must register as an open-source Sign in with ChatGPT client and follow OpenAI's branding rules (a "Continue with ChatGPT" label with prominence comparable to other options).
- Structured-output schemas must satisfy both providers. OpenAI's strict mode requires every field to be present (nullable instead of optional) and no extra properties. A CI lint enforces this.
- Prompts are shared, with optional per-provider overrides. Evals run for each provider and model, and only models that pass are marked "recommended".
- A Conversation, or a Batch's Change Request run, stays on one provider for its whole life. Separate tasks within a Review may use different providers.
- When both providers are configured, Verification can optionally run on the provider that *didn't* produce the Finding, which reduces shared blind spots.
- An OpenAI key can also power the OpenAI Decisions Judge backend ([ADR 0005](./0005-judge-interface-for-typed-judgments.md)).
