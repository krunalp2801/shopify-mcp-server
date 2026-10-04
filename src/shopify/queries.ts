/**
 * GraphQL documents, kept together so the exact shape sent to Shopify is
 * reviewable in one place rather than scattered through tool handlers.
 *
 * Each selects the smallest useful field set. Admin GraphQL charges by
 * returned fields, and every field also lands in an agent's context window,
 * so there are two separate reasons not to select `*`.
 */

export const SHOP_INFO = /* GraphQL */ `
  query ShopInfo {
    shop {
      name
      myshopifyDomain
      primaryDomain { url }
      currencyCode
      ianaTimezone
      plan { displayName }
    }
  }
`;

export const LIST_ORDERS = /* GraphQL */ `
  query ListOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { email }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const GET_ORDER = /* GraphQL */ `
  query GetOrder($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      note
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { email }
      shippingAddress { name city countryCodeV2 zip }
      lineItems(first: 50) {
        nodes { title quantity sku }
      }
    }
  }
`;

export const LIST_PRODUCTS = /* GraphQL */ `
  query ListProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        totalInventory
        vendor
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const INVENTORY_LEVELS = /* GraphQL */ `
  query InventoryLevels($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      nodes {
        sku
        title
        product { title }
        inventoryItem {
          inventoryLevels(first: 5) {
            nodes {
              location { name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
