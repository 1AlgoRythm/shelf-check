// Pass counts per check for each results file. usage: node app/summary.mjs results/a.json ...
import fs from "node:fs";
const CHECKS = ["exists", "prices_accurate", "no_other_brands", "shows_a_product", "right_product", "not_excluded", "bundle_fits", "meets_requirements", "no_silent_bad_cards"];
const rows = process.argv.slice(2).map((f) => {
  const d = JSON.parse(fs.readFileSync(f, "utf8")); const ok = d.results.filter((x) => x.ok);
  const cell = (c) => { const r = ok.filter((x) => x.checks[c]); return r.length ? `${r.filter((x) => x.checks[c].pass).length}/${r.length}` : "-"; };
  const badCards = ok.reduce((n, x) => n + (x.checks.meets_requirements.why ? x.checks.meets_requirements.why.split("; ").length : 0), 0);
  const silent = ok.reduce((n, x) => n + (x.checks.no_silent_bad_cards?.why ? x.checks.no_silent_bad_cards.why.split(", ").length : 0), 0);
  const short = ok.filter((x) => x.reply.length < 200).length;
  return [f.replace(/^results\/|\.json$/g, ""), ...CHECKS.map(cell), String(badCards), String(silent), `${short}/${ok.length}`];
});
const head = ["run", ...CHECKS, "bad cards", "bad cards with no warning", "replies under 200 chars"];
console.log("| " + head.join(" | ") + " |\n|" + head.map(() => "---").join("|") + "|");
for (const r of rows) console.log("| " + r.join(" | ") + " |");
