import { test } from "node:test";
import assert from "node:assert/strict";

import { ShopifyClient } from "../src/shopify/client.ts";
import { mockTransport } from "../src/mock/fixtures.ts";
import { clampPageSize, loadConfig } from "../src/config.ts";
import * as tools from "../src/tools.ts";

const client = () => new ShopifyClient(mockTransport(), { sleepFn: async () => {} });

test("shop info comes back from fixtures", async () => {
  const shop = await tools.shopInfo(client());
  assert.equal(shop.currencyCode, "EUR");
  assert.equal(shop.ianaTimezone, "Europe/Berlin");
});

test("orders are returned newest first with the customer email flattened", async () => {
  const page = await tools.listOrders(client(), { limit: 10 });
  assert.ok(page.items.length >= 3);
  assert.equal(page.items[0]?.name, "#1042");
  assert.equal(page.items[0]?.customerEmail, "m.weber@example.de");
  assert.equal(page.pageInfo.hasNextPage, false);
});

test("the order search query filters", async () => {
  const page = await tools.listOrders(client(), { query: "fischer" });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.name, "#1038");
});

test("an order can be fetched by name, by numeric id, or by gid", async () => {
  for (const id of ["#1042", "5001", "gid://shopify/Order/5001"]) {
    const order = await tools.getOrder(client(), id);
    assert.ok(order, `expected to resolve ${id}`);
    assert.equal(order.name, "#1042");
    assert.equal(order.lineItems.nodes.length, 2);
  }
});

test("an unknown order resolves to null rather than throwing", async () => {
  assert.equal(await tools.getOrder(client(), "gid://shopify/Order/999999"), null);
});

test("normaliseOrderId only rewrites bare numbers", () => {
  assert.equal(tools.normaliseOrderId("5001"), "gid://shopify/Order/5001");
  assert.equal(tools.normaliseOrderId("gid://shopify/Order/5001"), "gid://shopify/Order/5001");
  assert.equal(tools.normaliseOrderId("#1042"), "#1042");
});

test("products include a draft and an out-of-stock item", async () => {
  const page = await tools.listProducts(client(), { limit: 10 });
  assert.ok(page.items.some((p) => p.status === "DRAFT"));
  assert.ok(page.items.some((p) => p.totalInventory === 0));
});

test("inventory is flattened to one row per variant and location", async () => {
  const page = await tools.inventoryLevels(client(), { limit: 10 });
  const classic = page.items.filter((r) => r.sku === "GB-CLASSIC");
  assert.equal(classic.length, 2, "GB-CLASSIC is stocked in two locations");
  assert.deepEqual(
    classic.map((r) => r.location).sort(),
    ["Frankfurt Warehouse", "Hamburg Overflow"],
  );
});

test("belowQuantity finds what needs restocking", async () => {
  const page = await tools.inventoryLevels(client(), { limit: 10, belowQuantity: 0 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sku, "GB-DELUXE");
  assert.equal(page.items[0]?.available, 0);
  assert.equal(page.items[0]?.location, "Frankfurt Warehouse");
});

test("page size is clamped so an agent cannot ask for the whole catalogue", () => {
  assert.equal(clampPageSize(undefined), 10);
  assert.equal(clampPageSize(5), 5);
  assert.equal(clampPageSize(9999), 50);
  assert.equal(clampPageSize(0), 1);
  assert.equal(clampPageSize(-3), 1);
});

test("config defaults to mock mode and only goes live with both shop and token", () => {
  assert.equal(loadConfig({}).mode, "mock");
  assert.equal(loadConfig({ SHOPIFY_SHOP: "acme" }).mode, "mock", "shop alone is not enough");
  assert.equal(loadConfig({ SHOPIFY_ACCESS_TOKEN: "shpat_x" }).mode, "mock", "token alone is not enough");

  const live = loadConfig({ SHOPIFY_SHOP: "acme", SHOPIFY_ACCESS_TOKEN: "shpat_x" });
  assert.equal(live.mode, "live");
  assert.equal(live.shop, "acme");
});

test("the shop handle is normalised from whatever form it is pasted in", () => {
  for (const raw of ["acme", "acme.myshopify.com", "https://acme.myshopify.com", "https://acme.myshopify.com/"]) {
    const c = loadConfig({ SHOPIFY_SHOP: raw, SHOPIFY_ACCESS_TOKEN: "shpat_x" });
    assert.equal(c.shop, "acme", `failed to normalise ${raw}`);
  }
});

test("SHOPIFY_MCP_MODE=mock forces fixtures even with credentials present", () => {
  const c = loadConfig({ SHOPIFY_SHOP: "acme", SHOPIFY_ACCESS_TOKEN: "shpat_x", SHOPIFY_MCP_MODE: "mock" });
  assert.equal(c.mode, "mock");
});
