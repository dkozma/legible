# Legible

_Working name._ A desktop app for understanding code changes, mainly changes written by AI agents, so you keep an accurate mental model of your system and catch incorrect logic, wrongly codified business rules, and changes nobody asked for.

> [!WARNING]
> Legible is in active, early development. Expect rough edges, missing features, and breaking changes to stored data and settings between builds. It's not ready to depend on yet.

**Status:** M3. Every Review opens on a Change Brief: what the change was meant to do, the business rules it changes, what nobody asked for, and where the risk is. Then a Walkthrough takes you through it Step by Step, in dependency order and sized for a sitting. Click anything to have Claude or OpenAI explain it, and follow how it connects to the rest of the code. See [Dogfooding](docs/dogfooding.md) to run it.

```sh
pnpm install
pnpm dev ~/code/your-repo
```

- [Dogfooding](docs/dogfooding.md): what's in M1–M3, how to run and build it, keyboard shortcuts
- [Evals](evals/README.md): labeled Change Sets and how to score the AI pipelines
- [Product plan](docs/product-plan.md)
- [Engineering plan](docs/engineering-plan.md)
- [Glossary (CONTEXT.md)](CONTEXT.md): the canonical names for every concept, used in code and docs alike
- [Architecture decision records](docs/adr/)

## Privacy

Legible collects no telemetry. Your code leaves your machine only for these destinations:

- your git host (GitHub or GitLab)
- the model providers you connect: Claude (Anthropic, the default) and/or OpenAI. OpenAI's SDK tracing is off.
- TypeSafe, only if you turn on the optional Jev judgment backend, and OpenAI's Decisions API, only if you turn it on. These receive Step names and narratives, file paths, changed Symbol names, the Intent and the Pull Request text, never code.
- Sentry, only if you turn on **Send error reports** in Settings → Privacy (off by default). Reports carry error messages, stack traces in Legible's own code, and your OS and app version, with tokens and your home directory removed. A crash report also carries a memory dump, which can include code you had open. See [ADR 0013](docs/adr/0013-opt-in-error-reports.md).

Legible also reads, on your machine only, the Claude Code and Codex sessions run in a repository's folder (`~/.claude/projects`, `~/.codex/sessions`) to find a change's Intent. Turn that off in Settings → Walkthrough & Brief.

## License

[Apache-2.0](LICENSE). Contributions require a [DCO](https://developercertificate.org/) sign-off (`git commit -s`).
