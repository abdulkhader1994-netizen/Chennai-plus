// Chennai Plus news writer.
// Every run: picks the biggest new Chennai / Tamil Nadu stories from data/news.json, gathers what the
// original reports say, and asks Claude to write an ORIGINAL article (English + Tamil) in Chennai Plus's
// own words, crediting and linking the sources. Results: data/articles.json + static pages under news/.
//
// Needs the repository secret ANTHROPIC_API_KEY. Without it the script only rebuilds the pages.
// Optional settings (repository variables): NEWS_MODEL (default claude-haiku-5-5), NEWS_PER_RUN (default 2),
// SITE_URL (default the GitHub Pages address).
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";

const KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.NEWS_MODEL || "claude-haiku-5-5";
const PER_RUN = Math.max(0, Math.min(6, +(process.env.NEWS_PER_RUN || 2)));
const SITE = (process.env.SITE_URL || "https://abdulkhader1994-netizen.github.io/Chennai-plus").replace(/\/$/, "");
const MOCK = process.env.MOCK_AI === "1";
const UA = "Mozilla/5.0 (compatible; ChennaiPlusBot/1.0; +https://github.com/abdulkhader1994-netizen/Chennai-plus)";
const KEEP = 200;

const CATS = ["City", "Tamil Nadu", "Politics", "Business", "Weather", "Sports", "Cinema", "Transport", "Civic"];
const CAT_TA = { City: "நகரம்", "Tamil Nadu": "தமிழ்நாடு", Politics: "அரசியல்", Business: "வணிகம்", Weather: "வானிலை", Sports: "விளையாட்டு", Cinema: "சினிமா", Transport: "போக்குவரத்து", Civic: "குடிமை" };
const TOPIC_W = { chennai: 3, weather: 2.5, tn: 1.6, politics: 1.4, business: 1.3, sports: 1.1, cinema: 1 };

const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };
const STOP = new Set("with from that this have will into after over amid about their they were been more than what when where which while also says said chennai tamil nadu city news today live update updates video photos police".split(" "));
const words = (t) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 3 && !STOP.has(w)));
const sim = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n >= 2 ? n / Math.min(a.size, b.size) : 0; };
const keyOf = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 60);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (t) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "story";
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/\s+/g, " ").trim();

// ---------- 1. candidate stories ----------
function clusters(news, done) {
  const items = [];
  for (const [topic, list] of Object.entries(news.topics || {})) for (const x of list || []) items.push({ ...x, topic, w: words(x.title) });
  const seenKeys = new Set(done.flatMap((a) => a.keys || []));
  const doneWords = done.slice(0, 120).map((a) => words(a.en?.title || "")).concat(done.slice(0, 120).flatMap((a) => (a.src || []).map((s) => words(s.t || ""))));
  const groups = [];
  for (const it of items) {
    if (seenKeys.has(keyOf(it.title)) || it.w.size < 2) continue;
    if (/\b(live|highlights|scorecard|horoscope|quiz|photos|in pics|watch|video)\b/i.test(it.title)) continue;
    if (doneWords.some((w) => sim(it.w, w) >= 0.6)) continue;
    let g = groups.find((g) => g.items.some((o) => sim(o.w, it.w) >= 0.5));
    if (!g) groups.push((g = { items: [] }));
    if (!g.items.some((o) => o.link === it.link)) g.items.push(it);
  }
  const now = Date.now();
  for (const g of groups) {
    const srcs = new Set(g.items.map((i) => i.source)), newest = Math.max(...g.items.map((i) => +new Date(i.published)));
    const ageH = (now - newest) / 36e5, tw = Math.max(...g.items.map((i) => TOPIC_W[i.topic] || 1));
    g.score = (srcs.size * 2 + g.items.length * 0.5) * tw / (1 + ageH / 10);
    g.topic = g.items.sort((a, b) => (TOPIC_W[b.topic] || 1) - (TOPIC_W[a.topic] || 1))[0].topic;
  }
  return groups.filter((g) => (now - Math.max(...g.items.map((i) => +new Date(i.published)))) < 36 * 36e5).sort((a, b) => b.score - a.score);
}

// ---------- 2. what the reports say ----------
async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}
function articleText(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim()); const arr = [].concat(j["@graph"] || j);
      for (const o of arr) if (o && typeof o.articleBody === "string" && o.articleBody.length > 300) return decode(o.articleBody);
    } catch {}
  }
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1])).filter((t) => t.length > 60 && !/cookie|subscribe|sign in|newsletter|copyright|all rights reserved|download the app/i.test(t));
  if (ps.join(" ").length > 300) return ps.join("\n");
  const d = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"/i);
  return d ? decode(d[1]) : "";
}
async function gather(g) {
  const out = [];
  for (const it of g.items.slice(0, 5)) {
    let text = "";
    if (!/news\.google\.com/.test(it.link)) { try { text = articleText(await get(it.link)).slice(0, 5000); } catch (e) { console.warn("  could not read", it.source, e.message); } }
    if (it.desc && !text.includes(it.desc.slice(0, 60))) text = (it.desc + "\n" + text).trim();
    out.push({ outlet: it.source, headline: it.title, url: it.link, published: it.published, text });
  }
  return out;
}

// ---------- 3. ask Claude ----------
const SYSTEM = `You are the news writer for Chennai Plus, a Chennai city news website. You write ORIGINAL news articles based on the source reports you are given.
Rules:
- Use only facts stated in the sources. Never invent facts, names, numbers, dates or quotes. If sources disagree, use the most cautious version or say reports differ.
- Write completely in your own words and your own structure. Do not copy sentences or distinctive phrases from the sources (never more than 6 words in a row), except at most one short direct quote, clearly attributed.
- Lead with what happened, then why it matters to people in Chennai / Tamil Nadu, then useful details (where, when, what next). Neutral, factual tone. No clickbait, no opinion.
- Attribute claims and allegations ("police said", "according to officials"). Do not name victims of sexual offences, or any minor.
- English: 180-320 words in 3-6 short paragraphs. Title max 90 characters and different from every source headline.
- Tamil: write natural, fluent Tamil news prose for Tamil readers (not a word-for-word translation), same facts, 3-6 paragraphs.
- If the material is too thin to write an accurate article of at least 150 words, or it is an advertisement, opinion piece, live blog, match scorecard, horoscope or gossip, skip it.
Reply with JSON only, no other text:
{"skip":false,"category":"one of ${CATS.join(" | ")}","tags":["3-5 short English keywords"],
 "en":{"title":"...","summary":"1-2 sentences, max 220 characters","body":["paragraph", "..."]},
 "ta":{"title":"...","summary":"...","body":["...", "..."]}}
or {"skip":true,"reason":"..."}`;

async function claude(sources, feedback) {
  const material = sources.map((s, i) => `SOURCE ${i + 1}: ${s.outlet}\nHeadline: ${s.headline}\nPublished: ${s.published}\n${s.text ? "Report text:\n" + s.text : "(only the headline is available)"}`).join("\n\n---\n\n");
  const user = `Write a Chennai Plus article about this story.\n\n${material}${feedback ? "\n\nIMPORTANT: your previous draft " + feedback : ""}`;
  if (MOCK) {
    const s = sources[0];
    return { skip: false, category: "City", tags: ["chennai", "test"], en: { title: "Mock: " + s.headline.slice(0, 70), summary: "A short mock summary for testing the Chennai Plus news pages.", body: [1, 2, 3, 4].map((i) => `Mock paragraph ${i} about ${s.headline}. ` + "This is filler text used only to test how Chennai Plus builds its news pages, with enough words to look like a real story. ".repeat(2)) }, ta: { title: "மாதிரி: சென்னை செய்தி", summary: "சோதனைக்கான சுருக்கம்.", body: ["முதல் பத்தி.", "இரண்டாம் பத்தி.", "மூன்றாம் பத்தி."] } };
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${j?.error?.message || JSON.stringify(j).slice(0, 300)}`);
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("No JSON in reply");
  console.log(`  tokens in/out: ${j.usage?.input_tokens}/${j.usage?.output_tokens}`);
  return JSON.parse(text.slice(a, b + 1));
}

// copied-text guard: no 8-word run may match a source
const grams = (t, n) => { const w = (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []); const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" ")); return s; };
function copied(art, sources) {
  const src = new Set(); sources.forEach((s) => grams(s.text + " " + s.headline, 8).forEach((g) => src.add(g)));
  let n = 0; for (const g of grams(art.en.body.join(" ") + " " + art.en.title, 8)) if (src.has(g)) n++;
  return n;
}
const valid = (a) => a && !a.skip && a.en?.title && Array.isArray(a.en.body) && a.en.body.length >= 3 && a.ta?.title && Array.isArray(a.ta.body) && a.ta.body.length >= 2 && a.en.body.join(" ").split(/\s+/).length >= 120;

// ---------- 4. pages ----------
const fmtDate = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const CSS = `:root{--ink:#16181d;--muted:#5d6470;--line:#e6e8ec;--bg:#f6f7f9;--card:#fff;--brand:#e8590c;--brand2:#0b7285}
@media(prefers-color-scheme:dark){:root{--ink:#eef0f3;--muted:#a3a9b3;--line:#2a2e35;--bg:#111317;--card:#1a1d22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 "Hind Madurai",system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--brand2)}header.top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:1080px;margin:0 auto;display:flex;align-items:center;gap:18px;padding:12px 18px}.logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);font:800 20px "Baloo Thambi 2",system-ui,sans-serif}.logo img{width:34px;height:34px;border-radius:9px}
.logo{white-space:nowrap}nav{display:flex;gap:16px;margin-left:auto;font-weight:600;font-size:15px}@media(max-width:420px){.bar{gap:10px;padding:10px 14px}nav{gap:12px;font-size:14px}.logo{font-size:18px}}nav a{color:var(--muted);text-decoration:none}nav a.on,nav a:hover{color:var(--ink)}
main{max-width:1080px;margin:0 auto;padding:22px 18px 60px}.wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:40px}@media(max-width:860px){.wrap{grid-template-columns:1fr}}
.chip{display:inline-block;background:var(--brand);color:#fff;font:700 12px system-ui,sans-serif;letter-spacing:.5px;text-transform:uppercase;padding:4px 9px;border-radius:6px;text-decoration:none}
h1{font:800 clamp(28px,4.4vw,42px)/1.15 "Baloo Thambi 2",system-ui,sans-serif;margin:12px 0 10px;letter-spacing:-.3px}.dek{font-size:19px;color:var(--muted);margin:0 0 14px}
.meta{font-size:14px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.lang{margin-left:auto;display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden}.lang button{border:0;background:none;color:var(--muted);font:700 13px system-ui,sans-serif;padding:6px 12px;cursor:pointer}.lang button.on{background:var(--ink);color:var(--bg)}
article p{margin:0 0 1.05em}[lang=ta] p{font-size:18px;line-height:1.8}.hide{display:none}
.src{margin-top:26px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;font-size:14.5px}.src b{display:block;margin-bottom:6px}.src ul{margin:0;padding-left:18px}.src small{display:block;margin-top:10px;color:var(--muted)}
aside h3{font:800 18px "Baloo Thambi 2",system-ui,sans-serif;margin:0 0 10px}.mini{display:block;text-decoration:none;color:var(--ink);padding:12px 0;border-bottom:1px solid var(--line)}.mini small{color:var(--muted);font-size:12.5px;display:block}.mini b{font-weight:700;line-height:1.35;display:block}
.app{margin-top:20px;background:linear-gradient(135deg,#ff922b,#e8590c);color:#fff;border-radius:16px;padding:16px;text-decoration:none;display:block}.app b{display:block;font:800 18px "Baloo Thambi 2",system-ui,sans-serif}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:8px}.card:hover{border-color:var(--brand)}
.card h2{font:800 20px/1.25 "Baloo Thambi 2",system-ui,sans-serif;margin:0}.card p{margin:0;color:var(--muted);font-size:15px;line-height:1.5}.card small{color:var(--muted);font-size:12.5px}
.lead{grid-column:1/-1}.lead h2{font-size:clamp(24px,3.4vw,34px)}.lead p{font-size:17px}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px;text-align:center;padding:24px 18px}`;
const head = (title, desc, url, extra = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:site_name" content="Chennai Plus"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/icon-512.png"><meta name="twitter:card" content="summary">
<link rel="icon" href="../favicon.png"><link rel="alternate" type="application/rss+xml" title="Chennai Plus News" href="${SITE}/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Baloo+Thambi+2:wght@700;800&family=Hind+Madurai:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>${extra}</head><body>
<header class="top"><div class="bar"><a class="logo" href="../"><img src="../icon-192.png" alt="">Chennai Plus</a><nav><a href="../">Home</a><a href="./" class="on">News</a><a href="../#games">Games</a></nav></div></header>`;
const foot = `<footer>© ${new Date().getFullYear()} Chennai Plus · Original reporting summaries with credit to the publications linked in each story.</footer></body></html>`;

function articlePage(a, all) {
  const url = `${SITE}/news/${a.slug}.html`;
  const ld = { "@context": "https://schema.org", "@type": "NewsArticle", headline: a.en.title, description: a.en.summary, datePublished: a.date, dateModified: a.date, inLanguage: ["en", "ta"],
    author: { "@type": "Organization", name: "Chennai Plus" }, publisher: { "@type": "Organization", name: "Chennai Plus", logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` } }, mainEntityOfPage: url, image: [`${SITE}/icon-512.png`] };
  const more = all.filter((o) => o.slug !== a.slug).slice(0, 6);
  return head(`${a.en.title} | Chennai Plus`, a.en.summary, url, `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`) + `
<main><div class="wrap"><div>
<a class="chip" href="./">${esc(a.cat)}</a>
<div lang="en" id="en"><h1>${esc(a.en.title)}</h1><p class="dek">${esc(a.en.summary)}</p></div>
<div lang="ta" id="ta" class="hide"><h1>${esc(a.ta.title)}</h1><p class="dek">${esc(a.ta.summary)}</p></div>
<div class="meta"><span>Chennai Plus News Desk</span><span>${fmtDate(a.date)} IST</span><span class="lang"><button class="on" data-l="en">English</button><button data-l="ta">தமிழ்</button></span></div>
<article lang="en" id="ben">${a.en.body.map((p) => `<p>${esc(p)}</p>`).join("")}</article>
<article lang="ta" id="bta" class="hide">${a.ta.body.map((p) => `<p>${esc(p)}</p>`).join("")}</article>
<div class="src"><b>Sources</b><ul>${a.src.map((s) => `<li><a href="${esc(s.u)}" rel="nofollow noopener" target="_blank">${esc(s.n)}</a>: ${esc(s.t)}</li>`).join("")}</ul>
<small>Chennai Plus writes these stories with the help of AI, using only the facts in the reports above. Read the original reports for full details.</small></div>
</div><aside><h3>Latest news</h3>${more.map((o) => `<a class="mini" href="${o.slug}.html"><small>${esc(o.cat)} · ${fmtDate(o.date)}</small><b>${esc(o.en.title)}</b></a>`).join("")}
<a class="app" href="../"><b>Open the Chennai Plus app</b>Weather, alerts, places, games and more.</a></aside></div></main>
<script>const b=document.querySelectorAll(".lang button");const set=l=>{["en","ben"].forEach(i=>document.getElementById(i).classList.toggle("hide",l!=="en"));["ta","bta"].forEach(i=>document.getElementById(i).classList.toggle("hide",l!=="ta"));b.forEach(x=>x.classList.toggle("on",x.dataset.l===l));document.documentElement.lang=l;try{localStorage.setItem("cp-news-lang",l)}catch(e){}};b.forEach(x=>x.onclick=()=>set(x.dataset.l));try{const l=new URLSearchParams(location.search).get("lang")||localStorage.getItem("cp-news-lang");if(l==="ta")set("ta")}catch(e){}</script>` + foot;
}
function indexPage(all) {
  const url = `${SITE}/news/`;
  const cards = all.slice(0, 60).map((a, i) => `<a class="card${i === 0 ? " lead" : ""}" href="${a.slug}.html"><span><span class="chip">${esc(a.cat)}</span></span><h2>${esc(a.en.title)}</h2><p>${esc(a.en.summary)}</p><small>${fmtDate(a.date)} IST</small></a>`).join("");
  return head("Chennai News Today | Chennai Plus", "Latest Chennai and Tamil Nadu news, written by Chennai Plus with credit to the original reports.", url) + `
<main><h1>Chennai news</h1><p class="dek">The latest from Chennai and Tamil Nadu, in plain words.</p>${all.length ? `<div class="grid">${cards}</div>` : `<p>No stories yet. The first ones appear after the news writer runs.</p>`}</main>` + foot;
}
const xmlEsc = (s) => esc(s).replace(/'/g, "&apos;");
const feed = (all) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Chennai Plus News</title><link>${SITE}/news/</link><description>Chennai and Tamil Nadu news from Chennai Plus</description><language>en-in</language>
${all.slice(0, 40).map((a) => `<item><title>${xmlEsc(a.en.title)}</title><link>${SITE}/news/${a.slug}.html</link><guid>${SITE}/news/${a.slug}.html</guid><pubDate>${new Date(a.date).toUTCString()}</pubDate><category>${xmlEsc(a.cat)}</category><description>${xmlEsc(a.en.summary)}</description></item>`).join("\n")}</channel></rss>`;
const sitemap = (all) => `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE}/</loc></url><url><loc>${SITE}/news/</loc><changefreq>hourly</changefreq></url>
${all.map((a) => `<url><loc>${SITE}/news/${a.slug}.html</loc><lastmod>${a.date.slice(0, 10)}</lastmod></url>`).join("\n")}</urlset>`;

async function buildPages(all) {
  await mkdir("news", { recursive: true });
  const want = new Set(all.map((a) => a.slug + ".html"));
  for (const f of await readdir("news")) if (f.endsWith(".html") && f !== "index.html" && !want.has(f)) await unlink("news/" + f);
  for (const a of all) await writeFile(`news/${a.slug}.html`, articlePage(a, all));
  await writeFile("news/index.html", indexPage(all));
  await writeFile("feed.xml", feed(all));
  await writeFile("sitemap.xml", sitemap(all));
  await writeFile("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
}

// ---------- main ----------
const news = await readJSON("data/news.json", { topics: {} });
const store = await readJSON("data/articles.json", { items: [] });
const all = store.items || [];
let added = 0;
if (!KEY && !MOCK) console.log("No ANTHROPIC_API_KEY secret yet: rebuilding pages only.");
else {
  const groups = clusters(news, all);
  console.log(`${groups.length} candidate stories; writing up to ${PER_RUN}`);
  for (const g of groups.slice(0, PER_RUN * 3)) {
    if (added >= PER_RUN) break;
    console.log(`- ${g.items[0].title} (${g.items.length} reports, score ${g.score.toFixed(1)})`);
    try {
      const sources = await gather(g);
      const facts = sources.reduce((n, s) => n + s.text.length, 0);
      if (facts < 350 && !(facts > 120 && new Set(sources.map((s) => s.outlet)).size >= 2)) { console.log("  skipped: not enough material"); continue; }
      let art = await claude(sources), tries = 1;
      while (art && !art.skip && valid(art) && copied(art, sources) > 2 && tries < 2) { art = await claude(sources, "reused wording from the sources. Rewrite it fully in new words."); tries++; }
      if (!art || art.skip) { console.log("  skipped by writer:", art?.reason); g.items.forEach((i) => all.push({ skipped: true, keys: [keyOf(i.title)], date: new Date().toISOString() })); continue; }
      if (!valid(art) || copied(art, sources) > 2) { console.log("  rejected: invalid or too close to a source"); continue; }
      const date = new Date().toISOString();
      let slug = slugify(art.en.title); if (all.some((a) => a.slug === slug)) slug += "-" + date.slice(0, 10);
      all.unshift({ id: slug, slug, date, cat: CATS.includes(art.category) ? art.category : "City", catTa: CAT_TA[art.category] || CAT_TA.City, tags: (art.tags || []).slice(0, 5),
        en: { title: art.en.title.trim(), summary: art.en.summary.trim(), body: art.en.body.map((p) => p.trim()).filter(Boolean) },
        ta: { title: art.ta.title.trim(), summary: (art.ta.summary || "").trim(), body: art.ta.body.map((p) => p.trim()).filter(Boolean) },
        src: sources.map((s) => ({ n: s.outlet, u: s.url, t: s.headline })), keys: g.items.map((i) => keyOf(i.title)) });
      added++; console.log("  published:", slug);
    } catch (e) { console.warn("  failed:", e.message); }
  }
}
const items = all.filter((a) => !a.skipped).slice(0, KEEP);
const skipped = all.filter((a) => a.skipped && Date.now() - new Date(a.date) < 3 * 864e5);
await writeFile("data/articles.json", JSON.stringify({ updated: new Date().toISOString(), items: items.concat(skipped) }));
await buildPages(items);
console.log(`Done: ${added} new, ${items.length} total articles.`);
