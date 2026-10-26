// Builds data/transit.json for the trip planner.
//  - Buses (and Metro if present): community Chennai GTFS feed (github.com/ungalsoththu/ChennaiGTFS, listed as mdb-3360 on mobilitydatabase.org)
//  - Suburban/MRTS trains (and Metro fallback): OpenStreetMap route relations
// Output: stops [[name,lat,lng]], routes [{m:"bus"|"train"|"metro", ref, name, col, s:[stopIndex...]}]
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";

const LOG = [];
const stops = [], stopKey = new Map(), routes = [];
const addStop = (name, lat, lng) => {
  name = (name || "").replace(/\s+/g, " ").trim(); if (!name || !isFinite(lat) || !isFinite(lng)) return -1;
  const k = name.toLowerCase() + "|" + (+lat).toFixed(3) + "," + (+lng).toFixed(3);
  if (!stopKey.has(k)) { stopKey.set(k, stops.length); stops.push([name, +(+lat).toFixed(5), +(+lng).toFixed(5)]); }
  return stopKey.get(k);
};
const pushRoute = (r) => {
  const s = []; for (const i of r.s) { if (i < 0) continue; const p = s.at(-1); if (p !== undefined && (p === i || stops[p][0].toLowerCase() === stops[i][0].toLowerCase())) continue; s.push(i); }
  if (s.length >= 2) routes.push({ ...r, s });
};

// ---------- GTFS ----------
function splitCSV(line) { const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out; }
async function eachRow(file, fn) {
  if (!existsSync(file)) throw new Error("missing " + file);
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity }); let head = null, n = 0;
  for await (let line of rl) { if (!head) { head = splitCSV(line.replace(/^﻿/, "")).map((h) => h.trim()); continue; } if (!line.trim()) continue; const v = splitCSV(line); const o = {}; head.forEach((h, i) => (o[h] = (v[i] || "").trim())); fn(o); n++; }
  return n;
}
let gtfsMetro = 0;
try {
  const URLS = ["https://raw.githubusercontent.com/ungalsoththu/ChennaiGTFS/main/data/chennai-unified-gtfs.zip"];
  execSync("rm -rf /tmp/gtfs && mkdir -p /tmp/gtfs");
  let ok = false;
  for (const u of URLS) { try { execSync(`curl -sSfL --max-time 180 -o /tmp/gtfs/feed.zip "${u}" && cd /tmp/gtfs && unzip -oq feed.zip`); ok = true; break; } catch (e) { LOG.push("gtfs download: " + e.message.slice(0, 120)); } }
  if (!ok) throw new Error("GTFS download failed");
  const dir = existsSync("/tmp/gtfs/routes.txt") ? "/tmp/gtfs" : execSync("dirname $(find /tmp/gtfs -name routes.txt | head -1)").toString().trim();
  const gStops = new Map(); await eachRow(dir + "/stops.txt", (o) => gStops.set(o.stop_id, o));
  const gRoutes = new Map(); await eachRow(dir + "/routes.txt", (o) => gRoutes.set(o.route_id, o));
  // up to 3 candidate trips per route+direction; keep the longest
  const cand = new Map(), tripKey = new Map();
  await eachRow(dir + "/trips.txt", (o) => { const k = o.route_id + "|" + (o.direction_id || "0"); const a = cand.get(k) || []; if (a.length < 3) { a.push(o.trip_id); cand.set(k, a); tripKey.set(o.trip_id, k); } });
  const seqs = new Map();
  const nST = await eachRow(dir + "/stop_times.txt", (o) => { if (!tripKey.has(o.trip_id)) return; const a = seqs.get(o.trip_id) || []; a.push([+o.stop_sequence, o.stop_id]); seqs.set(o.trip_id, a); });
  for (const [k, trips] of cand) {
    let best = null; for (const t of trips) { const a = seqs.get(t); if (a && (!best || a.length > best.length)) best = a; }
    if (!best) continue; best.sort((x, y) => x[0] - y[0]);
    const r = gRoutes.get(k.split("|")[0]) || {}; const type = +r.route_type;
    const m = type === 3 || (type >= 700 && type < 800) ? "bus" : type === 1 || type === 0 || (type >= 400 && type < 500) ? "metro" : type === 2 || (type >= 100 && type < 200) ? "train" : "bus";
    if (m === "metro") gtfsMetro++;
    pushRoute({ m, ref: r.route_short_name || "", name: r.route_long_name || "", col: r.route_color ? "#" + r.route_color : "", src: "g",
      s: best.map(([, id]) => { const st = gStops.get(id); return st ? addStop(st.stop_name, st.stop_lat, st.stop_lon) : -1; }) });
  }
  LOG.push(`gtfs: ${gRoutes.size} routes, ${gStops.size} stops, ${nST} stop_times rows, ${cand.size} patterns, metro patterns ${gtfsMetro}`);
} catch (e) { LOG.push("gtfs failed: " + e.message); }

// ---------- OpenStreetMap trains (+ metro fallback) ----------
const BBOX = "12.68,79.95,13.35,80.35";
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function query(q) {
  for (const ep of ENDPOINTS) { try { const r = await fetch(ep + "?data=" + encodeURIComponent(q), { headers: { "User-Agent": "ChennaiPlusBot/1.0" }, signal: AbortSignal.timeout(180000) }); if (!r.ok) throw new Error("HTTP " + r.status); return (await r.json()).elements; } catch (e) { LOG.push(`${ep.split("/")[2]}: ${e.message}`); } }
  throw new Error("all map services failed");
}
try {
  const els = await query(`[out:json][timeout:180];relation["type"="route"]["route"~"^(train|subway|light_rail|monorail)$"](${BBOX})->.r;.r out body;node(r.r);out;`);
  const nodes = new Map(els.filter((e) => e.type === "node").map((e) => [e.id, e]));
  let nOsm = 0;
  for (const r of els.filter((e) => e.type === "relation")) {
    const t = r.tags || {}; const m = t.route === "train" ? "train" : "metro";
    if (m === "metro" && gtfsMetro > 0) continue;
    const s = []; for (const mem of r.members || []) { if (mem.type !== "node" || !/^(stop|platform)/.test(mem.role || "")) continue; const n = nodes.get(mem.ref); if (n) s.push(addStop(n.tags?.["name:en"] || n.tags?.name, n.lat, n.lon)); }
    pushRoute({ m, ref: t.ref || "", name: t.name || "", col: t.colour || "", src: "o", s }); nOsm++;
  }
  LOG.push(`osm: ${nOsm} train/metro routes`);
} catch (e) { LOG.push("osm failed: " + e.message); }

const count = (m) => routes.filter((r) => r.m === m).length;
const summary = { stops: stops.length, bus: count("bus"), busNumbers: new Set(routes.filter((r) => r.m === "bus").map((r) => r.ref)).size, train: count("train"), metro: count("metro") };
console.log(summary, LOG);
await mkdir("data", { recursive: true });
await writeFile("data/transit-log.json", JSON.stringify({ at: new Date().toISOString(), summary, log: LOG,
  sample: routes.filter((r) => r.m === "bus").slice(0, 6).map((r) => [r.ref, r.name, r.s.length, stops[r.s[0]][0], stops[r.s.at(-1)][0]]) }, null, 1));
if (summary.bus < 50 && existsSync("data/transit.json")) { console.warn("Too few bus routes; keeping previous file."); process.exit(0); }
if (!routes.length) process.exit(0);
await writeFile("data/transit.json", JSON.stringify({ updated: new Date().toISOString(), summary, stops, routes: routes.map(({ src, ...r }) => r) }));
