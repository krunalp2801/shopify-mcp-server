/**
 * Smoke test: start the built server, speak MCP over stdio, assert it
 * advertises exactly the five read-only tools.
 *
 * Unit tests cover the client and the tool logic. This covers the thing they
 * cannot: that the process actually starts, completes the MCP handshake and
 * answers a real tools/list. Kept as a file rather than inline YAML so it can
 * be run by hand with `node .github/scripts/smoke.mjs`.
 */
import { spawn } from "node:child_process";

const EXPECTED = [
  "shopify_shop_info",
  "shopify_list_orders",
  "shopify_get_order",
  "shopify_list_products",
  "shopify_inventory_levels",
];

const srv = spawn("node", ["dist/src/index.js"], { stdio: ["pipe", "pipe", "inherit"] });

let buf = "";
const seen = [];
srv.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) {
      try { seen.push(JSON.parse(line)); } catch { /* not a protocol frame */ }
    }
  }
});

const send = (o) => srv.stdin.write(JSON.stringify(o) + "\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error("smoke: " + msg); srv.kill(); process.exit(1); };

send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ci", version: "1" } },
});
await wait(1500);
send({ jsonrpc: "2.0", method: "notifications/initialized" });
await wait(300);
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
await wait(1500);
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "shopify_inventory_levels", arguments: { belowQuantity: 0 } } });
await wait(1500);
srv.kill();

const init = seen.find((m) => m.id === 1);
if (!init?.result?.serverInfo?.name) fail("no initialize result");

const tools = seen.find((m) => m.id === 2)?.result?.tools ?? [];
const names = tools.map((t) => t.name).sort();
if (names.join(",") !== [...EXPECTED].sort().join(",")) {
  fail(`unexpected tool list: ${names.join(", ")}`);
}
if (!tools.every((t) => t.annotations?.readOnlyHint === true)) {
  fail("a tool is missing readOnlyHint — this server must stay read-only");
}

const call = seen.find((m) => m.id === 3);
let payload;
try { payload = JSON.parse(call?.result?.content?.[0]?.text ?? ""); } catch { fail("tool call returned no JSON"); }
if (!Array.isArray(payload.items)) fail("tool call returned no items array");

console.log(`smoke: ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
console.log(`smoke: ${names.length} read-only tools, inventory call returned ${payload.items.length} row(s)`);
