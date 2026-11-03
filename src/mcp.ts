/**
 * geoscore MCP server. Tools: analyze_geo_score,
 * get_geo_fixes, make_site_geo_ready,
 * suggest_monitoring_config, get_site_report.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema
 * and injects keys that are not in this tool set's
 * documented spec ("$schema" and
 * "additionalProperties"), which breaks exact
 * tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas
 * as explicit literals, and the core validates every
 * tools/call argument set itself.
 *
 * Labelled subset: the original server has a sixth
 * tool, get_product_guide, which is omitted here — its
 * return value is the vendor's unpublished guide
 * document, which an honest rebuild cannot reproduce.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  analyzeGeoScore,
  getGeoFixes,
  getSiteReport,
  makeSiteGeoReady,
  suggestMonitoringConfig,
  VERSION,
} from "./geo.js";

const TOOLS = [
  {
    name: "analyze_geo_score",
    description: "Check GEO score 0–100 + breakdown for an existing domain",
    inputSchema: {
      type: "object" as const,
      properties: {
        domain: { type: "string" , description: "Domain this call applies to." },
      },
      required: ["domain"],
    },
  },
  {
    name: "get_geo_fixes",
    description: "Get copy-paste robots.txt, Schema.org, FAQ, and llms.txt fixes",
    inputSchema: {
      type: "object" as const,
      properties: {
        domain: { type: "string" , description: "Domain this call applies to." },
      },
      required: ["domain"],
    },
  },
  {
    name: "make_site_geo_ready",
    description: "Generate all GEO assets for a new site in one shot (no API key needed)",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" , description: "Name for this call." },
        url: { type: "string" , description: "URL for this call." },
        description: { type: "string" , description: "Description text." },
        services: { type: "array", items: { type: "string" } , description: "Services to include." },
        email: { type: "string" , description: "Email address." },
        faq: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" , description: "Question text." },
              answer: { type: "string" , description: "Answer text." },
            },
            required: ["question", "answer"],
          },
         description: "FAQ content." },
      },
      required: ["name", "url", "description"],
    },
  },
  {
    name: "suggest_monitoring_config",
    description:
      "Draft a monitoring config (target audiences, location, suggested queries) from a business description — returns JSON plus the API calls to apply it on causabi.com",
    inputSchema: {
      type: "object" as const,
      properties: {
        business_name: { type: "string" , description: "Name of the business." },
        business_description: { type: "string" , description: "Description of the business." },
        location: { type: "string" , description: "Location for this call." },
      },
      required: ["business_name", "business_description"],
    },
  },
  {
    name: "get_site_report",
    description:
      "Client-ready report: pass `report_slug` for the full AI mention-rate breakdown (no API key needed), or just `domain` for a crawlability-score-only summary",
    inputSchema: {
      type: "object" as const,
      properties: {
        report_slug: { type: "string" , description: "Slug of the report." },
        domain: { type: "string" , description: "Domain this call applies to." },
      },
      required: [],
    },
  },
];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "geoscore", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "analyze_geo_score":
        out = await analyzeGeoScore(a as never);
        break;
      case "get_geo_fixes":
        out = await getGeoFixes(a as never);
        break;
      case "make_site_geo_ready":
        out = await makeSiteGeoReady(a as never);
        break;
      case "suggest_monitoring_config":
        out = await suggestMonitoringConfig(a as never);
        break;
      case "get_site_report":
        out = await getSiteReport(a as never);
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
