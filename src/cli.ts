#!/usr/bin/env node
/**
 * geoscore CLI.
 *
 *   geoscore analyze_geo_score '<json>'
 *   geoscore get_geo_fixes '<json>'
 *   geoscore make_site_geo_ready '<json>'
 *   geoscore suggest_monitoring_config '<json>'
 *   geoscore get_site_report '<json>'
 *   geoscore mcp
 *   geoscore --version
 *
 * Each tool subcommand takes one JSON argument string
 * with the tool's arguments and prints the tool's
 * result text. Exit codes: 0 success, 1 runtime error,
 * 2 usage error.
 */
import {
  analyzeGeoScore,
  getGeoFixes,
  getSiteReport,
  makeSiteGeoReady,
  suggestMonitoringConfig,
  VERSION,
} from "./geo.js";

const TOOL_NAMES = [
  "analyze_geo_score",
  "get_geo_fixes",
  "make_site_geo_ready",
  "suggest_monitoring_config",
  "get_site_report",
] as const;

function usage(): never {
  console.error(`Usage:
  geoscore <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  geoscore mcp
  geoscore --version`);
  process.exit(2);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "analyze_geo_score":
      return analyzeGeoScore(args as never);
    case "get_geo_fixes":
      return getGeoFixes(args as never);
    case "make_site_geo_ready":
      return makeSiteGeoReady(args as never);
    case "suggest_monitoring_config":
      return suggestMonitoringConfig(args as never);
    case "get_site_report":
      return getSiteReport(args as never);
    default:
      usage();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
