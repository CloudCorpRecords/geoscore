# geoscore — Build Report (Batch 25)

Rebuild of the `com.causabi/geo-optimizer-mcp` MCP
server (npm package `geo-optimizer-mcp`) from the
firsthand spec in `specs-batch25/geoscore.md`. Built
2026-10-27.

## Identity

- npm: `@reneturcios/geoscore` @ 0.1.0, bin `geoscore`
  → `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/geoscore`
  (matches `package.json` `mcpName`, `server.json`
  `name`, and the Dockerfile
  `io.modelcontextprotocol.server.name` label)
- server.json description (91 chars, verified):
  "AI-crawler readiness checks and fixes: GEO score,
  robots.txt, schema.org, FAQ and llms.txt."
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/geoscore:0.1.0`) carries
  **no** `version` field (verified).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/ruleverdict/tsconfig.json,
verified with `cmp`), .gitignore, .dockerignore,
package-lock.json, README.md (fresh prose), LICENSE
(MIT, © 2026 Rene Turcios), CHANGELOG.md (single 0.1.0
entry dated 2026-10-27), src/index.ts, src/cli.ts,
src/mcp.ts, src/types.ts, src/geo.ts (core),
test/geo.test.ts, and the four workflows under
.github/workflows/ (publish-container adapted: IMAGE
ghcr.io/cloudcorprecords/geoscore, smoke assertion on
server name `geoscore`). Plus this BUILD-REPORT.md and
the parity-out/ artifacts. The parity fixture lives at
`harness/fixtures/geo-optimizer-mcp-tools-original.json`
with the spec's exact `_source` string (verified by
extracting the string from the spec and comparing for
equality).

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`,
  handlers for `ListToolsRequestSchema` /
  `CallToolRequestSchema` from `sdk/types.js`),
  explicit JSON-schema literals for all five tools
  (analyze_geo_score, get_geo_fixes,
  make_site_geo_ready, suggest_monitoring_config,
  get_site_report); no McpServer/zod registration.
  Tool descriptions and input schemas are the
  fixture's, exactly.
- `src/geo.ts`: `VERSION = "0.1.0"`. Site facts go
  through an injectable fetch (deps `fetchFn`,
  `timeoutMs`, default 15000 ms, AbortController plus
  a raced timeout). The domain is normalized (scheme /
  path stripped, lowercased) and
  `https://<domain>/`, `/robots.txt` and `/llms.txt`
  are fetched. A throwing home-page fetch fails with
  `site unreachable: <domain>`; a reachable HTTP-error
  home page is scored, not fatal; a missing robots.txt
  / llms.txt is data, not an error. Scoring is the
  spec's labelled reconstruction (total 100):
  crawlability 20 (home 200), robots 20 (eight named
  AI crawlers — GPTBot, ClaudeBot, PerplexityBot,
  ChatGPT-User, Claude-User, OAI-SearchBot,
  Google-Extended, CCBot — at 2.5 each when not
  disallowed for `/`; a group naming the crawler or
  the `*` group with an exact `Disallow: /` blocks it;
  no robots.txt blocks nothing), visibility 20
  (visible text ≥ 200 chars 8, `<h1>` 4, `<h2>` 4,
  question-shaped text 4), schema 15 (a JSON-LD block
  parses 8, a specific non-generic @type 7 — the
  generic set is this rebuild's: Thing / WebPage /
  WebSite), faq 10 (FAQPage JSON-LD 10, else
  question-shaped text 5), contacts 10 (email/mailto
  4, phone-shaped number 3, the domain's registrable
  label in visible text or title 3), hygiene 5
  (llms.txt 200 → 2, `<html lang>` 2, an image with an
  alt attribute or no images at all 1).
  `analyze_geo_score` returns the spec's JSON envelope
  `{domain, score, breakdown, robots, facts}`.
  `get_geo_fixes` renders a markdown document with
  all four sections (robots.txt allowing every named
  crawler and listing any currently blocked,
  Organization JSON-LD filled with the page title or
  a `<name>` placeholder, FAQPage skeleton, llms.txt
  skeleton). `make_site_geo_ready` and
  `suggest_monitoring_config` are fully local and
  deterministic: the former renders Organization
  JSON-LD (email only when given), a FAQPage block
  when `faq` is given, an llms.txt body (Services list
  when given) and the robots.txt body; the latter
  returns `{business_name, location, audiences,
  suggested_queries, apply_calls}` with audiences
  `people looking for <name>` plus `people in
  <location> looking for <name>` when a location is
  given, three query templates over the description's
  first phrase (text up to the first comma / period /
  semicolon, leading article stripped) with an
  ` in <location>` suffix when a location is given,
  and the two README-pinned apply calls rendered as
  text with the `{site_id}` placeholder
  (`PUT https://causabi.com/api/v1/monitor/{site_id}/settings`
  and `.../queries`).
  `get_site_report`: a `report_slug` wins over a
  domain; the slug form returns the upstream body
  verbatim, non-2xx → `causabi error: HTTP <status>`,
  a throwing fetch → `causabi unreachable`; the
  domain-only form returns the analyze JSON plus the
  spec's `note` field; neither argument →
  `one of report_slug or domain is required`.
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version` (prints `0.1.0`); unknown
  subcommand → usage on stderr, exit 2; tool errors
  exit 1.

## Labelled subset and reconstructions

- **Omitted tool: `get_product_guide`.** The original
  has six tools; this one is omitted because its
  return value is the vendor's own guide document,
  which is not published in the readable record. The
  omission is recorded in the spec, in the fixture
  `_source`, in README.md, in CHANGELOG.md and here.
- **Scoring weights are a labelled reconstruction**:
  the original README publishes the check list but
  not the weights; the composition above is this
  rebuild's, as documented in the spec, README.md and
  the `src/geo.ts` header.
- **The report wire path is a labelled
  reconstruction**: `GET
  https://causabi.com/api/v1/reports/<slug>` — the
  README pins that the share pages at
  causabi.com/report/<slug> are public, not the API
  path behind them.
- The crawler set, the result envelope and renderings,
  the error strings (`site unreachable: <domain>`,
  `causabi error: HTTP <status>`, `causabi
  unreachable`, the one-of error), the monitoring
  query templates and all validation strings are this
  rebuild's, per the spec.

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0.
- `npm test`: **27 tests, 27 pass, 0 fail** — injected
  fake fetch returning canned site fixtures only, no
  live network (the CLI tests spawn the CLI through
  tsx and use only local or pre-network paths).
  Covers: the fully-passing fixture at score 100 with
  the exact breakdown; domain normalization (scheme /
  path stripped, exact fetched URLs); a blocked
  crawler losing exactly its 2.5 share (two blocked →
  robots 15, score 95); a wildcard `Disallow: /`
  blocking every crawler and a narrower path blocking
  nothing; 404 robots.txt = nothing blocked; the
  partial fixture category by category (score 56);
  a missing llms.txt losing exactly 2 (score 98);
  FAQPage JSON-LD earning the faq 10 and
  question-shaped text earning 5 (with the visibility
  question points at 16); the `site unreachable:
  acme.com` error for both analyze and fixes; a
  reachable 500 home page scored (crawlability 0,
  score 80) rather than fatal; a missing domain
  rejected before any fetch; get_geo_fixes' four
  sections, blocked-crawler listing, title-filled
  Organization template and `<name>` placeholder
  fallback; make_site_geo_ready's exact deterministic
  composition for a fixed full input and for a
  minimal input (no email key, no FAQ section, no
  Services list), plus its validation errors;
  suggest_monitoring_config's exact shape with a
  location (audiences, queries, both PUT call texts
  with the `{site_id}` placeholder) and without one
  (single audience, null location); get_site_report
  in all three modes (slug body verbatim with the
  exact fetched URL, slug 404 → `causabi error: HTTP
  404`, slug throw → `causabi unreachable`,
  domain-only with the exact note field and the same
  score object as analyze_geo_score, slug winning
  over a domain) and the one-of error; and the CLI
  cases (`--version` exit 0, unknown subcommand exit
  2, tool error exit 1, a fully local tool end to
  end).
- `node dist/cli.js --version`: prints `0.1.0`.
- Parity: tools captured by sending initialize +
  notifications/initialized + tools/list to
  `node dist/cli.js mcp` over stdio into
  `parity-out/tools-rebuild.json`, then
  `harness/parity.py` against
  `harness/fixtures/geo-optimizer-mcp-tools-original.json`
  → **PASS, parity 100.0, identical_tools 5 / total 5**
  (see `parity-out/parity.json`).
- Lockfile (Route 3, clean from birth): generated in
  the build dir before any install (no node_modules
  present) with `npm install --package-lock-only
  --ignore-scripts --offline`; verified it parses,
  `name` == `@reneturcios/geoscore`, **128 package
  entries**; then `npm install --offline` in the build
  dir succeeded for node_modules.
- Version consistency: `package.json` 0.1.0 =
  `server.json` top-level 0.1.0 = npm entry 0.1.0 =
  OCI tag `:0.1.0` = core `VERSION` 0.1.0 = CHANGELOG
  heading `## 0.1.0 (2026-10-27)`.

## Deviations from the spec

- None in behaviour. Two builder choices the spec
  explicitly leaves open, recorded here: the generic
  @type set for the schema category (Thing / WebPage
  / WebSite) and the exact suggest_monitoring_config
  query templates / first-phrase rule — both are
  defined in `src/geo.ts` and pinned by tests.

## Gaps

- Live behaviour is unproven: no live call was made
  (tests are fake-fetch only), including the causabi
  report lookup.
