// One-off: find Chennai MPs' official contact details on sansad.in and look for MLA contact pages on the TN Assembly site.
import { writeFile } from "node:fs/promises";
const out = { sample: null, mps: [], assembly: [] , errors: [] };
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 ChennaiPlusBot" }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(u + " " + r.status); return r; };
try { const j = await (await get("https://sansad.in/api_ls/member/4144")).json(); out.sample = Object.keys(j).slice(0, 80); out.sampleObj = j; } catch (e) { out.errors.push(e.message); }
const ids = []; for (let i = 3900; i <= 5900; i++) ids.push(i);
let k = 0;
await Promise.all(Array.from({ length: 12 }, async () => { while (k < ids.length) { const id = ids[k++]; try { const r = await fetch(`https://sansad.in/api_ls/member/${id}`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue; const t = await r.text(); if (/chennai/i.test(t)) { const j = JSON.parse(t); out.mps.push({ id, data: j }); } } catch {} } }));
for (const u of ["https://www.assembly.tn.gov.in/", "https://assembly.tn.gov.in/"]) {
  try { const h = await (await get(u)).text(); out.assembly.push({ u, links: [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((x) => /member|mla|17th|who/i.test(x)).slice(0, 60) }); break; } catch (e) { out.errors.push(e.message); }
}
await writeFile("data/reps-probe.json", JSON.stringify(out, null, 1));
console.log(out.mps.length, out.errors);
