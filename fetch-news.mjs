// Scarica le notizie dai feed RSS di Google News e le salva in data/news.json
// Eseguito da GitHub Actions (vedi .github/workflows/update.yml). Nessuna dipendenza.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const FEEDS = {
  // Solo la frase esatta "AS Roma": niente "giallorossi" (Lecce, Catanzaro, Benevento…)
  roma: [
    { q: '"AS Roma"', hl: "it", gl: "IT" },
  ],
  boca: [
    { q: '"Boca Juniors"', hl: "it", gl: "IT" },
    { q: '"Boca Juniors"', hl: "es-419", gl: "AR" },
  ],
  // Solo la frase esatta "Fortitudo Bologna" (esistono tante Fortitudo)
  fortitudo: [
    { q: '"Fortitudo Bologna" basket', hl: "it", gl: "IT" },
  ],
  juvecaserta: [
    { q: 'Juvecaserta OR "Juve Caserta" basket', hl: "it", gl: "IT" },
  ],
};

// Altri sport e altre squadre da escludere sempre
const OTHER = "rugby|volley|pallavolo|pallanuoto|baseball|softball|hockey|futsal|calcio a 5|calcio a cinque|femminile|women|primavera|under 1[0-9]|u1[0-9]\\b|giovanili|scherma|ginnastica|atletica|ciclismo|tennis|padel";

// Filtro sul titolo: deve nominare la squadra (must) e non riguardare altro (not)
const FILTERS = {
  roma: {
    must: /\b(as roma|roma)\b/i,
    not: new RegExp(`${OTHER}|basket|lupa roma|atletico roma|roma city|roma capitale|comune di roma|sindaco|campidoglio|metro|atac|cotral|traffico|meteo|giubileo|vaticano|papa`, "i"),
  },
  boca: { must: /\bboca\b/i, not: new RegExp(`${OTHER}|basket|básquet|basquet|vóley|voley|boca raton|boca unidos`, "i") },
  fortitudo: {
    must: /fortitudo|\bfort\b|\beffe\b/i,
    not: new RegExp(`${OTHER}|calcio|agrigento|trento|mozzecane|roma|pomezia|messina|moncalieri|reggio|bologna 103`, "i"),
  },
  juvecaserta: { must: /juvecaserta|juve caserta|caserta/i, not: new RegExp(`${OTHER}|casertana|calcio`, "i") },
};

const MAX_PER_TEAM = 30;
const MAX_AGE_DAYS = 10;

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

async function fetchFeed({ q, hl, gl }) {
  const ceid = `${gl}:${hl.split("-")[0]}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Tifo PWA)" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const source = tag(item, "source");
    let title = tag(item, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return {
      title,
      link: tag(item, "link"),
      source,
      date: new Date(tag(item, "pubDate")).toISOString(),
      lang: hl.startsWith("es") ? "es" : "it",
    };
  });
}

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9àèéìòù ]/g, "").slice(0, 70);

const out = { updated: new Date().toISOString(), teams: {} };
const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;

for (const [team, feeds] of Object.entries(FEEDS)) {
  const all = [];
  for (const f of feeds) {
    try {
      all.push(...(await fetchFeed(f)));
    } catch (e) {
      console.error(`[${team}] ${e.message}`);
    }
  }
  const seen = new Set();
  out.teams[team] = all
    .filter((n) => n.title && Date.parse(n.date) > cutoff)
    .filter((n) => {
      const f = FILTERS[team];
      if (!f) return true;
      return f.must.test(n.title) && !f.not.test(n.title);
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .filter((n) => !seen.has(norm(n.title)) && seen.add(norm(n.title)))
    .slice(0, MAX_PER_TEAM);
  console.log(`${team}: ${out.teams[team].length} notizie`);
}

// Scrive solo se le notizie sono cambiate (evita commit inutili)
const prev = await readFile("data/news.json", "utf8").then(JSON.parse).catch(() => ({}));
if (JSON.stringify(prev.teams) === JSON.stringify(out.teams)) {
  console.log("Nessuna novità");
} else {
  await mkdir("data", { recursive: true });
  await writeFile("data/news.json", JSON.stringify(out, null, 1));
}
