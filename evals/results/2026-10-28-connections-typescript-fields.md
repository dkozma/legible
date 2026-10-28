## Connections against SCIP · TypeScript · fields · 2026-10-28

scip-typescript 0.5.2. **legible** (this repository): 14 Change Sets scored, 1 skipped; **hono** (https://github.com/honojs/hono@bac5c4a8bcd7): 30 Change Sets scored, 0 skipped. Preparing indexes took 1s, scoring 19s.

### All

| Status | Precision (correct/uses) |
|---|---|
| resolved | 99% (36072/36327) |
| likely | 96% (1265/1320) |
| possible | 7% (25/350) |
| ambiguous (SCIP's target among candidates) | 58% (2337/4053) |
| external (SCIP has no definition) | 89% (48178/53894) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 99% (12221/12293) | 96% (1259/1312) | 7% (23/324) | 66% (2336/3555) | 93% (38017/40925) |
| implements | 100% (55/55) | — | — | — | 100% (25/25) |
| read | 99% (14473/14652) | — | — | — | 90% (5051/5632) |
| references | 100% (9323/9327) | 75% (6/8) | 8% (2/26) | 0% (1/498) | 70% (5085/7312) |

- **Connections on locals and parameters** (pattern A): 2626 (external 2342, ambiguous 154, resolved 128, possible 2). On names being declared: 339 (external 337, ambiguous 2).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 93% (2337/2524).
- **Wrongly external**: 3037 of 53894 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 62% (39653/64131) counting files we indexed; 61% (39653/64535) counting every file. Found as resolved 36030, ambiguous 2337, likely 1261, possible 25; 9528 not extracted as references at all.
- **Used by** of 2091 changed Symbols (124 not defined in SCIP at their name, not scored): precision 96% (7250/7530) (resolved 100% (7007/7029), likely 99% (122/123), possible 4% (2/51), ambiguous 36% (119/327)); recall 67% (7250/10790).
- Not scored: 1629 uses with no SCIP occurrence; 155 changed files SCIP didn't index.

### legible

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (23242/23314) |
| likely | 96% (1220/1266) |
| possible | 7% (21/317) |
| ambiguous (SCIP's target among candidates) | 90% (508/564) |
| external (SCIP has no definition) | 94% (29377/31175) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 99% (5609/5641) | 96% (1220/1266) | 7% (21/310) | 90% (508/564) | 94% (20937/22175) |
| implements | 100% (21/21) | — | — | — | 100% (21/21) |
| read | 100% (12069/12109) | — | — | — | 92% (4896/5350) |
| references | 100% (5543/5543) | — | 0% (0/7) | — | 97% (3523/3629) |

- **Connections on locals and parameters** (pattern A): 27 (resolved 18, external 9). On names being declared: 0 (none).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 98% (508/517).
- **Wrongly external**: 1789 of 31175 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 56% (24987/44912) counting files we indexed; 55% (24987/45156) counting every file. Found as resolved 23242, likely 1216, ambiguous 508, possible 21; 8303 not extracted as references at all.
- **Used by** of 2000 changed Symbols (108 not defined in SCIP at their name, not scored): precision 96% (6270/6541) (resolved 100% (6029/6042), likely 99% (120/121), possible 4% (2/51), ambiguous 36% (119/327)); recall 68% (6270/9281).
- Not scored: 1288 uses with no SCIP occurrence; 14 changed files SCIP didn't index.

### hono

| Status | Precision (correct/uses) |
|---|---|
| resolved | 99% (12830/13013) |
| likely | 83% (45/54) |
| possible | 12% (4/33) |
| ambiguous (SCIP's target among candidates) | 52% (1829/3489) |
| external (SCIP has no definition) | 83% (18801/22719) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 99% (6612/6652) | 85% (39/46) | 14% (2/14) | 61% (1828/2991) | 91% (17080/18750) |
| implements | 100% (34/34) | — | — | — | 100% (4/4) |
| read | 95% (2404/2543) | — | — | — | 55% (155/282) |
| references | 100% (3780/3784) | 75% (6/8) | 11% (2/19) | 0% (1/498) | 42% (1562/3683) |

- **Connections on locals and parameters** (pattern A): 2599 (external 2333, ambiguous 154, resolved 110, possible 2). On names being declared: 339 (external 337, ambiguous 2).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 91% (1829/2007).
- **Wrongly external**: 1248 of 22719 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 76% (14666/19219) counting files we indexed; 76% (14666/19379) counting every file. Found as resolved 12788, ambiguous 1829, likely 45, possible 4; 1225 not extracted as references at all.
- **Used by** of 91 changed Symbols (16 not defined in SCIP at their name, not scored): precision 99% (980/989) (resolved 99% (978/987), likely 100% (2/2)); recall 65% (980/1509).
- Not scored: 341 uses with no SCIP occurrence; 141 changed files SCIP didn't index.

### Change Sets

| Change Set | Files | resolved | likely | Locals connected | Recall (indexed) | Used by |
|---|---|---|---|---|---|---|
| legible `6782c6ac` M3: Judge retries 429 and 5xx before falling back | 2 | 99% (358/362) | 100% (8/8) | 4 | 80% | 100% (25/25) |
| legible `d777c9f5` M3: evals load .env and stop on settings they would ignore | 4 | 100% (274/274) | 100% (4/4) | 0 | 61% | 100% (54/54) |
| legible `7f2a6285` Resizable side panels that remember their widths | 7 | 99% (1009/1015) | — | 0 | 47% | 97% (288/298) |
| legible `b4ef0746` M3: fix findings from an independent review | 21 | 100% (4347/4357) | 93% (217/233) | 4 | 49% | 87% (476/550) |
| legible `48e52bc4` M3: docs — ADR 0015, dogfooding, README privacy, engineering | 5 | 100% (74/74) | — | 0 | 45% | 100% (4/4) |
| legible `340de6b3` M3: evals harness with six labeled cases | 63 | 100% (267/267) | 100% (2/2) | 0 | 56% | 94% (140/149) |
| legible `537007c1` M3: Change Brief, Walkthrough sidebar, Step view and editing | 17 | 100% (3364/3372) | 98% (210/214) | 0 | 53% | 98% (479/490) |
| legible `b727ad24` M3: Understanding service, agent host pipelines, ChatGPT sig | 20 | 100% (2858/2858) | 96% (248/258) | 0 | 65% | 95% (861/903) |
| legible `78c41ec6` M3: Intent, Walkthrough and Change Brief pipelines | 23 | 100% (1402/1402) | 98% (102/104) | 0 | 51% | 100% (599/599) |
| legible `3968d87c` M3: Fragment graph — dependencies, reach and test links for  | 7 | 100% (1741/1747) | 100% (32/32) | 6 | 62% | 98% (179/182) |
| legible `18b758a5` M3: packages/judge with TypeSafe Jev, OpenAI Decisions and f | 10 | 100% (504/506) | 100% (1/1) | 2 | 62% | 94% (257/273) |
| legible `33010da3` M3: domain types and storage for Intent, Walkthrough and Cha | 13 | 100% (1175/1175) | 89% (73/82) | 0 | 63% | 98% (505/514) |
| legible `3c517a82` M2: code structure — tree-sitter indexer, Symbols, Connectio | 85 | 99% (5563/5599) | 98% (255/260) | 11 | 56% | 96% (2403/2500) |
| legible `979f1837` Fix the macOS test failure that stopped the first release, a | 4 | 100% (306/306) | 100% (68/68) | 0 | 98% | — (0/0) |
| legible `74cc4eca` M1: desktop shell, diff viewer and Explanations (#2) | skipped: parent b5d1d5c1 not indexed: - . (missing tsconfig.json) | | | | | |
| hono `eb78ecaa` fix(utils/url): preserve encoded duplicate query order (#549 | 3 | 98% (685/697) | — | 8 | 88% | 100% (4/4) |
| hono `06a45bc3` feat(bearer-auth): allow MessageFunction to return a Respons | 2 | 100% (430/430) | — | 2 | 87% | 100% (108/108) |
| hono `5ca49b07` fix(css): Fix multiline CSS handling in style replacement (# | 2 | 97% (324/334) | — | 0 | 47% | 100% (38/38) |
| hono `e9c01079` fix(hono-base): disallow `getPath` when `strict` is `false`  | 3 | 99% (2938/2972) | 100% (10/10) | 2097 | 79% | 100% (27/27) |
| hono `08807ce1` fix(trie-router): keep first value for duplicate path params | 5 | 99% (2959/2993) | 100% (8/8) | 394 | 80% | 100% (348/348) |
| hono `e77c7c8e` fix(helper/route): match regex params in basePath() the same | 2 | 83% (190/230) | — | 40 | 53% | 100% (29/29) |
| hono `d54720da` fix(serve-static): respect q-values in Accept-Encoding for p | 2 | 100% (200/200) | 100% (2/2) | 2 | 74% | 100% (41/41) |
| hono `ae401f08` fix(css): keep the descendant combinator before a pseudo-cla | 2 | 100% (372/372) | — | 0 | 53% | 100% (8/8) |
| hono `2013fed5` fix(css): keep "//" inside an unquoted url() when minifying  | 2 | 100% (372/372) | — | 0 | 53% | 100% (4/4) |
| hono `43379d93` fix(jsx): preserve self-closing void elements in cloneElemen | 2 | 99% (384/386) | 100% (2/2) | 4 | 78% | 100% (16/16) |
| hono `33622444` fix(build): keep barrel imports in the bundled `d.ts` (#5557 | 5 | 100% (26/26) | — | 0 | 100% | — (0/0) |
| hono `588ec13f` fix(serve-static): only serve GET and HEAD requests (#5514) | 2 | 100% (192/192) | 100% (2/2) | 2 | 75% | 100% (39/39) |
| hono `f78a245a` chore: unified oxfmt and oxlint config (#5518) | 3 | — | — | 0 | — | — (0/0) |
| hono `ae595de8` feat(mount): introduce Mount Middleware and deprecate `app.m | 5 | 98% (364/372) | 100% (3/3) | 8 | 75% | 85% (44/52) |
| hono `f23b146a` fix(jsx): allow JSXNode function component results (#5476) | 2 | 99% (378/380) | 100% (2/2) | 4 | 79% | 100% (5/5) |
| hono `6d73a74f` docs(request): fix jsdoc comments for some getters (#5445) | 1 | 100% (150/150) | — | 0 | 77% | 100% (104/104) |
| hono `deff5296` test(client): simulate network error for undefined route in  | 1 | 98% (162/166) | — | 4 | 89% | — (0/0) |
| hono `afb2068c` fix(combine): return a Response from a short-circuiting midd | 2 | 94% (295/313) | 100% (2/2) | 18 | 88% | 100% (20/20) |
| hono `e5bb2062` fix(jsx): add px to numeric gridGap, gridRowGap and gridColu | 2 | 100% (124/124) | — | 0 | 100% | 100% (56/56) |
| hono `c3053ccf` fix(etag): correctly match mixed-case header name in retaine | 2 | 100% (298/298) | 0% (0/4) | 0 | 91% | 100% (44/44) |
| hono `c437d756` test(build): type-check the bundled declarations from a cons | 6 | — | — | 0 | — | — (0/0) |
| hono `be1f7498` fix(build): keep internal types private in bundled d.ts and  | 11 | 100% (336/337) | 100% (2/2) | 2 | 86% | 0% (0/1) |
| hono `1e1207ca` test(serve-static): fix the test (#5479) | 1 | 100% (76/76) | — | 0 | 72% | — (0/0) |
| hono `8b05c774` Merge commit from fork | 2 | 100% (178/178) | 50% (2/4) | 2 | 76% | 100% (45/45) |
| hono `72f0d8d5` feat(adapters/netlify): publish to JSR (#5468) | 8 | — | — | 0 | — | — (0/0) |
| hono `645ddd6e` test: move adapter runtime tests into `adapters/*` (#5466) | 49 | — | — | 0 | — | — (0/0) |
| hono `1c6e060d` feat(adapters/deno): publish to JSR (#5465) | 10 | — | — | 0 | — | — (0/0) |
| hono `b877827f` feat(adapters): add the seven adapters as workspace packages | 101 | 99% (1172/1184) | 75% (9/12) | 6 | 76% | — (0/0) |
| hono `4d9f2a2e` chore(adapters/bun): ship ESM only (#5462) | 3 | — | — | 0 | — | — (0/0) |
| hono `fc2343db` feat(adapters): add @hono/bun as a workspace package (#5447) | 27 | 97% (225/231) | 100% (1/1) | 6 | 70% | — (0/0) |

## False positives, most frequent first

### likely

- apps/desktop/src/main/understanding.ts:166 all (calls) → likely packages/store/src/sqlite.ts:28 Statement.all vs SCIP external (×22) · `b4ef0746`
- packages/store/src/index.ts:160 prepare (calls) → likely packages/store/src/sqlite.ts:53 NodeSqliteDatabase.prepare vs SCIP external (×12) · `b4ef0746`
- src/middleware/etag/index.test.ts:37 digest (calls) → likely src/middleware/etag/digest.ts:30 generateDigest.digest vs SCIP external (×4) · `c3053ccf`
- src/adapter/deno/websocket.ts:15 upgradeWebSocket (calls) → likely src/helper/websocket/index.ts:121 defineWebSocketHelper.upgradeWebSocket vs SCIP src/adapter/deno/deno.d.ts:49 (×3) · `b877827f`
- packages/agent-runtime/src/openai.ts:69 getResponse (calls) → likely packages/agent-runtime/src/openai.ts:67 MeteredModel.getResponse vs SCIP external (×2) · `b4ef0746`
- packages/agent-runtime/src/openai.ts:76 getStreamedResponse (calls) → likely packages/agent-runtime/src/openai.ts:74 MeteredModel.getStreamedResponse vs SCIP external (×2) · `b4ef0746`
- packages/agent-runtime/src/openai.ts:87 getModel (calls) → likely packages/agent-runtime/src/openai.ts:86 MeteredProvider.getModel vs SCIP external (×2) · `b4ef0746`
- src/middleware/serve-static/index.ts:97 Set (references) → likely src/context.ts:105 Set vs SCIP external (×2) · `8b05c774`
- packages/agent-runtime/src/openai.ts:73 getResponse (calls) → likely packages/agent-runtime/src/openai.ts:71 MeteredModel.getResponse vs SCIP external · `b4ef0746`
- packages/agent-runtime/src/openai.ts:80 getStreamedResponse (calls) → likely packages/agent-runtime/src/openai.ts:78 MeteredModel.getStreamedResponse vs SCIP external · `b4ef0746`
- packages/agent-runtime/src/openai.ts:91 getModel (calls) → likely packages/agent-runtime/src/openai.ts:90 MeteredProvider.getModel vs SCIP external · `b4ef0746`
- apps/desktop/src/main/agentHostClient.ts:129 onEvent (calls) → likely apps/desktop/src/main/agentHostCore.ts:234 createAgentHost.handle.onEvent vs SCIP apps/desktop/src/main/agentHostClient.ts:31 · `b727ad24`
- apps/desktop/src/main/agentHostClient.ts:147 onEvent (calls) → likely apps/desktop/src/main/agentHostCore.ts:283 createAgentHost.run.onEvent vs SCIP apps/desktop/src/main/agentHostClient.ts:33 · `b727ad24`
- apps/desktop/src/main/indexer.ts:18 handle (calls) → likely apps/desktop/src/main/indexerCore.ts:212 serveIndexer.handle vs SCIP external · `3c517a82`

### possible

- packages/store/src/index.ts:204 execute (calls) → possible packages/agent-runtime/src/openai.ts:176 OpenAIAgentsRuntime.run.execute vs SCIP external (×116) · `b4ef0746`
- packages/judge/src/fast.ts:39 describe (calls) → possible apps/desktop/src/main/hosts.ts:39 HostService.describe vs SCIP external (×37) · `b4ef0746`
- packages/store/src/index.ts:205 execute (calls) → possible packages/agent-runtime/src/openai.ts:182 OpenAIAgentsRuntime.run.execute vs SCIP external (×29) · `b4ef0746`
- packages/git/src/repo.ts:256 all (calls) → possible packages/store/src/sqlite.ts:28 Statement.all vs SCIP external (×29) · `b727ad24`
- packages/ui/src/review/BriefPage.tsx:163 label (calls) → possible packages/pipelines/test/pipelines.test.ts:280 label vs SCIP external (×26) · `b4ef0746`
- packages/ui/src/review/BriefPage.tsx:68 header (calls) → possible packages/indexer/src/outline.ts:309 header vs SCIP external (×9) · `b4ef0746`
- src/adapter/cloudflare-workers/websocket.ts:43 Event (references) → possible src/jsx/types.ts:29 Event vs SCIP external (×9) · `b877827f`
- apps/desktop/e2e/app.spec.ts:257 move (calls) → possible packages/ui/src/diff/DiffView.tsx:231 DiffView.move vs SCIP external (×8) · `7f2a6285`
- src/helper/css/common.ts:63 Set (references) → possible src/context.ts:105 Set vs SCIP external (×8) · `ae401f08`
- apps/desktop/e2e/app.spec.ts:245 Text (references) → possible packages/indexer/src/changeSet.ts:65 Text vs SCIP external (×7) · `7f2a6285`
- packages/ui/src/review/BriefPage.tsx:216 p (calls) → possible packages/judge/src/http.ts:56 sane.p vs SCIP external (×7) · `b4ef0746`
- src/request.test.ts:640 clone (calls) → possible src/client/types.ts:147 ClientResponse.clone vs SCIP external (×6) · `eb78ecaa`
- apps/desktop/e2e/app.spec.ts:258 down (calls) → possible packages/ui/src/views/Review.tsx:1125 ReviewView.down vs SCIP external (×4) · `7f2a6285`
- apps/desktop/e2e/app.spec.ts:254 down (calls) → possible packages/ui/src/views/Review.tsx:1121 ReviewView.down vs SCIP external (×4) · `b4ef0746`
- apps/desktop/e2e/app.spec.ts:203 down (calls) → possible packages/ui/src/views/Review.tsx:822 ReviewView.down vs SCIP external (×4) · `537007c1`
- src/adapter/cloudflare-workers/websocket.ts:43 onError (calls) → possible src/adapter/cloudflare-workers/websocket.test.ts:87 onError vs SCIP src/helper/websocket/index.ts:18 (×4) · `b877827f`
- apps/desktop/e2e/app.spec.ts:258 down (calls) → possible packages/ui/src/views/Review.tsx:1138 ReviewView.down vs SCIP external (×3) · `7f2a6285`
- apps/desktop/src/main/indexerCore.ts:193 source (calls) → possible apps/desktop/src/main/indexerClient.ts:83 IndexerClient.source vs SCIP packages/indexer/src/connections.ts:978 (×3) · `3968d87c`
- packages/agent-runtime/src/openai.ts:314 list (calls) → possible apps/desktop/src/main/explanations.ts:405 ExplanationService.list vs SCIP external (×2) · `b4ef0746`
- apps/desktop/e2e/app.spec.ts:202 move (calls) → possible packages/ui/src/diff/DiffView.tsx:229 DiffView.move vs SCIP external (×2) · `537007c1`

### resolved

- src/hono.test.ts:15 getPath (read) → resolved src/hono.test.ts:648 getPath vs SCIP src/utils/url.ts:106 (×30) · `e9c01079`
- src/hono.test.ts:15 getPath (read) → resolved src/hono.test.ts:649 getPath vs SCIP src/utils/url.ts:106 (×10) · `e9c01079`
- src/helper/route/index.test.ts:87 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:79 (×8) · `e77c7c8e`
- apps/desktop/src/main/indexerCore.ts:17 buildChangeSet (read) → resolved apps/desktop/src/main/indexerCore.ts:154 createIndexer.buildChangeSet vs SCIP packages/indexer/src/changeSet.ts:154 (×6) · `3968d87c`
- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:12 nextVersion vs SCIP external (×6) · `3c517a82`
- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:16 nextVersion vs SCIP external (×6) · `3c517a82`
- src/hono.test.ts:2766 anotherApp (read) → resolved src/hono.test.ts:2635 anotherApp vs SCIP local src/hono.test.ts:2762 (×6) · `e9c01079`
- src/helper/route/index.test.ts:53 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:45 (×6) · `e77c7c8e`
- src/helper/route/index.test.ts:129 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:121 (×6) · `e77c7c8e`
- packages/indexer/test/connections.test.ts:339 sh (calls) → resolved packages/indexer/test/connections.test.ts:216 sh vs SCIP local packages/indexer/test/connections.test.ts:333 (×5) · `3c517a82`
- packages/judge/test/judge.test.ts:273 run (read) → resolved packages/judge/test/judge.test.ts:226 run vs SCIP local packages/judge/test/judge.test.ts:266 (×4) · `6782c6ac`
- packages/judge/test/judge.test.ts:255 run (read) → resolved packages/judge/test/judge.test.ts:208 run vs SCIP local packages/judge/test/judge.test.ts:248 (×4) · `b4ef0746`
- apps/desktop/test/version.test.ts:6 prereleaseVersion (read) → resolved apps/desktop/scripts/version.mjs:31 prereleaseVersion vs SCIP external (×4) · `3c517a82`
- src/request.test.ts:643 formData (calls) → resolved src/request.ts:334 HonoRequest.formData vs SCIP external (×4) · `eb78ecaa`
- src/helper/route/index.test.ts:91 handlerB (read) → resolved src/helper/route/index.test.ts:17 handlerB vs SCIP local src/helper/route/index.test.ts:80 (×4) · `e77c7c8e`
- src/helper/route/index.test.ts:161 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:154 (×4) · `e77c7c8e`
- src/helper/route/index.test.ts:181 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:173 (×4) · `e77c7c8e`
- src/helper/route/index.test.ts:223 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:215 (×4) · `e77c7c8e`
- src/jsx/base.test.tsx:26 fnElement (calls) → resolved src/jsx/base.test.tsx:17 fnElement vs SCIP local src/jsx/base.test.tsx:25 (×4) · `43379d93`
- apps/desktop/src/main/indexerCore.ts:19 buildChangeSet (read) → resolved apps/desktop/src/main/indexerCore.ts:158 createIndexer.buildChangeSet vs SCIP packages/indexer/src/changeSet.ts:154 (×3) · `3968d87c`

### used by

- packages/judge/test/judge.test.ts:90 used by → ambiguous FastTierBackend.judge vs SCIP src/`http.ts`/JevBackend#judge(). (×13) · `b4ef0746`
- packages/ui/src/views/Settings.tsx:288 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×8) · `b4ef0746`
- src/middleware/mount/index.test.ts:146 used by → resolved anotherApp vs SCIP local (×8) · `ae595de8`
- packages/judge/test/judge.test.ts:155 used by → ambiguous JevBackend.judge vs SCIP src/`http.ts`/DecisionsBackend#judge(). (×7) · `b4ef0746`
- packages/ui/src/review/ConnectionsPanel.tsx:205 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×7) · `b4ef0746`
- apps/desktop/src/main/index.ts:317 used by → ambiguous UnderstandingService.status vs SCIP src/main/`agentHostClient.ts`/AgentHostClient#status(). (×6) · `b4ef0746`
- apps/desktop/test/understanding.test.ts:91 used by → ambiguous OpenAIAgentsRuntime.run vs SCIP src/main/`understanding.ts`/UnderstandingService#run(). (×6) · `b4ef0746`
- packages/judge/test/judge.test.ts:90 used by → ambiguous DecisionsBackend.judge vs SCIP src/`http.ts`/JevBackend#judge(). (×6) · `b4ef0746`
- packages/ui/src/review/BriefPage.tsx:216 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×6) · `b4ef0746`
- packages/ui/src/review/ExplainPanel.tsx:93 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×6) · `b4ef0746`
- apps/desktop/src/main/agentHostClient.ts:71 used by → ambiguous IndexerTransport.post vs SCIP src/main/`agentHostClient.ts`/Transport#post(). (×5) · `3c517a82`
- packages/ui/src/App.tsx:73 used by → ambiguous createResolver.go vs SCIP src/`state.ts`/UIState#go(). (×5) · `3c517a82`
- packages/indexer/test/connections.test.ts:339 used by → resolved sh vs SCIP local (×5) · `3c517a82`
- apps/desktop/src/main/explanations.ts:140 used by → ambiguous createAgentHost.repoFor vs SCIP src/main/`reviews.ts`/ReviewService#repoFor(). (×4) · `b727ad24`
- apps/desktop/src/main/agentHostClient.ts:156 used by → ambiguous createAgentHost.handle vs SCIP src/main/`agentHostCore.ts`/handle0: (×4) · `b727ad24`
- apps/desktop/src/main/agentHost.ts:18 used by → ambiguous createAgentHost.handle vs SCIP src/main/`agentHostCore.ts`/handle0: (×4) · `b727ad24`
- packages/judge/test/judge.test.ts:90 used by → ambiguous UnderstandingService.judge vs SCIP src/`http.ts`/JevBackend#judge(). (×4) · `b727ad24`
- packages/judge/test/judge.test.ts:90 used by → ambiguous Judge.judge vs SCIP src/`http.ts`/JevBackend#judge(). (×4) · `18b758a5`
- apps/desktop/src/main/index.ts:262 used by → ambiguous FakeRuntime.status vs SCIP src/main/`agentHostClient.ts`/AgentHostClient#status(). (×4) · `33010da3`
- apps/desktop/src/main/explanations.ts:174 used by → possible splitAtSymbols.emit vs SCIP src/main/`explanations.ts`/ExplanationService#`<constructor>`().(emit) (×4) · `3c517a82`

### wrongly external

- packages/ui/src/views/Review.tsx:78 call (calls) → external vs SCIP packages/ui/src/client.ts:24 (×237) · `7f2a6285`
- packages/ui/src/views/Review.tsx:1197 Button (calls) → external vs SCIP packages/ui/src/components/ui.tsx:57 (×197) · `7f2a6285`
- packages/ui/src/views/Review.tsx:249 set (calls) → external vs SCIP packages/ui/src/state.ts:78 (×184) · `7f2a6285`
- src/helper/css/index.test.tsx:51 css (calls) → external vs SCIP src/helper/css/index.ts:234 (×124) · `5ca49b07`
- src/hono.test.ts:260 get (calls) → external vs SCIP src/hono-base.ts:104 (×112) · `e9c01079`
- src/helper/css/index.test.tsx:88 h1 (calls) → external vs SCIP src/jsx/intrinsic-elements.ts:844 (×109) · `5ca49b07`
- src/helper/factory/index.ts:14 IntersectNonAnyTypes (read) → external vs SCIP src/types.ts:2767 (×92) · `e9c01079`
- src/helper/css/index.test.tsx:54 Style (calls) → external vs SCIP src/helper/css/index.ts:262 (×79) · `5ca49b07`
- packages/ui/src/App.tsx:46 set (calls) → external vs SCIP packages/ui/src/state.ts:70 (×71) · `537007c1`
- src/helper/css/index.test.tsx:177 div (calls) → external vs SCIP src/jsx/intrinsic-elements.ts:834 (×57) · `5ca49b07`
- src/helper/css/index.test.tsx:88 cx (calls) → external vs SCIP src/helper/css/index.ts:241 (×48) · `5ca49b07`
- src/hono.test.ts:2479 set (calls) → external vs SCIP src/context.ts:550 (×48) · `e9c01079`
- src/middleware/serve-static/index.test.ts:13 request (calls) → external vs SCIP src/hono-base.ts:501 (×48) · `1e1207ca`
- src/hono-base.ts:26 Schema (read) → external vs SCIP src/types.ts:2531 (×43) · `e9c01079`
- packages/ui/src/views/Review.tsx:262 set (calls) → external vs SCIP packages/ui/src/state.ts:88 (×40) · `7f2a6285`
- apps/desktop/src/main/understanding.ts:50 PlannerFragment (read) → external vs SCIP packages/pipelines/src/walkthrough/fragments.ts:14 (×37) · `b4ef0746`
- src/helper/css/index.ts:6 raw (read) → external vs SCIP src/utils/html.ts:40 (×36) · `5ca49b07`
- evals/src/run.ts:44 PlannerOutput (read) → external vs SCIP packages/pipelines/src/walkthrough/planner.ts:21 (×34) · `d777c9f5`
- src/helper/css/index.test.tsx:572 get (calls) → external vs SCIP src/hono-base.ts:119 (×29) · `5ca49b07`
- src/middleware/serve-static/index.test.ts:7 use (calls) → external vs SCIP src/hono-base.ts:113 (×29) · `1e1207ca`

### locals

- src/helper/factory/index.ts:34 P (references) → external P vs SCIP local src/helper/factory/index.ts:20 (×230) · `e9c01079`
- src/hono.test.ts:3144 echo (calls) → external echo vs SCIP local src/hono.test.ts:3036 (×148) · `e9c01079`
- src/helper/factory/index.ts:31 E (references) → ambiguous src/types.test.ts:31 E vs SCIP local src/helper/factory/index.ts:20 (×138) · `e9c01079`
- src/helper/factory/index.ts:28 I (references) → external I vs SCIP local src/helper/factory/index.ts:27 (×134) · `e9c01079`
- src/hono.test.ts:3148 echo2 (calls) → external echo2 vs SCIP local src/hono.test.ts:3047 (×132) · `e9c01079`
- src/helper/factory/index.ts:32 E2 (references) → external E2 vs SCIP local src/helper/factory/index.ts:31 (×126) · `e9c01079`
- src/hono.test.ts:3152 echo3 (calls) → external echo3 vs SCIP local src/hono.test.ts:3058 (×116) · `e9c01079`
- src/helper/factory/index.ts:35 E3 (references) → external E3 vs SCIP local src/helper/factory/index.ts:32 (×108) · `e9c01079`
- src/helper/factory/index.ts:35 I2 (references) → external I2 vs SCIP local src/helper/factory/index.ts:28 (×108) · `e9c01079`
- src/hono.test.ts:3157 echo4 (calls) → external echo4 vs SCIP local src/hono.test.ts:3069 (×100) · `e9c01079`
- src/helper/factory/index.ts:52 E4 (references) → external E4 vs SCIP local src/helper/factory/index.ts:48 (×88) · `e9c01079`
- src/helper/factory/index.ts:52 I3 (references) → external I3 vs SCIP local src/helper/factory/index.ts:42 (×88) · `e9c01079`
- src/hono.test.ts:3167 echo5 (calls) → external echo5 vs SCIP local src/hono.test.ts:3080 (×84) · `e9c01079`
- src/helper/factory/index.ts:73 E5 (references) → external E5 vs SCIP local src/helper/factory/index.ts:68 (×70) · `e9c01079`
- src/helper/factory/index.ts:73 I4 (references) → external I4 vs SCIP local src/helper/factory/index.ts:60 (×70) · `e9c01079`
- src/helper/factory/index.ts:34 R (references) → external R vs SCIP local src/helper/factory/index.ts:29 (×68) · `e9c01079`
- src/hono.test.ts:3178 echo6 (calls) → external echo6 vs SCIP local src/hono.test.ts:3091 (×68) · `e9c01079`
- src/helper/factory/index.ts:98 E6 (references) → external E6 vs SCIP local src/helper/factory/index.ts:92 (×54) · `e9c01079`
- src/helper/factory/index.ts:98 I5 (references) → external I5 vs SCIP local src/helper/factory/index.ts:82 (×54) · `e9c01079`
- src/hono.test.ts:3190 echo7 (calls) → external echo7 vs SCIP local src/hono.test.ts:3102 (×52) · `e9c01079`

