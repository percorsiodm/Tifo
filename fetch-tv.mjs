// "Dove vederla" partita per partita -> data/tv.json
// Per le prossime partite di ogni squadra cerca su Google News gli articoli "Squadra-Avversario dove vederla / diretta tv"
// e ricava dai titoli i canali citati (DAZN, Sky, Prime Video, Rai Sport, LNP Pass, ...).
// Eseguito da GitHub Actions dopo fetch-basket.mjs. Nessuna dipendenza.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SOCCER = [
  { key: "roma", espn: "104", me: "Roma" },
  { key: "boca", espn: "5", me: "Boca" },
];
const BASKET = [
  { key: "fortitudo", me: "Fortitudo", re: /fortitudo/i },
  { key: "juvecaserta", me: "Juvecaserta", re: /caserta/i },
];
const DAYS_AHEAD = 10;

// Canali riconosciuti nei titoli (nome mostrato -> espressione)
const CHANNELS = [
  ["DAZN", /\bdazn\b/i],
  ["Sky Sport", /\bsky\b/i],
  ["NOW", /\bnow\b/i],
  ["Prime Video", /prime video|amazon/i],
  ["TV8", /\btv ?8\b/i],
  ["Canale 5", /canale 5/i],
  ["Italia 1", /italia 1|italia uno/i],
  ["Mediaset Infinity", /mediaset infinity|\binfinity\b/i],
  ["Rai Sport", /rai ?sport/i],
  ["Rai 2", /\brai ?2\b|rai due/i],
  ["RaiPlay", /raiplay/i],
  ["Sportitalia", /sportitalia/i],
  ["LNP Pass", /lnp ?pass/i],
  ["Eurosport", /eurosport/i],
  ["Discovery+", /discovery\+|discovery plus/i],
];

const decode = (s = "") => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (xml, n) => { const m = xml.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? decode(m[1]) : ""; };
const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

// Parola chiave dell'avversario (es. "Dinamo Basket Sassari" -> "Sassari")
const STOP = /^(as|ac|fc|ssc|us|sc|cf|ca|club|basket|pallacanestro|calcio|atletico|atlético|deportivo|real|sporting|the|de|del|la|el|1907|1913)$/i;
const keyword = (name) => name.replace(/[()]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.test(w))
  .sort((a, b) => b.length - a.length)[0] || name;

async function news(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=it&gl=IT&ceid=IT:it`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Tifo PWA)" } });
  if (!r.ok) return [];
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(it, "link"), source, date: new Date(tag(it, "pubDate")).toISOString() };
  });
}

async function findTv(me, opp, date) {
  const ok = keyword(opp);
  const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const items = await news(`${me} ${ok} (dove vederla OR "diretta tv" OR "in tv" OR streaming)`);
  const since = Date.parse(date) - 8 * 864e5;
  const relevant = items.filter((n) => Date.parse(n.date) > since
    && strip(n.title).includes(strip(me)) && strip(n.title).includes(strip(ok))
    && /dove veder|in tv|diretta|streaming|canale|\btv\b/i.test(n.title));
  const count = {};
  const sources = [];
  for (const n of relevant) {
    const found = CHANNELS.filter(([, re]) => re.test(n.title)).map(([name]) => name);
    if (!found.length) continue;
    found.forEach((c) => (count[c] = (count[c] || 0) + 1));
    if (sources.length < 3) sources.push({ title: n.title, link: n.link, source: n.source });
  }
  const channels = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  return { channels, sources, checked: new Date().toISOString() };
}

const out = { updated: new Date().toISOString(), matches: [] };
const now = Date.now(), limit = now + DAYS_AHEAD * 864e5;

// Calcio: prossime partite da ESPN
for (const t of SOCCER) {
  try {
    const d = await getJSON(`${ESPN}/all/teams/${t.espn}/schedule?fixture=true`);
    const next = (d.events || []).filter((e) => Date.parse(e.date) > now - 3 * 3600e3 && Date.parse(e.date) < limit).slice(0, 2);
    for (const e of next) {
      const c = e.competitions[0].competitors;
      const home = c.find((x) => x.homeAway === "home").team, away = c.find((x) => x.homeAway === "away").team;
      const opp = home.id === t.espn ? away : home;
      const tv = await findTv(t.me, opp.shortDisplayName || opp.displayName, e.date);
      out.matches.push({ team: t.key, id: e.id, date: e.date, home: home.shortDisplayName, away: away.shortDisplayName, ...tv });
      console.log(`${t.key}: ${home.shortDisplayName}-${away.shortDisplayName} -> ${tv.channels.map((x) => x.name).join(", ") || "non annunciato"}`);
    }
  } catch (e) { console.log(t.key, e.message); }
}

// Basket: prossime partite da data/basket.json
const basket = await readFile("data/basket.json", "utf8").then(JSON.parse).catch(() => ({ teams: {} }));
for (const t of BASKET) {
  const ms = (basket.teams?.[t.key]?.matches || [])
    .filter((m) => m.homeScore === "" && Date.parse(m.date) > now - 3 * 3600e3 && Date.parse(m.date) < limit).slice(0, 2);
  for (const m of ms) {
    const opp = t.re.test(m.home) ? m.away : m.home;
    const tv = await findTv(t.me, opp, m.date);
    // per la Serie A2 LNP Pass trasmette sempre tutte le partite
    if (!tv.channels.some((c) => c.name === "LNP Pass")) tv.channels.push({ name: "LNP Pass", n: 0, always: true });
    out.matches.push({ team: t.key, id: m.id, date: m.date, home: m.home, away: m.away, ...tv });
    console.log(`${t.key}: ${m.home}-${m.away} -> ${tv.channels.map((x) => x.name).join(", ")}`);
  }
}

await mkdir("data", { recursive: true });
const prev = await readFile("data/tv.json", "utf8").then(JSON.parse).catch(() => ({}));
const strip = ({ updated, matches }) => JSON.stringify((matches || []).map(({ checked, ...m }) => m));
if (strip(prev) !== strip(out)) await writeFile("data/tv.json", JSON.stringify(out, null, 1));
else console.log("Nessuna novità");
