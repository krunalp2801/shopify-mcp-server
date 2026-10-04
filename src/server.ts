/**
 * MCP wiring: registers each tool and renders its result for an agent.
 *
 * Every tool here is READ-ONLY and says so via `readOnlyHint`. That is a
 * deliberate limit, not an unfinished edge: the blast radius of a confused
 * agent with write access to a live storefront is somebody's real order.
 * Writes belong behind an explicit human approval step, which is a different
 * project.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Config } from "./config.ts";
import { MAX_PAGE_SIZE } from "./config.ts";
import { ShopifyClient, ShopifyError, httpTransport } from "./shopify/client.ts";
import { mockTransport } from "./mock/fixtures.ts";
import * as tools from "./tools.ts";

export const VERSION = "0.1.0";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * Errors are returned as tool results rather than thrown. An agent can read a
 * message and change course; an exception just ends the turn.
 */
function fail(err: unknown): ToolResult {
  const message =
    err instanceof ShopifyError
      ? `${err.code}: ${err.message}${err.retryable ? " (retryable)" : ""}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text", text: `Shopify request failed. ${message}` }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function buildClient(config: Config): ShopifyClient {
  const transport =
    config.mode === "live"
      ? httpTransport(config.shop, config.accessToken, config.apiVersion)
      : mockTransport();
  return new ShopifyClient(transport);
}

export function createServer(config: Config, client = buildClient(config)): McpServer {
  const server = new McpServer({ name: "shopify-mcp-server", version: VERSION });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  const limit = z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Items to return, 1 to ${MAX_PAGE_SIZE}. Defaults to 10.`);
  const cursor = z.string().optional().describe("Pagination cursor from a previous call's pageInfo.endCursor.");

  server.registerTool(
    "shopify_shop_info",
    {
      title: "Shop info",
      description:
        "Name, domain, currency, timezone and plan for the connected store. Call this first to confirm which store you are looking at, and whether the server is running on live data or demo fixtures.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => run(async () => ({ mode: config.mode, shop: await tools.shopInfo(client) })),
  );

  server.registerTool(
    "shopify_list_orders",
    {
      title: "List orders",
      description:
        "Recent orders, newest first. Use `query` for Shopify search syntax, for example 'financial_status:paid', 'fulfillment_status:unfulfilled' or 'created_at:>2026-09-01'.",
      inputSchema: {
        limit,
        cursor,
        query: z.string().optional().describe("Shopify order search query."),
      },
      annotations: readOnly,
    },
    async (args) => run(() => tools.listOrders(client, args)),
  );

  server.registerTool(
    "shopify_get_order",
    {
      title: "Get order",
      description:
        "One order in full, with line items and shipping address. Accepts a numeric id, a gid, or an order name like '#1042'.",
      inputSchema: {
        id: z.string().describe("Order id or name, e.g. '5001', 'gid://shopify/Order/5001' or '#1042'."),
      },
      annotations: readOnly,
    },
    async ({ id }) =>
      run(async () => (await tools.getOrder(client, id)) ?? { found: false, id }),
  );

  server.registerTool(
    "shopify_list_products",
    {
      title: "List products",
      description:
        "Products with status and total inventory. Use `query` for Shopify search syntax, for example 'status:active' or a title fragment.",
      inputSchema: {
        limit,
        cursor,
        query: z.string().optional().describe("Shopify product search query."),
      },
      annotations: readOnly,
    },
    async (args) => run(() => tools.listProducts(client, args)),
  );

  server.registerTool(
    "shopify_inventory_levels",
    {
      title: "Inventory levels",
      description:
        "Stock per variant per location, flattened to one row each. Set `belowQuantity` to find what needs restocking, for example belowQuantity: 0 for everything out of stock.",
      inputSchema: {
        limit,
        cursor,
        query: z.string().optional().describe("Variant search query, e.g. a SKU fragment."),
        belowQuantity: z
          .number()
          .int()
          .optional()
          .describe("Only return rows with available stock at or below this number."),
      },
      annotations: readOnly,
    },
    async (args) => run(() => tools.inventoryLevels(client, args)),
  );

  return server;
}
