// Builds data/news.json: Chennai headlines grouped into topics, in English and Tamil.
// Sources: publisher RSS feeds (The Hindu, Times of India, DT Next) and Google News topic searches.
// Only headline, source, time and link are kept; readers open the full story on the publisher's site.
import { writeFile, mkdir, readFile } from "node:fs/promises";

const gn = (q, lang) => lang === "ta"
  ? `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=ta&gl=IN&ceid=IN:ta`
  : `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=en-IN&gl=IN&ceid=IN:en`;

const TOPICS = [
  { id: "chennai",  en: [gn("Chennai"), "https://www.thehindu.com/news/cities/chennai/feeder/default.rss", "https://timesofindia.indiatimes.com/rssfeeds/2950623.cms", "https://www.dtnext.in/rss/city"], ta: [gn("சென்னை", "ta")] },
  { id: "tn",       en: [gn("Tamil Nadu")], ta: [gn("தமிழ்நாடு", "ta")] },
  { id: "politics", en: [gn("Tamil Nadu politics")], ta: [gn("தமிழக அரசியல்", "ta")] },
  { id: "cinema",   en: [gn("Kollywood OR \"Tamil cinema\" OR \"Tamil film\"")], ta: [gn("தமிழ் சினிமா", "ta")] },
  { id: "sports",   en: [gn("\"Chennai Super Kings\" OR Chepauk OR \"Chennaiyin FC\" OR \"Chennai Open\" OR \"Tamil Nadu cricket\"")], ta: [gn("சென்னை விளையாட்டு OR கிரிக்கெட்", "ta")] },
  { id: "business", en: [gn("Chennai business OR \"Chennai IT\" OR \"Tamil Nadu investment\"")], ta: [gn("சென்னை தொழில் OR தமிழக முதலீடு", "ta")] },
  { id: "weather",  en: [gn("Chennai rain OR \"Chennai weather\" OR \"northeast monsoon\"")], ta: [gn("சென்னை மழை OR வானிலை", "ta")] },
];
const PUB = { "thehindu.com": "The Hindu", "indiatimes.com": "Times of India", "dtnext.in": "DT Next" };

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/\s+/g, " ").trim();
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, "i")); return m ? decode(m[1]) : ""; };
const attr = (b, n, a) => { const m = b.match(new RegExp(`<${n}[^>]*\\b${a}="([^"]+)"`, "i")); return m ? m[1] : ""; };

async function readFeed(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "ChennaiPlusBot/1.0 (+https://github.com/abdulkhader1994-netizen/Chennai-plus)" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const xml = await r.text();
    const host = new URL(url).hostname.replace(/^www\./, "");
    return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]).slice(0, 40).map((it) => {
      let title = tag(it, "title"), source = PUB[Object.keys(PUB).find((k) => host.endsWith(k))] || tag(it, "source"), site = "";
      if (host === "news.google.com") { site = attr(it, "source", "url"); const i = title.lastIndexOf(" - "); if (i > 0) { source = source || title.slice(i + 3); title = title.slice(0, i); } }
      else site = "https://" + host;
      const when = new Date(tag(it, "pubDate") || tag(it, "dc:date") || Date.now());
      return { title, source: source || host, site, link: tag(it, "link"), published: isNaN(when) ? new Date().toISOString() : when.toISOString() };
    }).filter((x) => x.title && /^https?:/.test(x.link));
  } catch (e) { console.warn(`Skipped ${url.slice(0, 80)}: ${e.message}`); return []; }
}
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 50);
const fresh = (x) => Date.now() - new Date(x.published) < 4 * 864e5;

const out = { updated: new Date().toISOString(), topics: {}, ta: {} };
for (const lang of ["en", "ta"]) {
  const seen = new Set();
  for (const t of TOPICS) {
    const all = (await Promise.all(t[lang].map(readFeed))).flat().filter(fresh).sort((a, b) => b.published.localeCompare(a.published));
    const list = [];
    for (const x of all) { const k = norm(x.title); if (seen.has(k)) continue; seen.add(k); list.push(x); if (list.length >= 20) break; }
    (lang === "en" ? out.topics : out.ta)[t.id] = list;
    console.log(lang, t.id, list.length);
  }
}
// Keep a combined list for the Home screen and older app versions.
out.items = [...(out.topics.chennai || []).slice(0, 25), ...(out.topics.weather || []).slice(0, 5)].map((x) => ({ ...x, category: "City" }));
const total = Object.values(out.topics).reduce((n, l) => n + l.length, 0);
if (total < 10) {
  try { const old = JSON.parse(await readFile("data/news.json", "utf8")); if (old.topics) { console.warn("Too few headlines; keeping previous file."); process.exit(0); } } catch {}
}
await mkdir("data", { recursive: true });
await writeFile("data/news.json", JSON.stringify(out));
console.log("Saved", total, "English headlines");
