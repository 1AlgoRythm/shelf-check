// A tiny branded shopping MCP server for the fictional brand North & Else, shaped like the
// branded apps Thankly ships into ChatGPT and Claude: catalog search, product detail, and a
// tool that renders product cards. Every card shown is appended to SHELF_LOG for grading.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { products: CATALOG } = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));
const LOG = process.env.SHELF_LOG;
const log = (event) => LOG && fs.appendFileSync(LOG, JSON.stringify(event) + "\n");

const inStock = (p) => Object.entries(p.stock).filter(([, n]) => n > 0).map(([s]) => s);
const view = (p) => ({ sku: p.sku, name: p.name, category: p.category, audience: p.audience, price_usd: p.price,
  water: p.water, packable: p.packable, weight_g: p.weight_g, colors: p.colors, sizes_in_stock: inStock(p),
  sizes_sold_out: Object.keys(p.stock).filter((s) => p.stock[s] === 0), description: p.description });

const server = new McpServer(
  { name: "north-and-else", version: "1.0.0" },
  { instructions: "North & Else catalog. search_products finds products; get_product returns one product; show_products renders product cards for the shopper." },
);

server.registerTool("search_products", {
  title: "Search products",
  description: "Search the North & Else catalog. All filters are optional. Returns live price and stock.",
  inputSchema: {
    query: z.string().optional().describe("Free text, e.g. 'rain jacket' or 'fleece'"),
    category: z.enum(["rain-jacket", "insulated-jacket", "fleece", "rain-pants", "pants", "shoes", "trail-shoes", "boots", "bag", "accessory"]).optional(),
    max_price_usd: z.number().optional(),
  },
}, async ({ query, category, max_price_usd }) => {
  const words = (query ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const hits = CATALOG.filter((p) =>
    (!category || p.category === category) &&
    (max_price_usd == null || p.price <= max_price_usd) &&
    (!words.length || words.some((w) => `${p.name} ${p.category} ${p.water} ${p.description}`.toLowerCase().includes(w))));
  log({ tool: "search_products", input: { query, category, max_price_usd }, hits: hits.map((p) => p.sku) });
  return { content: [{ type: "text", text: hits.length ? JSON.stringify(hits.map(view), null, 1) : "No products matched." }] };
});

server.registerTool("get_product", {
  title: "Get product",
  description: "Get one North & Else product by SKU, with live price and stock by size.",
  inputSchema: { sku: z.string() },
}, async ({ sku }) => {
  const p = CATALOG.find((x) => x.sku === sku);
  log({ tool: "get_product", input: { sku }, found: !!p });
  return { content: [{ type: "text", text: p ? JSON.stringify(view(p), null, 1) : `No product with SKU ${sku}.` }] };
});

const BADGES = process.env.SHELF_VARIANT === "badges";
const WATER = { none: 0, "water-resistant": 1, waterproof: 2 };
// Fix B: what the card itself says a product misses, from catalog data, never from the model.
function badgesFor(p, req = {}) {
  const b = [];
  if (req.size && !((p.stock[req.size] ?? 0) > 0)) b.push(p.stock[req.size] === 0 ? `Sold out in ${req.size}` : `Not made in ${req.size}`);
  if (req.max_price_usd != null && p.price > req.max_price_usd) b.push(`$${p.price - req.max_price_usd} over your $${req.max_price_usd} budget`);
  if (req.water && WATER[p.water] < WATER[req.water]) b.push(p.water === "none" ? "Not waterproof" : "Water-resistant, not waterproof");
  if (req.packable && !p.packable) b.push("Not packable");
  if (req.audience && p.audience !== req.audience) b.push(`Made for ${p.audience}`);
  return b;
}
const requirements = z.object({
  size: z.string().optional(), max_price_usd: z.number().optional(),
  water: z.enum(["water-resistant", "waterproof"]).optional(), packable: z.boolean().optional(), audience: z.enum(["adult", "kids"]).optional(),
}).describe("What the shopper asked for. Leave out anything they did not ask for.");

server.registerTool("show_products", {
  title: "Show product cards",
  description: "Render product cards in the chat for the products you are recommending. Pass the SKUs in the order to show them." +
    (BADGES ? " Pass the shopper's requirements; each card shows any requirement that product misses." : ""),
  inputSchema: BADGES ? { skus: z.array(z.string()).min(1), requirements } : { skus: z.array(z.string()).min(1) },
}, async ({ skus, requirements: req }) => {
  const known = skus.filter((s) => CATALOG.some((p) => p.sku === s));
  const badges = BADGES ? Object.fromEntries(known.map((s) => [s, badgesFor(CATALOG.find((p) => p.sku === s), req)]).filter(([, b]) => b.length)) : {};
  log({ tool: "show_products", input: { skus, requirements: req }, known, badges });
  const unknown = skus.filter((s) => !known.includes(s));
  const badgeText = Object.entries(badges).map(([s, b]) => `${s}: ${b.join("; ")}`).join(". ");
  return { content: [{ type: "text", text: `Displayed ${known.length} product card(s).` + (badgeText ? ` Cards show these warnings to the shopper: ${badgeText}.` : "") +
    (unknown.length ? ` Unknown SKU(s) not shown: ${unknown.join(", ")}.` : "") }] };
});

await server.connect(new StdioServerTransport());
