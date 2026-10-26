// Fetches Chennai headlines from publisher RSS feeds and writes data/news.json.
// Only headline, source, time and link are kept; readers open the full story on the publisher's site.
import { writeFile, mkdir } from "node:fs/promises";

const FEEDS = [
  { source: "The Hindu", url: "https://www.thehindu.com/news/cities/chennai/feeder/default.rss" },
  { source: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/2950623.cms" },
  { source: "DT Next", url: "https://www.dtnext.in/rss/city" },
  { source: "Google News", url: "https://news.google.com/rss/search?q=Chennai&hl=en-IN&gl=IN&ceid=IN:en" },
];

const CATS = [
  ["Rain", /\b(rain|monsoon|flood|cyclone|imd|waterlog|storm)\b/i],
  ["Transport", /\b(metro|cmrl|mtc|bus|train|railway|airport|flight|traffic|road)\b/i],
  ["Movies", /\b(film|movie|cinema|actor|actress|box office|trailer|release)\b/i],
  ["Civic", /\b(gcc|corporation|water supply|power cut|tangedco|garbage|civic|council|mayor)\b/i],
  ["Business", /\b(business|jobs|startup|it park|investment|economy|company)\b/i],
  ["Sports", /\b(cricket|chepauk|football|match|ipl|stadium|tournament)\b/i],
  ["Events", /\b(festival|concert|exhibition|sabha|fair|expo|event)\b/i],
];

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/\s+/g, " ").trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? decode(m[1]) : ""; };

async function readFeed({ source, url }) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ChennaiPlusBot/1.0 (+https://github.com/abdulkhader1994-netizen/Chennai-plus)" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
    return items.slice(0, 25).map((it) => {
      let title = tag(it, "title");
      let src = source;
      if (source === "Google News") { const i = title.lastIndexOf(" - "); if (i > 0) { src = title.slice(i + 3); title = title.slice(0, i); } }
      const when = new Date(tag(it, "pubDate") || tag(it, "dc:date") || Date.now());
      const cat = (CATS.find(([, re]) => re.test(title)) || ["City"])[0];
      return { title, source: src, link: tag(it, "link"), published: isNaN(when) ? new Date().toISOString() : when.toISOString(), category: cat };
    }).filter((x) => x.title && x.link.startsWith("http"));
  } catch (e) {
    console.warn(`Skipped ${source}: ${e.message}`);
    return [];
  }
}

const all = (await Promise.all(FEEDS.map(readFeed))).flat();
const seen = new Set();
const items = all
  .sort((a, b) => b.published.localeCompare(a.published))
  .filter((x) => { const k = x.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(0, 40);

if (items.length === 0) { console.warn("No headlines fetched; keeping previous file."); process.exit(0); }
await mkdir("data", { recursive: true });
await writeFile("data/news.json", JSON.stringify({ updated: new Date().toISOString(), items }, null, 1));
console.log(`Saved ${items.length} headlines.`);
