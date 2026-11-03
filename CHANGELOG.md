# Changelog

## 0.1.0 (2026-10-27)

- Initial release: five MCP tools and matching CLI
  subcommands for AI-crawler readiness (GEO) checks and
  fix generation — `analyze_geo_score`, `get_geo_fixes`,
  `make_site_geo_ready`, `suggest_monitoring_config`
  and `get_site_report`.
- No configuration and no API key: site facts are
  fetched directly, scoring and fix generation run
  locally, and the report-slug lookup reads the public
  causabi.com share report.
- Labelled subset of the original six tools:
  `get_product_guide` is omitted (its return value is
  the vendor's unpublished guide document). The scoring
  weights are a labelled reconstruction of the
  published check list; see README.md.
