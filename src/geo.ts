/**
 * geoscore core: five tools for AI-crawler readiness
 * (GEO — Generative Engine Optimization) checks and fix
 * generation, rebuilt from the geo-optimizer-mcp README.
 *
 * Shared site facts (analyze_geo_score, get_geo_fixes and
 * the domain form of get_site_report): the domain is
 * normalized (any scheme/path the caller included is
 * stripped) and three URLs are fetched through the
 * injectable fetchFn: `https://<domain>/`,
 * `https://<domain>/robots.txt` and
 * `https://<domain>/llms.txt`. If the home page fetch
 * itself throws, the tool fails with
 * `site unreachable: <domain>` (this rebuild's string).
 * A reachable home page with an HTTP error status is
 * scored, not fatal. A missing robots.txt / llms.txt
 * (404, or an unfetchable one) is data, not an error.
 *
 * Scoring (LABELLED RECONSTRUCTION — the original README
 * publishes the check list — crawlability; robots.txt
 * per AI crawler; visible without JavaScript; Schema.org;
 * FAQ; name and contacts; freshness / accessibility /
 * llms.txt hygiene with "a small weight" — but not the
 * weights; the composition below is this rebuild's and
 * totals 100):
 *
 * - crawlability 20: home page status 200 → 20, else 0.
 * - robots 20: eight named AI crawlers (AI_CRAWLERS),
 *   each crawler not disallowed for `/` in robots.txt
 *   earns 2.5; no robots.txt at all blocks nothing → 20.
 * - visibility 20: visible text (tags / scripts / styles
 *   stripped) of at least 200 characters → 8; an <h1>
 *   present → 4; at least one <h2> → 4; question-shaped
 *   text (a `?` in the visible text) → 4.
 * - schema 15: a JSON-LD block parses → 8; its @type is
 *   a specific (non-generic) type string → 7.
 * - faq 10: FAQPage JSON-LD present → 10; else
 *   question-shaped visible text → 5.
 * - contacts 10: an email address or mailto link → 4;
 *   a phone-shaped number → 3; the business name (the
 *   domain's registrable label, case-insensitive) in
 *   the visible text or title → 3.
 * - hygiene 5: llms.txt returns 200 → 2; an <html lang>
 *   attribute present → 2; at least one image with an
 *   alt attribute → 1 (or no images at all → 1).
 *
 * get_site_report with a report_slug fetches
 * `https://causabi.com/api/v1/reports/<slug>` (labelled
 * wire reconstruction — the README pins that the share
 * pages at causabi.com/report/<slug> are public, not the
 * API path) and returns the body verbatim; non-2xx →
 * `causabi error: HTTP <status>`; a throwing fetch →
 * `causabi unreachable`. With only a domain it returns
 * the analyze_geo_score JSON plus a `note` field.
 *
 * make_site_geo_ready and suggest_monitoring_config are
 * fully local: they render deterministic documents from
 * their arguments and never fetch.
 */
import type {
  DomainArgs,
  FaqEntry,
  FetchFn,
  FetchResponseLike,
  GeoDeps,
  GetSiteReportArgs,
  MakeSiteGeoReadyArgs,
  SuggestMonitoringConfigArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_TIMEOUT_MS = 15000;

/** The named AI crawlers (this rebuild's set, labelled). */
export const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "ChatGPT-User",
  "Claude-User",
  "OAI-SearchBot",
  "Google-Extended",
  "CCBot",
] as const;

/** @type values too generic to earn the specific-type points. */
const GENERIC_TYPES = new Set(["Thing", "WebPage", "WebSite"]);

/** The note on domain-only reports (this rebuild's string). */
export const DOMAIN_ONLY_NOTE =
  "Domain-only reports carry the crawlability score; the full mention-rate report needs a report_slug from a causabi.com share link.";

// ---------------------------------------------------------------------------
// fetching
// ---------------------------------------------------------------------------

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init);
}

function fetchFn(deps: GeoDeps): FetchFn {
  return deps.fetchFn ?? defaultFetch;
}

/**
 * One fetch with the deps timeout applied: an
 * AbortController signal is passed to the fetch and the
 * call itself is raced against the timeout, so a fetch
 * that ignores the signal still cannot hang the tool.
 */
async function fetchWithTimeout(
  deps: GeoDeps,
  url: string,
): Promise<FetchResponseLike> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`fetch timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([
      fetchFn(deps)(url, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// domain handling and site facts
// ---------------------------------------------------------------------------

/** Strip any scheme/path the caller included; lowercase the host. */
export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split(/[/?#]/)[0];
  return d;
}

/** The domain's registrable label: "www.acme.com" → "acme". */
function registrableLabel(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length === 0) return domain;
  if (parts.length === 1) return parts[0];
  const secondLevel = new Set(["co", "com", "org", "net", "ac", "gov"]);
  if (parts.length >= 3 && secondLevel.has(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts[parts.length - 2];
}

interface SiteFacts {
  domain: string;
  homeStatus: number;
  homeHtml: string;
  robotsText: string | null;
  hasLlmsTxt: boolean;
}

async function fetchSiteFacts(domainArg: string, deps: GeoDeps): Promise<SiteFacts> {
  if (typeof domainArg !== "string" || domainArg.trim() === "") {
    throw new Error("domain must be a non-empty string");
  }
  const domain = normalizeDomain(domainArg);
  if (domain === "") {
    throw new Error("domain must be a non-empty string");
  }
  let home: FetchResponseLike;
  try {
    home = await fetchWithTimeout(deps, `https://${domain}/`);
  } catch {
    throw new Error(`site unreachable: ${domain}`);
  }
  const homeHtml = await home.text();

  let robotsText: string | null = null;
  try {
    const robots = await fetchWithTimeout(deps, `https://${domain}/robots.txt`);
    if (robots.status === 200) robotsText = await robots.text();
  } catch {
    robotsText = null;
  }

  let hasLlmsTxt = false;
  try {
    const llms = await fetchWithTimeout(deps, `https://${domain}/llms.txt`);
    hasLlmsTxt = llms.status === 200;
  } catch {
    hasLlmsTxt = false;
  }

  return { domain, homeStatus: home.status, homeHtml, robotsText, hasLlmsTxt };
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

/** Visible text: script/style bodies and all tags stripped. */
function visibleText(html: string): string {
  const noScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  return decodeEntities(noScripts.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return m ? decodeEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "";
}

/** Parse every JSON-LD block; unparseable blocks are skipped. */
function parseJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // A block that does not parse earns nothing.
    }
  }
  return blocks;
}

/** Every @type string in parsed JSON-LD (top level, arrays, @graph). */
function jsonLdTypes(blocks: unknown[]): string[] {
  const types: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object" && node !== null) {
      const rec = node as Record<string, unknown>;
      const t = rec["@type"];
      if (typeof t === "string") types.push(t);
      if (Array.isArray(t)) {
        for (const item of t) if (typeof item === "string") types.push(item);
      }
      if (Array.isArray(rec["@graph"])) {
        for (const item of rec["@graph"]) walk(item);
      }
    }
  };
  for (const block of blocks) walk(block);
  return types;
}

/**
 * Which crawlers robots.txt disallows for `/`.
 * A crawler is blocked when a group naming it (or the
 * `*` group) carries a `Disallow: /` rule — an exact
 * root disallow; narrower paths do not block `/`.
 */
function blockedCrawlers(robotsText: string | null): Map<string, boolean> {
  const blocked = new Map<string, boolean>(AI_CRAWLERS.map((c) => [c, false]));
  if (robotsText === null) return blocked;
  let agents: string[] = [];
  let groupHasRules = false;
  const disallowsRoot = (line: string): boolean => {
    const m = /^disallow\s*:\s*(\S*)\s*$/i.exec(line);
    return m !== null && m[1] === "/";
  };
  const applyGroup = (groupAgents: string[], rootBlocked: boolean): void => {
    if (!rootBlocked) return;
    for (const crawler of AI_CRAWLERS) {
      const named = groupAgents.some((a) => a.toLowerCase() === crawler.toLowerCase());
      const wildcard = groupAgents.some((a) => a === "*");
      if (named || wildcard) blocked.set(crawler, true);
    }
  };
  let rootBlocked = false;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const ua = /^user-agent\s*:\s*(\S+)\s*$/i.exec(line);
    if (ua) {
      if (groupHasRules) {
        applyGroup(agents, rootBlocked);
        agents = [];
        rootBlocked = false;
        groupHasRules = false;
      }
      agents.push(ua[1]);
      continue;
    }
    if (/^(dis)?allow\s*:/i.test(line)) {
      groupHasRules = true;
      if (disallowsRoot(line)) rootBlocked = true;
    }
  }
  applyGroup(agents, rootBlocked);
  return blocked;
}

// ---------------------------------------------------------------------------
// scoring (labelled reconstruction — see the header)
// ---------------------------------------------------------------------------

export interface GeoAnalysis {
  domain: string;
  score: number;
  breakdown: {
    crawlability: number;
    robots: number;
    visibility: number;
    schema: number;
    faq: number;
    contacts: number;
    hygiene: number;
  };
  robots: Record<string, "allowed" | "blocked">;
  facts: {
    home_status: number;
    has_llms_txt: boolean;
    has_json_ld: boolean;
  };
}

function analyzeFacts(facts: SiteFacts): GeoAnalysis {
  const { domain, homeStatus, homeHtml, robotsText, hasLlmsTxt } = facts;

  const crawlability = homeStatus === 200 ? 20 : 0;

  const blocked = blockedCrawlers(robotsText);
  const robotsMap: Record<string, "allowed" | "blocked"> = {};
  let robotsScore = 0;
  for (const crawler of AI_CRAWLERS) {
    const isBlocked = blocked.get(crawler) === true;
    robotsMap[crawler] = isBlocked ? "blocked" : "allowed";
    if (!isBlocked) robotsScore += 2.5;
  }

  const text = visibleText(homeHtml);
  const questionShaped = text.includes("?");
  let visibility = 0;
  if (text.length >= 200) visibility += 8;
  if (/<h1\b/i.test(homeHtml)) visibility += 4;
  if (/<h2\b/i.test(homeHtml)) visibility += 4;
  if (questionShaped) visibility += 4;

  const ldBlocks = parseJsonLd(homeHtml);
  const types = jsonLdTypes(ldBlocks);
  let schema = 0;
  if (ldBlocks.length > 0) schema += 8;
  if (types.some((t) => !GENERIC_TYPES.has(t))) schema += 7;

  const faq = types.includes("FAQPage") ? 10 : questionShaped ? 5 : 0;

  let contacts = 0;
  if (/mailto:/i.test(homeHtml) || /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.test(homeHtml)) {
    contacts += 4;
  }
  if (
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/.test(text) ||
    /\+\d[\d\s-]{8,}\d/.test(text)
  ) {
    contacts += 3;
  }
  const label = registrableLabel(domain);
  const title = pageTitle(homeHtml);
  if (
    label !== "" &&
    (text.toLowerCase().includes(label.toLowerCase()) ||
      title.toLowerCase().includes(label.toLowerCase()))
  ) {
    contacts += 3;
  }

  let hygiene = 0;
  if (hasLlmsTxt) hygiene += 2;
  if (/<html\b[^>]*\blang\s*=/i.test(homeHtml)) hygiene += 2;
  const imgTags = homeHtml.match(/<img\b[^>]*>/gi) ?? [];
  if (imgTags.length === 0 || imgTags.some((tag) => /\balt\s*=/i.test(tag))) {
    hygiene += 1;
  }

  const breakdown = {
    crawlability,
    robots: robotsScore,
    visibility,
    schema,
    faq,
    contacts,
    hygiene,
  };
  const score =
    breakdown.crawlability +
    breakdown.robots +
    breakdown.visibility +
    breakdown.schema +
    breakdown.faq +
    breakdown.contacts +
    breakdown.hygiene;

  return {
    domain,
    score,
    breakdown,
    robots: robotsMap,
    facts: {
      home_status: homeStatus,
      has_llms_txt: hasLlmsTxt,
      has_json_ld: ldBlocks.length > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

export async function analyzeGeoScore(
  args: DomainArgs,
  deps: GeoDeps = {},
): Promise<string> {
  const facts = await fetchSiteFacts(args?.domain, deps);
  return JSON.stringify(analyzeFacts(facts));
}

export async function getGeoFixes(
  args: DomainArgs,
  deps: GeoDeps = {},
): Promise<string> {
  const facts = await fetchSiteFacts(args?.domain, deps);
  const blocked = blockedCrawlers(facts.robotsText);
  const blockedList = AI_CRAWLERS.filter((c) => blocked.get(c) === true);
  const title = pageTitle(facts.homeHtml);
  const name = title !== "" ? title : "<name>";

  const robotsLines: string[] = [];
  for (const crawler of AI_CRAWLERS) {
    robotsLines.push(`User-agent: ${crawler}`, "Allow: /", "");
  }
  robotsLines.push("User-agent: *", "Allow: /");

  const orgJsonLd = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name,
      url: `https://${facts.domain}/`,
    },
    null,
    2,
  );
  const faqJsonLd = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "<question>",
          acceptedAnswer: { "@type": "Answer", text: "<answer>" },
        },
      ],
    },
    null,
    2,
  );

  return [
    `# GEO fixes for ${facts.domain}`,
    "",
    "## robots.txt",
    "",
    blockedList.length > 0
      ? `Currently blocked by robots.txt: ${blockedList.join(", ")}. The block below allows every named AI crawler:`
      : "No named AI crawler is currently blocked. The block below allows every named AI crawler:",
    "",
    "```",
    robotsLines.join("\n"),
    "```",
    "",
    "## Schema.org (Organization JSON-LD)",
    "",
    "```html",
    '<script type="application/ld+json">',
    orgJsonLd,
    "</script>",
    "```",
    "",
    "## FAQ (FAQPage JSON-LD)",
    "",
    "```html",
    '<script type="application/ld+json">',
    faqJsonLd,
    "</script>",
    "```",
    "",
    "## llms.txt",
    "",
    "```",
    `# ${name}`,
    "",
    `> <one-line description of ${facts.domain}>`,
    "",
    `- [Home](https://${facts.domain}/): <what visitors find here>`,
    "```",
    "",
  ].join("\n");
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value as string[];
}

function robotsTxtBody(): string {
  const lines: string[] = [];
  for (const crawler of AI_CRAWLERS) {
    lines.push(`User-agent: ${crawler}`, "Allow: /", "");
  }
  lines.push("User-agent: *", "Allow: /");
  return lines.join("\n");
}

export async function makeSiteGeoReady(args: MakeSiteGeoReadyArgs): Promise<string> {
  const name = requireNonEmptyString(args?.name, "name");
  const url = requireNonEmptyString(args?.url, "url");
  const description = requireNonEmptyString(args?.description, "description");
  const services = optionalStringArray(args?.services, "services");
  const email =
    args?.email === undefined
      ? undefined
      : requireNonEmptyString(args.email, "email");
  let faq: FaqEntry[] | undefined;
  if (args?.faq !== undefined) {
    if (!Array.isArray(args.faq)) {
      throw new Error("faq must be an array of {question, answer} objects");
    }
    faq = args.faq.map((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`faq[${i}] must be an object with question and answer strings`);
      }
      return {
        question: requireNonEmptyString(
          (entry as FaqEntry).question,
          `faq[${i}].question`,
        ),
        answer: requireNonEmptyString((entry as FaqEntry).answer, `faq[${i}].answer`),
      };
    });
  }

  const org: Record<string, string> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url,
    description,
  };
  if (email !== undefined) org.email = email;

  const sections: string[] = [
    `# GEO assets for ${name}`,
    "",
    "## Organization Schema (Schema.org JSON-LD)",
    "",
    '<script type="application/ld+json">',
    JSON.stringify(org, null, 2),
    "</script>",
  ];

  if (faq !== undefined && faq.length > 0) {
    const faqLd = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((entry) => ({
        "@type": "Question",
        name: entry.question,
        acceptedAnswer: { "@type": "Answer", text: entry.answer },
      })),
    };
    sections.push(
      "",
      "## FAQ Schema (Schema.org JSON-LD)",
      "",
      '<script type="application/ld+json">',
      JSON.stringify(faqLd, null, 2),
      "</script>",
    );
  }

  const llms: string[] = [`# ${name}`, "", description];
  if (services !== undefined && services.length > 0) {
    llms.push("", "## Services", "", ...services.map((s) => `- ${s}`));
  }
  sections.push("", "## llms.txt", "", llms.join("\n"));

  sections.push("", "## robots.txt", "", robotsTxtBody(), "");
  return sections.join("\n");
}

/** The description's first phrase: up to the first comma/period/semicolon, leading article stripped. */
function firstPhrase(description: string): string {
  const head = description.trim().split(/[.,;]/)[0].trim();
  return head.replace(/^(a|an|the)\s+/i, "");
}

export async function suggestMonitoringConfig(
  args: SuggestMonitoringConfigArgs,
): Promise<string> {
  const businessName = requireNonEmptyString(args?.business_name, "business_name");
  const businessDescription = requireNonEmptyString(
    args?.business_description,
    "business_description",
  );
  const location =
    args?.location === undefined
      ? undefined
      : requireNonEmptyString(args.location, "location");

  const audiences: string[] = [`people looking for ${businessName}`];
  if (location !== undefined) {
    audiences.push(`people in ${location} looking for ${businessName}`);
  }

  const phrase = firstPhrase(businessDescription);
  const place = location !== undefined ? ` in ${location}` : "";
  const suggestedQueries = [
    `What is the best ${phrase}${place}?`,
    `Which ${phrase} do you recommend${place}?`,
    `Where can I find a ${phrase}${place}?`,
  ];

  const applyCalls = [
    "PUT https://causabi.com/api/v1/monitor/{site_id}/settings",
    "PUT https://causabi.com/api/v1/monitor/{site_id}/queries",
  ];

  return JSON.stringify({
    business_name: businessName,
    location: location ?? null,
    audiences,
    suggested_queries: suggestedQueries,
    apply_calls: applyCalls,
  });
}

export async function getSiteReport(
  args: GetSiteReportArgs,
  deps: GeoDeps = {},
): Promise<string> {
  const slug =
    typeof args?.report_slug === "string" && args.report_slug.trim() !== ""
      ? args.report_slug.trim()
      : undefined;
  const domain =
    typeof args?.domain === "string" && args.domain.trim() !== ""
      ? args.domain
      : undefined;

  if (slug !== undefined) {
    let res: FetchResponseLike;
    try {
      res = await fetchWithTimeout(
        deps,
        `https://causabi.com/api/v1/reports/${encodeURIComponent(slug)}`,
      );
    } catch {
      throw new Error("causabi unreachable");
    }
    if (!res.ok) {
      throw new Error(`causabi error: HTTP ${res.status}`);
    }
    return res.text();
  }

  if (domain !== undefined) {
    const facts = await fetchSiteFacts(domain, deps);
    const analysis = analyzeFacts(facts);
    return JSON.stringify({ ...analysis, note: DOMAIN_ONLY_NOTE });
  }

  throw new Error("one of report_slug or domain is required");
}
