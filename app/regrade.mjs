// Re-applies the current graders to saved runs (no model calls). usage: node app/regrade.mjs results/x.json
import fs from "node:fs";
import { TASKS, grade } from "./grade.mjs";
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const x of d.results) if (x.ok) Object.assign(x, grade(TASKS.find((t) => t.id === x.task), x));
  fs.writeFileSync(f, JSON.stringify(d, null, 1));
  const ok = d.results.filter((x) => x.ok);
  console.log(f, `pass ${ok.filter((x) => x.pass).length}/${ok.length}, pass ignoring card rule ${ok.filter((x) => x.passExceptCards).length}/${ok.length}`);
}
