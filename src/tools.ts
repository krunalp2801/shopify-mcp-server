/**
 * Tool implementations, kept as plain async functions that take a client.
 *
 * Deliberately separate from MCP registration: these are the part worth
 * testing, and testing them should not require standing up a server or a
 * transport. `server.ts` wraps each one in a thin adapter.
 */

import type { ShopifyClient } from "./shopify/client.ts";
import * as Q from "./shopify/queries.ts";
import { clampPageSize } from "./config.ts";
import type {
  InventoryLevelRow,
  OrderDetail,
  OrderSummary,
  Page,
  PageInfo,
  ProductSummary,
  ShopInfo,
} from "./shopify/types.ts";

/** Shopify order ids may arrive as a gid, a bare number, or "#1042". */
export function normaliseOrderId(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("gid://")) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/Order/${t}`;
  return t; // a name like "#1042"; the mock resolves it, live callers should pass an id
}

export async function shopInfo(client: ShopifyClient): Promise<ShopInfo> {
  const data = await client.query<{ shop: ShopInfo }>(Q.SHOP_INFO);
  return data.shop;
}

export interface ListOrdersArgs {
  limit?: number;
  /** Shopify search syntax, e.g. "financial_status:paid created_at:>2026-09-01". */
  query?: string;
  cursor?: string;
}

export async function listOrders(
  client: ShopifyClient,
  args: ListOrdersArgs = {},
): Promise<Page<OrderSummary>> {
  type R = {
    orders: {
      nodes: (Omit<OrderSummary, "customerEmail"> & { customer: { email: string | null } | null })[];
      pageInfo: PageInfo;
    };
  };
  const data = await client.query<R>(Q.LIST_ORDERS, {
    first: clampPageSize(args.limit),
    after: args.cursor ?? null,
    query: args.query ?? null,
  });
  return {
    items: data.orders.nodes.map(({ customer, ...o }) => ({ ...o, customerEmail: customer?.email ?? null })),
    pageInfo: data.orders.pageInfo,
  };
}

export async function getOrder(client: ShopifyClient, id: string): Promise<OrderDetail | null> {
  type R = {
    order:
      | (Omit<OrderDetail, "customerEmail"> & { customer: { email: string | null } | null })
      | null;
  };
  const data = await client.query<R>(Q.GET_ORDER, { id: normaliseOrderId(id) });
  if (!data.order) return null;
  const { customer, ...order } = data.order;
  return { ...order, customerEmail: customer?.email ?? null };
}

export interface ListProductsArgs {
  limit?: number;
  query?: string;
  cursor?: string;
}

export async function listProducts(
  client: ShopifyClient,
  args: ListProductsArgs = {},
): Promise<Page<ProductSummary>> {
  type R = { products: { nodes: ProductSummary[]; pageInfo: PageInfo } };
  const data = await client.query<R>(Q.LIST_PRODUCTS, {
    first: clampPageSize(args.limit),
    after: args.cursor ?? null,
    query: args.query ?? null,
  });
  return { items: data.products.nodes, pageInfo: data.products.pageInfo };
}

export interface InventoryArgs {
  limit?: number;
  query?: string;
  cursor?: string;
  /** Only return rows at or below this quantity. Useful for restock checks. */
  belowQuantity?: number;
}

export async function inventoryLevels(
  client: ShopifyClient,
  args: InventoryArgs = {},
): Promise<Page<InventoryLevelRow>> {
  type Variant = {
    sku: string | null;
    title: string | null;
    product: { title: string };
    inventoryItem: {
      inventoryLevels: {
        nodes: { location: { name: string }; quantities: { name: string; quantity: number }[] }[];
      };
    };
  };
  type R = { productVariants: { nodes: Variant[]; pageInfo: PageInfo } };

  const data = await client.query<R>(Q.INVENTORY_LEVELS, {
    first: clampPageSize(args.limit),
    after: args.cursor ?? null,
    query: args.query ?? null,
  });

  // One row per variant-location pair: "how many, and where" is the question
  // a restock decision actually needs, and a nested shape makes an agent walk
  // the tree itself.
  const rows: InventoryLevelRow[] = [];
  for (const v of data.productVariants.nodes) {
    for (const level of v.inventoryItem.inventoryLevels.nodes) {
      const available = level.quantities.find((q) => q.name === "available")?.quantity ?? null;
      if (args.belowQuantity !== undefined && (available ?? Infinity) > args.belowQuantity) continue;
      rows.push({
        sku: v.sku,
        productTitle: v.product.title,
        variantTitle: v.title,
        available,
        location: level.location.name,
      });
    }
  }
  return { items: rows, pageInfo: data.productVariants.pageInfo };
}
