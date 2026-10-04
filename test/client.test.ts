import { test } from "node:test";
import assert from "node:assert/strict";

import { ShopifyClient, ShopifyError, type Transport } from "../src/shopify/client.ts";

/** Transport that replays a scripted list of responses and records the waits. */
function scripted(responses: { status: number; text: string; retryAfterSec?: number }[]) {
  const calls: string[] = [];
  const waits: number[] = [];
  const transport: Transport = {
    async send(body) {
      calls.push(body);
      const next = responses.shift();
      if (!next) throw new Error("scripted transport ran out of responses");
      return next;
    },
  };
  return { transport, calls, waits };
}

const okBody = (data: unknown, available = 900) =>
  JSON.stringify({
    data,
    extensions: {
      cost: {
        requestedQueryCost: 10,
        actualQueryCost: 10,
        throttleStatus: { maximumAvailable: 1000, currentlyAvailable: available, restoreRate: 50 },
      },
    },
  });

test("returns data on a clean response", async () => {
  const { transport } = scripted([{ status: 200, text: okBody({ shop: { name: "Demo" } }) }]);
  const client = new ShopifyClient(transport, { sleepFn: async () => {} });
  const data = await client.query<{ shop: { name: string } }>("query ShopInfo { shop { name } }");
  assert.equal(data.shop.name, "Demo");
});

test("records throttle status so later calls can pace themselves", async () => {
  const { transport } = scripted([{ status: 200, text: okBody({ shop: {} }, 420) }]);
  const client = new ShopifyClient(transport, { sleepFn: async () => {} });
  await client.query("query ShopInfo { shop { name } }");
  assert.equal(client.throttleStatus?.currentlyAvailable, 420);
});

test("retries a 429 and succeeds", async () => {
  const { transport, waits } = scripted([
    { status: 429, text: "", retryAfterSec: 2 },
    { status: 200, text: okBody({ shop: { name: "Demo" } }) },
  ]);
  const client = new ShopifyClient(transport, { sleepFn: async (ms) => void waits.push(ms) });
  const data = await client.query<{ shop: { name: string } }>("q");
  assert.equal(data.shop.name, "Demo");
  assert.ok(waits.includes(2000), `expected to honour Retry-After, waited ${waits.join(",")}`);
});

test("gives up after maxRetries and reports it as retryable", async () => {
  const { transport } = scripted([
    { status: 503, text: "" },
    { status: 503, text: "" },
  ]);
  const client = new ShopifyClient(transport, { maxRetries: 1, sleepFn: async () => {} });
  await assert.rejects(
    () => client.query("q"),
    (err: unknown) => err instanceof ShopifyError && err.retryable && err.code === "UPSTREAM",
  );
});

test("a THROTTLED error arriving with HTTP 200 is retried, not surfaced", async () => {
  const { transport } = scripted([
    { status: 200, text: JSON.stringify({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }) },
    { status: 200, text: okBody({ shop: { name: "Demo" } }) },
  ]);
  const client = new ShopifyClient(transport, { sleepFn: async () => {} });
  const data = await client.query<{ shop: { name: string } }>("q");
  assert.equal(data.shop.name, "Demo");
});

test("401 is not retried and names the likely cause", async () => {
  const { transport, calls } = scripted([{ status: 401, text: "" }]);
  const client = new ShopifyClient(transport, { sleepFn: async () => {} });
  await assert.rejects(
    () => client.query("q"),
    (err: unknown) =>
      err instanceof ShopifyError && err.code === "UNAUTHORIZED" && !err.retryable &&
      /SHOPIFY_ACCESS_TOKEN/.test(err.message),
  );
  assert.equal(calls.length, 1, "must not retry an auth failure");
});

test("a non-JSON body is reported clearly rather than throwing a parse error", async () => {
  const { transport } = scripted([{ status: 200, text: "<html>maintenance</html>" }]);
  const client = new ShopifyClient(transport, { sleepFn: async () => {} });
  await assert.rejects(
    () => client.query("q"),
    (err: unknown) => err instanceof ShopifyError && err.code === "BAD_RESPONSE",
  );
});

test("a GraphQL error is surfaced with its code", async () => {
  const { transport } = scripted([
    { status: 200, text: JSON.stringify({ errors: [{ message: "Field 'nope' doesn't exist", extensions: { code: "undefinedField" } }] }) },
  ]);
  const client = new ShopifyClient(transport, { sleepFn: async () => {} });
  await assert.rejects(
    () => client.query("q"),
    (err: unknown) => err instanceof ShopifyError && err.code === "undefinedField" && !err.retryable,
  );
});
