// Tifo – notifiche live (Cloudflare Worker, gira ogni minuto)
// Calcio (Roma, Boca): inizio, gol, gol annullato, intervallo, finale  -> fonte ESPN
// Basket (Fortitudo, Juvecaserta): palla a due e risultato finale      -> fonte TheSportsDB
// Le notifiche arrivano direttamente nell'app Tifo (Web Push). Serve solo il binding KV "STATE".

const APP_URL = "https://percorsiodm.github.io/Tifo/";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const TSDB = "https://www.thesportsdb.com/api/v1/json/123";

const SOCCER = [
  { key: "roma", name: "Roma", espn: "104", tag: "red_circle" },
  { key: "boca", name: "Boca", espn: "5", tag: "large_blue_circle" },
];
const BASKET = [
  { key: "fortitudo", name: "Fortitudo", id: "137319", re: /fortitudo/i },
  { key: "juvecaserta", name: "Juvecaserta", id: "137311", re: /caserta/i },
];

const HOUR = 3600000;
const getJSON = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": "Tifo-notifiche" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

// ================= NOTIFICHE PUSH NELL'APP (Web Push, nessun servizio esterno) =================
// Le chiavi VAPID vengono create automaticamente al primo uso e salvate nella memoria STATE.
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4)), (c) => c.charCodeAt(0)),
};
const te = new TextEncoder();
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign("HMAC",
  await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data));

async function vapidKeys(env) {
  let k = await env.STATE.get("vapid", "json");
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    k = { jwk: await crypto.subtle.exportKey("jwk", pair.privateKey), pub: b64u.enc(await crypto.subtle.exportKey("raw", pair.publicKey)) };
    await env.STATE.put("vapid", JSON.stringify(k)); // permanente
  }
  return k;
}

async function vapidHeader(env, endpoint) {
  const k = await vapidKeys(env);
  const key = await crypto.subtle.importKey("jwk", k.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u.enc(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:tifo@example.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${k.pub}`;
}

// Cifratura del messaggio (RFC 8291, aes128gcm)
async function encrypt(sub, payload) {
  const uaPub = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hmac(await hmac(auth, shared), concat(te.encode("WebPush: info\0"), uaPub, asPub, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(te.encode(payload), [2])));
  return concat(salt, [0, 0, 16, 0], [asPub.length], asPub, ct); // rs = 4096
}

async function pushTo(env, sub, data) {
  return fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(env, sub.endpoint), "Content-Encoding": "aes128gcm",
               "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" },
    body: await encrypt(sub, JSON.stringify(data)),
  });
}

// Invia la notifica a tutti i telefoni iscritti; rimuove quelli non più validi
async function notify(env, title, message) {
  const subs = (await env.STATE.get("subs", "json")) || [];
  const results = [];
  const keep = [];
  for (const sub of subs) {
    try {
      const r = await pushTo(env, sub, { title, body: message || "", url: APP_URL });
      results.push(`${new URL(sub.endpoint).host}: ${r.status}${r.ok ? " OK" : " " + (await r.text()).slice(0, 120)}`);
      if (r.status !== 404 && r.status !== 410) keep.push(sub);
    } catch (e) { results.push(`errore: ${e.message}`); keep.push(sub); }
  }
  if (keep.length !== subs.length) await env.STATE.put("subs", JSON.stringify(keep));
  return { ok: results.some((x) => x.includes(" OK")), count: subs.length, results };
}

const kvGet = async (env, k) => JSON.parse((await env.STATE.get(k)) || "null");
const kvPut = (env, k, v, ttlDays = 3) => env.STATE.put(k, JSON.stringify(v), { expirationTtl: ttlDays * 86400 });

// ---------------- CALCIO ----------------
// Calendario delle prossime partite, aggiornato una volta all'ora
async function soccerSchedule(env, t, now, force) {
  let sched = await kvGet(env, `sched:${t.key}`);
  if (!sched || force) {
    const d = await getJSON(`${ESPN}/all/teams/${t.espn}/schedule?fixture=true`);
    sched = (d.events || []).slice(0, 6).map((e) => ({ id: e.id, date: e.date, slug: e.league?.slug }));
    await kvPut(env, `sched:${t.key}`, sched, 1);
  }
  return sched;
}

async function checkSoccer(env, t, now, minute) {
  const sched = await soccerSchedule(env, t, now, minute === 0);
  // partite iniziate da meno di 3h30 o che iniziano entro 2 minuti
  const hot = sched.filter((m) => {
    const start = Date.parse(m.date);
    return m.slug && now >= start - 2 * 60000 && now - start < 3.5 * HOUR;
  });
  for (const m of hot) {
    const prev = (await kvGet(env, `m:${m.id}`)) || { state: "pre", h: 0, a: 0, ht: false };
    if (prev.state === "post") continue;

    const start = Date.parse(m.date);
    const sb = await getJSON(`${ESPN}/${m.slug}/scoreboard?dates=${ymd(start - 86400000)}-${ymd(start + 86400000)}`);
    const ev = (sb.events || []).find((e) => e.id === m.id);
    if (!ev) continue;
    const c = ev.competitions[0];
    const st = c.status?.type || {};
    const home = c.competitors.find((x) => x.homeAway === "home");
    const away = c.competitors.find((x) => x.homeAway === "away");
    const H = home.team.shortDisplayName || home.team.displayName, A = away.team.shortDisplayName || away.team.displayName;
    const h = +home.score || 0, a = +away.score || 0;
    const score = `${H} ${h}-${a} ${A}`;
    const league = ev.league?.name || ev.season?.displayName || "";
    const mineHome = home.team.id === t.espn;
    const next = { state: st.state, h, a, ht: prev.ht };

    if (prev.state === "pre" && st.state === "in")
      await notify(env, `🟢 Iniziata: ${H} – ${A}`, league, [t.tag]);

    if (st.state !== "pre") {
      const goals = (c.details || []).filter((d) => d.scoringPlay);
      if (h + a > prev.h + prev.a) {
        // un messaggio per ogni gol nuovo (dal più vecchio)
        for (const g of goals.slice(prev.h + prev.a, h + a)) {
          const forMe = (g.team?.id === home.team.id) === mineHome;
          const who = g.athletesInvolved?.[0]?.displayName || "";
          const extra = g.ownGoal ? " (autogol)" : g.penaltyKick ? " (rigore)" : "";
          const scorerTeam = g.team?.id === home.team.id ? H : A;
          await notify(env, forMe ? `⚽ GOL ${t.name.toUpperCase()}!` : `⚽ Gol ${scorerTeam}`,
            `${score}${who ? ` · ${who}${extra} ${g.clock?.displayValue || ""}` : ""}`, [forMe ? "tada" : "soccer", t.tag]);
        }
        if (goals.length < h + a - (prev.h + prev.a)) // dettagli non ancora disponibili
          await notify(env, "⚽ Gol!", score, ["soccer", t.tag]);
      } else if (h + a < prev.h + prev.a) {
        await notify(env, "❌ Gol annullato", score, ["x", t.tag]);
      }
    }

    if (!prev.ht && /HALFTIME/i.test(st.name || "")) {
      next.ht = true;
      await notify(env, "⏸️ Fine primo tempo", score, [t.tag]);
    }

    if (st.state === "post") {
      const my = mineHome ? h : a, opp = mineHome ? a : h;
      const esito = my > opp ? "Vittoria! 🎉" : my === opp ? "Pareggio" : "Sconfitta";
      await notify(env, `🏁 Finale: ${score}`, `${esito} · ${league}`, [t.tag]);
    }

    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvPut(env, `m:${m.id}`, next);
  }
}

// ---------------- BASKET ----------------
async function checkBasket(env, t, now, minute) {
  let sched = await kvGet(env, `bsched:${t.key}`);
  if (!sched || minute === 0) {
    const d = await getJSON(`${TSDB}/eventsnext.php?id=${t.id}`);
    sched = (d.events || []).slice(0, 4).map((e) => ({
      id: e.idEvent, home: e.strHomeTeam, away: e.strAwayTeam,
      date: e.strTimestamp ? new Date(e.strTimestamp.replace(/(\+00:00)?$/, "Z").replace("ZZ", "Z")).toISOString() : `${e.dateEvent}T18:00:00Z`,
    }));
    await kvPut(env, `bsched:${t.key}`, sched, 1);
  }
  for (const m of sched) {
    const start = Date.parse(m.date);
    if (now < start || now - start > 5 * HOUR) continue;
    const prev = (await kvGet(env, `b:${m.id}`)) || { started: false, done: false };
    if (prev.done) continue;
    const next = { ...prev };

    if (!prev.started) {
      next.started = true;
      await notify(env, `🏀 Palla a due: ${m.home} – ${m.away}`, "Segui la diretta su Tifo", ["basketball"]);
    }
    // risultato finale (la fonte lo pubblica a fine gara)
    if (now - start > 90 * 60000) {
      const e = (await getJSON(`${TSDB}/lookupevent.php?id=${m.id}`)).events?.[0];
      if (e && e.intHomeScore !== null && e.intHomeScore !== "" && e.intHomeScore !== undefined) {
        const h = +e.intHomeScore, a = +e.intAwayScore;
        const mineHome = t.re.test(m.home);
        const my = mineHome ? h : a, opp = mineHome ? a : h;
        next.done = true;
        await notify(env, `🏁 Finale: ${m.home} ${h}-${a} ${m.away}`, my > opp ? "Vittoria! 🎉" : "Sconfitta", ["basketball"]);
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(prev)) await kvPut(env, `b:${m.id}`, next);
  }
}

// ---------------- AVVIO ----------------
async function run(env, when) {
  const now = when, minute = new Date(when).getUTCMinutes();
  for (const t of SOCCER) {
    try { await checkSoccer(env, t, now, minute); } catch (e) { console.log(t.key, e.message); }
  }
  if (minute % 5 === 0) // il basket ogni 5 minuti (la fonte ha limiti di richieste)
    for (const t of BASKET) {
      try { await checkBasket(env, t, now, minute); } catch (e) { console.log(t.key, e.message); }
    }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const reply = (body, type = "text/plain; charset=utf-8") => new Response(typeof body === "string" ? body : JSON.stringify(body),
  { headers: { "Content-Type": type, ...CORS } });

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, event.scheduledTime));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    // L'app chiede la chiave pubblica per iscriversi
    if (url.pathname === "/vapid") return reply({ key: (await vapidKeys(env)).pub }, "application/json");
    // L'app registra (o rimuove) il telefono
    if (url.pathname === "/subscribe" && req.method === "POST") {
      const { sub, remove } = await req.json();
      let subs = ((await env.STATE.get("subs", "json")) || []).filter((s) => s.endpoint !== sub?.endpoint);
      if (!remove && sub?.endpoint && sub?.keys) {
        subs.push(sub);
        await env.STATE.put("subs", JSON.stringify(subs));
        await pushTo(env, sub, { title: "✅ Tifo: notifiche attive", body: "Riceverai gol e risultati delle tue squadre.", url: APP_URL }).catch(() => {});
      } else await env.STATE.put("subs", JSON.stringify(subs));
      return reply({ ok: true, devices: subs.length }, "application/json");
    }
    if (url.pathname === "/test") {
      const r = await notify(env, "✅ Tifo: prova notifica", "Se la vedi, le notifiche funzionano.");
      return reply(`Memoria STATE: ${env.STATE ? "collegata" : "NON collegata"}\nTelefoni iscritti: ${r.count}\n${r.results.join("\n") || "Nessun telefono iscritto: attiva le notifiche dall'app (🔔)."}`);
    }
    return reply("Tifo notifiche: attivo. Apri /test per una notifica di prova.");
  },
};
