// Runs one shopper question through Claude Code headless (`claude -p`), connected only to the
// North & Else server, in a fresh session. Returns the reply text, every tool call, and the
// product cards shown (read from the server's own log, not from the model's account of it).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-cwd-")); // no CLAUDE.md, no .mcp.json

// The brand playbook, written the way Thankly's playbook fields read in its OpenAPI document
// (goal, tone_hint, must_mention, must_not_mention). This text is ours, not Thankly's.
const BASE_PLAYBOOK = [
  "You are the North & Else shopping assistant inside a chat app.",
  "Goal: help the shopper find North & Else products that fit what they asked for.",
  "Tone: warm, brief, practical.",
  "Rules:",
  "- Recommend only North & Else products returned by the tools. Use live price and stock from the tools.",
  "- When you recommend products, call show_products with their SKUs so the shopper sees product cards.",
  "- Must not mention: other brands or stores; delivery dates or shipping speed; discount codes.",
];
// Fix A (prompt): one more rule. Fix B (badges): show_products takes the shopper's
// requirements and the card itself shows what a product misses, computed from the catalog.
const EXTRA = {
  base: [],
  prompt: ["- Show cards only for products that meet every requirement the shopper gave. If none do, say so plainly in your reply; the shopper reads your reply, not your reasoning."],
  badges: ["- Pass the shopper's requirements to show_products. Each card then shows, from live catalog data, any requirement that product misses."],
};
export const playbook = (variant = "base") => [...BASE_PLAYBOOK, ...EXTRA[variant]].join("\n");
export const PLAYBOOK = playbook("base");

export function runAgent({ prompt, model, variant = "base", timeoutMs = 180000 }) {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shelf-log-")), "tools.jsonl");
  const mcpConfig = { mcpServers: { shop: { command: process.execPath, args: [path.join(ROOT, "server/shop-mcp.mjs")], env: { SHELF_LOG: logFile, SHELF_VARIANT: variant } } } };
  const args = [
    "-p", prompt, "--model", model,
    "--strict-mcp-config", "--mcp-config", JSON.stringify(mcpConfig),
    "--tools", "", "--allowedTools", "mcp__shop__*",
    "--system-prompt", playbook(variant),
    "--no-session-persistence", "--output-format", "stream-json", "--verbose",
  ];
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("claude", args, { cwd: EMPTY_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      let resolvedModel = "", costUsd = null;
      const texts = [];
      for (const line of out.split("\n")) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === "system" && e.subtype === "init") resolvedModel = e.model ?? "";
        if (e.type === "result") costUsd = e.total_cost_usd ?? null;
        if (e.type === "assistant") for (const b of e.message?.content ?? []) if (b.type === "text" && b.text.trim()) texts.push(b.text.trim());
      }
      const tools = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      resolve({
        ok: code === 0, error: code === 0 ? "" : (err.trim().split("\n").pop() || `claude exited ${code}`),
        model: resolvedModel, ms: Date.now() - started, costUsd,
        tools, shown: tools.filter((t) => t.tool === "show_products").flatMap((t) => t.input.skus),
        badges: Object.assign({}, ...tools.filter((t) => t.tool === "show_products").map((t) => t.badges ?? {})),
        reply: texts.join("\n\n"),
      });
    });
  });
}
