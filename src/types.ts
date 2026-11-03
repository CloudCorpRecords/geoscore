/**
 * geoscore types.
 *
 * Five tools for AI-crawler readiness (GEO) checks and
 * fix generation. Site facts are fetched through an
 * injectable fetch so every tool is testable offline;
 * two tools (make_site_geo_ready, suggest_monitoring_config)
 * are fully local and never fetch at all.
 */

export interface DomainArgs {
  domain: string;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface MakeSiteGeoReadyArgs {
  name: string;
  url: string;
  description: string;
  services?: string[];
  email?: string;
  faq?: FaqEntry[];
}

export interface SuggestMonitoringConfigArgs {
  business_name: string;
  business_description: string;
  location?: string;
}

export interface GetSiteReportArgs {
  report_slug?: string;
  domain?: string;
}

/** The minimal slice of a fetch Response this tool relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface GeoDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Per-request timeout in ms. Defaults to 15000; tests override it. */
  timeoutMs?: number;
}
