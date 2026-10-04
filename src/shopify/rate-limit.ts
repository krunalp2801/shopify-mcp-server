/**
 * Shopify's Admin GraphQL API is not rate-limited by request count. It uses a
 * leaky bucket measured in QUERY COST: every response reports what the query
 * cost and how much of the bucket is left. Two cheap queries a second is fine;
 * one expensive one can empty the bucket on its own.
 *
 * Clients that only retry on 429 therefore spend their time being throttled.
 * Reading `extensions.cost` and pausing *before* the next call keeps the
 * bucket healthy, which matters a lot here: an agent will happily fire a
 * dozen tool calls in a row without any sense of pacing.
 */

import type { QueryCost, ThrottleStatus } from "./types.ts";

/** Leave a little headroom so a cost estimate that is slightly low cannot 429. */
const SAFETY_MARGIN = 10;

export interface WaitDecision {
  /** Milliseconds to sleep before issuing the next query. */
  waitMs: number;
  reason: "ok" | "refill";
}

/**
 * How long to wait before a query expected to cost `nextCost`.
 *
 * Pure function of the last throttle status, so it is trivially testable and
 * has no hidden clock dependency.
 */
export function decideWait(
  throttle: ThrottleStatus | undefined,
  nextCost: number,
): WaitDecision {
  if (!throttle) return { waitMs: 0, reason: "ok" };

  const { currentlyAvailable, restoreRate } = throttle;
  const needed = nextCost + SAFETY_MARGIN;

  if (currentlyAvailable >= needed) return { waitMs: 0, reason: "ok" };
  if (restoreRate <= 0) return { waitMs: 1000, reason: "refill" };

  const deficit = needed - currentlyAvailable;
  return { waitMs: Math.ceil((deficit / restoreRate) * 1000), reason: "refill" };
}

/** Tracks the most recent cost report so the next call can pace itself. */
export class CostTracker {
  #throttle: ThrottleStatus | undefined;
  #lastActualCost = 0;

  record(cost: QueryCost | undefined): void {
    if (!cost) return;
    this.#throttle = cost.throttleStatus;
    this.#lastActualCost = cost.actualQueryCost ?? cost.requestedQueryCost;
  }

  get throttle(): ThrottleStatus | undefined {
    return this.#throttle;
  }

  /**
   * Best guess at the next query's cost. Shopify only tells you after the
   * fact, so the last actual cost is the most honest estimate available.
   */
  estimateNextCost(): number {
    return this.#lastActualCost > 0 ? this.#lastActualCost : 20;
  }

  waitBeforeNext(): WaitDecision {
    return decideWait(this.#throttle, this.estimateNextCost());
  }
}

export const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
