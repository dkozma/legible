## openai:defaults+decisions · 2026-10-28

| Case | Steps | Coverage | Dep. violations | Grouping F1 | Layers | Unrequested recall | Unrequested precision | Domain Change recall | Domain Change precision | Chapters | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| discounts-java | 1 | 100% | 0 | 80% | 67% | — | — | 33% | 33% | yes | $0.073 |
| inventory-py | 4 | 100% | 0 | 50% | 83% | 100% | 100% | 100% | 100% | no | $0.046 |
| ports-rs | 2 | 100% | 0 | 100% | 100% | — | — | 100% | 100% | yes | $0.109 |
| ratelimit-go | 1 | 100% | 0 | 84% | 0% | — | — | 100% | 100% | yes | $0.156 |
| refunds-ts | 7 | 100% | 0 | 89% | 100% | 0% | — | 100% | 75% | yes | $0.285 |
| two-features-ts | 5 | 100% | 0 | 60% | 87% | — | — | 100% | 75% | yes | $0.155 |
| **All** | | 100% | 0 | 77% | 73% | 50% | 100% | 89% | 81% | | $2.439/1k lines |

Judge: decisions:gpt-6-luna.

Exit criteria: coverage met, dependency order met.
