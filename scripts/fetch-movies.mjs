// Builds data/movies.json: Tamil releases plus popular English films in India, from TMDB.
// Needs a TMDB "API Read Access Token" saved as the GitHub secret TMDB_TOKEN.
// This product uses the TMDB API but is not endorsed or certified by TMDB. (Attribution shown in the app.)
import { readFile, writeFile } from "node:fs/promises";

const token = process.env.TMDB_TOKEN;
if (!token) { console.log("No TMDB_TOKEN secret yet; skipping movies."); process.exit(0); }
try { const old = JSON.parse(await readFile("data/movies.json", "utf8")); if (old.updated && Date.now() - new Date(old.updated) < 6 * 3600e3 && !process.env.FORCE) { console.log("Movies are fresh; skipping."); process.exit(0); } } catch {}

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const api = async (path) => {
  const r = await fetch("https://api.themoviedb.org/3" + path, { headers: { Authorization: "Bearer " + token, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(path + " HTTP " + r.status);
  return r.json();
};
const LANG = { ta: "Tamil", en: "English", hi: "Hindi", te: "Telugu", ml: "Malayalam", kn: "Kannada" };

try {
  const [tamil, english] = await Promise.all([
    api(`/discover/movie?with_original_language=ta&region=IN&primary_release_date.gte=${day(-35)}&primary_release_date.lte=${day(45)}&sort_by=popularity.desc&include_adult=false`),
    api(`/movie/now_playing?region=IN&language=en-IN`),
  ]);
  const genres = Object.fromEntries((await api("/genre/movie/list?language=en")).genres.map((g) => [g.id, g.name]));
  const pick = (m) => ({
    id: m.id, title: m.title, lang: LANG[m.original_language] || m.original_language.toUpperCase(),
    genre: (m.genre_ids || []).slice(0, 2).map((g) => genres[g]).filter(Boolean).join(", "),
    date: m.release_date, poster: m.poster_path ? "https://image.tmdb.org/t/p/w342" + m.poster_path : null,
    rating: m.vote_count >= 20 ? Math.round(m.vote_average * 10) / 10 : null,
  });
  const ta = tamil.results.filter((m) => m.poster_path).slice(0, 10).map(pick);
  const en = english.results.filter((m) => m.poster_path && m.original_language === "en").slice(0, 4).map(pick);
  const items = [...ta, ...en];
  if (!items.length) throw new Error("no movies returned");
  await writeFile("data/movies.json", JSON.stringify({ updated: new Date().toISOString(), items }, null, 1));
  console.log(`Saved ${items.length} movies.`);
} catch (e) {
  console.warn("Movies update skipped:", e.message);
}
