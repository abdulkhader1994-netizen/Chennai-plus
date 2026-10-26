// Builds data/transit.json from OpenStreetMap route relations: MTC buses, suburban/MRTS trains and Chennai Metro.
// Output: stops [[name,lat,lng]], routes [{m:mode,ref,name,col,s:[stopIndex...]}]. The app plans trips on the phone.
import { writeFile, mkdir } from "node:fs/promises";

const BBOX = "12.68,79.95,13.35,80.35"; // wider Chennai incl. Chengalpattu side and Gummidipoondi line start
const ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const LOG = [];
async function query(q) {
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep + "?data=" + encodeURIComponent(q), { headers: { "User-Agent": "ChennaiPlusBot/1.0 (github.com/abdulkhader1994-netizen/Chennai-plus)" }, signal: AbortSignal.timeout(240000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return (await r.json()).elements;
    } catch (e) { LOG.push(`${ep.split("/")[2]}: ${e.message}`); }
  }
  throw new Error("all map services failed");
}

let els;
try { els = await query(`[out:json][timeout:240];
relation["type"="route"]["route"~"^(bus|train|subway|light_rail|monorail)$"](${BBOX})->.r;
.r out body;
node(r.r);
out;`);
} catch (e) {
  await mkdir("data", { recursive: true });
  await writeFile("data/transit-log.json", JSON.stringify({ at: new Date().toISOString(), error: e.message, log: LOG }, null, 1));
  console.warn(e.message, LOG); process.exit(0);
}
const nodes = new Map(els.filter((e) => e.type === "node").map((e) => [e.id, e]));
const rels = els.filter((e) => e.type === "relation");

const stops = [], stopKey = new Map();
const stopIdx = (n) => {
  const name = (n.tags?.["name:en"] || n.tags?.name || "").trim();
  if (!name) return -1;
  const k = name.toLowerCase() + "|" + n.lat.toFixed(3) + "," + n.lon.toFixed(3);
  if (!stopKey.has(k)) { stopKey.set(k, stops.length); stops.push([name, +n.lat.toFixed(5), +n.lon.toFixed(5)]); }
  return stopKey.get(k);
};
const MODE = { bus: "bus", train: "train", subway: "metro", light_rail: "metro", monorail: "metro" };
const routes = [];
for (const r of rels) {
  const t = r.tags || {};
  const seq = [];
  for (const m of r.members || []) {
    if (m.type !== "node" || !/^(stop|platform)/.test(m.role || "")) continue;
    const n = nodes.get(m.ref); if (!n) continue;
    const i = stopIdx(n); if (i < 0) continue;
    const prev = seq.at(-1);
    if (prev !== undefined && (prev === i || stops[prev][0].toLowerCase() === stops[i][0].toLowerCase())) continue;
    seq.push(i);
  }
  if (seq.length < 2) continue;
  routes.push({ m: MODE[t.route], ref: t.ref || "", name: t.name || t["name:en"] || "", from: t.from || "", to: t.to || "", col: t.colour || "", s: seq });
}
const count = (m) => routes.filter((r) => r.m === m).length;
const summary = { stops: stops.length, bus: count("bus"), train: count("train"), metro: count("metro"), busRefs: new Set(routes.filter((r) => r.m === "bus").map((r) => r.ref)).size };
console.log(summary, LOG);
if (!routes.length) { console.warn("No routes; keeping previous file."); process.exit(0); }
await mkdir("data", { recursive: true });
await writeFile("data/transit.json", JSON.stringify({ updated: new Date().toISOString(), summary, stops, routes }));
await writeFile("data/transit-log.json", JSON.stringify({ at: new Date().toISOString(), summary, log: LOG, sample: routes.filter(r=>r.m!=="bus").slice(0,12).map(r=>[r.m,r.ref,r.name,r.col,r.s.length]).concat(routes.filter(r=>r.m==="bus").slice(0,8).map(r=>[r.m,r.ref,r.name,r.s.length])) }, null, 1));
