# Legible

_Working name._ A desktop app for understanding code changes, mainly changes written by AI agents, so you keep an accurate mental model of your system and catch incorrect logic, wrongly codified business rules, and changes nobody asked for.

**Status:** planning. No code yet.

- [Product plan](docs/product-plan.md)
- [Engineering plan](docs/engineering-plan.md)
- [Glossary (CONTEXT.md)](CONTEXT.md): the canonical names for every concept, used in code and docs alike
- [Architecture decision records](docs/adr/)

## Privacy

Legible collects no telemetry. Your code leaves your machine only for three destinations:

- your git host (GitHub or GitLab)
- the model providers you connect: Claude (Anthropic, the default) and/or OpenAI
- TypeSafe, only if you turn on the optional Jev judgment backend

## License

[Apache-2.0](LICENSE). Contributions require a [DCO](https://developercertificate.org/) sign-off (`git commit -s`).
