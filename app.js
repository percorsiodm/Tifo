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
    colors: ["#9cc3ff", "#1d4f9c"],
    links: [["Diretta LNP", "https://lnppass.legapallacanestro.com/"], ["Lega Nazionale Pallacanestro", "https://www.legapallacanestro.com"]] },
  { key: "juvecaserta", name: "Juvecaserta", short: "Caserta", sport: "Basket", abbr: "J", img: "Juvecaserta.png",
    colors: ["#dddddd", "#2a2a2a"],
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

async function loadAll() {
  $("#upd").textContent = "aggiorno…";
  state.comps = {};
  await Promise.allSettled([loadNews(), loadBasket(), ...TEAMS.filter((t) => t.espn).map(loadMatches)]);
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
    <div class="meta"><span>${compChip(m, t)} ${m.basket ? esc(m.league) : ""}</span><span>${status}</span></div></div>`;
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
function viewHome() {
  return `<div class="grid">${TEAMS.map((t) => `<div class="tile" style="--c1:${t.colors[0]};--c2:${t.colors[1]}">
      ${crest(t, "big")}<button class="go" data-view="${t.key}">GO</button></div>`).join("")}</div>`;
}

// ----- PAGINA SQUADRA: live, ultima, prossima, notizie -----
function viewTeam(t) {
  const ms = state.matches[t.key] || [];
  const live = ms.filter((m) => m.state === "in" || m.playing);
  const last = [...ms].reverse().find((m) => m.state === "post");
  const next = ms.find((m) => m.state === "pre" && !m.playing);
  const comps = [...new Set(ms.map((m) => m.comp).filter(Boolean))];
  if (!ms.length) return head(t) + `<div class="empty">Caricamento…</div>`;
  return head(t)
    + (live.length ? `<h2>Live</h2>${live.map((m) => matchCard(m, t)).join("")}` : "")
    + `<h2>Ultima partita</h2>${last ? matchCard(last, t) : `<div class="empty">Nessuna partita giocata.</div>`}`
    + `<h2>Prossima partita</h2>${next ? matchCard(next, t) : `<div class="empty">Nessuna partita in programma.</div>`}`
    + (comps.length ? `<h2>Competizioni</h2><div>${comps.map((k) => compChip(ms.find((m) => m.comp === k), t)).join(" ")}</div>` : "")
    + `<h2>Notizie</h2>${newsList(state.news?.teams?.[t.key])}`;
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
    body += `<div class="card empty">Il tabellino completo, giocatore per giocatore, del basket è disponibile sul sito ufficiale della Lega.</div>
      <a class="btn" href="${LNP_LIVE}" target="_blank" rel="noopener">Tabellino ufficiale LNP ›</a>`;
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

function viewComp(t, k) {
  const ms = state.matches[t.key] || [];
  const bk = state.basket[t.key];
  const myId = t.espn || bk?.id;
  const mine = ms.filter((m) => m.comp === k);
  const name = compLabel(k, mine[0]?.compName);
  const res = mine.filter((m) => m.state === "post").reverse();
  const fix = mine.filter((m) => m.state !== "post");
  let extra = "";
  if (t.espn) {
    const c = state.comps[k];
    if (!c) loadComp(k);
    if (!c || c.loading) extra = `<div class="empty">Caricamento classifica…</div>`;
    else {
      const groups = c.groups.filter((g) => g.rows.some((r) => String(r.id) === String(myId)));
      extra = groups.map((g) => (c.groups.length > 1 ? `<div class="tag" style="margin:4px 0">${esc(g.name)}</div>` : "") + tableHtml(g.rows, myId)).join("")
        || (c.groups.length ? "" : `<div class="card empty">Eliminazione diretta: nessuna classifica.</div>`);
      extra += leadersHtml("Marcatori", c.scorers, myId) + leadersHtml("Assist", c.assists, myId);
      const others = c.round.filter((m) => !mine.some((x) => x.id === m.id));
      if (others.length) extra += `<details class="card"><summary><b>Altre partite</b> · ${others.length} in questi giorni</summary>
        ${others.map((m) => `<div class="row"><div class="opp">${esc(m.home.name)} – ${esc(m.away.name)}</div>
          <div class="when">${m.state === "pre" ? when(m.date) : `<b>${esc(m.home.score)}-${esc(m.away.score)}</b>${m.state === "in" ? ` <span class="live-badge">${esc(m.clock)}</span>` : ""}`}</div></div>`).join("")}</details>`;
    }
  } else {
    const rows = (state.tables[bk?.leagueId] || []).map((r) => ({ ...r, w: r.win, l: r.loss }));
    extra = rows.length ? tableHtml(rows, myId, true) : "";
    extra += `<a class="btn" href="https://www.legapallacanestro.com/serie/1/leaders/regular/5286" target="_blank" rel="noopener">Marcatori e statistiche ›</a>`;
  }
  return head(t, name) + extra
    + (res.length ? `<details class="card" open><summary><b>Risultati</b> · ${res.length}</summary>${res.map((m) => resultRow(m, t)).join("")}</details>` : "")
    + (fix.length ? `<details class="card"><summary><b>Calendario</b> · ${fix.length}</summary>${fix.slice(0, 20).map(fixtureRow).join("")}</details>` : "");
}

function render() {
  const t = teamBy(state.view);
  const [c1, c2] = t?.colors || ["#e8b23a", "#8e1f2f"];
  document.documentElement.style.setProperty("--accent", c1);
  document.documentElement.style.setProperty("--accent2", c2);
  $("#back").hidden = !t;
  $("#view").innerHTML = !t ? viewHome()
    : state.sub?.type === "match" ? viewMatch(t, state.sub.id)
    : state.sub?.type === "comp" ? viewComp(t, state.sub.key)
    : viewTeam(t);
  $("#nav").innerHTML = `<button data-view="home" class="${!t ? "on" : ""}"><span class="ic home">⌂</span>Home</button>`
    + TEAMS.map((x) => `<button data-view="${x.key}" class="${state.view === x.key ? "on" : ""}">${crest(x, "ic")}${esc(x.short)}</button>`).join("");
}

// ===== Navigazione (con tasto indietro del telefono) =====
function go(view, sub = null, push = true) {
  state.view = view; state.sub = sub;
  if (push) history.pushState({ view, sub }, "", view === "home" ? "#" : `#${view}`);
  render(); scrollTo(0, 0);
}
window.addEventListener("popstate", (e) => { const s = e.state || { view: "home", sub: null }; go(s.view, s.sub, false); });

document.addEventListener("click", (e) => {
  const comp = e.target.closest("[data-comp]"), match = e.target.closest("[data-match]"), v = e.target.closest("[data-view]");
  if (comp) return go(comp.dataset.team, { type: "comp", key: comp.dataset.comp });
  if (match) return go(match.dataset.team, { type: "match", id: match.dataset.match });
  if (v) return go(v.dataset.view);
});
$("#back").addEventListener("click", () => history.length > 1 ? history.back() : go("home"));
$("#refresh").addEventListener("click", () => { state.details = {}; loadAll(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
if (teamBy(location.hash.slice(1))) state.view = location.hash.slice(1);
history.replaceState({ view: state.view, sub: null }, "");

render();
loadAll();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
