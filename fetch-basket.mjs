// Calendario, risultati e classifica del basket da TheSportsDB -> data/basket.json
// Eseguito da GitHub Actions. Nessuna dipendenza.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const TEAMS = { fortitudo: "137319", juvecaserta: "137311" }; // id TheSportsDB
// Riconoscimento anche per nome, nel caso la fonte usi un codice diverso
const NAMES = { fortitudo: /fortitudo/i, juvecaserta: /caserta/i };
const KEYS = ["123", "3"]; // chiavi pubbliche gratuite
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// TheSportsDB gratuito: max ~30 richieste al minuto -> una richiesta ogni 2,2 secondi,
// e se arriva il blocco (429) si aspetta un minuto e si riprova.
let lastCall = 0;
async function api(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const k of KEYS) {
      const wait = lastCall + 2200 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try {
        const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${k}/${path}`);
        if (r.status === 429) { console.log("Limite richieste raggiunto, attendo 60s…"); await sleep(61000); continue; }
        if (r.ok) {
          const txt = await r.text();
          if (txt.trim().startsWith("{")) return JSON.parse(txt);
        }
      } catch {}
    }
  }
  console.log(`Nessuna risposta per ${path}`);
  return {};
}

const now = new Date();
const season = now.getUTCMonth() >= 7 ? `${now.getUTCFullYear()}-${now.getUTCFullYear() + 1}` : `${now.getUTCFullYear() - 1}-${now.getUTCFullYear()}`;

const toMatch = (e) => {
  const iso = e.strTimestamp ? e.strTimestamp.replace(/(\+00:00)?$/, "Z").replace("ZZ", "Z")
    : `${e.dateEvent}T${e.strTime || "18:00:00"}Z`;
  const played = e.intHomeScore !== null && e.intHomeScore !== "" && e.intHomeScore !== undefined;
  return {
    id: e.idEvent, date: new Date(iso).toISOString(), round: e.intRound || "",
    league: e.strLeague || "", status: e.strStatus || "",
    homeId: e.idHomeTeam, awayId: e.idAwayTeam,
    home: e.strHomeTeam, away: e.strAwayTeam,
    homeScore: played ? String(e.intHomeScore) : "", awayScore: played ? String(e.intAwayScore) : "",
    homeBadge: e.strHomeTeamBadge || "", awayBadge: e.strAwayTeamBadge || "",
  };
};

const out = { updated: new Date().toISOString(), season, teams: {}, tables: {} };
const leagueEvents = {};

for (const [key, id] of Object.entries(TEAMS)) {
  const team = (await api(`lookupteam.php?id=${id}`)).teams?.[0] || {};
  const lid = team.idLeague;
  let events = [];

  // 1) Tutte le giornate del campionato (calendario completo)
  if (lid && !leagueEvents[lid]) {
    const all = [];
    let empty = 0;
    for (let r = 1; r <= 45 && empty < 3; r++) {
      const evs = (await api(`eventsround.php?id=${lid}&r=${r}&s=${season}`)).events || [];
      evs.length ? ((empty = 0), all.push(...evs)) : all.length && empty++;
    }
    leagueEvents[lid] = all;
    console.log(`Lega ${lid} (${team.strLeague}): ${all.length} partite`);
  }
  const isMe = (tid, name) => tid === id || NAMES[key].test(name || "");
  events = (leagueEvents[lid] || []).filter((e) => isMe(e.idHomeTeam, e.strHomeTeam) || isMe(e.idAwayTeam, e.strAwayTeam));

  // 2) Ultime e prossime partite della squadra: aggiunge anche le coppe (es. Coppa Italia LNP)
  const last = (await api(`eventslast.php?id=${id}`)).results || [];
  const next = (await api(`eventsnext.php?id=${id}`)).events || [];
  events = [...events, ...last, ...next];

  const byId = new Map(events.map((e) => [e.idEvent, toMatch(e)]));
  const matches = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  // Statistiche di squadra delle ultime 3 partite giocate (se la fonte le fornisce)
  for (const m of matches.filter((x) => x.homeScore !== "").slice(-3)) {
    const st = (await api(`lookupeventstats.php?id=${m.id}`)).eventstats || [];
    m.stats = st.map((x) => ({ label: x.strStat, home: String(x.intHome ?? ""), away: String(x.intAway ?? "") }))
      .filter((x) => x.label);
  }

  const realId = matches.map((m) => (NAMES[key].test(m.home) ? m.homeId : NAMES[key].test(m.away) ? m.awayId : null)).find(Boolean) || id;
  out.teams[key] = { id: realId, league: team.strLeague || "", badge: team.strBadge || "", matches };
  console.log(`${key}: ${out.teams[key].matches.length} partite`);

  // 3) Classifica
  if (lid && !out.tables[lid]) {
    const t = (await api(`lookuptable.php?l=${lid}&s=${season}`)).table || [];
    out.tables[lid] = t.map((r) => ({ pos: r.intRank, id: r.idTeam, team: r.strTeam, badge: r.strBadge || "",
      played: r.intPlayed, win: r.intWin, loss: r.intLoss, pts: r.intPoints }));
  }
  out.teams[key].leagueId = lid || "";
}

// Se una squadra torna vuota (fonte non raggiungibile) tiene i dati precedenti
const prevData = await readFile("data/basket.json", "utf8").then(JSON.parse).catch(() => ({}));
for (const [key, t] of Object.entries(out.teams))
  if (!t.matches.length && prevData.teams?.[key]?.matches?.length) out.teams[key] = prevData.teams[key];
for (const [lid, rows] of Object.entries(out.tables))
  if (!rows.length && prevData.tables?.[lid]?.length) out.tables[lid] = prevData.tables[lid];

// Scrive solo se qualcosa è cambiato
const strip = ({ updated, ...rest }) => JSON.stringify(rest);
const prev = await readFile("data/basket.json", "utf8").then(JSON.parse).catch(() => ({}));
if (strip(prev) === strip(out)) console.log("Nessuna novità");
else {
  await mkdir("data", { recursive: true });
  await writeFile("data/basket.json", JSON.stringify(out, null, 1));
}
