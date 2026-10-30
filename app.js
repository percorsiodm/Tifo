// ===== Configurazione squadre =====
// espn: id squadra su ESPN (solo calcio). links: scorciatoie mostrate nella pagina squadra.
const TEAMS = [
  { key: "roma", name: "AS Roma", short: "Roma", sport: "Calcio", espn: 104, abbr: "R", img: "AS Roma.png",
    colors: ["#f0bc42", "#8e1f2f"],
    links: [["Sito ufficiale", "https://www.asroma.com/it"], ["Classifica Serie A", "https://www.espn.com/soccer/standings/_/league/ita.1"]] },
  { key: "boca", name: "Boca Juniors", short: "Boca", sport: "Calcio", espn: 5, abbr: "B", img: "BOCA.png",
    colors: ["#ffd100", "#0033a0"],
    links: [["Sito ufficiale", "https://www.bocajuniors.com.ar"], ["Classifica LPF", "https://www.espn.com/soccer/standings/_/league/arg.1"]] },
  { key: "fortitudo", name: "Fortitudo Bologna", short: "Fortitudo", sport: "Basket", abbr: "F", img: "Fortitudo Bologna.png",
    colors: ["#9cc3ff", "#1d4f9c"], bg: ["#ffffff", "#1d4f9c"],
    links: [["Diretta LNP", "https://lnppass.legapallacanestro.com/"], ["Lega Nazionale Pallacanestro", "https://www.legapallacanestro.com"]] },
  { key: "juvecaserta", name: "Juvecaserta", short: "Caserta", sport: "Basket", abbr: "J", img: "Juvecaserta.png",
    colors: ["#dddddd", "#2a2a2a"], bg: ["#f2f2f2", "#111111"],
    links: [["Diretta LNP", "https://lnppass.legapallacanestro.com/"], ["Lega Nazionale Pallacanestro", "https://www.legapallacanestro.com"]] },
];

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const LNP_LIVE = "https://lnppass.legapallacanestro.com/"; // diretta ufficiale Serie A2
const TZ = "Europe/Rome";
// view: "home" oppure la chiave della squadra; sub: null | {type:"match", id} | {type:"comp", key}
const state = { view: "home", sub: null, news: null, matches: {}, basket: {}, tables: {}, comps: {}, details: {} };
let liveTimer = null;

// ===== Utilità =====
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d, o) => new Intl.DateTimeFormat("it-IT", { timeZone: TZ, ...o }).format(new Date(d));
const when = (d) => fmt(d, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (d) => {
  const m = Math.round((Date.now() - Date.parse(d)) / 60000);
  if (m < 60) return `${Math.max(m, 1)} min fa`;
  if (m < 1440) return `${Math.round(m / 60)} h fa`;
  return fmt(d, { day: "numeric", month: "short" });
};
const teamBy = (k) => TEAMS.find((t) => t.key === k);
// Stemma della squadra (file caricato nel repo); se manca mostra l'iniziale
const crest = (t, cls = "") => `<span class="crest ${cls}" data-abbr="${esc(t.abbr)}"
  style="--c1:${t.colors[0]};--c2:${t.colors[1]}"><img src="${encodeURIComponent(t.img)}" alt="${esc(t.name)}"
  onerror="this.parentNode.classList.add('noimg');this.remove()"></span>`;
const getJSON = async (url) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
};

// ===== Dati: partite (ESPN) =====
function parseEvent(ev, teamId) {
  const c = ev.competitions?.[0] || ev;
  const st = c.status?.type || ev.status?.type || {};
  const side = (ha) => {
    const x = c.competitors.find((p) => p.homeAway === ha);
    const sc = typeof x.score === "object" ? x.score?.displayValue : x.score;
    return { id: x.team.id, name: x.team.shortDisplayName || x.team.displayName,
             logo: x.team.logos?.[0]?.href || x.team.logo, score: sc ?? "" };
  };
  const home = side("home"), away = side("away");
  const goals = (c.details || [])
    .filter((d) => d.scoringPlay || d.redCard)
    .map((d) => ({ min: d.clock?.displayValue || "", home: d.team?.id === home.id, red: !!d.redCard,
                   who: d.athletesInvolved?.[0]?.displayName || d.type?.text || "" }));
  return {
    id: ev.id, date: ev.date, league: ev.league?.shortName || ev.season?.displayName || "",
    slug: ev.league?.slug || "", comp: ev.league?.slug || "", compName: ev.league?.name || "", state: st.state, detail: st.shortDetail || "", clock: c.status?.displayClock,
    home, away, goals, mine: String(home.id) === String(teamId) ? "home" : "away",
    link: ev.links?.find((l) => l.rel?.includes("summary"))?.href,
  };
}

async function loadMatches(t) {
  const base = `${ESPN}/all/teams/${t.espn}/schedule`;
  const [res, fix] = await Promise.allSettled([getJSON(base), getJSON(base + "?fixture=true")]);
  const evs = [...(res.value?.events || []), ...(fix.value?.events || [])];
  const byId = new Map(evs.map((e) => [e.id, parseEvent(e, t.espn)]));
  state.matches[t.key] = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

// Aggiorna le partite in corso dallo scoreboard della competizione (più veloce del calendario)
async function refreshLive() {
  const now = Date.now();
  const hot = [];
  for (const t of TEAMS.filter((t) => t.espn))
    for (const m of state.matches[t.key] || [])
      if (m.state === "in" || (m.state === "pre" && Date.parse(m.date) - now < 10 * 60000 && now - Date.parse(m.date) < 3 * 3600000))
        hot.push([t, m]);
  for (const [t, m] of hot) {
    if (!m.slug) continue;
    try {
      const day = fmt(m.date, { year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("");
      const sb = await getJSON(`${ESPN}/${m.slug}/scoreboard?dates=${day}`);
      const ev = sb.events?.find((e) => e.id === m.id);
      if (ev) Object.assign(m, parseEvent({ ...ev, league: m.league ? { shortName: m.league, slug: m.slug } : ev.league }, t.espn));
    } catch {}
  }
  scheduleLive();
  render();
}

function scheduleLive() {
  clearTimeout(liveTimer);
  const now = Date.now();
  const any = Object.values(state.matches).flat().some((m) => m.slug &&
    (m.state === "in" || (m.state === "pre" && Date.parse(m.date) - now < 10 * 60000 && now - Date.parse(m.date) < 3 * 3600000)));
  if (any) liveTimer = setTimeout(refreshLive, 30000);
}

// ===== Dati: competizioni (classifica, marcatori, giornata) =====
const COMP_NAMES = {
  "ita.1": "Serie A", "ita.coppa_italia": "Coppa Italia", "ita.super_cup": "Supercoppa Italiana",
  "uefa.champions": "Champions League", "uefa.europa": "Europa League", "uefa.europa.conf": "Conference League",
  "arg.1": "Liga Profesional (Argentina)", "arg.copa": "Copa Argentina", "arg.supercopa": "Supercopa Argentina",
  "conmebol.libertadores": "Copa Libertadores", "conmebol.sudamericana": "Copa Sudamericana",
  "Italian Serie A2": "Serie A2",
};
const compLabel = (key, fallback) => COMP_NAMES[key] || fallback || key;
const ymd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, "");

async function loadComp(slug) {
  if (state.comps[slug]) return;
  state.comps[slug] = { loading: true };
  const base = `https://site.api.espn.com/apis`;
  const range = `${ymd(Date.now() - 3 * 864e5)}-${ymd(Date.now() + 4 * 864e5)}`;
  const [st, stats, sb] = await Promise.allSettled([
    getJSON(`${base}/v2/sports/soccer/${slug}/standings`),
    getJSON(`${base}/site/v2/sports/soccer/${slug}/statistics`),
    getJSON(`${base}/site/v2/sports/soccer/${slug}/scoreboard?dates=${range}`),
  ]);
  const stat = (e, n) => e.stats?.find((x) => x.name === n)?.displayValue ?? "";
  const groups = (st.value?.children || [st.value || {}])
    .map((g) => ({ name: g.name || "", rows: (g.standings?.entries || []).map((e) => ({
      id: e.team.id, team: e.team.shortDisplayName || e.team.displayName, logo: e.team.logos?.[0]?.href,
      pos: +stat(e, "rank") || 0, pts: stat(e, "points"), gp: stat(e, "gamesPlayed"),
      w: stat(e, "wins"), d: stat(e, "ties"), l: stat(e, "losses"), gd: stat(e, "pointDifferential"),
    })).sort((a, b) => a.pos - b.pos) }))
    .filter((g) => g.rows.length);
  const leaders = (n) => (stats.value?.stats?.find((c) => c.name === n)?.leaders || []).slice(0, 10)
    .map((l) => ({ who: l.athlete?.displayName, team: l.athlete?.team?.abbreviation || l.athlete?.team?.name,
                   teamId: l.athlete?.team?.id, val: l.value }));
  state.comps[slug] = {
    groups, scorers: leaders("goalsLeaders"), assists: leaders("assistsLeaders"),
    round: (sb.value?.events || []).map((e) => parseEvent({ ...e, league: { slug } }, 0)),
  };
  render();
}

// ===== Dati: notizie (generate da GitHub Actions) =====
async function loadNews() {
  try { state.news = await getJSON(`data/news.json?t=${Date.now()}`); } catch { state.news = { teams: {} }; }
}

// ===== Dati: basket (generati da GitHub Actions da TheSportsDB) =====
async function loadBasket() {
  try {
    const d = await getJSON(`data/basket.json?t=${Date.now()}`);
    state.tables = d.tables || {};
    for (const [key, t] of Object.entries(d.teams || {})) {
      state.basket[key] = { leagueId: t.leagueId, badge: t.badge, id: t.id, league: t.league };
      state.matches[key] = t.matches.map((b) => {
        const played = b.homeScore !== "";
        const start = Date.parse(b.date);
        return {
          id: b.id, date: b.date, league: b.round ? `G${b.round}` : "", slug: "", detail: "", goals: [],
          comp: b.league || t.league, compName: b.league || t.league,
          state: played ? "post" : "pre",
          playing: !played && Date.now() >= start && Date.now() - start < 3 * 3600000,
          // da 30 minuti prima a fine gara la scheda apre la diretta ufficiale
          link: !played && Date.now() >= start - 30 * 60000 && Date.now() - start < 3 * 3600000 ? LNP_LIVE : undefined,
          home: { id: b.homeId, name: b.home, logo: b.homeBadge, score: b.homeScore },
          away: { id: b.awayId, name: b.away, logo: b.awayBadge, score: b.awayScore },
          mine: b.homeId === t.id ? "home" : "away",
          stats: b.stats || [], lineup: b.lineup || [], basket: true,
        };
      });
    }
  } catch {}
}

// ===== LIVE ORA: tutte le partite di oggi nelle competizioni delle mie squadre (ESPN) =====
// Competizioni sempre seguite (anche quando la squadra non ha ancora partite in calendario)
const FOLLOW = {
  roma: ["ita.1", "uefa.champions", "uefa.europa", "uefa.europa.conf", "ita.coppa_italia", "ita.super_cup"],
  boca: ["arg.1", "arg.copa", "conmebol.libertadores", "conmebol.sudamericana", "arg.supercopa"],
};
const followed = (t) => [...new Set([...(FOLLOW[t.key] || []), ...(state.matches[t.key] || []).map((m) => m.comp)
  .filter((c) => c && c.includes(".") && t.espn)])];
state.today = {};      // slug -> partite di oggi
let todayTimer = null;

async function loadToday() {
  const slugs = [...new Set(TEAMS.filter((t) => t.espn).flatMap(followed))];
  const now = Date.now();
  const range = `${ymd(now - 864e5)}-${ymd(now + 864e5)}`;
  await Promise.allSettled(slugs.map(async (slug) => {
    const sb = await getJSON(`${ESPN}/${slug}/scoreboard?dates=${range}`);
    const evs = (sb.events || []).map((e) => parseEvent({ ...e, league: { slug, name: sb.leagues?.[0]?.name, shortName: sb.leagues?.[0]?.abbreviation } }, 0));
    // tieni: in corso + quelle di oggi (ora italiana) iniziate o in programma
    const today = fmt(now, { year: "numeric", month: "2-digit", day: "2-digit" });
    state.today[slug] = evs.filter((m) => m.state === "in" || fmt(m.date, { year: "numeric", month: "2-digit", day: "2-digit" }) === today)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }));
  // anche le partite delle mie squadre si aggiornano da qui
  for (const t of TEAMS.filter((t) => t.espn))
    for (const m of state.matches[t.key] || []) {
      const fresh = (state.today[m.comp] || []).find((x) => x.id === m.id);
      if (fresh) Object.assign(m, { state: fresh.state, clock: fresh.clock, detail: fresh.detail, goals: fresh.goals,
        home: { ...m.home, score: fresh.home.score }, away: { ...m.away, score: fresh.away.score } });
    }
  lastRefresh = Date.now();
  clearTimeout(todayTimer);
  const anyLive = Object.values(state.today).flat().some((m) => m.state === "in");
  // se c'è un live o una partita che inizia entro 15 minuti: ogni minuto, altrimenti ogni 5
  const soon = Object.values(state.today).flat().some((m) => m.state === "pre" && Date.parse(m.date) - Date.now() < 15 * 60000);
  todayTimer = setTimeout(tickToday, anyLive || soon ? 60000 : 300000);
}
// Il giro di aggiornamento non si ferma mai: con l'app in background aspetta e riprova
async function tickToday() {
  if (document.hidden) { clearTimeout(todayTimer); todayTimer = setTimeout(tickToday, 60000); return; }
  await loadToday().catch(() => {});
  render();
}
let lastRefresh = 0;
// Quando riapri l'app (era in background) aggiorna subito tutto
async function refreshNow() {
  if (document.hidden || Date.now() - lastRefresh < 30000) return;
  lastRefresh = Date.now();
  await Promise.allSettled([loadTv(), ...TEAMS.filter((t) => t.espn).map(loadMatches)]);
  await loadToday().catch(() => {});
  $("#upd").textContent = "agg. " + fmt(Date.now(), { hour: "2-digit", minute: "2-digit" });
  scheduleLive();
  render();
}
document.addEventListener("visibilitychange", refreshNow);
window.addEventListener("focus", refreshNow);
window.addEventListener("pageshow", refreshNow);

// Elenco partite di oggi per competizione; evidenzia le mie squadre
function todayHtml(slugs, myIds, onlyLive) {
  const blocks = slugs.map((slug) => {
    const list = (state.today[slug] || []).filter((m) => !onlyLive || m.state === "in");
    if (!list.length) return "";
    const isMine = (id) => myIds.includes(String(id));
    return `<div class="tday"><div class="tday-head">${esc(compLabel(slug))}</div>${list.map((m) => {
      const mine = isMine(m.home.id) || isMine(m.away.id);
      const team = TEAMS.find((t) => isMine(m.home.id) && String(t.espn) === String(m.home.id) || isMine(m.away.id) && String(t.espn) === String(m.away.id));
      const attrs = team ? `data-match="${esc(m.id)}" data-team="${team.key}"` : (m.link ? `data-href="${esc(m.link)}"` : "");
      return `<div class="row trow ${m.state === "in" ? "is-live" : ""} ${mine ? "mine" : ""}" ${attrs}>
        <div class="opp">${esc(m.home.name)} – ${esc(m.away.name)}</div>
        <div class="when">${m.state === "pre" ? fmt(m.date, { hour: "2-digit", minute: "2-digit" })
          : `<b>${esc(m.home.score)}-${esc(m.away.score)}</b> ${m.state === "in" ? `<span class="live-badge">${esc(m.clock || "LIVE")}</span>` : "fin."}`}</div></div>`;
    }).join("")}</div>`;
  }).join("");
  return blocks;
}

let loaded = false;
async function loadAll() {
  $("#upd").textContent = "aggiorno…";
  state.comps = {};
  await Promise.allSettled([loadNews(), loadBasket(), loadTv(), ...TEAMS.filter((t) => t.espn).map(loadMatches)]);
  await loadToday().catch(() => {});
  loaded = true;
  $("#upd").textContent = "agg. " + fmt(Date.now(), { hour: "2-digit", minute: "2-digit" });
  scheduleLive();
  render();
}

// ===== Tabellino calcio (ESPN, scaricato quando apri la partita) =====
async function loadDetail(m) {
  if (state.details[m.id] || !m.slug) return;
  state.details[m.id] = { loading: true };
  try {
    const d = await getJSON(`${ESPN}/${m.slug}/summary?event=${m.id}`);
    const name = (id) => [m.home, m.away].find((x) => String(x.id) === String(id));
    const events = (d.keyEvents || [])
      .filter((e) => e.clock?.displayValue && (e.scoringPlay || /card|substitution|goal|penalty/i.test(e.type?.type || e.type?.text || "")))
      .map((e) => {
        const t = (e.type?.type || e.type?.text || "").toLowerCase();
        const icon = e.scoringPlay || t.includes("goal") ? "⚽" : t.includes("red") ? "🟥" : t.includes("yellow") ? "🟨" : t.includes("sub") ? "🔄" : "•";
        const who = (e.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
        return { min: e.clock.displayValue, icon, home: String(e.team?.id) === String(m.home.id),
                 who: icon === "🔄" && who.length > 1 ? `${who[0]} ↔ ${who[1]}` : who[0] || e.text || "" };
      });
    const statsBy = Object.fromEntries((d.boxscore?.teams || []).map((t) => [String(t.team?.id), t.statistics || []]));
    const hs = statsBy[String(m.home.id)] || [], as = statsBy[String(m.away.id)] || [];
    const stats = hs.map((x) => ({ label: x.label || x.name, home: x.displayValue,
      away: as.find((y) => y.name === x.name)?.displayValue ?? "" })).filter((x) => x.home !== undefined);
    const lineups = (d.rosters || []).map((r) => ({
      home: String(r.team?.id) === String(m.home.id), team: name(r.team?.id)?.name || r.team?.displayName, formation: r.formation || "",
      starters: (r.roster || []).filter((p) => p.starter), bench: (r.roster || []).filter((p) => !p.starter && p.subbedIn),
    }));
    state.details[m.id] = { events, stats, lineups };
  } catch { state.details[m.id] = { error: true }; }
  render();
}

// ===== Rendering =====
const compChip = (m, t) => m.comp ? `<button class="chip" data-comp="${esc(m.comp)}" data-team="${t.key}">${esc(compLabel(m.comp, m.compName))} ›</button>` : "";

function matchCard(m, t) {
  const live = m.state === "in", done = m.state === "post";
  const center = live || done ? `${esc(m.home.score)} – ${esc(m.away.score)}`
    : m.playing ? `<span class="live-badge" style="font-size:16px">LIVE</span>` : fmt(m.date, { hour: "2-digit", minute: "2-digit" });
  const side = (s, cls) => `<div class="side ${cls}">${cls === "away" ? `<span>${esc(s.name)}</span>` : ""}
      ${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ""}${cls === "home" ? `<span>${esc(s.name)}</span>` : ""}</div>`;
  const status = live ? `<span class="live-badge">● LIVE ${esc(m.clock || m.detail)}</span>`
    : m.playing ? `<span class="live-badge">● In corso</span>`
    : done ? "Finale · Tabellino ›" : when(m.date);
  return `<div class="card match-card ${live || m.playing ? "live" : ""}" data-match="${esc(m.id)}" data-team="${t.key}">
    <div class="match">${side(m.home, "home")}<div class="score">${center}</div>${side(m.away, "away")}</div>
    <div class="meta"><span>${compChip(m, t)} ${m.basket ? esc(m.league) : ""}</span><span>${status}</span></div>
    ${done ? "" : tvLine(m, t)}</div>`;
}

function resultRow(m, t) {
  const me = m[m.mine], opp = m[m.mine === "home" ? "away" : "home"];
  const a = +me.score, b = +opp.score;
  const r = isNaN(a) || isNaN(b) ? "x" : a > b ? "V" : a === b ? "N" : "P";
  return `<div class="row click" data-match="${esc(m.id)}" data-team="${t.key}"><div class="res ${r}">${r === "x" ? "–" : r}</div>
    <div class="opp">${m.mine === "home" ? "vs" : "@"} ${esc(opp.name)}</div>
    <div class="when"><b>${esc(me.score)}-${esc(opp.score)}</b><br>${fmt(m.date, { day: "numeric", month: "short" })}</div></div>`;
}

function fixtureRow(m) {
  const opp = m[m.mine === "home" ? "away" : "home"];
  return `<div class="row"><div class="res x">${m.mine === "home" ? "C" : "T"}</div>
    <div class="opp">${m.mine === "home" ? "vs" : "@"} ${esc(opp.name)}</div>
    <div class="when">${when(m.date)}</div></div>`;
}

function newsList(items) {
  if (!items?.length) return `<div class="empty">Nessuna notizia (si aggiornano ogni 30 minuti).</div>`;
  return items.map((n) => `<a class="card news" href="${esc(n.link)}" target="_blank" rel="noopener">
    <div class="t">${esc(n.title)}</div>
    <div class="src">${esc(n.source)} · ${ago(n.date)}${n.lang === "es" ? " · 🇦🇷" : ""}</div></a>`).join("");
}

// ----- HOME: solo stemmi + GO -----
// Scritta della Home: "EL CORAZÓN LATE" con la linea del battito nei colori delle 4 squadre
const BRAND = `<div class="brand"><h1>EL CORAZÓN LATE</h1>
  <svg viewBox="0 0 350 40" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="beat">
    <stop offset="0" stop-color="#f0bc42"/><stop offset=".3" stop-color="#8e1f2f"/><stop offset=".55" stop-color="#ffd100"/>
    <stop offset=".75" stop-color="#1d4f9c"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <polyline fill="none" stroke="url(#beat)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"
      points="0,22 120,22 132,22 140,8 150,36 160,2 170,30 178,22 230,22 238,15 246,22 350,22"/></svg></div>`;

function viewHome() {
  const all = [...new Set(TEAMS.filter((t) => t.espn).flatMap(followed))];
  const ids = TEAMS.filter((t) => t.espn).map((t) => String(t.espn));
  const anyLive = all.some((slug) => (state.today[slug] || []).some((m) => m.state === "in"));
  const live = todayHtml(all, ids, false);
  return BRAND + `<div class="grid">${TEAMS.map((t) => `<div class="tile" style="--c1:${t.colors[0]};--c2:${t.colors[1]}">
      ${crest(t, "big")}<button class="go" data-view="${t.key}">GO</button></div>`).join("")}</div>`
    + `<div style="margin-top:16px">${panel("liveora", anyLive ? "🔴" : "📅", anyLive ? "Live ora" : "Oggi nelle tue competizioni",
        live ? `<div class="hint">Le partite in corso sono evidenziate · si aggiorna da solo</div>${live}`
             : `<div class="empty">${loaded ? "Oggi nessuna partita nelle competizioni di Roma e Boca." : "Caricamento…"}</div>`)}</div>`;
}

// ----- DOVE VEDERLA (Italia, stagione 2026/27) -----
// [canale, cosa trasmette, come vederla (TV / app / streaming), link]
const TV = {
  "ita.1": [
    ["DAZN", "Tutte le partite", "App DAZN su smartphone, Smart TV, Fire TV, PC", "https://www.dazn.com/it-IT"],
    ["Sky Sport", "3 partite per giornata", "Decoder Sky · app Sky Go · NOW", "https://www.nowtv.it"]],
  "uefa.champions": [
    ["Sky Sport", "185 partite su 203", "Decoder Sky · app Sky Go · NOW", "https://www.nowtv.it"],
    ["Prime Video", "La miglior partita del mercoledì", "App Prime Video su smartphone, Smart TV, Fire TV", "https://www.primevideo.com"]],
  "uefa.europa": [["Sky Sport", "Tutte le partite", "Decoder Sky · app Sky Go · NOW", "https://www.nowtv.it"]],
  "uefa.europa.conf": [["Sky Sport", "Tutte le partite", "Decoder Sky · app Sky Go · NOW", "https://www.nowtv.it"]],
  "ita.coppa_italia": [["Mediaset", "In chiaro (Canale 5 / Italia 1)", "TV · app Mediaset Infinity", "https://mediasetinfinity.mediaset.it"]],
  "ita.super_cup": [["Mediaset", "In chiaro (Canale 5 / Italia 1)", "TV · app Mediaset Infinity", "https://mediasetinfinity.mediaset.it"]],
  "arg.1": [["Sportitalia", "In chiaro", "Canale 60 del digitale terrestre · streaming su sportitalia.it e app", "https://www.sportitalia.it"]],
  "Italian Serie A2": [
    ["LNP Pass", "Tutte le partite in streaming", "Abbonamento su lnppass.legapallacanestro.com", "https://lnppass.legapallacanestro.com/"],
    ["Rai Sport", "Alcune partite in chiaro", "Rai Sport HD · app RaiPlay", "https://www.legapallacanestro.com/serie-a2/calendario-dirette"]],
};
const TV_GUIDE = "https://www.goal.com/it/notizie/guida-tv-dove-vedere-tutto-il-calcio-in-diretta-e-streaming/1674frahvw8qt1nojf0cwjwlzr";

// Dove vederla PARTITA PER PARTITA (data/tv.json, dagli articoli "dove vederla")
state.tv = [];
async function loadTv() {
  try { state.tv = (await getJSON(`data/tv.json?t=${Date.now()}`)).matches || []; } catch { state.tv = []; }
}
function tvFor(m, t) {
  return state.tv.find((x) => x.team === t.key && (String(x.id) === String(m.id) || Math.abs(Date.parse(x.date) - Date.parse(m.date)) < 6 * 3600e3));
}
function tvMatchHtml(m, t) {
  const x = tvFor(m, t);
  const found = (x?.channels || []).filter((c) => !c.always);
  const always = (x?.channels || []).filter((c) => c.always);
  let h = `<div class="tvmatch"><div class="tvmatch-title">${esc(m.home.name)} – ${esc(m.away.name)} · ${when(m.date)}</div>`;
  if (found.length) {
    h += `<div class="tvchips">${found.map((c) => `<span class="tvchip">📺 ${esc(c.name)}</span>`).join("")}${always.map((c) => `<span class="tvchip soft">${esc(c.name)} (sempre)</span>`).join("")}</div>
      <div class="hint">Fonti per questa partita:</div>${x.sources.map((n) => `<a class="src-link" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)} <small>· ${esc(n.source)}</small></a>`).join("")}`;
  } else {
    h += `${always.length ? `<div class="tvchips">${always.map((c) => `<span class="tvchip">📺 ${esc(c.name)}</span>`).join("")}</div>` : ""}
      <div class="hint">⏳ Il canale di questa partita non è ancora stato annunciato. Lo controllo ogni 30 minuti: di solito esce nei giorni prima della gara.</div>`;
  }
  return h + `</div>`;
}
function tvLine(m, t) {
  const found = (tvFor(m, t)?.channels || []).filter((c) => !c.always).map((c) => c.name);
  return found.length ? `<div class="tvline">📺 ${esc(found.join(" · "))}</div>` : "";
}

function tvHtml(k) {
  const list = TV[k];
  if (!list) return `<div class="empty">Diritti TV in Italia non confermati per questa competizione.
    <a href="${TV_GUIDE}" target="_blank" rel="noopener">Controlla la guida TV ↗</a></div>`;
  return list.map(([ch, what, how, url]) => `<a class="tv" href="${url}" target="_blank" rel="noopener">
    <b>${esc(ch)}</b><span>${esc(what)}</span><small>${esc(how)}</small></a>`).join("");
}

// ----- PAGINA SQUADRA: tre sezioni ben distinte -> NOTIZIE, LIVE, COMPETIZIONI -----
// Link esterno ufficiale per ogni competizione
function compExtLink(k) {
  if (/serie a2|italian serie a2/i.test(k)) return ["Sito ufficiale LNP", "https://www.legapallacanestro.com/serie/1/calendario"];
  if (k.includes(".")) return ["Classifica su ESPN", `https://www.espn.com/soccer/standings/_/league/${k}`];
  return null;
}

function panel(id, icon, title, body) {
  return `<section class="panel" id="sec-${id}"><div class="panel-head"><span>${icon}</span>${title}</div><div class="panel-body">${body}</div></section>`;
}

function viewTeam(t) {
  const ms = state.matches[t.key] || [];
  const news = state.news?.teams?.[t.key] || [];
  const showAll = state.newsAll === t.key;
  const live = ms.filter((m) => m.state === "in" || m.playing);
  const last = [...ms].reverse().find((m) => m.state === "post");
  const next = ms.find((m) => m.state === "pre" && !m.playing);
  const comps = [...new Set(ms.map((m) => m.comp).filter(Boolean))];

  const jump = `<nav class="jump"><a href="#sec-notizie" data-jump="notizie">📰 Notizie</a>
    <a href="#sec-live" data-jump="live">🔴 Live</a><a href="#sec-ultima" data-jump="ultima">⏱️ Ultima</a>
    <a href="#sec-comp" data-jump="comp">🏆 Competizioni</a><a href="#sec-tv" data-jump="tv">📺 Dove vederla</a></nav>`;

  // NOTIZIE
  const newsBody = newsList(showAll ? news : news.slice(0, 5))
    + (news.length > 5 ? `<button class="more" data-newsall="${showAll ? "" : t.key}">${showAll ? "Mostra meno" : `Mostra tutte (${news.length})`}</button>` : "");

  // LIVE
  let liveBody;
  if (!ms.length) liveBody = loaded ? `<div class="empty">Calendario non ancora disponibile: si aggiorna ogni 30 minuti.</div>` : `<div class="empty">Caricamento…</div>`;
  else liveBody = (live.length ? live.map((m) => matchCard(m, t)).join("")
      : next ? `<div class="hint">Nessuna partita in corso · prossimo live</div>${matchCard(next, t)}`
      : `<div class="empty">Nessuna partita in programma.</div>`);
  if (t.espn) {
    const others = todayHtml(followed(t), [String(t.espn)], false);
    liveBody += others ? `<div class="hint" style="margin-top:14px">Oggi nelle competizioni di ${esc(t.short)} · si aggiorna ogni minuto</div>${others}`
      : `<div class="hint" style="margin-top:14px">Oggi non ci sono altre partite nelle competizioni di ${esc(t.short)}.</div>`;
  } else {
    liveBody += `<div class="hint" style="margin-top:14px">Per il basket i punteggi in diretta li trovi su LNP Pass:</div>
      <a class="ext" href="${LNP_LIVE}" target="_blank" rel="noopener">Diretta ufficiale LNP ↗</a>`;
  }
  const lastBody = last ? `<div class="hint">Tocca la partita per il tabellino, la competizione per classifica e calendario</div>${matchCard(last, t)}`
    : `<div class="empty">${loaded ? "Nessuna partita giocata." : "Caricamento…"}</div>`;

  // COMPETIZIONI
  const compBody = comps.length ? comps.map((k) => {
      const mine = ms.filter((m) => m.comp === k);
      const n = mine.find((m) => m.state === "pre");
      const ext = compExtLink(k);
      return `<div class="comp-row">
        <button class="comp-main" data-comp="${esc(k)}" data-team="${t.key}">
          <b>${esc(compLabel(k, mine[0].compName))}</b>
          <small>${mine.filter((m) => m.state === "post").length} giocate${n ? ` · prossima ${fmt(n.date, { day: "numeric", month: "short" })}` : ""}</small>
          <span class="go-arrow">Classifica e calendario ›</span></button>
        ${ext ? `<a class="ext" href="${ext[1]}" target="_blank" rel="noopener">${esc(ext[0])} ↗</a>` : ""}</div>`;
    }).join("")
    : `<div class="empty">${loaded ? "Nessuna competizione trovata." : "Caricamento…"}</div>`;
  // DOVE VEDERLA: prima la prossima partita, poi tutte le competizioni della squadra
  const upcoming = [...live, ...ms.filter((m) => m.state === "pre" && !m.playing)].slice(0, 2);
  const tvBody = (upcoming.length ? upcoming.map((m) => tvMatchHtml(m, t)).join("") : `<div class="empty">Nessuna partita in programma.</div>`)
    + `<details class="card" style="margin-top:10px"><summary><b>Chi trasmette le competizioni</b> (in generale)</summary>
       ${comps.map((k) => `<div class="hint" style="margin-top:10px">${esc(compLabel(k))}</div>${tvHtml(k)}`).join("")}
       <div class="hint" style="margin-top:10px"><a href="${TV_GUIDE}" target="_blank" rel="noopener">Guida TV completa ↗</a></div></details>`;
  const links = `<div class="links">${t.links.map(([l, u]) => `<a class="ext" href="${u}" target="_blank" rel="noopener">${esc(l)} ↗</a>`).join("")}</div>`;

  return head(t) + jump
    + panel("notizie", "📰", "Notizie", newsBody)
    + panel("live", "🔴", "Live", liveBody)
    + panel("ultima", "⏱️", "Ultima partita", lastBody)
    + panel("comp", "🏆", "Competizioni", compBody + links)
    + panel("tv", "📺", "Dove vederla", tvBody);
}

function head(t, title) {
  return `<div class="team-head">${crest(t, "mid")}<div><h3>${esc(title || t.name)}</h3><p>${esc(t.sport)}</p></div></div>`;
}

// ----- TABELLINO -----
function viewMatch(t, id) {
  const m = (state.matches[t.key] || []).find((x) => String(x.id) === String(id));
  if (!m) return head(t) + `<div class="empty">Partita non trovata.</div>`;
  let body = "";
  if (m.basket) {
    body += m.stats.length ? `<h2>Statistiche</h2><div class="card">${statRows(m.stats)}</div>` : "";
    // Link al tabellino: calendario ufficiale Serie A2 (colonna "Tabellino") + ricerca con squadre e data
    const q = encodeURIComponent(`${m.home.name} ${m.away.name} tabellino ${fmt(m.date, { day: "numeric", month: "long", year: "numeric" })}`);
    body += `<div class="card empty">Il tabellino giocatore per giocatore lo trovi qui:</div>
      <a class="btn" href="https://www.legapallacanestro.com/serie/1/calendario" target="_blank" rel="noopener">Calendario ufficiale Serie A2 (Tabellino) ›</a>
      <a class="btn" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Cerca tabellino ${esc(m.home.name)}–${esc(m.away.name)} ›</a>`;
  } else {
    const d = state.details[m.id];
    if (!d) loadDetail(m);
    if (!d || d.loading) body = `<div class="empty">Caricamento tabellino…</div>`;
    else if (d.error) body = `<div class="empty">Tabellino non disponibile.</div>`;
    else {
      if (d.events.length) body += `<h2>Cronaca</h2><div class="card">${d.events.map((e) =>
        `<div class="ev ${e.home ? "" : "away"}"><span class="min">${esc(e.min)}</span> ${e.icon} ${esc(e.who)}</div>`).join("")}</div>`;
      if (d.stats.length) body += `<h2>Statistiche</h2><div class="card">${statRows(d.stats)}</div>`;
      if (d.lineups.length) body += `<h2>Formazioni</h2>${d.lineups.map((l) => `<details class="card" open><summary><b>${esc(l.team)}</b> ${esc(l.formation)}</summary>
        ${l.starters.map((p) => `<div class="row"><div class="res x">${esc(p.jersey || "")}</div><div class="opp">${esc(p.athlete?.displayName)}${p.subbedOut ? " 🔻" : ""}</div><div class="when">${esc(p.position?.abbreviation || "")}</div></div>`).join("")}
        ${l.bench.length ? `<div class="tag" style="margin:6px 0">Entrati</div>${l.bench.map((p) => `<div class="row"><div class="res x">${esc(p.jersey || "")}</div><div class="opp">${esc(p.athlete?.displayName)} 🔺</div><div class="when">${esc(p.position?.abbreviation || "")}</div></div>`).join("")}` : ""}
        </details>`).join("")}`;
      if (!body) body = `<div class="empty">Tabellino non ancora disponibile.</div>`;
    }
    if (m.link) body += `<a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener">Apri su ESPN ›</a>`;
  }
  return head(t) + matchCard(m, t).replace("Finale · Tabellino ›", "Finale") + body;
}

function statRows(stats) {
  return stats.map((x) => {
    const a = parseFloat(x.home) || 0, b = parseFloat(x.away) || 0, tot = a + b || 1;
    return `<div class="stat"><span>${esc(x.home)}</span><span class="lbl">${esc(x.label)}</span><span>${esc(x.away)}</span>
      <div class="bar"><i style="width:${(a / tot) * 100}%"></i><i class="b" style="width:${(b / tot) * 100}%"></i></div></div>`;
  }).join("");
}

// ----- COMPETIZIONE -----
function tableHtml(rows, myId, basket) {
  const me = rows.find((r) => String(r.id) === String(myId));
  const body = rows.map((r) => `<div class="row" ${String(r.id) === String(myId) ? 'style="font-weight:800;color:var(--accent)"' : ""}>
      <div class="res x">${esc(r.pos)}</div><div class="opp">${esc(r.team)}</div>
      <div class="when">${basket ? `${esc(r.w)}V ${esc(r.l)}P` : `${esc(r.gp)}G ${esc(r.w)}-${esc(r.d)}-${esc(r.l)} · ${esc(r.gd)}`} · <b>${esc(r.pts)}</b></div></div>`).join("");
  return `<details class="card" open><summary><b>Classifica</b>${me ? ` · ${esc(me.pos)}° con ${esc(me.pts)} pt` : ""}</summary>${body}</details>`;
}

function leadersHtml(title, list, myId) {
  if (!list?.length) return "";
  return `<details class="card"><summary><b>${title}</b> · ${esc(list[0].who)} ${esc(list[0].val)}</summary>${list.map((l, i) =>
    `<div class="row" ${String(l.teamId) === String(myId) ? 'style="font-weight:800;color:var(--accent)"' : ""}>
      <div class="res x">${i + 1}</div><div class="opp">${esc(l.who)} <span class="tag">${esc(l.team)}</span></div>
      <div class="when"><b>${esc(l.val)}</b></div></div>`).join("")}</details>`;
}

let compTimer = null;
function viewComp(t, k) {
  const ms = state.matches[t.key] || [];
  const bk = state.basket[t.key];
  const myId = t.espn || bk?.id;
  const mine = ms.filter((m) => m.comp === k);
  const name = compLabel(k, mine[0]?.compName);
  const res = mine.filter((m) => m.state === "post").reverse();
  const fix = mine.filter((m) => m.state !== "post");
  const ext = compExtLink(k);
  const mark = (id) => String(id) === String(myId) ? ' style="font-weight:800;color:var(--accent)"' : "";
  let liveBody = "", tableBody = "", leadersBody = "";

  if (t.espn) {
    const c = state.comps[k];
    if (!c) loadComp(k);
    if (!c || c.loading) liveBody = tableBody = `<div class="empty">Caricamento…</div>`;
    else {
      // Live e giornata: tutte le partite della competizione nei giorni vicini
      const fresh = new Map((state.today[k] || []).map((m) => [m.id, m]));
      const round = [...c.round].map((m) => fresh.get(m.id) || m).sort((x, y) => Date.parse(x.date) - Date.parse(y.date));
      const anyLive = round.some((m) => m.state === "in");
      liveBody = round.length ? (anyLive ? `<div class="hint"><span class="live-badge">● LIVE</span> si aggiorna da solo ogni minuto</div>` : "")
        + round.map((m) => `<div class="row ${m.state === "in" ? "is-live" : ""}">
            <div class="opp"><span${mark(m.home.id)}>${esc(m.home.name)}</span> – <span${mark(m.away.id)}>${esc(m.away.name)}</span></div>
            <div class="when">${m.state === "pre" ? when(m.date)
              : `<b>${esc(m.home.score)}-${esc(m.away.score)}</b> ${m.state === "in" ? `<span class="live-badge">${esc(m.clock || "LIVE")}</span>` : "fin."}`}</div></div>`).join("")
        : `<div class="empty">Nessuna partita in questi giorni.</div>`;
      // aggiornamento automatico mentre ci sono partite in corso
      clearTimeout(compTimer);
      if (anyLive) compTimer = setTimeout(() => {
        if (state.sub?.type === "comp" && state.sub.key === k) { delete state.comps[k]; render(); }
      }, 60000);
      const groups = c.groups.filter((g) => g.rows.some((r) => String(r.id) === String(myId)));
      tableBody = groups.map((g) => (c.groups.length > 1 ? `<div class="tag" style="margin:4px 0">${esc(g.name)}</div>` : "") + tableHtml(g.rows, myId)).join("")
        || (c.groups.length ? "" : `<div class="empty">Fase a eliminazione diretta: nessuna classifica.</div>`);
      leadersBody = leadersHtml("Marcatori", c.scorers, myId) + leadersHtml("Assist", c.assists, myId);
    }
  } else {
    const rows = (state.tables[bk?.leagueId] || []).map((r) => ({ ...r, w: r.win, l: r.loss }));
    const now = Date.now();
    const near = mine.filter((m) => Math.abs(Date.parse(m.date) - now) < 4 * 86400000);
    liveBody = (near.length ? near.map((m) => matchCard(m, t)).join("") : `<div class="empty">Nessuna partita in questi giorni.</div>`)
      + `<a class="ext" href="${LNP_LIVE}" target="_blank" rel="noopener">Diretta ufficiale LNP ↗</a>`;
    tableBody = rows.length ? tableHtml(rows, myId, true) : `<div class="empty">Classifica non ancora disponibile.</div>`;
    leadersBody = `<a class="ext" href="https://www.legapallacanestro.com/serie/1/leaders/regular/5286" target="_blank" rel="noopener">Marcatori e statistiche LNP ↗</a>`;
  }

  const calBody = (fix.length ? `<div class="hint">Prossime partite</div><div class="card">${fix.slice(0, 20).map(fixtureRow).join("")}</div>` : "")
    + (res.length ? `<div class="hint" style="margin-top:10px">Risultati · tocca per il tabellino</div><div class="card">${res.map((m) => resultRow(m, t)).join("")}</div>` : "")
    || `<div class="empty">Nessuna partita.</div>`;

  return head(t, name)
    + `<nav class="jump"><a data-jump="clive">🔴 Live</a><a data-jump="ctab">🏆 Classifica</a><a data-jump="ccal">📅 Calendario</a><a data-jump="cmar">⚽ Marcatori</a></nav>`
    + panel("clive", "🔴", "Live e giornata", liveBody)
    + panel("ctab", "🏆", "Classifica", tableBody)
    + panel("ccal", "📅", `Calendario ${esc(t.short)}`, calBody)
    + panel("cmar", "⚽", "Marcatori e assist", leadersBody || `<div class="empty">Non disponibili.</div>`)
    + panel("ctv", "📺", "Dove vederla", tvHtml(k))
    + (ext ? `<a class="ext" href="${ext[1]}" target="_blank" rel="noopener">${esc(ext[0])} ↗</a>` : "");
}

// Prossimo impegno (o live) di ogni squadra, in ordine di orario
function upcomingHtml() {
  const now = Date.now();
  const items = TEAMS.map((t) => {
    const ms = state.matches[t.key] || [];
    const m = ms.find((x) => x.state === "in" || x.playing)
      || ms.find((x) => x.state === "pre" && Date.parse(x.date) > now - 3 * 3600000);
    return m && { t, m };
  }).filter(Boolean).sort((a, b) => Date.parse(a.m.date) - Date.parse(b.m.date));
  return items.map(({ t, m }) => {
    const opp = m[m.mine === "home" ? "away" : "home"].name;
    const live = m.state === "in" || m.playing;
    const time = live ? `<span class="live-badge">● LIVE${m.state === "in" ? ` ${esc(m.home.score)}-${esc(m.away.score)}` : ""}</span>`
      : `<span class="d">${fmt(m.date, { weekday: "short", day: "numeric" })}</span> <span class="h">${fmt(m.date, { hour: "2-digit", minute: "2-digit" })}</span>`;
    return `<button class="up ${live ? "is-live" : ""}" data-match="${esc(m.id)}" data-team="${t.key}">
      ${crest(t, "ic")}<span class="up-txt"><b class="up-when">${time}</b><span class="up-opp">vs ${esc(opp)}</span></span></button>`;
  }).join("");
}

function render() {
  const t = teamBy(state.view);
  const [c1, c2] = t?.colors || ["#e8b23a", "#8e1f2f"];
  const [b1, b2] = t?.bg || t?.colors || [];
  const root = document.documentElement.style;
  root.setProperty("--accent", c1);
  root.setProperty("--accent2", c2);
  document.body.classList.toggle("team-bg", !!t);
  if (t) { root.setProperty("--bg1", b1); root.setProperty("--bg2", b2); }
  $("#back").hidden = !t;
  $("#home").hidden = !t;
  $("#upcoming").innerHTML = upcomingHtml();
  $("#view").innerHTML = !t ? viewHome()
    : state.sub?.type === "match" ? viewMatch(t, state.sub.id)
    : state.sub?.type === "comp" ? viewComp(t, state.sub.key)
    : viewTeam(t);
}

// ===== Navigazione (con tasto indietro del telefono) =====
function go(view, sub = null, push = true) {
  state.view = view; state.sub = sub;
  if (push) history.pushState({ view, sub }, "", view === "home" ? "#" : `#${view}`);
  render(); scrollTo(0, 0);
}
window.addEventListener("popstate", (e) => { const s = e.state || { view: "home", sub: null }; go(s.view, s.sub, false); });

document.addEventListener("click", (e) => {
  const ext = e.target.closest("[data-href]");
  if (ext && !e.target.closest("[data-match]")) return window.open(ext.dataset.href, "_blank", "noopener");
  const jmp = e.target.closest("[data-jump]");
  if (jmp) { e.preventDefault(); return document.getElementById(`sec-${jmp.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  const more = e.target.closest("[data-newsall]");
  if (more) { state.newsAll = more.dataset.newsall || null; return render(); }
  const comp = e.target.closest("[data-comp]"), match = e.target.closest("[data-match]"), v = e.target.closest("[data-view]");
  if (comp) return go(comp.dataset.team, { type: "comp", key: comp.dataset.comp });
  if (match) return go(match.dataset.team, { type: "match", id: match.dataset.match });
  if (v) return go(v.dataset.view);
});
$("#back").addEventListener("click", () => history.length > 1 ? history.back() : go("home"));
$("#home").addEventListener("click", () => go("home"));
$("#refresh").addEventListener("click", () => { state.details = {}; loadAll(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
if (teamBy(location.hash.slice(1))) state.view = location.hash.slice(1);
history.replaceState({ view: state.view, sub: null }, "");

// ===== Notifiche push: pulsante 🔔 =====
const PUSH_API = "https://tifo-notifiche.mimmo-asci.workers.dev";
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));

async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await swReady();
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

async function updateBell() {
  const st = await pushState();
  const b = $("#bell");
  b.textContent = st === "on" ? "🔔" : "🔕";
  b.title = { on: "Notifiche attive (tocca per disattivare)", off: "Attiva le notifiche", denied: "Notifiche bloccate nelle impostazioni del telefono", unsupported: "Notifiche non supportate: aggiungi Tifo alla schermata Home" }[st];
  b.classList.toggle("on", st === "on");
  const lab = $("#bell-label");
  lab.textContent = st === "on" ? "Live attivo" : "Attiva la campanella per il live";
  lab.classList.toggle("on", st === "on");
}

// Aspetta il service worker al massimo 8 secondi
const swReady = () => Promise.race([navigator.serviceWorker.ready,
  new Promise((_, rej) => setTimeout(() => rej(new Error("app non pronta: chiudila e riaprila dall'icona")), 8000))]);

async function toggleBell() {
  alertMsg("Un attimo…");
  const st = await pushState().catch(() => "unsupported");
  if (st === "unsupported") return alertMsg("Per le notifiche apri Tifo dall'icona sulla schermata Home.");
  if (st === "denied") return alertMsg("Le notifiche sono bloccate: sbloccale nelle impostazioni del telefono (App → Tifo/Chrome → Notifiche).");
  try {
    const reg = await swReady();
    if (st === "on") {
      return alertMsg(`Notifiche attive. <button class="btn" id="ptest">Prova notifica</button> <button class="btn" id="poff">Disattiva</button>`, 10000, true);
    }
    {
      if ((await Notification.requestPermission()) !== "granted") return updateBell();
      const { key } = await getJSON(`${PUSH_API}/vapid`);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      await fetch(`${PUSH_API}/subscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: sub.toJSON() }) });
      alertMsg("Notifiche attivate! Tra pochi secondi arriva una notifica di conferma.");
    }
  } catch (e) { alertMsg("Non sono riuscito ad attivare le notifiche: " + e.message); }
  updateBell();
}

function alertMsg(t, ms = 4000, html = false) {
  const el = $("#toast"); el[html ? "innerHTML" : "textContent"] = t; el.hidden = false;
  clearTimeout(alertMsg.t); alertMsg.t = setTimeout(() => (el.hidden = true), ms);
}

// Prova: 1) notifica locale (senza internet)  2) notifica push dal servizio Cloudflare
async function testPush() {
  try {
    const reg = await swReady();
    await reg.showNotification("🔔 Prova locale", { body: "Se vedi questa, il telefono mostra le notifiche di Tifo.", icon: "icon-192.png" });
    const r = await fetch(`${PUSH_API}/test`).then((x) => x.text());
    alertMsg(`Inviate 2 prove: "Prova locale" subito e "Tifo: prova notifica" entro pochi secondi.<br><small>${esc(r).replace(/\n/g, "<br>")}</small>`, 15000, true);
  } catch (e) { alertMsg("Prova non riuscita: " + e.message); }
}

async function disablePush() {
  const reg = await swReady();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await fetch(`${PUSH_API}/subscribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub, remove: true }) }).catch(() => {});
    await sub.unsubscribe();
  }
  alertMsg("Notifiche disattivate.");
  updateBell();
}

document.addEventListener("click", (e) => {
  if (e.target.id === "ptest") testPush();
  if (e.target.id === "poff") disablePush();
});

$("#bell").addEventListener("click", toggleBell);
$("#bell-label").addEventListener("click", toggleBell);

render();
loadAll();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(updateBell);
