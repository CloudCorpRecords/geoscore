import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeGeoScore,
  getGeoFixes,
  getSiteReport,
  makeSiteGeoReady,
  suggestMonitoringConfig,
} from "../src/geo.js";
import type { FetchFn, GeoDeps } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch returning
 * canned site fixtures (home page HTML / robots.txt /
 * llms.txt bodies): no live network, no live claims.
 * The CLI tests spawn the real CLI through tsx and only
 * exercise paths that need no network.
 */

type Route = { status?: number; body?: string } | "throw";

function siteFetch(routes: Record<string, Route>, captured: string[] = []): FetchFn {
  return async (url) => {
    captured.push(url);
    const route = routes[url];
    if (route === undefined) {
      return { ok: false, status: 404, text: async () => "" };
    }
    if (route === "throw") throw new Error("connection refused");
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => route.body ?? "",
    };
  };
}

function deps(fetchFn: FetchFn): GeoDeps {
  return { fetchFn };
}

// --- fixtures ---------------------------------------------------------------

const FULL_HOME = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Acme Corp — Widgets for Small Businesses</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme Corp","email":"hello@acme.com"}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What does Acme do?","acceptedAnswer":{"@type":"Answer","text":"We sell widgets."}}]}
</script>
</head>
<body>
<h1>Acme Corp</h1>
<h2>What we do</h2>
<p>Acme helps small businesses grow with dependable widgets, honest pricing and support that answers the phone when you call. Do you need a widget that just works? Our team ships fast, documents everything in plain language, and stands behind every order with a simple guarantee.</p>
<p>Call us at 415-555-0132 or write to hello@acme.com any time.</p>
<img src="/hero.png" alt="Acme widgets on a workbench">
</body>
</html>`;

const FULL_SITE: Record<string, Route> = {
  "https://acme.com/": { body: FULL_HOME },
  "https://acme.com/robots.txt": { status: 404 },
  "https://acme.com/llms.txt": { body: "# Acme Corp\n" },
};

const PARTIAL_HOME = `<html>
<head><title>Partial Widgets</title></head>
<body>
<h1>Partial Widgets</h1>
<p>Partial makes simple widgets for workshops and garages across the country, with plain pricing and delivery in three days flat for every single order placed this year without fail.</p>
</body>
</html>`;

const PARTIAL_SITE: Record<string, Route> = {
  "https://partial.com/": { body: PARTIAL_HOME },
  "https://partial.com/robots.txt": { status: 404 },
  "https://partial.com/llms.txt": { status: 404 },
};

const QUESTION_HOME = `<html>
<head><title>Partial Widgets</title></head>
<body>
<h1>Partial Widgets</h1>
<p>Partial makes simple widgets for workshops and garages across the country, with plain pricing and delivery in three days flat for every single order placed this year without fail. Wondering which widget fits your bench? Every model is listed with its measurements.</p>
</body>
</html>`;

// --- analyze_geo_score ------------------------------------------------------

describe("analyze_geo_score", () => {
  it("scores a fully-passing fixture at exactly 100", async () => {
    const out = JSON.parse(await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(FULL_SITE))));
    assert.equal(out.domain, "acme.com");
    assert.equal(out.score, 100);
    assert.deepEqual(out.breakdown, {
      crawlability: 20,
      robots: 20,
      visibility: 20,
      schema: 15,
      faq: 10,
      contacts: 10,
      hygiene: 5,
    });
    assert.deepEqual(out.facts, { home_status: 200, has_llms_txt: true, has_json_ld: true });
    for (const crawler of [
      "GPTBot",
      "ClaudeBot",
      "PerplexityBot",
      "ChatGPT-User",
      "Claude-User",
      "OAI-SearchBot",
      "Google-Extended",
      "CCBot",
    ]) {
      assert.equal(out.robots[crawler], "allowed");
    }
  });

  it("normalizes a domain given with scheme and path", async () => {
    const captured: string[] = [];
    const out = JSON.parse(
      await analyzeGeoScore(
        { domain: "https://acme.com/some/page?x=1" },
        deps(siteFetch(FULL_SITE, captured)),
      ),
    );
    assert.equal(out.domain, "acme.com");
    assert.equal(out.score, 100);
    assert.deepEqual(captured, [
      "https://acme.com/",
      "https://acme.com/robots.txt",
      "https://acme.com/llms.txt",
    ]);
  });

  it("a blocked crawler loses exactly its 2.5 share", async () => {
    const routes: Record<string, Route> = {
      ...FULL_SITE,
      "https://acme.com/robots.txt": {
        body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n",
      },
    };
    const out = JSON.parse(await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(routes))));
    assert.equal(out.breakdown.robots, 15);
    assert.equal(out.score, 95);
    assert.equal(out.robots.GPTBot, "blocked");
    assert.equal(out.robots.CCBot, "blocked");
    assert.equal(out.robots.ClaudeBot, "allowed");
  });

  it("a wildcard Disallow: / blocks every crawler; a narrower path blocks nothing", async () => {
    const wildcard: Record<string, Route> = {
      ...FULL_SITE,
      "https://acme.com/robots.txt": { body: "User-agent: *\nDisallow: /\n" },
    };
    const out1 = JSON.parse(
      await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(wildcard))),
    );
    assert.equal(out1.breakdown.robots, 0);
    assert.equal(out1.robots.PerplexityBot, "blocked");

    const narrow: Record<string, Route> = {
      ...FULL_SITE,
      "https://acme.com/robots.txt": { body: "User-agent: GPTBot\nDisallow: /admin/\n" },
    };
    const out2 = JSON.parse(
      await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(narrow))),
    );
    assert.equal(out2.breakdown.robots, 20);
    assert.equal(out2.robots.GPTBot, "allowed");
  });

  it("404 robots.txt means nothing is blocked", async () => {
    const out = JSON.parse(
      await analyzeGeoScore({ domain: "partial.com" }, deps(siteFetch(PARTIAL_SITE))),
    );
    assert.equal(out.breakdown.robots, 20);
    assert.equal(out.robots.GPTBot, "allowed");
    assert.equal(out.robots["Google-Extended"], "allowed");
  });

  it("scores the partial fixture category by category", async () => {
    const out = JSON.parse(
      await analyzeGeoScore({ domain: "partial.com" }, deps(siteFetch(PARTIAL_SITE))),
    );
    assert.deepEqual(out.breakdown, {
      crawlability: 20,
      robots: 20,
      visibility: 12, // text >= 200 (8) + h1 (4); no h2, no question text
      schema: 0,
      faq: 0,
      contacts: 3, // business name only
      hygiene: 1, // no llms.txt, no lang; no images at all earns the image point
    });
    assert.equal(out.score, 56);
    assert.deepEqual(out.facts, { home_status: 200, has_llms_txt: false, has_json_ld: false });
  });

  it("a missing llms.txt loses exactly its 2 hygiene points", async () => {
    const routes: Record<string, Route> = {
      ...FULL_SITE,
      "https://acme.com/llms.txt": { status: 404 },
    };
    const out = JSON.parse(await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(routes))));
    assert.equal(out.breakdown.hygiene, 3);
    assert.equal(out.facts.has_llms_txt, false);
    assert.equal(out.score, 98);
  });

  it("FAQPage JSON-LD earns the faq 10; question-shaped text alone earns 5", async () => {
    const full = JSON.parse(
      await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(FULL_SITE))),
    );
    assert.equal(full.breakdown.faq, 10);

    const routes: Record<string, Route> = {
      ...PARTIAL_SITE,
      "https://partial.com/": { body: QUESTION_HOME },
    };
    const out = JSON.parse(
      await analyzeGeoScore({ domain: "partial.com" }, deps(siteFetch(routes))),
    );
    assert.equal(out.breakdown.faq, 5);
    assert.equal(out.breakdown.visibility, 16); // text (8) + h1 (4) + question (4), no h2
  });

  it("an unreachable home page fails with the site-unreachable string", async () => {
    const routes: Record<string, Route> = { "https://acme.com/": "throw" };
    await assert.rejects(
      analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(routes))),
      (err: unknown) => err instanceof Error && err.message === "site unreachable: acme.com",
    );
    await assert.rejects(
      getGeoFixes({ domain: "acme.com" }, deps(siteFetch(routes))),
      (err: unknown) => err instanceof Error && err.message === "site unreachable: acme.com",
    );
  });

  it("a reachable HTTP-error home page is scored, not fatal", async () => {
    const routes: Record<string, Route> = {
      ...FULL_SITE,
      "https://acme.com/": { status: 500, body: FULL_HOME },
    };
    const out = JSON.parse(await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(routes))));
    assert.equal(out.breakdown.crawlability, 0);
    assert.equal(out.facts.home_status, 500);
    assert.equal(out.score, 80);
  });

  it("rejects a missing domain before fetching", async () => {
    const captured: string[] = [];
    await assert.rejects(
      analyzeGeoScore({ domain: "" }, deps(siteFetch(FULL_SITE, captured))),
      (err: unknown) =>
        err instanceof Error && err.message === "domain must be a non-empty string",
    );
    assert.deepEqual(captured, []);
  });
});

// --- get_geo_fixes ----------------------------------------------------------

describe("get_geo_fixes", () => {
  it("renders all four sections and lists the crawlers the current robots.txt blocks", async () => {
    const routes: Record<string, Route> = {
      ...FULL_SITE,
      "https://acme.com/robots.txt": {
        body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n",
      },
    };
    const out = await getGeoFixes({ domain: "acme.com" }, deps(siteFetch(routes)));
    assert.ok(out.startsWith("# GEO fixes for acme.com\n"));
    assert.ok(out.includes("## robots.txt"));
    assert.ok(out.includes("## Schema.org (Organization JSON-LD)"));
    assert.ok(out.includes("## FAQ (FAQPage JSON-LD)"));
    assert.ok(out.includes("## llms.txt"));
    assert.ok(out.includes("Currently blocked by robots.txt: GPTBot, CCBot."));
    assert.ok(out.includes("User-agent: GPTBot\nAllow: /"));
    assert.ok(out.includes("User-agent: CCBot\nAllow: /"));
    assert.ok(out.includes('"name": "Acme Corp — Widgets for Small Businesses"'));
    assert.ok(out.includes('"@type": "FAQPage"'));
    assert.ok(out.includes("# Acme Corp — Widgets for Small Businesses"));
  });

  it("falls back to the <name> placeholder when no title is discoverable", async () => {
    const routes: Record<string, Route> = {
      "https://partial.com/": { body: "<html><body><h1>Untitled</h1></body></html>" },
      "https://partial.com/robots.txt": { status: 404 },
      "https://partial.com/llms.txt": { status: 404 },
    };
    const out = await getGeoFixes({ domain: "partial.com" }, deps(siteFetch(routes)));
    assert.ok(out.includes('"name": "<name>"'));
    assert.ok(out.includes("No named AI crawler is currently blocked."));
  });
});

// --- make_site_geo_ready ----------------------------------------------------

const ROBOTS_BODY = `User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: *
Allow: /`;

describe("make_site_geo_ready", () => {
  it("renders the exact deterministic composition for a full input", async () => {
    const out = await makeSiteGeoReady({
      name: "Acme Corp",
      url: "https://acme.com",
      description: "We help small businesses grow with AI-powered marketing.",
      services: ["Marketing automation", "AI content", "Analytics"],
      email: "hello@acme.com",
      faq: [
        { question: "What does Acme do?", answer: "We help small businesses grow." },
        { question: "How much does it cost?", answer: "Plans start at $49/mo." },
      ],
    });
    const expected = `# GEO assets for Acme Corp

## Organization Schema (Schema.org JSON-LD)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Acme Corp",
  "url": "https://acme.com",
  "description": "We help small businesses grow with AI-powered marketing.",
  "email": "hello@acme.com"
}
</script>

## FAQ Schema (Schema.org JSON-LD)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What does Acme do?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We help small businesses grow."
      }
    },
    {
      "@type": "Question",
      "name": "How much does it cost?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Plans start at $49/mo."
      }
    }
  ]
}
</script>

## llms.txt

# Acme Corp

We help small businesses grow with AI-powered marketing.

## Services

- Marketing automation
- AI content
- Analytics

## robots.txt

${ROBOTS_BODY}
`;
    assert.equal(out, expected);
  });

  it("omits the email key, the FAQ section and the Services list when not given", async () => {
    const out = await makeSiteGeoReady({
      name: "Solo Site",
      url: "https://solo.example",
      description: "A one-person studio.",
    });
    const expected = `# GEO assets for Solo Site

## Organization Schema (Schema.org JSON-LD)

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Solo Site",
  "url": "https://solo.example",
  "description": "A one-person studio."
}
</script>

## llms.txt

# Solo Site

A one-person studio.

## robots.txt

${ROBOTS_BODY}
`;
    assert.equal(out, expected);
    assert.ok(!out.includes("FAQ Schema"));
    assert.ok(!out.includes("Services"));
    assert.ok(!out.includes("email"));
  });

  it("validates its required arguments", async () => {
    await assert.rejects(
      makeSiteGeoReady({ name: "", url: "https://x.example", description: "d" }),
      (err: unknown) =>
        err instanceof Error && err.message === "name must be a non-empty string",
    );
    await assert.rejects(
      makeSiteGeoReady({
        name: "X",
        url: "https://x.example",
        description: "d",
        faq: [{ question: "Q?" } as never],
      }),
      (err: unknown) =>
        err instanceof Error && err.message === "faq[0].answer must be a non-empty string",
    );
  });
});

// --- suggest_monitoring_config ----------------------------------------------

describe("suggest_monitoring_config", () => {
  it("renders the exact config shape with a location", async () => {
    const out = JSON.parse(
      await suggestMonitoringConfig({
        business_name: "Bright Smiles Dental",
        business_description:
          "A family dental clinic offering general and cosmetic dentistry.",
        location: "Austin, TX",
      }),
    );
    assert.deepEqual(out, {
      business_name: "Bright Smiles Dental",
      location: "Austin, TX",
      audiences: [
        "people looking for Bright Smiles Dental",
        "people in Austin, TX looking for Bright Smiles Dental",
      ],
      suggested_queries: [
        "What is the best family dental clinic offering general and cosmetic dentistry in Austin, TX?",
        "Which family dental clinic offering general and cosmetic dentistry do you recommend in Austin, TX?",
        "Where can I find a family dental clinic offering general and cosmetic dentistry in Austin, TX?",
      ],
      apply_calls: [
        "PUT https://causabi.com/api/v1/monitor/{site_id}/settings",
        "PUT https://causabi.com/api/v1/monitor/{site_id}/queries",
      ],
    });
  });

  it("without a location: one audience, null location, location-free queries", async () => {
    const out = JSON.parse(
      await suggestMonitoringConfig({
        business_name: "Bright Smiles Dental",
        business_description:
          "A family dental clinic offering general and cosmetic dentistry.",
      }),
    );
    assert.equal(out.location, null);
    assert.deepEqual(out.audiences, ["people looking for Bright Smiles Dental"]);
    assert.deepEqual(out.suggested_queries, [
      "What is the best family dental clinic offering general and cosmetic dentistry?",
      "Which family dental clinic offering general and cosmetic dentistry do you recommend?",
      "Where can I find a family dental clinic offering general and cosmetic dentistry?",
    ]);
    assert.ok(out.apply_calls[0].includes("{site_id}"));
    assert.ok(out.apply_calls[1].includes("{site_id}"));
  });
});

// --- get_site_report --------------------------------------------------------

describe("get_site_report", () => {
  it("returns the slug report body verbatim", async () => {
    const captured: string[] = [];
    const routes: Record<string, Route> = {
      "https://causabi.com/api/v1/reports/abc123": { body: "REPORT BODY — verbatim, not JSON" },
    };
    const out = await getSiteReport(
      { report_slug: "abc123" },
      deps(siteFetch(routes, captured)),
    );
    assert.equal(out, "REPORT BODY — verbatim, not JSON");
    assert.deepEqual(captured, ["https://causabi.com/api/v1/reports/abc123"]);
  });

  it("maps slug failures to the causabi error strings", async () => {
    const notFound: Record<string, Route> = {
      "https://causabi.com/api/v1/reports/nope": { status: 404, body: "not found" },
    };
    await assert.rejects(
      getSiteReport({ report_slug: "nope" }, deps(siteFetch(notFound))),
      (err: unknown) => err instanceof Error && err.message === "causabi error: HTTP 404",
    );
    const down: Record<string, Route> = {
      "https://causabi.com/api/v1/reports/abc123": "throw",
    };
    await assert.rejects(
      getSiteReport({ report_slug: "abc123" }, deps(siteFetch(down))),
      (err: unknown) => err instanceof Error && err.message === "causabi unreachable",
    );
  });

  it("domain-only: the analyze JSON plus the note field, same score", async () => {
    const analysis = JSON.parse(
      await analyzeGeoScore({ domain: "acme.com" }, deps(siteFetch(FULL_SITE))),
    );
    const out = JSON.parse(
      await getSiteReport({ domain: "acme.com" }, deps(siteFetch(FULL_SITE))),
    );
    assert.equal(
      out.note,
      "Domain-only reports carry the crawlability score; the full mention-rate report needs a report_slug from a causabi.com share link.",
    );
    assert.equal(out.score, analysis.score);
    const { note: _note, ...rest } = out;
    assert.deepEqual(rest, analysis);
  });

  it("a report_slug wins over a domain when both are given", async () => {
    const captured: string[] = [];
    const routes: Record<string, Route> = {
      "https://causabi.com/api/v1/reports/abc123": { body: "SLUG BODY" },
      ...FULL_SITE,
    };
    const out = await getSiteReport(
      { report_slug: "abc123", domain: "acme.com" },
      deps(siteFetch(routes, captured)),
    );
    assert.equal(out, "SLUG BODY");
    assert.deepEqual(captured, ["https://causabi.com/api/v1/reports/abc123"]);
  });

  it("requires one of report_slug or domain", async () => {
    await assert.rejects(
      getSiteReport({}, deps(siteFetch(FULL_SITE))),
      (err: unknown) =>
        err instanceof Error && err.message === "one of report_slug or domain is required",
    );
  });
});

// --- CLI --------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function runCli(args: string[]) {
  return spawnSync(join(root, "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("geoscore CLI", () => {
  it("prints 0.1.0 for --version and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("unknown subcommand prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.ok(res.stderr.includes("Usage:"));
  });

  it("a tool error exits 1 (get_site_report with neither argument)", () => {
    const res = runCli(["get_site_report", "{}"]);
    assert.equal(res.status, 1);
    assert.ok(res.stderr.includes("one of report_slug or domain is required"));
  });

  it("runs a fully local tool end to end", () => {
    const res = runCli([
      "suggest_monitoring_config",
      JSON.stringify({
        business_name: "Bright Smiles Dental",
        business_description:
          "A family dental clinic offering general and cosmetic dentistry.",
        location: "Austin, TX",
      }),
    ]);
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.business_name, "Bright Smiles Dental");
    assert.equal(out.apply_calls.length, 2);
  });
});
