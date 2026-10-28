## Connections against SCIP · TypeScript · corpus · 2026-10-28

scip-typescript 0.5.2. **legible** (this repository): 14 Change Sets scored, 1 skipped; **hono** (https://github.com/honojs/hono@bac5c4a8bcd7): 30 Change Sets scored, 0 skipped. Preparing indexes took 1s, scoring 19s.

### All

| Status | Precision (correct/uses) |
|---|---|
| resolved | 97% (28475/29446) |
| likely | 74% (1751/2361) |
| ambiguous (SCIP's target among candidates) | 34% (1787/5196) |
| external (SCIP has no definition) | 82% (47533/57662) |

| Kind | resolved | likely | ambiguous | external |
|---|---|---|---|---|
| calls | 98% (8404/8601) | 81% (1743/2164) | 40% (1786/4450) | 85% (38036/44611) |
| implements | 100% (55/55) | — | — | 100% (25/25) |
| read | 93% (10741/11498) | — | — | 91% (4387/4819) |
| references | 100% (9275/9292) | 4% (8/197) | 0% (1/746) | 62% (5085/8207) |

- **Connections on locals and parameters** (pattern A): 5300 (external 3776, resolved 814, ambiguous 537, likely 173). On names being declared: 696 (external 571, ambiguous 61, likely 48, resolved 16).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 49% (1787/3619).
- **Wrongly external**: 5782 of 57662 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 87% (31276/35799) counting files we indexed; 87% (31276/36008) counting every file. Found as resolved 28219, likely 1732, ambiguous 1325; 1888 not extracted as references at all.
- **Used by** of 1523 changed Symbols (124 not defined in SCIP at their name, not scored): precision 91% (6572/7220) (resolved 98% (6087/6201), likely 78% (311/400), ambiguous 28% (174/619)); recall 82% (6572/8005).
- Not scored: 412 uses with no SCIP occurrence; 155 changed files SCIP didn't index.

### legible

| Status | Precision (correct/uses) |
|---|---|
| resolved | 98% (19893/20317) |
| likely | 76% (1248/1635) |
| ambiguous (SCIP's target among candidates) | 76% (633/834) |
| external (SCIP has no definition) | 93% (28780/31075) |

| Kind | resolved | likely | ambiguous | external |
|---|---|---|---|---|
| calls | 97% (5411/5565) | 77% (1248/1628) | 76% (633/834) | 93% (20933/22577) |
| implements | 100% (21/21) | — | — | 100% (21/21) |
| read | 97% (8939/9209) | — | — | 94% (4303/4561) |
| references | 100% (5522/5522) | 0% (0/7) | — | 90% (3523/3916) |

- **Connections on locals and parameters** (pattern A): 1062 (external 527, resolved 352, ambiguous 137, likely 46). On names being declared: 94 (external 88, resolved 6).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 81% (633/779).
- **Wrongly external**: 1680 of 31075 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 92% (21757/23688) counting files we indexed; 91% (21757/23833) counting every file. Found as resolved 19893, likely 1231, ambiguous 633; 347 not extracted as references at all.
- **Used by** of 1436 changed Symbols (108 not defined in SCIP at their name, not scored): precision 90% (5599/6224) (resolved 98% (5315/5408), likely 56% (110/197), ambiguous 28% (174/619)); recall 86% (5599/6522).
- Not scored: 167 uses with no SCIP occurrence; 14 changed files SCIP didn't index.

### hono

| Status | Precision (correct/uses) |
|---|---|
| resolved | 94% (8582/9129) |
| likely | 69% (503/726) |
| ambiguous (SCIP's target among candidates) | 26% (1154/4362) |
| external (SCIP has no definition) | 71% (18753/26587) |

| Kind | resolved | likely | ambiguous | external |
|---|---|---|---|---|
| calls | 99% (2993/3036) | 92% (495/536) | 32% (1153/3616) | 78% (17103/22034) |
| implements | 100% (34/34) | — | — | 100% (4/4) |
| read | 79% (1802/2289) | — | — | 33% (84/258) |
| references | 100% (3753/3770) | 4% (8/190) | 0% (1/746) | 36% (1562/4291) |

- **Connections on locals and parameters** (pattern A): 4238 (external 3249, resolved 462, ambiguous 400, likely 127). On names being declared: 602 (external 483, ambiguous 61, likely 48, resolved 10).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 41% (1154/2840).
- **Wrongly external**: 4102 of 26587 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 79% (9519/12111) counting files we indexed; 78% (9519/12175) counting every file. Found as resolved 8326, ambiguous 692, likely 501; 1541 not extracted as references at all.
- **Used by** of 87 changed Symbols (16 not defined in SCIP at their name, not scored): precision 98% (973/996) (resolved 97% (772/793), likely 99% (201/203)); recall 66% (973/1483).
- Not scored: 245 uses with no SCIP occurrence; 141 changed files SCIP didn't index.

### Change Sets

| Change Set | Files | resolved | likely | Locals connected | Recall (indexed) | Used by |
|---|---|---|---|---|---|---|
| legible `6782c6ac` M3: Judge retries 429 and 5xx before falling back | 2 | 93% (326/350) | 100% (2/2) | 26 | 97% | 41% (25/61) |
| legible `d777c9f5` M3: evals load .env and stop on settings they would ignore | 4 | 100% (228/228) | 67% (4/6) | 4 | 91% | 100% (52/52) |
| legible `7f2a6285` Resizable side panels that remember their widths | 7 | 94% (949/1008) | 0% (0/14) | 124 | 87% | 97% (288/298) |
| legible `b4ef0746` M3: fix findings from an independent review | 21 | 98% (3659/3720) | 67% (215/322) | 198 | 88% | 79% (469/592) |
| legible `48e52bc4` M3: docs — ADR 0015, dogfooding, README privacy, engineering | 5 | 100% (74/74) | 0% (0/2) | 2 | 81% | 100% (4/4) |
| legible `340de6b3` M3: evals harness with six labeled cases | 63 | 100% (184/184) | 67% (2/3) | 3 | 90% | 86% (105/122) |
| legible `537007c1` M3: Change Brief, Walkthrough sidebar, Step view and editing | 17 | 96% (3056/3173) | 81% (193/238) | 270 | 86% | 93% (473/509) |
| legible `b727ad24` M3: Understanding service, agent host pipelines, ChatGPT sig | 20 | 99% (2445/2458) | 78% (255/328) | 89 | 96% | 90% (782/866) |
| legible `78c41ec6` M3: Intent, Walkthrough and Change Brief pipelines | 23 | 100% (1289/1289) | 85% (112/131) | 2 | 100% | 100% (517/517) |
| legible `3968d87c` M3: Fragment graph — dependencies, reach and test links for  | 7 | 100% (1267/1273) | 89% (32/36) | 18 | 95% | 97% (179/185) |
| legible `18b758a5` M3: packages/judge with TypeSafe Jev, OpenAI Decisions and f | 10 | 98% (405/415) | 9% (1/11) | 13 | 99% | 87% (228/262) |
| legible `33010da3` M3: domain types and storage for Intent, Walkthrough and Cha | 13 | 100% (918/918) | 67% (78/116) | 44 | 99% | 92% (479/522) |
| legible `3c517a82` M2: code structure — tree-sitter indexer, Symbols, Connectio | 85 | 97% (4787/4921) | 81% (286/352) | 269 | 93% | 89% (1998/2234) |
| legible `979f1837` Fix the macOS test failure that stopped the first release, a | 4 | 100% (306/306) | 92% (68/74) | 0 | 98% | — (0/0) |
| legible `74cc4eca` M1: desktop shell, diff viewer and Explanations (#2) | skipped: parent b5d1d5c1 not indexed: - . (missing tsconfig.json) | | | | | |
| hono `eb78ecaa` fix(utils/url): preserve encoded duplicate query order (#549 | 3 | 96% (472/492) | 47% (7/15) | 32 | 91% | 100% (4/4) |
| hono `06a45bc3` feat(bearer-auth): allow MessageFunction to return a Respons | 2 | 100% (194/194) | 0% (0/2) | 18 | 98% | 100% (108/108) |
| hono `5ca49b07` fix(css): Fix multiline CSS handling in style replacement (# | 2 | 96% (310/322) | — | 62 | 70% | 100% (38/38) |
| hono `e9c01079` fix(hono-base): disallow `getPath` when `strict` is `false`  | 3 | 97% (1781/1837) | 87% (26/30) | 2422 | 74% | 100% (25/25) |
| hono `08807ce1` fix(trie-router): keep first value for duplicate path params | 5 | 97% (1389/1425) | 91% (460/506) | 546 | 66% | 99% (344/346) |
| hono `e77c7c8e` fix(helper/route): match regex params in basePath() the same | 2 | 79% (153/193) | — | 40 | 73% | 100% (29/29) |
| hono `d54720da` fix(serve-static): respect q-values in Accept-Encoding for p | 2 | 74% (148/201) | — | 81 | 89% | 100% (41/41) |
| hono `ae401f08` fix(css): keep the descendant combinator before a pseudo-cla | 2 | 100% (336/336) | 0% (0/8) | 64 | 71% | 100% (8/8) |
| hono `2013fed5` fix(css): keep "//" inside an unquoted url() when minifying  | 2 | 100% (336/336) | 0% (0/8) | 64 | 72% | 100% (4/4) |
| hono `43379d93` fix(jsx): preserve self-closing void elements in cloneElemen | 2 | 99% (350/352) | 100% (2/2) | 46 | 92% | 100% (16/16) |
| hono `33622444` fix(build): keep barrel imports in the bundled `d.ts` (#5557 | 5 | 100% (26/26) | 0% (0/12) | 10 | 100% | — (0/0) |
| hono `588ec13f` fix(serve-static): only serve GET and HEAD requests (#5514) | 2 | 76% (139/184) | — | 72 | 91% | 100% (39/39) |
| hono `f78a245a` chore: unified oxfmt and oxlint config (#5518) | 3 | — | — | 0 | — | — (0/0) |
| hono `ae595de8` feat(mount): introduce Mount Middleware and deprecate `app.m | 5 | 91% (273/301) | — | 212 | 86% | 84% (43/51) |
| hono `f23b146a` fix(jsx): allow JSXNode function component results (#5476) | 2 | 99% (344/346) | 100% (2/2) | 46 | 92% | 100% (5/5) |
| hono `6d73a74f` docs(request): fix jsdoc comments for some getters (#5445) | 1 | 100% (96/96) | 0% (0/20) | 40 | 91% | 100% (104/104) |
| hono `deff5296` test(client): simulate network error for undefined route in  | 1 | 98% (162/166) | — | 4 | 98% | — (0/0) |
| hono `afb2068c` fix(combine): return a Response from a short-circuiting midd | 2 | 57% (164/290) | 0% (0/2) | 141 | 80% | 100% (20/20) |
| hono `e5bb2062` fix(jsx): add px to numeric gridGap, gridRowGap and gridColu | 2 | 100% (124/124) | — | 4 | 100% | 100% (56/56) |
| hono `c3053ccf` fix(etag): correctly match mixed-case header name in retaine | 2 | 88% (122/138) | 0% (0/8) | 18 | 82% | 79% (44/56) |
| hono `c437d756` test(build): type-check the bundled declarations from a cons | 6 | — | — | 0 | — | — (0/0) |
| hono `be1f7498` fix(build): keep internal types private in bundled d.ts and  | 11 | 99% (300/303) | 5% (2/42) | 44 | 92% | 0% (0/1) |
| hono `1e1207ca` test(serve-static): fix the test (#5479) | 1 | 67% (76/114) | — | 40 | 97% | — (0/0) |
| hono `8b05c774` Merge commit from fork | 2 | 80% (128/161) | 0% (0/2) | 59 | 94% | 100% (45/45) |
| hono `72f0d8d5` feat(adapters/netlify): publish to JSR (#5468) | 8 | — | — | 0 | — | — (0/0) |
| hono `645ddd6e` test: move adapter runtime tests into `adapters/*` (#5466) | 49 | — | — | 0 | — | — (0/0) |
| hono `1c6e060d` feat(adapters/deno): publish to JSR (#5465) | 10 | — | — | 0 | — | — (0/0) |
| hono `b877827f` feat(adapters): add the seven adapters as workspace packages | 101 | 97% (961/988) | 12% (2/17) | 137 | 93% | — (0/0) |
| hono `4d9f2a2e` chore(adapters/bun): ship ESM only (#5462) | 3 | — | — | 0 | — | — (0/0) |
| hono `fc2343db` feat(adapters): add @hono/bun as a workspace package (#5447) | 27 | 97% (198/204) | 4% (2/50) | 36 | 81% | — (0/0) |

## False positives, most frequent first

### likely

- packages/store/src/index.ts:204 execute (calls) → likely packages/agent-runtime/src/openai.ts:176 OpenAIAgentsRuntime.run.execute vs SCIP external (×116) · `b4ef0746`
- apps/desktop/src/main/understanding.ts:166 all (calls) → likely packages/store/src/sqlite.ts:28 Statement.all vs SCIP external (×51) · `b4ef0746`
- src/request.test.ts:5 T (references) → likely src/types.test.ts:697 T vs SCIP declaration (×48) · `eb78ecaa`
- packages/judge/src/fast.ts:39 describe (calls) → likely apps/desktop/src/main/hosts.ts:39 HostService.describe vs SCIP external (×37) · `b4ef0746`
- packages/store/src/index.ts:205 execute (calls) → likely packages/agent-runtime/src/openai.ts:182 OpenAIAgentsRuntime.run.execute vs SCIP external (×29) · `b4ef0746`
- packages/ui/src/review/BriefPage.tsx:163 label (calls) → likely packages/pipelines/test/pipelines.test.ts:280 label vs SCIP external (×28) · `b4ef0746`
- src/router/trie-router/node.ts:21 T (references) → likely src/types.test.ts:697 T vs SCIP local src/router/trie-router/node.ts:20 (×28) · `08807ce1`
- packages/store/src/index.ts:160 prepare (calls) → likely packages/store/src/sqlite.ts:53 NodeSqliteDatabase.prepare vs SCIP external (×12) · `b4ef0746`
- src/hono.test.ts:1412 redirect (calls) → likely src/client/types.ts:146 ClientResponse.redirect vs SCIP src/context.ts:767 (×10) · `e9c01079`
- src/helper/css/common.ts:63 Set (references) → likely src/context.ts:105 Set vs SCIP external (×10) · `ae401f08`
- packages/ui/src/review/BriefPage.tsx:68 header (calls) → likely packages/indexer/src/outline.ts:309 header vs SCIP external (×9) · `b4ef0746`
- packages/ui/src/state.ts:106 get (calls) → likely apps/desktop/src/main/secrets.ts:32 SecretStore.get vs SCIP local packages/ui/src/state.ts:80 (×9) · `3c517a82`
- src/adapter/cloudflare-workers/websocket.ts:43 Event (references) → likely src/jsx/types.ts:29 Event vs SCIP external (×9) · `b877827f`
- apps/desktop/e2e/app.spec.ts:257 move (calls) → likely packages/ui/src/diff/DiffView.tsx:231 DiffView.move vs SCIP external (×8) · `7f2a6285`
- src/jsx/base.ts:438 T (references) → likely src/types.test.ts:697 T vs SCIP local src/jsx/base.ts:437 (×8) · `be1f7498`
- src/jsx/base.ts:437 T (references) → likely src/types.test.ts:697 T vs SCIP local src/jsx/base.ts:436 (×8) · `be1f7498`
- apps/desktop/e2e/app.spec.ts:245 Text (references) → likely packages/indexer/src/changeSet.ts:65 Text vs SCIP external (×7) · `7f2a6285`
- packages/ui/src/review/BriefPage.tsx:216 p (calls) → likely packages/judge/src/http.ts:56 sane.p vs SCIP external (×7) · `b4ef0746`
- packages/ui/src/diff/DiffView.tsx:636 onSelect (calls) → likely packages/ui/src/diff/DiffView.tsx:326 RowProps.onSelect vs SCIP local packages/ui/src/diff/DiffView.tsx:384 (×6) · `537007c1`
- src/request.test.ts:640 clone (calls) → likely src/client/types.ts:147 ClientResponse.clone vs SCIP external (×6) · `eb78ecaa`

### resolved

- src/middleware/serve-static/index.test.ts:29 getContent (read) → resolved src/middleware/serve-static/index.test.ts:10 getContent vs SCIP local src/middleware/serve-static/index.test.ts:21 (×160) · `d54720da`
- src/hono.test.ts:15 getPath (read) → resolved src/hono.test.ts:648 getPath vs SCIP src/utils/url.ts:106 (×30) · `e9c01079`
- packages/ui/src/state.ts:128 set (calls) → resolved packages/ui/src/state.ts:135 useUI.set vs SCIP local packages/ui/src/state.ts:95 (×22) · `7f2a6285`
- packages/ui/src/state.ts:117 set (calls) → resolved packages/ui/src/state.ts:124 useUI.set vs SCIP local packages/ui/src/state.ts:87 (×22) · `537007c1`
- packages/ui/src/review/BriefPage.tsx:93 step (read) → resolved packages/ui/src/review/BriefPage.tsx:370 BriefPage.step vs SCIP local packages/ui/src/review/BriefPage.tsx:79 (×15) · `b4ef0746`
- packages/git/src/repo.ts:287 tree (read) → resolved packages/git/src/repo.ts:464 GitRepo.grepWords.tree vs SCIP local packages/git/src/repo.ts:285 (×15) · `b727ad24`
- packages/ui/src/state.ts:141 set (calls) → resolved packages/ui/src/state.ts:148 useUI.set vs SCIP local packages/ui/src/state.ts:107 (×12) · `7f2a6285`
- packages/ui/src/state.ts:108 set (calls) → resolved packages/ui/src/state.ts:115 useUI.set vs SCIP local packages/ui/src/state.ts:80 (×11) · `3c517a82`
- src/hono.test.ts:15 getPath (read) → resolved src/hono.test.ts:649 getPath vs SCIP src/utils/url.ts:106 (×10) · `e9c01079`
- packages/ui/src/views/Settings.tsx:478 update (calls) → resolved packages/ui/src/views/Settings.tsx:96 SettingsView.update vs SCIP local packages/ui/src/views/Settings.tsx:466 (×9) · `537007c1`
- packages/ui/src/diff/DiffView.tsx:824 off (read) → resolved packages/ui/src/diff/DiffView.tsx:154 DiffView.off vs SCIP local packages/ui/src/diff/DiffView.tsx:823 (×8) · `537007c1`
- packages/pipelines/src/explanations.ts:229 status (read) → resolved packages/pipelines/src/explanations.ts:324 describeConnections.status vs SCIP local packages/pipelines/src/explanations.ts:225 (×8) · `18b758a5`
- src/helper/route/index.test.ts:87 handlerA (read) → resolved src/helper/route/index.test.ts:16 handlerA vs SCIP local src/helper/route/index.test.ts:79 (×8) · `e77c7c8e`
- packages/ui/src/views/Settings.tsx:450 update (calls) → resolved packages/ui/src/views/Settings.tsx:70 SettingsView.update vs SCIP local packages/ui/src/views/Settings.tsx:438 (×7) · `537007c1`
- packages/ui/src/views/Review.tsx:1118 commands (read) → resolved packages/ui/src/views/Review.tsx:1149 ReviewView.commands vs SCIP local packages/ui/src/views/Review.tsx:923 (×6) · `7f2a6285`
- packages/ui/src/views/Review.tsx:1114 commands (read) → resolved packages/ui/src/views/Review.tsx:1145 ReviewView.commands vs SCIP local packages/ui/src/views/Review.tsx:919 (×6) · `b4ef0746`
- packages/ui/src/views/Review.tsx:815 commands (read) → resolved packages/ui/src/views/Review.tsx:846 ReviewView.commands vs SCIP local packages/ui/src/views/Review.tsx:668 (×6) · `537007c1`
- apps/desktop/src/main/indexerCore.ts:17 buildChangeSet (read) → resolved apps/desktop/src/main/indexerCore.ts:154 createIndexer.buildChangeSet vs SCIP packages/indexer/src/changeSet.ts:154 (×6) · `3968d87c`
- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:12 nextVersion vs SCIP external (×6) · `3c517a82`
- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:16 nextVersion vs SCIP external (×6) · `3c517a82`

### used by

- apps/desktop/src/main/agentHostCore.ts:258 used by → ambiguous post vs SCIP src/main/`agentHostCore.ts`/createAgentHost().(post) (×24) · `6782c6ac`
- packages/judge/test/judge.test.ts:90 used by → ambiguous FastTierBackend.judge vs SCIP src/`http.ts`/JevBackend#judge(). (×19) · `b4ef0746`
- packages/store/src/sqlite.ts:58 used by → likely DB vs SCIP src/`sqlite.ts`/createKysely().[DB] (×18) · `b4ef0746`
- packages/judge/test/judge.test.ts:58 used by → resolved sequenceFetch.calls vs SCIP local (×14) · `6782c6ac`
- packages/agent-runtime/test/openai.test.ts:104 used by → ambiguous UnderstandingService.run vs SCIP src/`openai.ts`/OpenAIAgentsRuntime#run(). (×13) · `b4ef0746`
- packages/judge/test/judge.test.ts:155 used by → ambiguous JevBackend.judge vs SCIP src/`http.ts`/DecisionsBackend#judge(). (×13) · `b4ef0746`
- packages/judge/test/judge.test.ts:90 used by → ambiguous DecisionsBackend.judge vs SCIP src/`http.ts`/JevBackend#judge(). (×12) · `b4ef0746`
- src/middleware/etag/index.ts:35 used by → resolved etag vs SCIP src/middleware/etag/`index.ts`/etagMatches().(etag) (×12) · `c3053ccf`
- packages/ui/src/state.ts:115 used by → ambiguous serveIndexer.get vs SCIP local (×9) · `3c517a82`
- packages/ui/src/state.ts:115 used by → ambiguous ParseCache.get vs SCIP local (×9) · `3c517a82`
- packages/ui/src/state.ts:115 used by → ambiguous Grammars.get vs SCIP local (×9) · `3c517a82`
- packages/ui/src/views/Settings.tsx:288 used by → likely sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×8) · `b4ef0746`
- apps/desktop/src/main/agentHostCore.ts:161 used by → ambiguous IndexerTransport.post vs SCIP src/main/`agentHostCore.ts`/createAgentHost().(post) (×8) · `3c517a82`
- packages/indexer/src/resolve.ts:115 used by → resolved createResolver.c vs SCIP local (×8) · `3c517a82`
- src/middleware/mount/index.test.ts:146 used by → resolved anotherApp vs SCIP local (×8) · `ae595de8`
- apps/desktop/test/understanding.test.ts:91 used by → ambiguous OpenAIAgentsRuntime.run vs SCIP src/main/`understanding.ts`/UnderstandingService#run(). (×7) · `b4ef0746`
- packages/ui/src/review/ConnectionsPanel.tsx:205 used by → likely sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×7) · `b4ef0746`
- apps/desktop/src/main/indexerCore.ts:229 used by → ambiguous post vs SCIP src/main/`indexerCore.ts`/serveIndexer().(post) (×6) · `6782c6ac`
- apps/desktop/src/main/index.ts:317 used by → ambiguous UnderstandingService.status vs SCIP src/main/`agentHostClient.ts`/AgentHostClient#status(). (×6) · `b4ef0746`
- packages/ui/src/review/BriefPage.tsx:216 used by → likely sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×6) · `b4ef0746`

### wrongly external

- src/hono.test.ts:77 request (calls) → external vs SCIP src/hono-base.ts:503 (×859) · `e9c01079`
- src/hono.test.ts:55 get (calls) → external vs SCIP src/hono-base.ts:104 (×752) · `e9c01079`
- src/middleware/bearer-auth/index.test.ts:447 request (calls) → external vs SCIP src/hono-base.ts:518 (×336) · `06a45bc3`
- src/middleware/bearer-auth/index.test.ts:23 get (calls) → external vs SCIP src/hono-base.ts:119 (×270) · `06a45bc3`
- src/hono-base.ts:399 add (calls) → external vs SCIP src/router.ts:42 (×254) · `e9c01079`
- packages/ui/src/views/Review.tsx:78 call (calls) → external vs SCIP packages/ui/src/client.ts:24 (×237) · `7f2a6285`
- src/middleware/combine/index.test.ts:22 request (calls) → external vs SCIP src/hono-base.ts:501 (×211) · `afb2068c`
- packages/ui/src/views/Review.tsx:1197 Button (calls) → external vs SCIP packages/ui/src/components/ui.tsx:57 (×197) · `7f2a6285`
- packages/ui/src/views/Review.tsx:249 set (calls) → external vs SCIP packages/ui/src/state.ts:78 (×184) · `7f2a6285`
- src/helper/css/index.test.tsx:51 css (calls) → external vs SCIP src/helper/css/index.ts:234 (×124) · `5ca49b07`
- src/helper/css/index.test.tsx:88 h1 (calls) → external vs SCIP src/jsx/intrinsic-elements.ts:844 (×109) · `5ca49b07`
- src/helper/factory/index.ts:14 IntersectNonAnyTypes (read) → external vs SCIP src/types.ts:2767 (×92) · `e9c01079`
- src/hono.test.ts:2030 on (calls) → external vs SCIP src/hono-base.ts:112 (×83) · `e9c01079`
- src/helper/css/index.test.tsx:54 Style (calls) → external vs SCIP src/helper/css/index.ts:262 (×79) · `5ca49b07`
- packages/ui/src/App.tsx:46 set (calls) → external vs SCIP packages/ui/src/state.ts:70 (×71) · `537007c1`
- src/helper/css/index.test.tsx:177 div (calls) → external vs SCIP src/jsx/intrinsic-elements.ts:834 (×57) · `5ca49b07`
- src/helper/css/index.test.tsx:590 body (calls) → external vs SCIP src/context.ts:681 (×50) · `5ca49b07`
- evals/src/run.ts:44 PlannerOutput (read) → external vs SCIP packages/pipelines/src/walkthrough/planner.ts:21 (×48) · `d777c9f5`
- src/helper/css/index.test.tsx:88 cx (calls) → external vs SCIP src/helper/css/index.ts:241 (×48) · `5ca49b07`
- src/hono.test.ts:2479 set (calls) → external vs SCIP src/context.ts:550 (×48) · `e9c01079`

### locals

- src/middleware/bearer-auth/index.ts:49 E (references) → ambiguous src/types.test.ts:31 E vs SCIP local src/middleware/bearer-auth/index.ts:22 (×323) · `06a45bc3`
- apps/desktop/src/main/agentHostCore.ts:171 P (references) → external P vs SCIP local apps/desktop/src/main/agentHostCore.ts:170 (×286) · `b4ef0746`
- src/middleware/bearer-auth/index.test.ts:21 next (calls) → external next vs SCIP local src/middleware/bearer-auth/index.test.ts:19 (×227) · `06a45bc3`
- evals/src/run.ts:193 T (references) → external T vs SCIP local evals/src/run.ts:193 (×174) · `d777c9f5`
- src/middleware/serve-static/index.test.ts:29 getContent (read) → resolved src/middleware/serve-static/index.test.ts:10 getContent vs SCIP local src/middleware/serve-static/index.test.ts:21 (×160) · `d54720da`
- src/hono.test.ts:3144 echo (calls) → external echo vs SCIP local src/hono.test.ts:3036 (×148) · `e9c01079`
- src/helper/factory/index.ts:22 I (references) → external I vs SCIP local src/helper/factory/index.ts:21 (×144) · `e9c01079`
- src/hono.test.ts:3148 echo2 (calls) → external echo2 vs SCIP local src/hono.test.ts:3047 (×132) · `e9c01079`
- src/helper/factory/index.ts:22 E2 (references) → external E2 vs SCIP local src/helper/factory/index.ts:21 (×130) · `e9c01079`
- src/hono.test.ts:3152 echo3 (calls) → external echo3 vs SCIP local src/hono.test.ts:3058 (×116) · `e9c01079`
- src/request.test.ts:6 T (references) → likely src/types.test.ts:697 T vs SCIP local src/request.test.ts:5 (×115) · `eb78ecaa`
- src/helper/factory/index.ts:35 E3 (references) → external E3 vs SCIP local src/helper/factory/index.ts:32 (×108) · `e9c01079`
- src/helper/factory/index.ts:35 I2 (references) → external I2 vs SCIP local src/helper/factory/index.ts:28 (×108) · `e9c01079`
- src/hono.test.ts:3157 echo4 (calls) → external echo4 vs SCIP local src/hono.test.ts:3069 (×100) · `e9c01079`
- src/hono-base.ts:102 BasePath (references) → external BasePath vs SCIP local src/hono-base.ts:101 (×94) · `e9c01079`
- src/helper/factory/index.ts:52 E4 (references) → external E4 vs SCIP local src/helper/factory/index.ts:48 (×88) · `e9c01079`
- src/helper/factory/index.ts:52 I3 (references) → external I3 vs SCIP local src/helper/factory/index.ts:42 (×88) · `e9c01079`
- src/hono.test.ts:3167 echo5 (calls) → external echo5 vs SCIP local src/hono.test.ts:3080 (×84) · `e9c01079`
- src/hono-base.ts:104 S (references) → external S vs SCIP local src/hono-base.ts:100 (×82) · `e9c01079`
- apps/desktop/src/main/changeSet.ts:122 R (references) → external R vs SCIP local apps/desktop/src/main/changeSet.ts:119 (×78) · `3c517a82`

