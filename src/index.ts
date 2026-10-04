#!/usr/bin/env node
/**
 * Entry point. Speaks MCP over stdio, which is what Claude Desktop and
 * Claude Code launch.
 *
 * Nothing may be written to stdout except protocol frames, so every
 * diagnostic goes to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createServer, VERSION } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.mode === "mock") {
    console.error(
      `shopify-mcp-server ${VERSION} starting in MOCK mode (demo fixtures). ` +
        `Set SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN for live data.`,
    );
  } else {
    console.error(
      `shopify-mcp-server ${VERSION} starting in LIVE mode against ` +
        `${config.shop}.myshopify.com (API ${config.apiVersion}), read-only.`,
    );
  }

  const server = createServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  console.error("shopify-mcp-server failed to start:", err);
  process.exit(1);
});
