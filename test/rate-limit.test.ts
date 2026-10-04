import { test } from "node:test";
import assert from "node:assert/strict";

import { CostTracker, decideWait } from "../src/shopify/rate-limit.ts";
import type { ThrottleStatus } from "../src/shopify/types.ts";

const throttle = (currentlyAvailable: number, restoreRate = 50): ThrottleStatus => ({
  maximumAvailable: 1000,
  currentlyAvailable,
  restoreRate,
});

test("no wait when the bucket comfortably covers the next query", () => {
  const d = decideWait(throttle(900), 20);
  assert.equal(d.waitMs, 0);
  assert.equal(d.reason, "ok");
});

test("waits long enough to refill the deficit plus the safety margin", () => {
  // available 5, next costs 45, margin 10 -> deficit 50, restore 50/s -> 1000ms
  const d = decideWait(throttle(5), 45);
  assert.equal(d.reason, "refill");
  assert.equal(d.waitMs, 1000);
});

test("the safety margin alone can trigger a wait", () => {
  // available exactly equals cost, so the margin is what pushes it over
  const d = decideWait(throttle(20), 20);
  assert.ok(d.waitMs > 0, "expected a wait when there is no headroom left");
});

test("a zero restore rate falls back to a fixed pause rather than dividing by zero", () => {
  const d = decideWait(throttle(0, 0), 50);
  assert.equal(d.waitMs, 1000);
  assert.ok(Number.isFinite(d.waitMs));
});

test("no throttle information means no wait", () => {
  assert.equal(decideWait(undefined, 100).waitMs, 0);
});

test("CostTracker estimates the next cost from the last actual cost", () => {
  const t = new CostTracker();
  assert.equal(t.estimateNextCost(), 20, "falls back to a conservative default");

  t.record({ requestedQueryCost: 30, actualQueryCost: 12, throttleStatus: throttle(800) });
  assert.equal(t.estimateNextCost(), 12, "prefers actual over requested");
  assert.equal(t.throttle?.currentlyAvailable, 800);
});

test("CostTracker falls back to requested cost when actual is absent", () => {
  const t = new CostTracker();
  t.record({ requestedQueryCost: 30, throttleStatus: throttle(800) });
  assert.equal(t.estimateNextCost(), 30);
});

test("tracker turns a drained bucket into a real wait", () => {
  const t = new CostTracker();
  t.record({ requestedQueryCost: 100, actualQueryCost: 100, throttleStatus: throttle(10) });
  assert.ok(t.waitBeforeNext().waitMs > 0);
});
