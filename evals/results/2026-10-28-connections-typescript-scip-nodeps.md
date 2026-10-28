## Connections against SCIP · TypeScript · scip-nodeps · 2026-10-28

scip-typescript 0.5.2. **legible** (this repository): 14 Change Sets scored, 1 skipped; **hono** (https://github.com/honojs/hono@bac5c4a8bcd7): 30 Change Sets scored, 0 skipped. Preparing indexes took 1s, scoring 25s.

### All

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (31704/31734) |
| likely | 3% (2/62) |
| possible | 4% (13/336) |
| ambiguous (SCIP's target among candidates) | 49% (2662/5451) |
| external (SCIP has no definition) | 92% (47537/51439) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 100% (12688/12706) | 3% (2/60) | 4% (13/312) | 24% (764/3194) | 92% (38040/41344) |
| implements | 100% (55/55) | — | — | — | 100% (25/25) |
| read | 100% (10560/10572) | — | — | 100% (810/810) | 99% (4387/4453) |
| references | 100% (8401/8401) | 0% (0/2) | 0% (0/24) | 75% (1088/1447) | 91% (5085/5617) |

- **Connections on locals and parameters** (pattern A): 0 (none). On names being declared: 339 (external 337, ambiguous 2).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 67% (2662/3945).
- **Wrongly external**: 3565 of 51439 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 94% (33552/35785) counting files we indexed; 94% (33756/36008) counting every file. Found as resolved 31191, ambiguous 2565; 1901 not extracted as references at all.
- **Used by** of 1523 changed Symbols (124 not defined in SCIP at their name, not scored): precision 99% (7648/7718) (resolved 100% (7633/7633), likely 75% (3/4), possible 0% (0/43), ambiguous 32% (12/38)); recall 96% (7648/8005).
- Not scored: 332 uses with no SCIP occurrence; 155 changed files SCIP didn't index.

### legible

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (20951/20969) |
| likely | 4% (2/48) |
| possible | 4% (11/303) |
| ambiguous (SCIP's target among candidates) | 98% (2203/2259) |
| external (SCIP has no definition) | 99% (28784/29125) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 100% (7947/7961) | 4% (2/48) | 4% (11/296) | 84% (305/361) | 98% (20937/21277) |
| implements | 100% (21/21) | — | — | — | 100% (21/21) |
| read | 100% (8423/8427) | — | — | 100% (810/810) | 100% (4303/4303) |
| references | 100% (4560/4560) | — | 0% (0/7) | 100% (1088/1088) | 100% (3523/3524) |

- **Connections on locals and parameters** (pattern A): 0 (none). On names being declared: 0 (none).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 100% (2203/2212).
- **Wrongly external**: 341 of 29125 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 97% (23002/23680) counting files we indexed; 97% (23154/23833) counting every file. Found as resolved 20951, ambiguous 2203; 360 not extracted as references at all.
- **Used by** of 1436 changed Symbols (108 not defined in SCIP at their name, not scored): precision 99% (6368/6438) (resolved 100% (6353/6353), likely 75% (3/4), possible 0% (0/43), ambiguous 32% (12/38)); recall 98% (6368/6522).
- Not scored: 104 uses with no SCIP occurrence; 14 changed files SCIP didn't index.

### hono

| Status | Precision (correct/uses) |
|---|---|
| resolved | 100% (10753/10765) |
| likely | 0% (0/14) |
| possible | 6% (2/33) |
| ambiguous (SCIP's target among candidates) | 14% (459/3192) |
| external (SCIP has no definition) | 84% (18753/22314) |

| Kind | resolved | likely | possible | ambiguous | external |
|---|---|---|---|---|---|
| calls | 100% (4741/4745) | 0% (0/12) | 13% (2/16) | 16% (459/2833) | 85% (17103/20067) |
| implements | 100% (34/34) | — | — | — | 100% (4/4) |
| read | 100% (2137/2145) | — | — | — | 56% (84/150) |
| references | 100% (3841/3841) | 0% (0/2) | 0% (0/17) | 0% (0/359) | 75% (1562/2093) |

- **Connections on locals and parameters** (pattern A): 0 (none). On names being declared: 339 (external 337, ambiguous 2).
- **Ambiguous**, where SCIP has a definition: it's among the candidates in 26% (459/1733).
- **Wrongly external**: 3224 of 22314 external uses resolve in the repository.
- **Recall**, uses of definitions we have a Symbol for: 87% (10550/12105) counting files we indexed; 87% (10602/12175) counting every file. Found as resolved 10240, ambiguous 362; 1541 not extracted as references at all.
- **Used by** of 87 changed Symbols (16 not defined in SCIP at their name, not scored): precision 100% (1280/1280) (resolved 100% (1280/1280)); recall 86% (1280/1483).
- Not scored: 228 uses with no SCIP occurrence; 141 changed files SCIP didn't index.

### Change Sets

| Change Set | Files | resolved | likely | Locals connected | Recall (indexed) | Used by |
|---|---|---|---|---|---|---|
| legible `6782c6ac` M3: Judge retries 429 and 5xx before falling back | 2 | 100% (353/353) | — | 0 | 99% | 100% (28/28) |
| legible `d777c9f5` M3: evals load .env and stop on settings they would ignore | 4 | 100% (304/304) | — | 0 | 100% | 100% (52/52) |
| legible `7f2a6285` Resizable side panels that remember their widths | 7 | 100% (1015/1015) | — | 0 | 89% | 97% (326/336) |
| legible `b4ef0746` M3: fix findings from an independent review | 21 | 100% (4041/4041) | 0% (0/16) | 0 | 97% | 95% (589/617) |
| legible `48e52bc4` M3: docs — ADR 0015, dogfooding, README privacy, engineering | 5 | 100% (94/94) | — | 0 | 87% | 100% (4/4) |
| legible `340de6b3` M3: evals harness with six labeled cases | 63 | 100% (201/201) | — | 0 | 100% | 100% (108/108) |
| legible `537007c1` M3: Change Brief, Walkthrough sidebar, Step view and editing | 17 | 100% (3542/3542) | 0% (0/4) | 0 | 96% | 100% (536/536) |
| legible `b727ad24` M3: Understanding service, agent host pipelines, ChatGPT sig | 20 | 100% (2504/2504) | 0% (0/10) | 0 | 99% | 100% (782/783) |
| legible `78c41ec6` M3: Intent, Walkthrough and Change Brief pipelines | 23 | 100% (1168/1168) | 0% (0/2) | 0 | 100% | 100% (613/613) |
| legible `3968d87c` M3: Fragment graph — dependencies, reach and test links for  | 7 | 100% (1146/1146) | — | 0 | 98% | 100% (222/222) |
| legible `18b758a5` M3: packages/judge with TypeSafe Jev, OpenAI Decisions and f | 10 | 100% (402/402) | — | 0 | 99% | 100% (329/329) |
| legible `33010da3` M3: domain types and storage for Intent, Walkthrough and Cha | 13 | 100% (755/755) | 18% (2/11) | 0 | 100% | 100% (541/541) |
| legible `3c517a82` M2: code structure — tree-sitter indexer, Symbols, Connectio | 85 | 100% (5046/5064) | 0% (0/5) | 0 | 97% | 99% (2238/2269) |
| legible `979f1837` Fix the macOS test failure that stopped the first release, a | 4 | 100% (380/380) | — | 0 | 100% | — (0/0) |
| legible `74cc4eca` M1: desktop shell, diff viewer and Explanations (#2) | skipped: parent b5d1d5c1 not indexed: - . (missing tsconfig.json) | | | | | |
| hono `eb78ecaa` fix(utils/url): preserve encoded duplicate query order (#549 | 3 | 99% (640/644) | — | 0 | 99% | 100% (4/4) |
| hono `06a45bc3` feat(bearer-auth): allow MessageFunction to return a Respons | 2 | 100% (266/266) | — | 0 | 98% | 100% (108/108) |
| hono `5ca49b07` fix(css): Fix multiline CSS handling in style replacement (# | 2 | 98% (435/443) | — | 0 | 98% | 100% (38/38) |
| hono `e9c01079` fix(hono-base): disallow `getPath` when `strict` is `false`  | 3 | 100% (2095/2095) | 0% (0/4) | 0 | 76% | 100% (25/25) |
| hono `08807ce1` fix(trie-router): keep first value for duplicate path params | 5 | 100% (2169/2169) | 0% (0/4) | 0 | 77% | 100% (350/350) |
| hono `e77c7c8e` fix(helper/route): match regex params in basePath() the same | 2 | 100% (204/204) | — | 0 | 92% | 100% (29/29) |
| hono `d54720da` fix(serve-static): respect q-values in Accept-Encoding for p | 2 | 100% (156/156) | — | 0 | 90% | 100% (47/47) |
| hono `ae401f08` fix(css): keep the descendant combinator before a pseudo-cla | 2 | 100% (471/471) | — | 0 | 100% | 100% (8/8) |
| hono `2013fed5` fix(css): keep "//" inside an unquoted url() when minifying  | 2 | 100% (469/469) | — | 0 | 100% | 100% (4/4) |
| hono `43379d93` fix(jsx): preserve self-closing void elements in cloneElemen | 2 | 100% (396/396) | — | 0 | 98% | 100% (16/16) |
| hono `33622444` fix(build): keep barrel imports in the bundled `d.ts` (#5557 | 5 | 100% (30/30) | — | 0 | 100% | — (0/0) |
| hono `588ec13f` fix(serve-static): only serve GET and HEAD requests (#5514) | 2 | 100% (148/148) | — | 0 | 92% | 100% (45/45) |
| hono `f78a245a` chore: unified oxfmt and oxlint config (#5518) | 3 | — | — | 0 | — | — (0/0) |
| hono `ae595de8` feat(mount): introduce Mount Middleware and deprecate `app.m | 5 | 100% (283/283) | — | 0 | 93% | 100% (324/324) |
| hono `f23b146a` fix(jsx): allow JSXNode function component results (#5476) | 2 | 100% (390/390) | — | 0 | 98% | 100% (5/5) |
| hono `6d73a74f` docs(request): fix jsdoc comments for some getters (#5445) | 1 | 100% (98/98) | — | 0 | 93% | 100% (104/104) |
| hono `deff5296` test(client): simulate network error for undefined route in  | 1 | 100% (166/166) | — | 0 | 100% | — (0/0) |
| hono `afb2068c` fix(combine): return a Response from a short-circuiting midd | 2 | 100% (225/225) | — | 0 | 93% | 100% (20/20) |
| hono `e5bb2062` fix(jsx): add px to numeric gridGap, gridRowGap and gridColu | 2 | 100% (124/124) | — | 0 | 100% | 100% (56/56) |
| hono `c3053ccf` fix(etag): correctly match mixed-case header name in retaine | 2 | 100% (162/162) | 0% (0/4) | 0 | 82% | 100% (44/44) |
| hono `c437d756` test(build): type-check the bundled declarations from a cons | 6 | — | — | 0 | — | — (0/0) |
| hono `be1f7498` fix(build): keep internal types private in bundled d.ts and  | 11 | 100% (344/344) | — | 0 | 99% | — (0/0) |
| hono `1e1207ca` test(serve-static): fix the test (#5479) | 1 | 100% (78/78) | — | 0 | 100% | — (0/0) |
| hono `8b05c774` Merge commit from fork | 2 | 100% (138/138) | 0% (0/2) | 0 | 95% | 100% (53/53) |
| hono `72f0d8d5` feat(adapters/netlify): publish to JSR (#5468) | 8 | — | — | 0 | — | — (0/0) |
| hono `645ddd6e` test: move adapter runtime tests into `adapters/*` (#5466) | 49 | — | — | 0 | — | — (0/0) |
| hono `1c6e060d` feat(adapters/deno): publish to JSR (#5465) | 10 | — | — | 0 | — | — (0/0) |
| hono `b877827f` feat(adapters): add the seven adapters as workspace packages | 101 | 100% (1047/1047) | — | 0 | 95% | — (0/0) |
| hono `4d9f2a2e` chore(adapters/bun): ship ESM only (#5462) | 3 | — | — | 0 | — | — (0/0) |
| hono `fc2343db` feat(adapters): add @hono/bun as a workspace package (#5447) | 27 | 100% (219/219) | — | 0 | 86% | — (0/0) |

## False positives, most frequent first

### likely

- apps/desktop/src/main/understanding.ts:166 all (calls) → likely packages/store/src/sqlite.ts:28 Statement.all vs SCIP external (×22) · `b4ef0746`
- packages/store/src/index.ts:160 prepare (calls) → likely packages/store/src/sqlite.ts:53 NodeSqliteDatabase.prepare vs SCIP external (×12) · `b4ef0746`
- src/hono.test.ts:1412 redirect (calls) → likely src/client/types.ts:146 ClientResponse.redirect vs SCIP src/context.ts:767 (×8) · `e9c01079`
- src/middleware/etag/index.test.ts:37 digest (calls) → likely src/middleware/etag/digest.ts:30 generateDigest.digest vs SCIP external (×4) · `c3053ccf`
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
- packages/agent-runtime/src/openai.ts:314 list (calls) → possible apps/desktop/src/main/explanations.ts:405 ExplanationService.list vs SCIP external (×2) · `b4ef0746`
- apps/desktop/e2e/app.spec.ts:202 move (calls) → possible packages/ui/src/diff/DiffView.tsx:229 DiffView.move vs SCIP external (×2) · `537007c1`
- src/middleware/combine/index.test.ts:245 redirect (calls) → possible src/client/types.ts:146 ClientResponse.redirect vs SCIP src/context.ts:767 (×2) · `afb2068c`

### resolved

- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:12 nextVersion vs SCIP external (×6) · `3c517a82`
- apps/desktop/test/version.test.ts:6 nextVersion (read) → resolved apps/desktop/scripts/version.mjs:16 nextVersion vs SCIP external (×6) · `3c517a82`
- apps/desktop/test/version.test.ts:6 prereleaseVersion (read) → resolved apps/desktop/scripts/version.mjs:31 prereleaseVersion vs SCIP external (×4) · `3c517a82`
- src/request.test.ts:643 formData (calls) → resolved src/request.ts:334 HonoRequest.formData vs SCIP external (×4) · `eb78ecaa`
- apps/desktop/electron.vite.config.ts:8 bundleFiles (read) → resolved packages/indexer/grammars/bundle.mjs:44 bundleFiles vs SCIP external (×2) · `3c517a82`
- src/helper/css/index.ts:209 css (read) → resolved src/helper/css/index.ts:169 createCssContext.css vs SCIP src/helper/css/index.ts:218 (×2) · `5ca49b07`
- src/helper/css/index.ts:210 cx (read) → resolved src/helper/css/index.ts:173 createCssContext.cx vs SCIP src/helper/css/index.ts:219 (×2) · `5ca49b07`
- src/helper/css/index.ts:211 keyframes (read) → resolved src/helper/css/index.ts:180 createCssContext.keyframes vs SCIP src/helper/css/index.ts:220 (×2) · `5ca49b07`
- src/helper/css/index.ts:213 Style (read) → resolved src/helper/css/index.ts:192 createCssContext.Style vs SCIP src/helper/css/index.ts:222 (×2) · `5ca49b07`

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

- src/hono.test.ts:77 request (calls) → external vs SCIP src/hono-base.ts:503 (×859) · `e9c01079`
- src/hono.test.ts:55 get (calls) → external vs SCIP src/hono-base.ts:104 (×752) · `e9c01079`
- src/middleware/bearer-auth/index.test.ts:447 request (calls) → external vs SCIP src/hono-base.ts:518 (×336) · `06a45bc3`
- src/middleware/bearer-auth/index.test.ts:23 get (calls) → external vs SCIP src/hono-base.ts:119 (×270) · `06a45bc3`
- src/middleware/combine/index.test.ts:22 request (calls) → external vs SCIP src/hono-base.ts:501 (×211) · `afb2068c`
- packages/ui/src/views/Review.tsx:249 set (calls) → external vs SCIP packages/ui/src/state.ts:78 (×184) · `7f2a6285`
- src/helper/css/index.test.tsx:88 h1 (calls) → external vs SCIP src/jsx/intrinsic-elements.ts:844 (×109) · `5ca49b07`
- src/helper/factory/index.ts:14 IntersectNonAnyTypes (read) → external vs SCIP src/types.ts:2767 (×92) · `e9c01079`
- packages/ui/src/App.tsx:46 set (calls) → external vs SCIP packages/ui/src/state.ts:70 (×71) · `537007c1`
- src/helper/css/index.test.tsx:177 div (calls) → external vs SCIP src/jsx/intrinsic-elements.ts:834 (×57) · `5ca49b07`
- src/helper/css/index.test.tsx:590 body (calls) → external vs SCIP src/context.ts:681 (×50) · `5ca49b07`
- src/hono.test.ts:2479 set (calls) → external vs SCIP src/context.ts:550 (×48) · `e9c01079`
- src/hono-base.ts:26 Schema (read) → external vs SCIP src/types.ts:2531 (×43) · `e9c01079`
- packages/ui/src/views/Review.tsx:262 set (calls) → external vs SCIP packages/ui/src/state.ts:88 (×40) · `7f2a6285`
- src/hono.test.ts:279 post (calls) → external vs SCIP src/hono-base.ts:105 (×33) · `e9c01079`
- src/middleware/serve-static/index.test.ts:7 use (calls) → external vs SCIP src/hono-base.ts:113 (×29) · `1e1207ca`
- src/hono.test.ts:1102 notFound (calls) → external vs SCIP src/hono-base.ts:294 (×28) · `e9c01079`
- packages/ui/src/diff/DiffView.tsx:156 set (calls) → external vs SCIP packages/ui/src/state.ts:63 (×23) · `3c517a82`
- src/helper/css/index.test.tsx:573 html (calls) → external vs SCIP src/context.ts:740 (×18) · `5ca49b07`
- src/jsx/base.ts:15 HonoJSX (read) → external vs SCIP src/jsx/intrinsic-elements.ts:14 (×17) · `43379d93`

### locals

None.

