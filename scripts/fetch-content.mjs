// Reads the "Chennai Plus Content" Google Sheet (tabs: Hot, Events, Food, Deals) and writes data/content.json.
// The sheet must be shared as "Anyone with the link can view". Its ID lives in data/content-config.json.
import { readFile, writeFile } from "node:fs/promises";

const cfg = JSON.parse(await readFile("data/content-config.json", "utf8"));
if (!cfg.sheetId) { console.log("No sheet connected yet; skipping content."); process.exit(0); }

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function tab(name) {
  const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${name} tab HTTP ${r.status}`);
  const [head, ...body] = parseCSV(await r.text());
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || "").trim()])))
    .filter((r) => Object.values(r).some(Boolean) && !/^no$/i.test(r.show || "yes"));
}
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const isoDate = (s) => { if (!s) return ""; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // DD/MM/YYYY
  const d = new Date(s); return isNaN(d) ? "" : d.toISOString().slice(0, 10); };
const link = (s) => (/^https?:\/\//i.test(s) ? s : "");

const out = { updated: new Date().toISOString() };
const safe = async (name, fn) => { try { out[name] = fn(await tab(name[0].toUpperCase() + name.slice(1))); } catch (e) { console.warn(`${name}: ${e.message}`); } };

await safe("hot", (rows) => rows.filter((r) => r.title).map((r) => ({
  type: /event/i.test(r.type) ? "event" : /try|food|dish/i.test(r.type) ? "food" : "place",
  label: r.label || "Trending", title: r.title, where: r.where || "", why: r.why || "", buzz: Math.min(100, Math.max(0, parseInt(r.buzz) || 70)), link: link(r.link) })));
await safe("events", (rows) => rows.map((r) => ({ ...r, date: isoDate(r.date) })).filter((r) => r.title && r.date && r.date >= today)
  .sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, title: r.title, area: r.area || "", time: r.time || "", price: r.price || "", category: r.category || "", link: link(r.link) })));
await safe("food", (rows) => rows.filter((r) => r.name).map((r) => ({ area: r.area || "", name: r.name, meal: r.meal || "", price: r.price || "", veg: r.veg_non_veg || r.veg || "", tag: r.tag || "", link: link(r.link) })));
await safe("deals", (rows) => rows.map((r) => ({ ...r, valid: isoDate(r.valid_till) })).filter((r) => r.offer && (!r.valid || r.valid >= today))
  .map((r) => ({ store: r.store || "", offer: r.offer, valid: r.valid, link: link(r.link) })));

await writeFile("data/content.json", JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out).filter(([k]) => k !== "updated").map(([k, v]) => [k, v.length])));
