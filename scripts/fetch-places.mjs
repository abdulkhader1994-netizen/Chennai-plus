// Downloads Chennai places from OpenStreetMap once a week into data/places/<category>.json.
// The app then finds the nearest ones on the phone, so it stays fast and doesn't depend on the map service being up.
import { writeFile, mkdir } from "node:fs/promises";

const BBOX = "12.80,80.05,13.25,80.33"; // Greater Chennai: south,west,north,east
const CATS = {
  petrol:  ['nwr["amenity"="fuel"]'],
  station: ['node["railway"~"^(station|halt)$"]', 'node["station"="subway"]'],
  bus:     ['node["highway"="bus_stop"]'],
  hotel:   ['nwr["tourism"~"^(hotel|guest_house|motel|hostel)$"]'],
  food:    ['nwr["amenity"~"^(restaurant|fast_food)$"]'],
  tea:     ['nwr["amenity"="cafe"]', 'nwr["shop"="tea"]'],
};
const ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function query(q) {
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep + "?data=" + encodeURIComponent(q), { headers: { "User-Agent": "ChennaiPlusBot/1.0 (github.com/abdulkhader1994-netizen/Chennai-plus)" }, signal: AbortSignal.timeout(150000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return (await r.json()).elements;
    } catch (e) { console.warn(`${ep}: ${e.message}`); }
  }
  throw new Error("all map services failed");
}

const info = (t) => [
  t.brand || t.operator,
  t.cuisine && t.cuisine.replace(/;/g, ", ").replace(/_/g, " "),
  t.route_ref && "Routes " + t.route_ref.replace(/;/g, ", "),
  t.stars && t.stars + "-star",
  t.opening_hours === "24/7" ? "24 hrs" : t.opening_hours,
].filter(Boolean).slice(0, 2).join(" • ");

await mkdir("data/places", { recursive: true });
const summary = {};
for (const [cat, parts] of Object.entries(CATS)) {
  try {
    const q = `[out:json][timeout:120];(${parts.map((p) => `${p}(${BBOX});`).join("")});out center tags;`;
    const els = await query(q);
    const seen = new Set();
    const rows = els.map((e) => {
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon, t = e.tags || {};
      if (lat == null) return null;
      return [t["name:en"] || t.name || "", +lat.toFixed(5), +lng.toFixed(5), info(t)];
    }).filter(Boolean).filter((r) => { const k = r[0] + r[1].toFixed(3) + r[2].toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
    await writeFile(`data/places/${cat}.json`, JSON.stringify({ updated: new Date().toISOString(), rows }));
    summary[cat] = rows.length;
    console.log(`${cat}: ${rows.length} places`);
  } catch (e) {
    console.warn(`${cat} skipped: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
console.log(summary);
