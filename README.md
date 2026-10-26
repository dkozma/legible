# Legible

_Working name._ A desktop app for understanding code changes, mainly changes written by AI agents, so you keep an accurate mental model of your system and catch incorrect logic, wrongly codified business rules, and changes nobody asked for.

**Status:** M2. Read agent-written changes in a viewer built for understanding them, click anything to have Claude explain it, and follow how the change connects to the rest of the code: Symbols, Connection changes, ⌘-click to definitions. See [Dogfooding](docs/dogfooding.md) to run it.

```sh
pnpm install
pnpm dev ~/code/your-repo
```

- [Dogfooding](docs/dogfooding.md): what's in M1 and M2, how to run and build it, keyboard shortcuts
- [Product plan](docs/product-plan.md)
- [Engineering plan](docs/engineering-plan.md)
- [Glossary (CONTEXT.md)](CONTEXT.md): the canonical names for every concept, used in code and docs alike
- [Architecture decision records](docs/adr/)

## Privacy

Legible collects no telemetry. Your code leaves your machine only for these destinations:

- your git host (GitHub or GitLab)
- the model providers you connect: Claude (Anthropic, the default) and/or OpenAI
- TypeSafe, only if you turn on the optional Jev judgment backend
- Sentry, only if you turn on **Send error reports** in Settings → Privacy (off by default). Reports carry error messages, stack traces in Legible's own code, and your OS and app version, with tokens and your home directory removed. A crash report also carries a memory dump, which can include code you had open. See [ADR 0013](docs/adr/0013-opt-in-error-reports.md).

## License

[Apache-2.0](LICENSE). Contributions require a [DCO](https://developercertificate.org/) sign-off (`git commit -s`).
