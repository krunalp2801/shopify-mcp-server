/** Shapes returned by the Admin GraphQL API, narrowed to what the tools use. */

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface QueryCost {
  requestedQueryCost: number;
  actualQueryCost?: number;
  throttleStatus: ThrottleStatus;
}

export interface GraphQLError {
  message: string;
  extensions?: { code?: string; [k: string]: unknown };
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: { cost?: QueryCost };
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface ShopInfo {
  name: string;
  myshopifyDomain: string;
  primaryDomain: { url: string } | null;
  currencyCode: string;
  ianaTimezone: string;
  plan: { displayName: string } | null;
}

export interface OrderLineItem {
  title: string;
  quantity: number;
  sku: string | null;
}

export interface OrderSummary {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: Money };
  customerEmail: string | null;
}

export interface OrderDetail extends OrderSummary {
  note: string | null;
  shippingAddress: {
    name: string | null;
    city: string | null;
    countryCodeV2: string | null;
    zip: string | null;
  } | null;
  lineItems: { nodes: OrderLineItem[] };
}

export interface ProductSummary {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number | null;
  vendor: string | null;
}

export interface InventoryLevelRow {
  sku: string | null;
  productTitle: string;
  variantTitle: string | null;
  available: number | null;
  location: string;
}

export interface Page<T> {
  items: T[];
  pageInfo: PageInfo;
}
