/**
 * Fixture store used when no access token is configured.
 *
 * The numbers are deliberately a bit messy: a refunded order, an unfulfilled
 * one sitting older than the rest, a variant that is out of stock in one
 * location but not another. A demo where everything is tidy teaches an agent
 * nothing about what real store data looks like.
 */

import type { Transport } from "../shopify/client.ts";

const ORDERS = [
  {
    id: "gid://shopify/Order/5001",
    name: "#1042",
    createdAt: "2026-09-29T08:14:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    totalPriceSet: { shopMoney: { amount: "148.00", currencyCode: "EUR" } },
    customer: { email: "m.weber@example.de" },
    note: null,
    shippingAddress: { name: "Marie Weber", city: "Frankfurt am Main", countryCodeV2: "DE", zip: "60311" },
    lineItems: {
      nodes: [
        { title: "Gift Bundle — Classic", quantity: 2, sku: "GB-CLASSIC" },
        { title: "Greeting Card", quantity: 1, sku: "CARD-01" },
      ],
    },
  },
  {
    id: "gid://shopify/Order/5002",
    name: "#1041",
    createdAt: "2026-09-28T16:02:00Z",
    displayFinancialStatus: "PARTIALLY_REFUNDED",
    displayFulfillmentStatus: "FULFILLED",
    totalPriceSet: { shopMoney: { amount: "72.50", currencyCode: "EUR" } },
    customer: { email: "j.schmidt@example.de" },
    note: "Customer reported one damaged item, partial refund issued.",
    shippingAddress: { name: "Jonas Schmidt", city: "Berlin", countryCodeV2: "DE", zip: "10115" },
    lineItems: { nodes: [{ title: "Gift Bundle — Deluxe", quantity: 1, sku: "GB-DELUXE" }] },
  },
  {
    id: "gid://shopify/Order/5003",
    name: "#1038",
    createdAt: "2026-09-24T09:47:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    totalPriceSet: { shopMoney: { amount: "212.00", currencyCode: "EUR" } },
    customer: { email: "a.fischer@example.de" },
    note: "Awaiting restock of GB-DELUXE.",
    shippingAddress: { name: "Anna Fischer", city: "München", countryCodeV2: "DE", zip: "80331" },
    lineItems: {
      nodes: [
        { title: "Gift Bundle — Deluxe", quantity: 3, sku: "GB-DELUXE" },
        { title: "Ribbon Set", quantity: 1, sku: "RIB-02" },
      ],
    },
  },
];

const PRODUCTS = [
  { id: "gid://shopify/Product/9001", title: "Gift Bundle — Classic", handle: "gift-bundle-classic", status: "ACTIVE", totalInventory: 128, vendor: "In-house" },
  { id: "gid://shopify/Product/9002", title: "Gift Bundle — Deluxe", handle: "gift-bundle-deluxe", status: "ACTIVE", totalInventory: 0, vendor: "In-house" },
  { id: "gid://shopify/Product/9003", title: "Greeting Card", handle: "greeting-card", status: "ACTIVE", totalInventory: 940, vendor: "Papier Nord" },
  { id: "gid://shopify/Product/9004", title: "Ribbon Set", handle: "ribbon-set", status: "DRAFT", totalInventory: 36, vendor: "Papier Nord" },
];

const VARIANTS = [
  {
    sku: "GB-CLASSIC", title: "Default", product: { title: "Gift Bundle — Classic" },
    inventoryItem: { inventoryLevels: { nodes: [
      { location: { name: "Frankfurt Warehouse" }, quantities: [{ name: "available", quantity: 94 }] },
      { location: { name: "Hamburg Overflow" }, quantities: [{ name: "available", quantity: 34 }] },
    ] } },
  },
  {
    sku: "GB-DELUXE", title: "Default", product: { title: "Gift Bundle — Deluxe" },
    inventoryItem: { inventoryLevels: { nodes: [
      { location: { name: "Frankfurt Warehouse" }, quantities: [{ name: "available", quantity: 0 }] },
      { location: { name: "Hamburg Overflow" }, quantities: [{ name: "available", quantity: 12 }] },
    ] } },
  },
  {
    sku: "CARD-01", title: "Default", product: { title: "Greeting Card" },
    inventoryItem: { inventoryLevels: { nodes: [
      { location: { name: "Frankfurt Warehouse" }, quantities: [{ name: "available", quantity: 940 }] },
    ] } },
  },
];

const SHOP = {
  name: "Demo Store",
  myshopifyDomain: "demo-store.myshopify.com",
  primaryDomain: { url: "https://demo-store.example" },
  currencyCode: "EUR",
  ianaTimezone: "Europe/Berlin",
  plan: { displayName: "Shopify (demo fixtures)" },
};

function matches(haystack: string, needle: string | undefined): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Mock transport. Dispatches on the GraphQL operation name and replays
 * fixtures, including a plausible `extensions.cost` block so the rate-limit
 * pacing path is exercised in mock mode too rather than only in production.
 */
export function mockTransport(): Transport {
  let remaining = 1000;

  return {
    async send(body: string) {
      const { query, variables = {} } = JSON.parse(body) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const first = Number(variables.first ?? 10);
      const search = typeof variables.query === "string" ? variables.query : undefined;

      let data: unknown;
      let cost = 5;

      if (query.includes("query ShopInfo")) {
        data = { shop: SHOP };
      } else if (query.includes("query ListOrders")) {
        cost = 12;
        const nodes = ORDERS.filter((o) => matches(`${o.name} ${o.customer?.email ?? ""}`, search)).slice(0, first);
        data = { orders: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
      } else if (query.includes("query GetOrder")) {
        cost = 8;
        const id = String(variables.id ?? "");
        const order = ORDERS.find((o) => o.id === id || o.name === id || o.name === `#${id.replace(/^#/, "")}`);
        data = { order: order ?? null };
      } else if (query.includes("query ListProducts")) {
        cost = 10;
        const nodes = PRODUCTS.filter((p) => matches(`${p.title} ${p.vendor ?? ""}`, search)).slice(0, first);
        data = { products: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
      } else if (query.includes("query InventoryLevels")) {
        cost = 18;
        const nodes = VARIANTS.filter((v) => matches(`${v.sku ?? ""} ${v.product.title}`, search)).slice(0, first);
        data = { productVariants: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } };
      } else {
        return { status: 400, text: JSON.stringify({ errors: [{ message: "Unknown operation in mock transport" }] }) };
      }

      remaining = Math.max(0, remaining - cost);
      const payload = {
        data,
        extensions: {
          cost: {
            requestedQueryCost: cost,
            actualQueryCost: cost,
            throttleStatus: { maximumAvailable: 1000, currentlyAvailable: remaining, restoreRate: 50 },
          },
        },
      };
      remaining = Math.min(1000, remaining + 50);
      return { status: 200, text: JSON.stringify(payload) };
    },
  };
}
