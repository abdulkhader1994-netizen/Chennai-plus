// Builds data/rates.json: estimated Chennai gold/silver rates from international prices, plus fuel prices from data/fuel.json.
import { readFile, writeFile } from "node:fs/promises";

const OZ = 31.1035;               // grams per troy ounce
const IMPORT_DUTY = 0.06;         // India customs duty on gold/silver
const GST = 0.03;                 // GST on gold/silver
const get = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": "ChennaiPlusBot/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(url + " HTTP " + r.status);
  return r.json();
};
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };

const prev = await readJson("data/rates.json", {});
const fuel = await readJson("data/fuel.json", null);
const out = { updated: new Date().toISOString(), fuel, gold: prev.gold || null, silver: prev.silver || null, history: prev.history || [] };

try {
  const [xau, xag, fx] = await Promise.all([
    get("https://api.gold-api.com/price/XAU"),
    get("https://api.gold-api.com/price/XAG"),
    get("https://open.er-api.com/v6/latest/USD"),
  ]);
  const inr = fx.rates?.INR;
  const pXau = xau.price ?? xau.value, pXag = xag.price ?? xag.value;
  if (!inr || !pXau) throw new Error("missing price data");
  const perGram = (usdOz) => (usdOz * inr / OZ) * (1 + IMPORT_DUTY) * (1 + GST);
  const k24 = Math.round(perGram(pXau));
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date
  const hist = out.history.filter((h) => h.date !== today);
  const yesterday = hist.at(-1);
  hist.push({ date: today, k24 });
  out.history = hist.slice(-30);
  out.gold = { k24, k22: Math.round(k24 * 0.916), k18: Math.round(k24 * 0.75), change: yesterday ? k24 - yesterday.k24 : null, usdOz: pXau, usdInr: inr };
  out.silver = pXag ? { gram: Math.round(perGram(pXag) * 10) / 10, kg: Math.round(perGram(pXag) * 1000) } : out.silver;
  console.log(`Gold 24K ₹${k24}/g, 22K ₹${out.gold.k22}/g`);
} catch (e) {
  console.warn("Gold update skipped:", e.message);
}
await writeFile("data/rates.json", JSON.stringify(out, null, 1));
