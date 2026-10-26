// One-off check: confirms the Rentals tab is readable and lists its column titles (no personal data is saved).
import { writeFile } from "node:fs/promises";
const id = "1VJhNusEoisNS0VHaHdfA1HjP0l-wpF4MVJwJHBHeV54";
const out = {};
for (const tab of ["Rentals", "Form Responses 1", "Form responses 1"]) {
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(tab)}`);
    const t = await r.text(); const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    out[tab] = j.status === "error" ? "missing" : { columns: j.table.cols.map((c) => c.label), rows: j.table.rows.length };
  } catch (e) { out[tab] = "error: " + e.message; }
}
await writeFile("data/rentals-check.json", JSON.stringify(out, null, 1));
console.log(out);
