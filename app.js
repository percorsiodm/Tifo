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
const state = { view: "home", tab: "partite", news: null, matches: {}, basket: {}, tables: {}, comps: {} };
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
  onerror="this.remove()"></span>`;
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

// ===== Rendering =====
function matchCard(m, t) {
  const live = m.state === "in", done = m.state === "post";
  const center = live || done ? `${esc(m.home.score)} – ${esc(m.away.score)}`
    : m.playing ? `<span class="live-badge" style="font-size:16px">LIVE</span>` : fmt(m.date, { hour: "2-digit", minute: "2-digit" });
  const side = (s, cls) => `<div class="side ${cls}">${cls === "away" ? `<span>${esc(s.name)}</span>` : ""}
      ${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : ""}${cls === "home" ? `<span>${esc(s.name)}</span>` : ""}</div>`;
  const goals = live || done ? m.goals.map((g) =>
    `<div style="text-align:${g.home ? "left" : "right"}">${g.red ? "🟥" : "⚽"} ${esc(g.who)} ${esc(g.min)}</div>`).join("") : "";
  const status = live ? `<span class="live-badge">● LIVE ${esc(m.clock || m.detail)}</span>`
    : m.playing ? `<span class="live-badge">● In corso · Segui live ›</span>`
    : m.link === LNP_LIVE ? `${when(m.date)} · <b style="color:var(--live)">Segui live ›</b>`
    : done ? "Finale" : when(m.date);
  return `<a class="card ${live ? "live" : ""}" ${m.link ? `href="${esc(m.link)}" target="_blank" rel="noopener"` : ""}>
    <div class="match">${side(m.home, "home")}<div class="score">${center}</div>${side(m.away, "away")}</div>
    ${goals ? `<div class="meta" style="display:block;font-size:12px">${goals}</div>` : ""}
    <div class="meta"><span>${t ? `<span class="tag">${esc(t.short)}</span> ` : ""}${esc(m.league)}</span><span>${status}</span></div></a>`;
}

function resultRow(m) {
  const me = m[m.mine], opp = m[m.mine === "home" ? "away" : "home"];
  const a = +me.score, b = +opp.score;
  const r = isNaN(a) || isNaN(b) ? "x" : a > b ? "V" : a === b ? "N" : "P";
  return `<div class="row"><div class="res ${r}">${r === "x" ? "–" : r}</div>
    <div class="opp">${m.mine === "home" ? "vs" : "@"} ${esc(opp.name)} <span class="tag">${esc(m.league)}</span></div>
    <div class="when"><b>${esc(me.score)}-${esc(opp.score)}</b><br>${fmt(m.date, { day: "numeric", month: "short" })}</div></div>`;
}

function fixtureRow(m) {
  const opp = m[m.mine === "home" ? "away" : "home"];
  return `<div class="row"><div class="res x">${m.mine === "home" ? "C" : "T"}</div>
    <div class="opp">${m.mine === "home" ? "vs" : "@"} ${esc(opp.name)} <span class="tag">${esc(m.league)}</span></div>
    <div class="when">${when(m.date)}</div></div>`;
}

function newsList(items, showTeam) {
  if (!items?.length) return `<div class="empty">Nessuna notizia (si aggiornano ogni 30 minuti).</div>`;
  return items.map((n) => `<a class="card news" href="${esc(n.link)}" target="_blank" rel="noopener">
    <div class="t">${esc(n.title)}</div>
    <div class="src">${showTeam ? `<span class="tag">${esc(teamBy(n.team).short)}</span> ` : ""}${esc(n.source)} · ${ago(n.date)}${n.lang === "es" ? " · 🇦🇷" : ""}</div></a>`).join("");
}

function teamStatus(t) {
  const ms = state.matches[t.key] || [];
  const now = Date.now();
  const opp = (m) => m[m.mine === "home" ? "away" : "home"].name;
  const live = ms.find((m) => m.state === "in" || m.playing);
  if (live) return `<span class="live-badge">● LIVE</span> ${live.state === "in" ? `<b>${esc(live.home.score)}-${esc(live.away.score)}</b>` : ""} vs ${esc(opp(live))}`;
  const last = [...ms].reverse().find((m) => m.state === "post");
  if (last && now - Date.parse(last.date) < 36 * 3600000) {
    const me = last[last.mine], o = last[last.mine === "home" ? "away" : "home"];
    const r = +me.score > +o.score ? "V" : +me.score === +o.score ? "N" : "P";
    return `<span class="res ${r}" style="display:inline-grid;width:18px;height:18px;font-size:11px">${r}</span> <b>${esc(me.score)}-${esc(o.score)}</b> vs ${esc(o.name)}`;
  }
  const next = ms.find((m) => m.state === "pre" && Date.parse(m.date) > now - 3 * 3600000);
  if (next) return `${fmt(next.date, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}<br>vs ${esc(opp(next))}`;
  return ms.length ? "" : "Caricamento…";
}

function viewHome() {
  const now = Date.now();
  const live = [];
  for (const t of TEAMS)
    (state.matches[t.key] || []).filter((m) => m.state === "in" || m.playing).forEach((m) => live.push([t, m]));
  const allNews = Object.entries(state.news?.teams || {})
    .flatMap(([team, arr]) => arr.map((n) => ({ ...n, team })))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 12);
  return `
    <div class="grid">${TEAMS.map((t) => `<button class="tile" data-view="${t.key}" style="--c1:${t.colors[0]};--c2:${t.colors[1]}">
      ${crest(t, "big")}<div class="tname">${esc(t.name)}</div><div class="tstat">${teamStatus(t)}</div></button>`).join("")}</div>
    ${live.length ? `<h2>In diretta</h2>${live.map(([t, m]) => matchCard(m, t)).join("")}` : ""}
    <h2>Ultime notizie</h2>${newsList(allNews, true)}`;
}

function tableHtml(rows, myId, basket) {
  const me = rows.find((r) => String(r.id) === String(myId));
  const body = rows.map((r) => `<div class="row" ${String(r.id) === String(myId) ? 'style="font-weight:800;color:var(--accent)"' : ""}>
      <div class="res x">${esc(r.pos)}</div><div class="opp">${esc(r.team)}</div>
      <div class="when">${basket ? `${esc(r.w)}V ${esc(r.l)}P` : `${esc(r.gp)}G ${esc(r.w)}-${esc(r.d)}-${esc(r.l)} · ${esc(r.gd)}`} · <b>${esc(r.pts)}</b></div></div>`).join("");
  return `<details class="card"${rows.length <= 20 ? " open" : ""}><summary><b>Classifica</b>${me ? ` · ${esc(me.pos)}° con ${esc(me.pts)} pt` : ""}</summary>${body}</details>`;
}

function leadersHtml(title, list, myId) {
  if (!list?.length) return "";
  return `<details class="card"><summary><b>${title}</b> · ${esc(list[0].who)} ${esc(list[0].val)}</summary>${list.map((l, i) =>
    `<div class="row" ${String(l.teamId) === String(myId) ? 'style="font-weight:800;color:var(--accent)"' : ""}>
      <div class="res x">${i + 1}</div><div class="opp">${esc(l.who)} <span class="tag">${esc(l.team)}</span></div>
      <div class="when"><b>${esc(l.val)}</b></div></div>`).join("")}</details>`;
}

function viewComps(t) {
  const ms = state.matches[t.key] || [];
  const bk = state.basket[t.key];
  const myId = t.espn || bk?.id;
  const keys = [...new Set(ms.map((m) => m.comp).filter(Boolean))]
    .sort((a, b) => ms.filter((m) => m.comp === b).length - ms.filter((m) => m.comp === a).length);
  if (!keys.length) return `<div class="empty">Caricamento…</div>`;
  return keys.map((k) => {
    const mine = ms.filter((m) => m.comp === k);
    const name = compLabel(k, mine[0].compName);
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
    } else if (k === bk?.league) {
      const rows = (state.tables[bk.leagueId] || []).map((r) => ({ ...r, w: r.win, l: r.loss }));
      extra = rows.length ? tableHtml(rows, myId, true) : "";
      extra += `<a class="btn" href="https://www.legapallacanestro.com/serie/1/leaders/regular/5286" target="_blank" rel="noopener">Marcatori e statistiche ›</a>`;
    }
    return `<h2>${esc(name)}</h2>${extra}
      ${res.length ? `<details class="card"><summary><b>Risultati</b> · ${res.length}</summary>${res.map(resultRow).join("")}</details>` : ""}
      ${fix.length ? `<details class="card" open><summary><b>Calendario</b> · ${fix.length}</summary>${fix.slice(0, 15).map(fixtureRow).join("")}</details>` : ""}`;
  }).join("");
}

function viewTeam(t) {
  const ms = state.matches[t.key] || [];
  const live = ms.filter((m) => m.state === "in" || m.playing);
  const next = ms.find((m) => m.state === "pre" && !m.playing);
  const results = ms.filter((m) => m.state === "post").reverse().slice(0, 10);
  const fixtures = ms.filter((m) => m.state === "pre" && !m.playing).slice(1, 11);
  const bk = state.basket[t.key];
  const head = `<div class="team-head">${crest(t, "mid")}
    <div><h3>${esc(t.name)}</h3><p>${t.sport}${bk?.league ? " · " + esc(bk.league) : ""}</p></div></div>
    <div class="seg"><button data-tab="partite" class="${state.tab === "partite" ? "on" : ""}">Live e partite</button>
    <button data-tab="competizioni" class="${state.tab === "competizioni" ? "on" : ""}">Competizioni</button>
    <button data-tab="notizie" class="${state.tab === "notizie" ? "on" : ""}">Notizie</button></div>`;
  const links = `<h2>Link utili</h2>${t.links.map(([l, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(l)}</a>`).join("")}`;

  if (state.tab === "notizie") return head + `<h2>Notizie</h2>` + newsList(state.news?.teams?.[t.key]);
  if (state.tab === "competizioni") return head + viewComps(t);
  if (!t.espn && !ms.length) return head + `<h2>Partite</h2><div class="card empty">Calendario non ancora disponibile:
      si aggiorna automaticamente ogni 30 minuti.</div>` + links;
  return head
    + (live.length ? `<h2>Live</h2>${live.map((m) => matchCard(m)).join("")}` : "")
    + (next ? `<h2>Prossima partita</h2>${matchCard(next)}` : "")
    + `<h2>Ultimi risultati</h2><div class="card">${results.map(resultRow).join("") || `<div class="empty">Caricamento…</div>`}</div>`
    + (fixtures.length ? `<h2>Calendario</h2><div class="card">${fixtures.map(fixtureRow).join("")}</div>` : "")
    + links;
}

function render() {
  const t = teamBy(state.view);
  const [c1, c2] = t?.colors || ["#e8b23a", "#8e1f2f"];
  document.documentElement.style.setProperty("--accent", c1);
  document.documentElement.style.setProperty("--accent2", c2);
  $("#view").innerHTML = t ? viewTeam(t) : viewHome();
  $("#nav").innerHTML = `<button data-view="home" class="${state.view === "home" ? "on" : ""}">
      <span class="ic" style="background:linear-gradient(135deg,#e8b23a,#444)">⌂</span>Home</button>`
    + TEAMS.map((x) => `<button data-view="${x.key}" class="${state.view === x.key ? "on" : ""}">
      ${crest(x, "ic")}${esc(x.short)}</button>`).join("");
}

// ===== Eventi =====
document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]"), tab = e.target.closest("[data-tab]");
  if (v) { state.view = v.dataset.view; state.tab = "partite"; location.hash = v.dataset.view; render(); scrollTo(0, 0); }
  if (tab) { state.tab = tab.dataset.tab; render(); }
});
$("#refresh").addEventListener("click", loadAll);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
if (teamBy(location.hash.slice(1))) state.view = location.hash.slice(1);

render();
loadAll();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
