// Runs every task through the agent, grades it, and saves results/<label>.json.
// usage: node app/run.mjs --model haiku --repeats 3 --label haiku-r3
import fs from "node:fs";
import { runAgent } from "./agent.mjs";
import { TASKS, grade } from "./grade.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const model = arg("model", "haiku"), repeats = Number(arg("repeats", 1)), label = arg("label", model), conc = Number(arg("concurrency", 5));
const variant = arg("variant", "base"), only = arg("only", ""), EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const jobs = [];
for (let r = 0; r < repeats; r++) for (const t of TASKS) if (!only || only.split(",").includes(t.id)) jobs.push({ t, r });
const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { t, r } = jobs[next++];
    const run = await runAgent({ prompt: t.prompt, model, variant });
    run.reply = run.reply.replace(EMAIL, "[email redacted]");
    const g = run.ok ? grade(t, run) : { pass: false, checks: {} };
    results.push({ task: t.id, repeat: r, ...run, ...g });
    const fails = Object.entries(g.checks).filter(([, v]) => !v.pass).map(([k, v]) => `${k}(${v.why})`);
    console.log(`${t.id} r${r} ${run.ok ? (g.pass ? "PASS" : "FAIL " + fails.join(" ")) : "ERROR " + run.error}`);
  }
}
await Promise.all(Array.from({ length: conc }, worker));
results.sort((a, b) => a.task.localeCompare(b.task) || a.repeat - b.repeat);
fs.writeFileSync(`results/${label}.json`, JSON.stringify({ model, variant, repeats, date: new Date().toISOString(), results }, null, 1));
const ok = results.filter((x) => x.ok);
console.log(`\n${label}: ${ok.filter((x) => x.pass).length}/${ok.length} tasks fully pass, ${results.length - ok.length} errors, cost $${ok.reduce((s, x) => s + (x.costUsd ?? 0), 0).toFixed(3)}`);
