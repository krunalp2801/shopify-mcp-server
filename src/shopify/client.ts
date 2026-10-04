/**
 * Thin Admin GraphQL client: pacing, retries, and turning Shopify's error
 * shapes into something an agent can act on.
 *
 * The transport is injected so the whole thing can be driven by fixtures in
 * tests and in mock mode without stubbing global fetch.
 */

import { CostTracker, sleep } from "./rate-limit.ts";
import type { GraphQLResponse } from "./types.ts";

export interface Transport {
  send(body: string): Promise<{ status: number; text: string; retryAfterSec?: number }>;
}

export class ShopifyError extends Error {
  // Declared and assigned rather than using TypeScript parameter properties:
  // those need a real transform, and the tests run under Node's strip-only
  // type stripping, which deliberately does not transform anything.
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "ShopifyError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ClientOptions {
  maxRetries?: number;
  /** Injected so tests do not actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class ShopifyClient {
  readonly #transport: Transport;
  readonly #cost = new CostTracker();
  readonly #maxRetries: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(transport: Transport, opts: ClientOptions = {}) {
    this.#transport = transport;
    this.#maxRetries = opts.maxRetries ?? 3;
    this.#sleep = opts.sleepFn ?? sleep;
  }

  /** Exposed for the diagnostics tool and for assertions in tests. */
  get throttleStatus() {
    return this.#cost.throttle;
  }

  async query<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({ query: document, variables });

    // Pace ourselves from the last cost report rather than waiting to be told off.
    const decision = this.#cost.waitBeforeNext();
    if (decision.waitMs > 0) await this.#sleep(decision.waitMs);

    let lastError: ShopifyError | undefined;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      const res = await this.#transport.send(body);

      if (RETRYABLE_STATUS.has(res.status)) {
        lastError = new ShopifyError(
          `Shopify responded ${res.status}`,
          res.status === 429 ? "THROTTLED" : "UPSTREAM",
          true,
        );
        if (attempt === this.#maxRetries) break;
        // Honour Retry-After when given; otherwise exponential backoff.
        const waitMs = res.retryAfterSec !== undefined
          ? res.retryAfterSec * 1000
          : Math.min(2 ** attempt * 500, 8000);
        await this.#sleep(waitMs);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new ShopifyError(
          "Shopify rejected the access token. Check SHOPIFY_ACCESS_TOKEN and that the app has the required read scopes.",
          "UNAUTHORIZED",
          false,
        );
      }

      if (res.status >= 400) {
        throw new ShopifyError(`Shopify responded ${res.status}`, "HTTP_ERROR", false);
      }

      let parsed: GraphQLResponse<T>;
      try {
        parsed = JSON.parse(res.text) as GraphQLResponse<T>;
      } catch {
        throw new ShopifyError("Shopify returned a response that was not JSON", "BAD_RESPONSE", false);
      }

      this.#cost.record(parsed.extensions?.cost);

      if (parsed.errors?.length) {
        const first = parsed.errors[0]!;
        // A THROTTLED code can arrive with HTTP 200, which is easy to miss.
        const throttled = parsed.errors.some((e) => e.extensions?.code === "THROTTLED");
        if (throttled && attempt < this.#maxRetries) {
          await this.#sleep(Math.min(2 ** attempt * 1000, 8000));
          continue;
        }
        throw new ShopifyError(
          parsed.errors.map((e) => e.message).join("; "),
          String(first.extensions?.code ?? "GRAPHQL_ERROR"),
          throttled,
        );
      }

      if (!parsed.data) {
        throw new ShopifyError("Shopify returned no data", "EMPTY_RESPONSE", false);
      }

      return parsed.data;
    }

    throw lastError ?? new ShopifyError("Request failed", "UNKNOWN", false);
  }
}

/** Live transport: a real HTTPS call to the Admin GraphQL endpoint. */
export function httpTransport(shop: string, token: string, apiVersion: string): Transport {
  const url = `https://${shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`;
  return {
    async send(body: string) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body,
      });
      const retryAfter = res.headers.get("retry-after");
      return {
        status: res.status,
        text: await res.text(),
        ...(retryAfter ? { retryAfterSec: Number(retryAfter) } : {}),
      };
    },
  };
}
