## Connections against SCIP · TypeScript · scip-nodeps-fields · 2026-10-28

scip-typescript 0.5.2. **legible** (this repository): 14 Change Sets scored, 1 skipped; **hono** (https://github.com/honojs/hono@bac5c4a8bcd7): 30 Change Sets scored, 0 skipped. Preparing indexes took 1s, scoring 26s.

### All

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (49846/49868) |
| likely | 0% (0/50) |
| possible | 0% (0/315) |
| ambiguous (SCIP's target among candidates) | 65% (2801/4330) |
| external (SCIP has no definition) | 98% (48178/49091) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 100% (17081/17099) | 0% (0/48) | 0% (0/291) | 36% (667/1837) | 99% (38017/38341) |
| implements | 100% (55/55) | — | — | — | 100% (25/25) |
| read | 100% (24309/24313) | — | — | 100% (1046/1046) | 99% (5051/5108) |
| references | 100% (8401/8401) | 0% (0/2) | 0% (0/24) | 75% (1088/1447) | 91% (5085/5617) |

- **Connections on locals and parameters** (pattern A): 0 (none). On names being declared: 339 (external 337, ambiguous 2).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 100% (2801/2801).
- **Wrongly external**: 576 of 49091 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 82% (52296/64131) counting files we indexed; 82% (52605/64535) counting every file. Found as resolved 49804, ambiguous 2801; 9528 not extracted as references at all.
- **Used by** of 2091 changed Symbols (124 not defined in SCIP at their name, not scored): precision 99% (10307/10377) (resolved 100% (10292/10292), likely 75% (3/4), possible 0% (0/43), ambiguous 32% (12/38)); recall 96% (10307/10790).
- Not scored: 1629 uses with no SCIP occurrence; 155 changed files SCIP didn't index.

### legible

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (32242/32260) |
| likely | 0% (0/44) |
| possible | 0% (0/292) |
| ambiguous (SCIP's target among candidates) | 98% (2233/2280) |
| external (SCIP has no definition) | 99% (29377/29696) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 100% (7993/8007) | 0% (0/44) | 0% (0/285) | 87% (305/352) | 99% (20937/21255) |
| implements | 100% (21/21) | — | — | — | 100% (21/21) |
| read | 100% (19668/19672) | — | — | 100% (840/840) | 100% (4896/4896) |
| references | 100% (4560/4560) | — | 0% (0/7) | 100% (1088/1088) | 100% (3523/3524) |

- **Connections on locals and parameters** (pattern A): 0 (none). On names being declared: 0 (none).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 100% (2233/2233).
- **Wrongly external**: 319 of 29696 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 76% (34302/44912) counting files we indexed; 76% (34475/45156) counting every file. Found as resolved 32242, ambiguous 2233; 8303 not extracted as references at all.
- **Used by** of 2000 changed Symbols (108 not defined in SCIP at their name, not scored): precision 99% (9001/9071) (resolved 100% (8986/8986), likely 75% (3/4), possible 0% (0/43), ambiguous 32% (12/38)); recall 97% (9001/9281).
- Not scored: 1288 uses with no SCIP occurrence; 14 changed files SCIP didn't index.

### hono

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (17604/17608) |
| likely | 0% (0/6) |
| possible | 0% (0/23) |
| ambiguous (SCIP's target among candidates) | 28% (568/2050) |
| external (SCIP has no definition) | 97% (18801/19395) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 100% (9088/9092) | 0% (0/4) | 0% (0/6) | 24% (362/1485) | 100% (17080/17086) |
| implements | 100% (34/34) | — | — | — | 100% (4/4) |
| read | 100% (4641/4641) | — | — | 100% (206/206) | 73% (155/212) |
| references | 100% (3841/3841) | 0% (0/2) | 0% (0/17) | 0% (0/359) | 75% (1562/2093) |

- **Connections on locals and parameters** (pattern A): 0 (none). On names being declared: 339 (external 337, ambiguous 2).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 100% (568/568).
- **Wrongly external**: 257 of 19395 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 94% (17994/19219) counting files we indexed; 94% (18130/19379) counting every file. Found as resolved 17562, ambiguous 568; 1225 not extracted as references at all.
- **Used by** of 91 changed Symbols (16 not defined in SCIP at their name, not scored): precision 100% (1306/1306) (resolved 100% (1306/1306)); recall 87% (1306/1509).
- Not scored: 341 uses with no SCIP occurrence; 141 changed files SCIP didn't index.

### Change Sets

| Change Set | Files | resolved | likely | Locals connected | Recall (indexed) | Used by |
|---|---|---|---|---|---|---|
| legible `6782c6ac` M3: Judge retries 429 and 5xx before falling back | 2 | 100% (426/426) | — | 0 | 89% | 100% (28/28) |
| legible `d777c9f5` M3: evals load .env and stop on settings they would ignore | 4 | 100% (440/440) | — | 0 | 82% | 100% (59/59) |
| legible `7f2a6285` Resizable side panels that remember their widths | 7 | 100% (1181/1181) | — | 0 | 52% | 97% (326/336) |
| legible `b4ef0746` M3: fix findings from an independent review | 21 | 100% (6753/6753) | 0% (0/16) | 0 | 76% | 96% (615/643) |
| legible `48e52bc4` M3: docs — ADR 0015, dogfooding, README privacy, engineering | 5 | 100% (112/112) | — | 0 | 48% | 100% (4/4) |
| legible `340de6b3` M3: evals harness with six labeled cases | 63 | 100% (376/376) | — | 0 | 81% | 100% (246/246) |
| legible `537007c1` M3: Change Brief, Walkthrough sidebar, Step view and editing | 17 | 100% (5059/5059) | 0% (0/4) | 0 | 75% | 100% (545/545) |
| legible `b727ad24` M3: Understanding service, agent host pipelines, ChatGPT sig | 20 | 100% (3650/3650) | 0% (0/8) | 0 | 81% | 100% (983/984) |
| legible `78c41ec6` M3: Intent, Walkthrough and Change Brief pipelines | 23 | 100% (1930/1930) | 0% (0/2) | 0 | 74% | 100% (1009/1009) |
| legible `3968d87c` M3: Fragment graph — dependencies, reach and test links for  | 7 | 100% (2248/2248) | — | 0 | 86% | 100% (297/297) |
| legible `18b758a5` M3: packages/judge with TypeSafe Jev, OpenAI Decisions and f | 10 | 100% (673/673) | — | 0 | 83% | 100% (445/445) |
| legible `33010da3` M3: domain types and storage for Intent, Walkthrough and Cha | 13 | 100% (1226/1226) | 0% (0/9) | 0 | 74% | 100% (639/639) |
| legible `3c517a82` M2: code structure — tree-sitter indexer, Symbols, Connectio | 85 | 100% (7786/7804) | 0% (0/5) | 0 | 77% | 99% (3805/3836) |
| legible `979f1837` Fix the macOS test failure that stopped the first release, a | 4 | 100% (382/382) | — | 0 | 100% | — (0/0) |
| legible `74cc4eca` M1: desktop shell, diff viewer and Explanations (#2) | skipped: parent b5d1d5c1 not indexed: - . (missing tsconfig.json) | | | | | |
| hono `eb78ecaa` fix(utils/url): preserve encoded duplicate query order (#549 | 3 | 99% (678/682) | — | 0 | 95% | 100% (4/4) |
| hono `06a45bc3` feat(bearer-auth): allow MessageFunction to return a Respons | 2 | 100% (524/524) | — | 0 | 91% | 100% (108/108) |
| hono `5ca49b07` fix(css): Fix multiline CSS handling in style replacement (# | 2 | 100% (577/577) | — | 0 | 82% | 100% (38/38) |
| hono `e9c01079` fix(hono-base): disallow `getPath` when `strict` is `false`  | 3 | 100% (4272/4272) | — | 0 | 98% | 100% (49/49) |
| hono `08807ce1` fix(trie-router): keep first value for duplicate path params | 5 | 100% (4257/4257) | — | 0 | 98% | 100% (350/350) |
| hono `e77c7c8e` fix(helper/route): match regex params in basePath() the same | 2 | 100% (253/253) | — | 0 | 66% | 100% (29/29) |
| hono `d54720da` fix(serve-static): respect q-values in Accept-Encoding for p | 2 | 100% (328/328) | — | 0 | 89% | 100% (47/47) |
| hono `ae401f08` fix(css): keep the descendant combinator before a pseudo-cla | 2 | 100% (597/597) | — | 0 | 84% | 100% (8/8) |
| hono `2013fed5` fix(css): keep "//" inside an unquoted url() when minifying  | 2 | 100% (595/595) | — | 0 | 84% | 100% (4/4) |
| hono `43379d93` fix(jsx): preserve self-closing void elements in cloneElemen | 2 | 100% (487/487) | — | 0 | 99% | 100% (16/16) |
| hono `33622444` fix(build): keep barrel imports in the bundled `d.ts` (#5557 | 5 | 100% (32/32) | — | 0 | 100% | — (0/0) |
| hono `588ec13f` fix(serve-static): only serve GET and HEAD requests (#5514) | 2 | 100% (304/304) | — | 0 | 90% | 100% (45/45) |
| hono `f78a245a` chore: unified oxfmt and oxlint config (#5518) | 3 | — | — | 0 | — | — (0/0) |
| hono `ae595de8` feat(mount): introduce Mount Middleware and deprecate `app.m | 5 | 100% (420/420) | — | 0 | 86% | 100% (324/324) |
| hono `f23b146a` fix(jsx): allow JSXNode function component results (#5476) | 2 | 100% (474/474) | — | 0 | 99% | 100% (5/5) |
| hono `6d73a74f` docs(request): fix jsdoc comments for some getters (#5445) | 1 | 100% (152/152) | — | 0 | 79% | 100% (104/104) |
| hono `deff5296` test(client): simulate network error for undefined route in  | 1 | 100% (216/216) | — | 0 | 100% | — (0/0) |
| hono `afb2068c` fix(combine): return a Response from a short-circuiting midd | 2 | 100% (401/401) | — | 0 | 100% | 100% (20/20) |
| hono `e5bb2062` fix(jsx): add px to numeric gridGap, gridRowGap and gridColu | 2 | 100% (124/124) | — | 0 | 100% | 100% (56/56) |
| hono `c3053ccf` fix(etag): correctly match mixed-case header name in retaine | 2 | 100% (374/374) | 0% (0/4) | 0 | 97% | 100% (44/44) |
| hono `c437d756` test(build): type-check the bundled declarations from a cons | 6 | — | — | 0 | — | — (0/0) |
| hono `be1f7498` fix(build): keep internal types private in bundled d.ts and  | 11 | 100% (391/391) | — | 0 | 98% | — (0/0) |
| hono `1e1207ca` test(serve-static): fix the test (#5479) | 1 | 100% (178/178) | — | 0 | 74% | — (0/0) |
| hono `8b05c774` Merge commit from fork | 2 | 100% (270/270) | 0% (0/2) | 0 | 90% | 100% (55/55) |
| hono `72f0d8d5` feat(adapters/netlify): publish to JSR (#5468) | 8 | — | — | 0 | — | — (0/0) |
| hono `645ddd6e` test: move adapter runtime tests into `adapters/*` (#5466) | 49 | — | — | 0 | — | — (0/0) |
| hono `1c6e060d` feat(adapters/deno): publish to JSR (#5465) | 10 | — | — | 0 | — | — (0/0) |
| hono `b877827f` feat(adapters): add the seven adapters as workspace packages | 101 | 100% (1403/1403) | — | 0 | 92% | — (0/0) |
| hono `4d9f2a2e` chore(adapters/bun): ship ESM only (#5462) | 3 | — | — | 0 | — | — (0/0) |
| hono `fc2343db` feat(adapters): add @hono/bun as a workspace package (#5447) | 27 | 100% (297/297) | — | 0 | 88% | — (0/0) |

## False positives, most frequent first

### likely

- apps/desktop/src/main/understanding.ts:166 all (calls) → likely packages/store/src/sqlite.ts:28 Statement.all vs SCIP external (×22) · `b4ef0746`
- packages/store/src/index.ts:160 prepare (calls) → likely packages/store/src/sqlite.ts:53 NodeSqliteDatabase.prepare vs SCIP external (×12) · `b4ef0746`
- src/middleware/etag/index.test.ts:37 digest (calls) → likely src/middleware/etag/digest.ts:30 generateDigest.digest vs SCIP external (×4) · `c3053ccf`
- packages/agent-runtime/src/openai.ts:69 getResponse (calls) → likely packages/agent-runtime/src/openai.ts:67 MeteredModel.getResponse vs SCIP external (×2) · `b4ef0746`
- packages/agent-runtime/src/openai.ts:76 getStreamedResponse (calls) → likely packages/agent-runtime/src/openai.ts:74 MeteredModel.getStreamedResponse vs SCIP external (×2) · `b4ef0746`
- packages/agent-runtime/src/openai.ts:87 getModel (calls) → likely packages/agent-runtime/src/openai.ts:86 MeteredProvider.getModel vs SCIP external (×2) · `b4ef0746`
- src/middleware/serve-static/index.ts:97 Set (references) → likely src/context.ts:105 Set vs SCIP external (×2) · `8b05c774`
- packages/agent-runtime/src/openai.ts:73 getResponse (calls) → likely packages/agent-runtime/src/openai.ts:71 MeteredModel.getResponse vs SCIP external · `b4ef0746`
- packages/agent-runtime/src/openai.ts:80 getStreamedResponse (calls) → likely packages/agent-runtime/src/openai.ts:78 MeteredModel.getStreamedResponse vs SCIP external · `b4ef0746`
- packages/agent-runtime/src/openai.ts:91 getModel (calls) → likely packages/agent-runtime/src/openai.ts:90 MeteredProvider.getModel vs SCIP external · `b4ef0746`
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
- apps/desktop/e2e/app.spec.ts:258 down (calls) → possible packages/ui/src/views/Review.tsx:1138 ReviewView.down vs SCIP external (×3) · `7f2a6285`
- packages/agent-runtime/src/openai.ts:314 list (calls) → possible apps/desktop/src/main/explanations.ts:405 ExplanationService.list vs SCIP external (×2) · `b4ef0746`
- apps/desktop/e2e/app.spec.ts:202 move (calls) → possible packages/ui/src/diff/DiffView.tsx:229 DiffView.move vs SCIP external (×2) · `537007c1`
- packages/ui/src/panels.ts:41 getItem (calls) → possible packages/ui/test/panels.test.ts:15 memory.getItem vs SCIP external · `7f2a6285`
- packages/ui/src/panels.ts:57 setItem (calls) → possible packages/ui/test/panels.test.ts:16 memory.setItem vs SCIP external · `7f2a6285`

### resolved

- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:12 nextVersion vs SCIP external (×6) · `3c517a82`
- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:16 nextVersion vs SCIP external (×6) · `3c517a82`
- apps/desktop/test/version.test.ts:6 prereleaseVersion (read) → resolved apps/desktop/scripts/version.mjs:31 prereleaseVersion vs SCIP external (×4) · `3c517a82`
- src/request.test.ts:643 formData (calls) → resolved src/request.ts:334 HonoRequest.formData vs SCIP external (×4) · `eb78ecaa`
- apps/desktop/electron.vite.config.ts:8 bundleFiles (read) → resolved packages/indexer/grammars/bundle.mjs:44 bundleFiles vs SCIP external (×2) · `3c517a82`

### used by

- packages/ui/src/views/Settings.tsx:288 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×8) · `b4ef0746`
- packages/ui/src/review/ConnectionsPanel.tsx:205 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×7) · `b4ef0746`
- packages/ui/src/review/BriefPage.tsx:216 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×6) · `b4ef0746`
- packages/ui/src/review/ExplainPanel.tsx:93 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. (×6) · `b4ef0746`
- packages/ui/src/App.tsx:73 used by → ambiguous createResolver.go vs SCIP src/`state.ts`/UIState#go(). (×5) · `3c517a82`
- packages/ui/src/views/Review.tsx:812 used by → ambiguous createResolver.go vs SCIP src/`state.ts`/UIState#go(). (×4) · `3c517a82`
- packages/git/src/run.ts:89 used by → possible ResizeHandle.end vs SCIP `stream.d.ts`/`"stream"`/Stream/Writable#end(). (×2) · `7f2a6285`
- apps/desktop/src/main/chatgpt.ts:180 used by → possible ResizeHandle.end vs SCIP `stream.d.ts`/`"stream"`/Stream/Writable#end(). (×2) · `7f2a6285`
- apps/desktop/src/main/index.ts:207 used by → ambiguous IndexerTransport.kill vs SCIP `electron.d.ts`/Electron/UtilityProcess#kill(). (×2) · `3c517a82`
- apps/desktop/e2e/app.spec.ts:203 used by → possible ReviewView.down vs SCIP types/`types.d.ts`/Keyboard#down(). (×2) · `3c517a82`
- apps/desktop/e2e/app.spec.ts:205 used by → ambiguous ReviewView.up vs SCIP types/`types.d.ts`/Mouse#up(). (×2) · `3c517a82`
- apps/desktop/e2e/errorReports.spec.ts:59 used by → possible ResizeHandle.end vs SCIP `stream.d.ts`/`"stream"`/Stream/Writable#end(). · `7f2a6285`
- packages/git/src/catFile.ts:51 used by → possible ResizeHandle.end vs SCIP `stream.d.ts`/`"stream"`/Stream/Writable#end(). · `7f2a6285`
- packages/ui/src/panels.ts:41 used by → possible memory.getItem vs SCIP lib/`lib.dom.d.ts`/Storage#getItem(). · `7f2a6285`
- evals/cases/two-features-ts/head/client/theme.ts:6 used by → possible memory.getItem vs SCIP nothing · `7f2a6285`
- packages/ui/src/panels.ts:57 used by → possible memory.setItem vs SCIP lib/`lib.dom.d.ts`/Storage#setItem(). · `7f2a6285`
- evals/cases/two-features-ts/head/client/theme.ts:11 used by → possible memory.setItem vs SCIP nothing · `7f2a6285`
- packages/ui/src/review/StepHeader.tsx:176 used by → possible sane.p vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#p. · `b4ef0746`
- packages/ui/src/views/Review.tsx:830 used by → ambiguous ChatGPTAuth.current vs SCIP `index.d.ts`/React/RefObject#current. · `b727ad24`
- packages/ui/src/review/ConnectionsPanel.tsx:327 used by → ambiguous ExplanationService.code vs SCIP `index.d.ts`/React/JSX/IntrinsicElements#code. · `3c517a82`

### wrongly external

- packages/ui/src/views/Review.tsx:249 set (calls) → external vs SCIP packages/ui/src/state.ts:78 (×184) · `7f2a6285`
- src/helper/factory/index.ts:14 IntersectNonAnyTypes (read) → external vs SCIP src/types.ts:2767 (×92) · `e9c01079`
- packages/ui/src/App.tsx:46 set (calls) → external vs SCIP packages/ui/src/state.ts:70 (×71) · `537007c1`
- src/hono-base.ts:26 Schema (read) → external vs SCIP src/types.ts:2531 (×43) · `e9c01079`
- packages/ui/src/views/Review.tsx:262 set (calls) → external vs SCIP packages/ui/src/state.ts:88 (×40) · `7f2a6285`
- packages/ui/src/diff/DiffView.tsx:156 set (calls) → external vs SCIP packages/ui/src/state.ts:63 (×23) · `3c517a82`
- src/hono-base.ts:18 MergePath (read) → external vs SCIP src/types.ts:2614 (×16) · `e9c01079`
- src/hono-base.ts:15 FetchEventLike (read) → external vs SCIP src/types.ts:2777 (×12) · `e9c01079`
- src/hono.test.ts:304 RegExpRouter (references) → external vs SCIP src/router/reg-exp-router/router.ts:54 (×12) · `e9c01079`
- src/request.ts:9 ParamKeys (read) → external vs SCIP src/types.ts:2710 (×12) · `6d73a74f`
- src/request.ts:12 ValidationTargets (read) → external vs SCIP src/types.ts:2687 (×10) · `6d73a74f`
- src/hono-base.ts:19 MergeSchemaPath (read) → external vs SCIP src/types.ts:2563 (×8) · `e9c01079`
- src/hono-base.ts:21 MiddlewareHandlerInterface (read) → external vs SCIP src/types.ts:1080 (×8) · `e9c01079`
- src/hono-base.ts:24 OnHandlerInterface (read) → external vs SCIP src/types.ts:1457 (×8) · `e9c01079`
- src/hono-base.ts:544 request (read) → external vs SCIP src/types.ts:2778 (×8) · `e9c01079`
- src/helper/css/index.test.tsx:566 Hono (references) → external vs SCIP src/hono.ts:26 (×6) · `5ca49b07`
- src/request.ts:10 RemoveQuestion (read) → external vs SCIP src/types.ts:2733 (×6) · `6d73a74f`
- src/hono-base.ts:544 respondWith (calls) → external vs SCIP src/types.ts:2779 (×4) · `e9c01079`
- src/request.ts:7 InputToDataByTarget (read) → external vs SCIP src/types.ts:2724 (×4) · `6d73a74f`
- src/request.ts:8 ParamKeyToRecord (read) → external vs SCIP src/types.ts:2714 (×4) · `6d73a74f`

### locals

None.

