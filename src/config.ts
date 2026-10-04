/**
 * Configuration, read once from the environment.
 *
 * The server deliberately starts in MOCK mode when no access token is
 * present. A hiring manager (or anyone evaluating this) can clone the repo
 * and get working tool calls in under a minute without a Shopify account,
 * and nobody has to point a half-understood agent at a live store to see
 * what it does.
 */

export type Mode = "live" | "mock";

export interface Config {
  mode: Mode;
  /** Store handle without the .myshopify.com suffix, e.g. "acme-supplies". */
  shop: string;
  accessToken: string;
  /** Shopify Admin API version, e.g. "2025-07". */
  apiVersion: string;
  /** Hard ceiling on items returned per page, to keep agent context small. */
  maxPageSize: number;
}

export const DEFAULT_API_VERSION = "2025-07";
export const MAX_PAGE_SIZE = 50;

function cleanShop(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.myshopify\.com\/?$/, "")
    .replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const accessToken = (env.SHOPIFY_ACCESS_TOKEN ?? "").trim();
  const shop = cleanShop(env.SHOPIFY_SHOP ?? "");
  const forcedMock = (env.SHOPIFY_MCP_MODE ?? "").trim().toLowerCase() === "mock";

  const live = !forcedMock && accessToken !== "" && shop !== "";

  return {
    mode: live ? "live" : "mock",
    shop: shop || "demo-store",
    accessToken,
    apiVersion: (env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION,
    maxPageSize: MAX_PAGE_SIZE,
  };
}

/** Clamp a caller-supplied page size into something sane. */
export function clampPageSize(requested: number | undefined, max = MAX_PAGE_SIZE): number {
  if (requested === undefined || Number.isNaN(requested)) return 10;
  return Math.min(Math.max(Math.trunc(requested), 1), max);
}
