# geoscore

Can ChatGPT, Claude and Perplexity actually see your
site? geoscore checks a website's readiness for AI
crawlers and search — its GEO (Generative Engine
Optimization) — and hands back the fixes as copy-paste
assets: a robots.txt that lets the named AI crawlers
in, Schema.org Organization and FAQ markup, and an
llms.txt. It runs locally over stdio, needs no account
and no API key.

Five tools do the work. `analyze_geo_score` grades an
existing domain from 0 to 100 with a per-category
breakdown. `get_geo_fixes` renders the repair kit for
that domain. `make_site_geo_ready` generates every
asset for a brand-new site in one shot from a name, a
URL and a description. `suggest_monitoring_config`
drafts the monitoring setup for a business — target
audiences, suggested queries, and the exact causabi.com
API calls that would apply it. `get_site_report`
returns a client-ready report: the full mention-rate
breakdown when you have a causabi.com share slug, or
the crawlability score on its own when you only have a
domain.

## Honest scope notes

- **Labelled subset — `get_product_guide` is
  omitted.** The original server ships six tools; the
  sixth returns the vendor's own guide document, whose
  contents are not published in any readable record,
  so an honest rebuild cannot reproduce it. Only the
  five tools above are built.
- **The scoring weights are a labelled
  reconstruction.** The original publishes its check
  list (crawlability; robots.txt per AI crawler;
  visible without JavaScript; Schema.org; FAQ; name and
  contacts; freshness / accessibility / llms.txt
  hygiene with a small weight) but not the weights.
  geoscore's composition — crawlability 20, robots 20,
  visibility 20, schema 15, FAQ 10, contacts 10,
  hygiene 5 — is this rebuild's, documented in
  `src/geo.ts`.
- **The report wire path is a reconstruction.** The
  share pages at `causabi.com/report/<slug>` are
  public; the API path behind them
  (`https://causabi.com/api/v1/reports/<slug>`) is this
  rebuild's rendering of that behaviour.

## Configuration

None. No environment variables, no API key. Site facts
are fetched directly from the domain being checked,
with a fixed 15-second per-request timeout.

## Tools

- `analyze_geo_score` — GEO score 0–100 plus a
  breakdown for an existing `domain`. The result is a
  JSON object: `{domain, score, breakdown:
  {crawlability, robots, visibility, schema, faq,
  contacts, hygiene}, robots: {<crawler>: "allowed" |
  "blocked"}, facts: {home_status, has_llms_txt,
  has_json_ld}}`. The eight crawlers tracked are
  GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User,
  Claude-User, OAI-SearchBot, Google-Extended and
  CCBot. If the home page cannot be fetched at all the
  tool fails with `site unreachable: <domain>`; a
  reachable page with an HTTP error status is scored,
  not fatal.
- `get_geo_fixes` — the copy-paste fixes for a
  `domain`, as a markdown document with four sections:
  a robots.txt block allowing every named AI crawler
  (listing any the current robots.txt blocks), an
  Organization JSON-LD template filled with the site's
  title when discoverable, a FAQPage JSON-LD skeleton,
  and an llms.txt skeleton.
- `make_site_geo_ready` — all GEO assets for a new
  site in one shot (no API key needed). Takes `name`,
  `url` and `description`, plus optional `services`
  (array of strings), `email`, and `faq` (array of
  `{question, answer}`). Returns one document:
  Organization JSON-LD, a FAQPage JSON-LD block when
  `faq` is given, an llms.txt body (with a Services
  list when given), and a robots.txt allowing the
  named AI crawlers. Fully local — it never fetches.
- `suggest_monitoring_config` — draft a monitoring
  config from `business_name` and
  `business_description`, with an optional `location`.
  Returns JSON: `{business_name, location, audiences,
  suggested_queries, apply_calls}`, where
  `apply_calls` holds the two calls that apply the
  config on causabi.com —
  `PUT https://causabi.com/api/v1/monitor/{site_id}/settings`
  and `PUT https://causabi.com/api/v1/monitor/{site_id}/queries`
  — with the `{site_id}` placeholder. This tool itself
  makes no API call.
- `get_site_report` — pass `report_slug` for the full
  AI mention-rate breakdown (no API key needed), or
  just `domain` for a crawlability-score-only summary:
  the `analyze_geo_score` JSON plus a `note` field
  explaining how to get the full report. One of the
  two arguments is required.

## CLI

```bash
npx @reneturcios/geoscore analyze_geo_score '{"domain":"example.com"}'
npx @reneturcios/geoscore get_geo_fixes '{"domain":"example.com"}'
npx @reneturcios/geoscore make_site_geo_ready '{"name":"Acme Corp","url":"https://acme.com","description":"We help small businesses grow."}'
npx @reneturcios/geoscore suggest_monitoring_config '{"business_name":"Bright Smiles Dental","business_description":"A family dental clinic.","location":"Austin, TX"}'
npx @reneturcios/geoscore get_site_report '{"report_slug":"abc123"}'
npx @reneturcios/geoscore --version
```

Each subcommand takes one JSON argument string and
prints the tool's result text. Exit codes: 0 success,
1 tool error, 2 usage error.

## MCP

```bash
npx -y @reneturcios/geoscore mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "geoscore": {
      "command": "npx",
      "args": ["-y", "@reneturcios/geoscore", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/geoscore          # stdio MCP server (CMD defaults to "mcp")
docker run --rm ghcr.io/cloudcorprecords/geoscore analyze_geo_score '{"domain":"example.com"}'   # CLI via container
```

## Development

```bash
npm install
npm run build   # tsc -> dist/ (dist/cli.js is the bin)
npm test        # tsx --test test/*.test.ts — fixture-based, no network
npm run dev     # tsx src/cli.ts — run the CLI from source
```

## License

MIT — see `LICENSE` (Copyright (c) 2026 Rene Turcios).
