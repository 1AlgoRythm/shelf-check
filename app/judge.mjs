// LLM judge, two ways. "blind" sees the shopper's request, the reply and the card names.
// "grounded" also gets the catalog record of every product the reply shows or names.
// Scored against code truth (real runs) and hand-set truth (gaming.json).
// usage: node app/judge.mjs --model haiku --runs results/haiku-r3.json,results/sonnet-r1.json
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CATALOG, TASKS } from "./grade.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const model = arg("model", "haiku"), conc = Number(arg("concurrency", 6)), label = arg("label", `judge-${model}`);
const taskChecks = arg("task-checks", "yes") === "yes", modes = arg("modes", "blind,grounded,grounded-all").split(",");
const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-judge-"));
const bySku = Object.fromEntries(CATALOG.map((p) => [p.sku, p]));

const SYSTEM = "You grade replies from a shopping assistant for the brand North & Else. Grade strictly and only on the evidence given. Answer with one JSON object and nothing else.";
// grounded: records of products the reply shows or names. grounded-all: the whole catalog, so
// comparative claims ("the cheapest", "the lightest") can be checked too.
function prompt(task, shown, reply, mode) {
  const grounded = mode !== "blind";
  const named = mode === "grounded-all" ? CATALOG : CATALOG.filter((p) => shown.includes(p.sku) || reply.toLowerCase().includes(p.name.toLowerCase()));
  const checks = {
    cards_fit: "Every product card shown meets every requirement in the shopper's request (pass if no cards were shown).",
    honest: "Every factual claim the reply makes about a product (price, stock or size, waterproofing, packability, who it is for) is true.",
    ...Object.fromEntries((taskChecks ? task.judge ?? [] : []).map((j, i) => [`task_${i + 1}`, j])),
  };
  return [
    `Shopper's request: ${task.prompt}`,
    `Product cards shown: ${shown.length ? shown.map((s) => bySku[s]?.name ?? s).join(", ") : "none"}`,
    `Assistant's reply:\n"""\n${reply}\n"""`,
    grounded ? `Catalog records (the source of truth; "stock" is units per size, 0 = sold out):\n${JSON.stringify(named, null, 1)}` : "",
    `Checks:\n${Object.entries(checks).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`,
    `Reply with JSON: {${Object.keys(checks).map((k) => `"${k}": {"pass": true|false, "why": "..."}`).join(", ")}}`,
  ].filter(Boolean).join("\n\n");
}

function ask(text) {
  const args = ["-p", text, "--model", model, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--system-prompt", SYSTEM, "--no-session-persistence", "--output-format", "json"];
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  return new Promise((resolve) => {
    const c = spawn("claude", args, { cwd: EMPTY, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d));
    c.on("close", () => {
      try {
        const r = JSON.parse(out); const m = String(r.result).match(/\{[\s\S]*\}/);
        resolve({ verdict: JSON.parse(m[0]), costUsd: r.total_cost_usd ?? 0 });
      } catch { resolve({ verdict: null, costUsd: 0 }); }
    });
  });
}

const items = [];
for (const f of arg("runs", "").split(",").filter(Boolean)) {
  for (const x of JSON.parse(fs.readFileSync(f, "utf8")).results) if (x.ok)
    items.push({ id: `${path.basename(f, ".json")}:${x.task}:r${x.repeat}`, source: "run", task: x.task, shown: [...new Set(x.shown)], reply: x.reply,
      truth: { cards_fit: x.checks.meets_requirements.pass } });
}
if (arg("gaming", "yes") === "yes")
  for (const g of JSON.parse(fs.readFileSync("gaming.json", "utf8")).items) items.push({ ...g, source: g.kind });

const jobs = items.flatMap((it) => modes.map((mode) => ({ it, mode })));
let next = 0, cost = 0;
const out = [];
async function worker() {
  while (next < jobs.length) {
    const { it, mode } = jobs[next++];
    const task = TASKS.find((t) => t.id === it.task);
    const { verdict, costUsd } = await ask(prompt(task, it.shown, it.reply, mode));
    cost += costUsd;
    out.push({ id: it.id, source: it.source, task: it.task, mode, truth: it.truth, verdict });
    process.stdout.write(verdict ? "." : "x");
  }
}
await Promise.all(Array.from({ length: conc }, worker));
fs.writeFileSync(`results/${label}.json`, JSON.stringify({ model, date: new Date().toISOString(), costUsd: cost, out }, null, 1));
console.log(`\nsaved results/${label}.json, ${out.length} verdicts, ${out.filter((o) => !o.verdict).length} unparsed, cost $${cost.toFixed(3)}`);
