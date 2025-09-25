// src/WeekSummary.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";

/* ===== formatting helpers ===== */
const titleCase = (s) => (!s ? "" : s.slice(0, 1).toUpperCase() + s.slice(1));
const dateKey = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};
const fmtMoney = (n) =>
  (Number(n || 0) >= 0 ? "+$" : "-$") + Math.abs(Number(n || 0)).toFixed(2);
const ptsFmt = (n) => (n == null ? "—" : `(${Number(n).toFixed(Math.abs(n) % 1 ? 1 : 0)})`);
const moneyColor = (n) => (n > 0 ? "#067647" : n < 0 ? "#b42318" : "#475569");
const okColor = (ok) => (ok === true ? "#067647" : ok === false ? "#b42318" : "#475569");

/* ===== robust name normalizers ===== */
const _strip = (s = "") =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[\.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const _expand = (s = "") =>
  s
    .replace(/\bst\b/g, "state")
    .replace(/\buniv(?:ersity)?\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\bmen(?:'s)?\b/g, "")
    .replace(/\bfootball\b/g, "")
    .replace(/\bof\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeName = (s = "") => {
  const t = _expand(_strip(s));
  return t
    .split(" ")
    .map((w) => (w.length > 4 && !/ss$/.test(w) ? w.replace(/s$/, "") : w))
    .join(" ")
    .trim();
};
const tokensOf = (s = "") => normalizeName(s).split(" ").filter(Boolean);
const tokenSet = (s = "") => new Set(tokensOf(s));
const jaccard = (a, b) => {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
};
const levenshtein = (a, b) => {
  a = normalizeName(a); b = normalizeName(b);
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
};
const levRatio = (a, b) => {
  const L = Math.max(normalizeName(a).length, normalizeName(b).length) || 1;
  return 1 - levenshtein(a, b) / L;
};
const similar = (a, b) => 0.6 * jaccard(a, b) + 0.4 * levRatio(a, b);

/* ===== component ===== */
export default function WeekSummary() {
  const [weekList, setWeekList] = useState([]);
  const [weekMeta, setWeekMeta] = useState(null);
  const [weekId, setWeekId] = useState(null);

  const [wr, setWR] = useState([]);           // weekly_results rows
  const [dbPicks, setDbPicks] = useState([]); // picks for week
  const [gamesIndex, setGamesIndex] = useState({});

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /* 1) Load week list, choose default week (most recently locked or past end_date), allow ?week= override */
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr("");

// Build week list directly from picks so ids match the data we query
const { data: pWeeks, error: pwErr } = await supabase
  .from("picks")
  .select("week_id")
  .order("week_id", { ascending: true });

if (pwErr) throw pwErr;

// unique week_ids present in picks
const ids = Array.from(new Set((pWeeks || []).map((r) => Number(r.week_id)).filter(Boolean)));

// label them W1, W2, W3 by order so the UI still looks nice
const weeks = ids.map((id, idx) => ({ week_id: id, label: `W${idx + 1}`, is_locked: true }));
setWeekList(weeks);

// allow ?week=<id> override, otherwise default to the latest week_id in picks
const urlWeek = Number(new URLSearchParams(window.location.search).get("week"));
let wid = Number.isFinite(urlWeek) ? urlWeek : (ids.length ? ids[ids.length - 1] : null);

// fall back to first if nothing else
if (!wid && ids.length) wid = ids[0];

const meta = (weeks || []).find((w) => w.week_id === wid) || null;
setWeekMeta(meta);
setWeekId(wid);

        
      } catch (e) {
        console.error(e);
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* 2) When week changes, fetch money table + picks */
  useEffect(() => {
    if (!weekId) return;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        let wid = weekId;

// --- Weekly money results (with fallback if empty) ---
let { data: results, error: weeklyErr } = await supabase
  .from("weekly_results_auto")

  .select("user_id,week_total,college_dollars,pro_dollars,week_id")
  .eq("week_id", wid)
  .order("week_total", { ascending: false });

if (weeklyErr) throw weeklyErr;

// Fallback: if this wid has no rows, jump to the latest week that *does* have results


setWR(results ?? []);


        // Picks for this week (for tokens / Bonus Summary / game matching)
        const { data: px, error: picksErr } = await supabase
          .from("picks")
          .select(
            "user_id,league,team,spread,bonus,pressed,slot,espn_event_id,espn_home,espn_away,espn_commence"
          )
          .eq("week_id", wid);
        if (picksErr) throw picksErr;
        setDbPicks(px ?? []);

      } catch (e) {
        console.error(e);
        setErr(e?.message || String(e));
        setWR([]);
        setDbPicks([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [weekId]);

  /* ===== derive Bonus Summary from picks (no DB view needed) ===== */
  const bonusByType = useMemo(() => {
    const map = { DOG: [], LOY: [], LOQ: [], STEAL: [], PRESS: [] };
    for (const p of dbPicks || []) {
      const name = titleCase(String(p.user_id || "").trim().toLowerCase());

      const b = (p?.bonus || "").toString().toUpperCase();
      if (b.includes("DOG") && !map.DOG.includes(name)) map.DOG.push(name);
      if (b.includes("LOY") && !map.LOY.includes(name)) map.LOY.push(name);
      if (b.includes("LOQ") && !map.LOQ.includes(name)) map.LOQ.push(name);
      if (p?.pressed && !map.PRESS.includes(name)) map.PRESS.push(name);
      if (p?.steal && !map.STEAL.includes(name)) map.STEAL.push(name);
    }
    return map;
  }, [dbPicks]);

  /* ===== ESPN game meta building (kept intact) ===== */
  const matchCacheRef = useRef(new Map()); // key => meta
  const [gamesBuiltFor, setGamesBuiltFor] = useState({ uids: 0, range: "" });

  /* build games index (id, pairs, single team, tokens) */
useEffect(() => {
  const has = (dbPicks || []).length > 0;
  if (!has) return;

  // Derive a window from espn_commence on the picks (fallback: ±5 days around now)
  const times = (dbPicks || [])
    .map((p) => (p.espn_commence ? new Date(p.espn_commence).getTime() : null))
    .filter(Boolean);
  let start = new Date(Date.now() - 5 * 86400000);
  let end   = new Date(Date.now() + 5 * 86400000);
  if (times.length) {
    start = new Date(Math.min(...times));
    end   = new Date(Math.max(...times));
    start.setDate(start.getDate() - 5);
    end.setDate(end.getDate() + 5);
  }

  let stop = false;

  async function build() {
    const idx = {};
    const seenIds = new Set();

    const addMeta = (m) => {
      if (!m?.id) return;

      // merge by id, preserving scores if one source has them and the other doesn't
      if (seenIds.has(m.id) && idx[`eid:${m.id}`]) {
        const prev = idx[`eid:${m.id}`];
        idx[`eid:${m.id}`] = {
          ...prev,
          ...m,
          awayScore: Number.isFinite(m.awayScore) ? m.awayScore : prev.awayScore,
          homeScore: Number.isFinite(m.homeScore) ? m.homeScore : prev.homeScore,
          away: m.away || prev.away,
          home: m.home || prev.home,
          commence: m.commence || prev.commence,
          completed: prev.completed || m.completed,
        };
      } else {
        seenIds.add(m.id);
        idx[`eid:${m.id}`] = m;
      }

      const dk = dateKey(m.commence);
      const awayN = normalizeName(m.away || "");
      const homeN = normalizeName(m.home || "");

      if (awayN && homeN) {
        idx[`k:${awayN}@${homeN}@${dk}`] = idx[`eid:${m.id}`];
        idx[`k:${homeN}@${awayN}@${dk}`] = idx[`eid:${m.id}`];
        idx[`kany:${awayN}@${homeN}`] = idx[`eid:${m.id}`];
        idx[`kany:${homeN}@${awayN}`] = idx[`eid:${m.id}`];
      }
      if (awayN) {
        idx[`team:${awayN}@${dk}`] = idx[`eid:${m.id}`];
        idx[`teamany:${awayN}`] = idx[`eid:${m.id}`];
      }
      if (homeN) {
        idx[`team:${homeN}@${dk}`] = idx[`eid:${m.id}`];
        idx[`teamany:${homeN}`] = idx[`eid:${m.id}`];
      }

      for (const t of new Set([...tokensOf(m.away || ""), ...tokensOf(m.home || "")])) {
        idx[`tok:${t}@${dk}`] = idx[`eid:${m.id}`];
        idx[`tokany:${t}`] = idx[`eid:${m.id}`];
      }
    };

    async function fetchSummaryAnyLeague(id) {
      const sports = ["college-football", "nfl"];
      const bases = ["apis/site/v2", "apis/v2"];
      for (const sport of sports) {
        for (const base of bases) {
          try {
            const url = `https://site.api.espn.com/${base}/sports/football/${sport}/summary?event=${id}`;
            const r = await fetch(url);
            if (!r.ok) continue;
            const j = await r.json();
            const comp = j?.header?.competitions?.[0] || j?.competitions?.[0] || {};
            const cs = comp?.competitors || [];
            const awayC = cs.find((c) => c.homeAway === "away");
            const homeC = cs.find((c) => c.homeAway === "home");
            if (!awayC || !homeC) continue;
            const meta = {
              id: String(id),
              away: awayC?.team?.displayName || awayC?.team?.name || null,
              home: homeC?.team?.displayName || homeC?.team?.name || null,
              awayScore: Number(awayC?.score ?? NaN),
              homeScore: Number(homeC?.score ?? NaN),
              commence:
                comp?.date || j?.gameInfo?.game?.date || j?.header?.competitions?.[0]?.date || null,
              completed: !!(comp?.status?.type?.completed),
            };
            if (Number.isNaN(meta.awayScore)) delete meta.awayScore;
            if (Number.isNaN(meta.homeScore)) delete meta.homeScore;
            addMeta(meta);
            return;
          } catch {}
        }
      }
    }

    // 1) Exact matches by espn_event_id
    const eventIds = Array.from(
      new Set((dbPicks || []).map((p) => p?.espn_event_id).filter(Boolean).map(String))
    );
    await Promise.all(eventIds.map((id) => fetchSummaryAnyLeague(id)));

    // 2) Scoreboard sweep across derived window (start..end)
    const days = [];
    const s = new Date(start), e = new Date(end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${y}${m}${dd}`);
    }
    const mk = (base, sport) =>
      days.map((d) => `https://site.api.espn.com/${base}/sports/football/${sport}/scoreboard?dates=${d}`);
    const urls = [
      ...mk("apis/site/v2", "college-football"),
      ...mk("apis/site/v2", "nfl"),
      ...mk("apis/v2", "college-football"),
      ...mk("apis/v2", "nfl"),
    ];

    const jsons = await Promise.all(
      urls.map((u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null))
    );

    for (const j of jsons) {
      if (!j || !Array.isArray(j.events)) continue;
      for (const ev of j.events) {
        const comp = ev.competitions?.[0];
        if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) continue;
        const awayC = comp.competitors.find((c) => c.homeAway === "away");
        const homeC = comp.competitors.find((c) => c.homeAway === "home");
        const meta = {
          id: String(ev.id),
          away: awayC?.team?.displayName || awayC?.team?.name || null,
          home: homeC?.team?.displayName || homeC?.team?.name || null,
          awayScore: Number(awayC?.score ?? NaN),
          homeScore: Number(homeC?.score ?? NaN),
          commence: ev.date || comp.date || null,
          completed: !!(comp.status?.type?.completed),
        };
        if (Number.isNaN(meta.awayScore)) delete meta.awayScore;
        if (Number.isNaN(meta.homeScore)) delete meta.homeScore;
        addMeta(meta);
      }
    }

    setGamesIndex(idx);
    // also write/refresh scores in Supabase so payouts update automatically
try {
  // de-dup metas by id
  const metas = Array.from(
    new Map(
      Object.values(idx)
        .filter(m => m && m.id)
        .map(m => [String(m.id), m])
    ).values()
  );

  const leagueById = new Map(
    (dbPicks || [])
      .filter(p => p?.espn_event_id)
      .map(p => [String(p.espn_event_id), p.league])
  );

  const rows = metas.map(m => ({
    espn_event_id: String(m.id),                                 // PK
    league: leagueById.get(String(m.id)) || null,                // NCAA / NFL if known
    week_id: weekId,                                             // current week
    away: m.away || null,
    home: m.home || null,
    commence: m.commence ? new Date(m.commence).toISOString() : null,
    away_score: Number.isFinite(m.awayScore) ? m.awayScore : null,
    home_score: Number.isFinite(m.homeScore) ? m.homeScore : null,
    completed: !!m.completed,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length) {
    await supabase.from("game_scores").upsert(rows, { onConflict: "espn_event_id" });
  }
} catch (e) {
  console.error("game_scores upsert error", e);
}

    setGamesBuiltFor({
      uids: (dbPicks || []).length,
      range: `${dateKey(start)}..${dateKey(end)}`,
    });
  }

  build();
  return () => { stop = true; };
}, [dbPicks]);


  /* ===== rows with a single cached match per pick ===== */
  const rows = useMemo(() => {
    matchCacheRef.current.clear();

    const dollars = {};
    for (const r of wr || []) {
      dollars[String(r.user_id).toLowerCase()] = {
        collegeDollar: Number(r.college_dollars || 0),
        proDollar: Number(r.pro_dollars || 0),
        weekTotal: Number(r.week_total || 0),
      };
    }

    const byUser = new Map();
    for (const r of dbPicks || []) {
      const uid = String(r.user_id || "").trim().toLowerCase();

      if (!byUser.has(uid)) byUser.set(uid, { player: titleCase(uid), A: null, B: null, ...dollars[uid] });
      let ab = r.slot ?? (r.pick_slot === 1 ? "A" : r.pick_slot === 2 ? "B" : null);
if (!ab) ab = r.league === "NCAA" ? "A" : (r.league === "NFL" ? "B" : null);
if (!ab) continue;


      const badgeStr = (r.bonus || "").toString().toUpperCase();
      const badges = [];
      if (badgeStr.includes("DOG")) badges.push("DOG");
      if (badgeStr.includes("LOQ")) badges.push("LOQ");
      if (badgeStr.includes("LOY")) badges.push("LOY");
      if (badgeStr.includes("GOOSE")) badges.push("GOOSE");
      if (badgeStr.includes("COOKED GOOSE")) badges.push("COOKED GOOSE");
      if (r.pressed) badges.push("PRESS");

      const pick = {
        team: r.team,
        line: Number.isFinite(r.spread) ? (r.spread > 0 ? `+${r.spread}` : `${r.spread}`) : "",
        spreadNum: Number.isFinite(r.spread) ? Number(r.spread) : 0,
        badges,
        league: r.league,
        espn_event_id: r.espn_event_id || null,
        espn_home: r.espn_home || null,
        espn_away: r.espn_away || null,
        espn_commence: r.espn_commence || null,
        slot: ab,
        userKey: uid,
      };
      if (ab === "A") byUser.get(uid).A = pick;
      if (ab === "B") byUser.get(uid).B = pick;
    }

    const findMetaOnce = (p) => {
      if (!p) return null;
      const cacheKey = JSON.stringify({
        u: p.userKey, s: p.slot, t: normalizeName(p.team || ""),
        e: p.espn_event_id || "", d: p.espn_commence ? dateKey(p.espn_commence) : "",
      });
      const cache = matchCacheRef.current;
      if (cache.has(cacheKey)) return cache.get(cacheKey);

      const inWindow = (m) => {
        if (!m?.commence || !weekMeta?.start_date || !weekMeta?.end_date) return 0;
        const t = new Date(m.commence).getTime();
        return t >= new Date(weekMeta.start_date).getTime() &&
               t <= new Date(weekMeta.end_date).getTime() ? 1 : 0;
      };

      let best = null; let bestScore = -1;
      const consider = (m, scoreBase) => {
        if (!m) return;
        const bonus = inWindow(m);
        const score = (scoreBase ?? 0) + bonus * 0.25;
        if (score > bestScore) { bestScore = score; best = m; }
      };

      if (p.espn_event_id && gamesIndex[`eid:${p.espn_event_id}`]) consider(gamesIndex[`eid:${p.espn_event_id}`], 10);

      if ((p.espn_away || p.espn_home) && p.espn_commence) {
        const dk = dateKey(p.espn_commence);
        const awayN = normalizeName(p.espn_away || "");
        const homeN = normalizeName(p.espn_home || "");
        consider(gamesIndex[`k:${awayN}@${homeN}@${dk}`], 8);
        consider(gamesIndex[`k:${homeN}@${awayN}@${dk}`], 8);
      }

      if (p.espn_away || p.espn_home) {
        const awayN = normalizeName(p.espn_away || "");
        const homeN = normalizeName(p.espn_home || "");
        consider(gamesIndex[`kany:${awayN}@${homeN}`], 6);
        consider(gamesIndex[`kany:${homeN}@${awayN}`], 6);
      }

      if (p.espn_commence) {
        const dk = dateKey(p.espn_commence);
        const tNorm = normalizeName(p.team || "");
        consider(gamesIndex[`team:${tNorm}@${dk}`], 5);
        for (const t of tokensOf(p.team || "")) consider(gamesIndex[`tok:${t}@${dk}`], 5);
      }

      consider(gamesIndex[`teamany:${normalizeName(p.team || "")}`], 3);
      for (const t of tokensOf(p.team || "")) consider(gamesIndex[`tokany:${t}`], 3);

      if (!best) {
        const seen = new Set();
        for (const k in gamesIndex) {
          const m = gamesIndex[k];
          if (!m || seen.has(m.id)) continue;
          seen.add(m.id);
          const s = Math.max(similar(p.team || "", m.home || ""), similar(p.team || "", m.away || ""));
          consider(m, s);
        }
      }

      cache.set(cacheKey, best || null);
      return best || null;
    };

    const resultLine = (p) => {
      const g = findMetaOnce(p);
      const away = g?.away || p?.espn_away || "—";
      const home = g?.home || p?.espn_home || "—";
      const aS = g?.awayScore, hS = g?.homeScore;
      const score = Number.isFinite(aS) && Number.isFinite(hS) ? `${aS}-${hS}` : "—";
      return `${away} @ ${home} — ${score}${g?.completed ? " (FT)" : ""}`;
    };

    const coverPts = (p) => {
      const g = findMetaOnce(p);
      if (!g || !Number.isFinite(g.awayScore) || !Number.isFinite(g.homeScore)) return null;
      const isAway = similar(p?.team || "", g.away || "") >= similar(p?.team || "", g.home || "");
      const my = isAway ? g.awayScore : g.homeScore;
      const opp = isAway ? g.homeScore : g.awayScore;
      const line = Number.isFinite(p?.spreadNum) ? p.spreadNum : 0;
      return my + line - opp;
    };

    const list = Array.from(byUser.values()).map((u) => {
      const cPts = coverPts(u.A);
      const pPts = coverPts(u.B);
      const bonusLabels = [];
      let bonusTotal = 0;
      if (cPts != null && pPts != null) {
        if (cPts > 0 && pPts > 0) { bonusLabels.push("Reverse Quigger"); bonusTotal += 56.26; }
        if (cPts < 0 && pPts < 0) { bonusLabels.push("Quigger");         bonusTotal -= 56.26; }
      }
      return {
        player: u.player,
        collegePick: u.A || null,
        proPick: u.B || null,
        collegeResult: resultLine(u.A),
        proResult: resultLine(u.B),
        collegePts: cPts,
        proPts: pPts,
        collegeDollar: u.collegeDollar ?? 0,
        proDollar: u.proDollar ?? 0,
        bonusesLabels: bonusLabels,
        bonusesTotal: bonusTotal,
        weekTotal: u.weekTotal ?? (u.collegeDollar || 0) + (u.proDollar || 0),
      };
    });

    list.sort((a, b) => {
      const diff = (b.weekTotal ?? 0) - (a.weekTotal ?? 0);
      if (diff !== 0) return diff;
      return String(a.player || "").localeCompare(String(b.player || ""));
    });

    return list;
  }, [wr, dbPicks, gamesIndex, weekMeta?.start_date, weekMeta?.end_date]);

  const onSelectWeek = (e) => {
    const wid = Number(e.target.value);
    const sp = new URLSearchParams(window.location.search);
    sp.set("week", String(wid));
    window.location.search = sp.toString();
  };

  /* ===== styles ===== */
  const S = {
    page: { minHeight: "100vh", background: "#f5f7fb", color: "#0f172a", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" },
    header: { background: "#0b2148", color: "#fff", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    h1: { margin: 0, fontSize: 18, fontWeight: 800 },
    tag: (locked) => ({ marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999, background: locked ? "#ecfeff" : "#eef2ff", color: locked ? "#155e75" : "#3730a3", fontWeight: 800 }),
    dropdown: { fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#1e1b4b", fontWeight: 700 },
    container: { maxWidth: 1200, margin: "16px auto", padding: "0 12px" },
    card: { border: "1px solid #dce6f5", background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" },
    headRow: { display: "flex", background: "#eaf0fe", padding: "10px 12px", fontSize: 13, fontWeight: 800, color: "#0b2148", borderBottom: "1px solid #dce6f5"
 },
    row: { display: "flex", alignItems: "stretch", borderTop: "1px solid #eef2f7" },
    cell: { padding: "12px 8px", display: "flex", alignItems: "center" },
    player: { flex: 2, minWidth: 140, borderRight: "1px solid #e5e7eb" },
    collegePick: { flex: 3, background: "#f8fafc" },
    collegeStat: { width: 90, justifyContent: "center", background: "#f8fafc", borderRight: "1px solid #e5e7eb" },
    proPick: { flex: 3, background: "#f6f7fb" },
    proStat: { width: 90, justifyContent: "center", background: "#f6f7fb", borderRight: "1px solid #e5e7eb" },
    bonus: { flex: 2, borderRight: "1px solid #e5e7eb" },
    total: { width: 140, justifyContent: "center" },
    pickTitle: { fontWeight: 700, fontSize: 13, lineHeight: 1.15, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
    pickSub: { fontSize: 11, color: "#64748b", marginTop: 2 },
    statCol: { display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.05 },
    statPts: (ok) => ({ fontWeight: 800, fontSize: 12, color: okColor(ok) }),
    statMoney: (n) => ({ fontWeight: 900, fontSize: 14, color: moneyColor(n) }),
    badge: (k) => ({
      fontSize: 10, fontWeight: 900, padding: "2px 6px", borderRadius: 999, border: "1px solid", lineHeight: 1,
      color: k === "DOG" ? "#0f766e" : k === "LOQ" ? "#4c1d95" : k === "LOY" ? "#b45309" : k === "GOOSE" ? "#0f766e" : k === "COOKED GOOSE" ? "#b42318" : "#1f2937",
      background: k === "DOG" ? "#ecfeff" : k === "LOQ" ? "#f5f3ff" : k === "LOY" ? "#fff7ed" : k === "GOOSE" ? "#ecfeff" : k === "COOKED GOOSE" ? "#fef2f2" : "#f1f5f9",
      borderColor: k === "DOG" ? "#99f6e4" : k === "LOQ" ? "#ddd6fe" : k === "LOY" ? "#fed7aa" : k === "GOOSE" ? "#99f6e4" : k === "COOKED GOOSE" ? "#fecaca" : "#e5e7eb",
    }),
    bonusWrap: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" },
    bonusLabel: { display: "flex", flexDirection: "column", gap: 4 },
    bonusName: { fontSize: 12, fontWeight: 600, color: "#3730a3" },
    bonusMoney: (n) => ({ fontWeight: 900, fontSize: 14, color: moneyColor(n) }),
    totalMoney: (n) => ({ fontWeight: 900, fontSize: 18, color: moneyColor(n) }),
  };

  const PickCell = ({ pick, result }) => {
    if (!pick) return <span style={{ color: "#94a3b8" }}>—</span>;
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={S.pickTitle}>
          {pick.badges?.map((b, i) => (
            <span key={i} style={S.badge(b)}>{b}</span>
          ))}
          <span>{pick.team} {pick.line || ""}</span>
        </div>
        {result ? <div style={S.pickSub}>{result}</div> : null}
      </div>
    );
  };

  const StatStack = ({ pts, dollars }) => (
    <div style={S.statCol}>
      <span style={S.statPts(pts > 0 ? true : pts < 0 ? false : null)}>{ptsFmt(pts)}</span>
      <span style={S.statMoney(dollars)}>{fmtMoney(dollars)}</span>
    </div>
  );

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;
  if (err) return <div style={{ padding: 16, color: "#b42318" }}>{err}</div>;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.h1}>
          Week Summary
          <span style={S.tag(!!weekMeta?.is_locked)}>
            {weekMeta?.is_locked ? (weekMeta?.label || `W${weekId}`) : "OPEN"}
          </span>
        </h1>
        <select aria-label="Select week" value={weekId || ""} onChange={onSelectWeek} style={S.dropdown}>
          {(weekList || []).map((w) => (
            <option key={w.week_id} value={w.week_id}>
              {w.label || `W${w.week_id}`} {w.is_locked ? "" : " (OPEN)"}
            </option>
          ))}
        </select>
      </div>

      <div style={S.container}>
        <div style={S.card}>
          <div style={S.headRow}>
            <div style={{ ...S.cell, ...S.player, fontWeight: 800 }}>Player</div>
            <div style={{ ...S.cell, ...S.collegePick }}>College Pick</div>
            <div style={{ ...S.cell, ...S.collegeStat, justifyContent: "center" }}>±</div>
            <div style={{ ...S.cell, ...S.proPick }}>Pro Pick</div>
            <div style={{ ...S.cell, ...S.proStat, justifyContent: "center" }}>±</div>
            <div style={{ ...S.cell, ...S.bonus }}>Bonuses</div>
            <div style={{ ...S.cell, ...S.total, justifyContent: "center" }}>Week Total</div>
          </div>

          {rows.map((r, i) => (
            <div key={r.player} style={{ ...S.row, background: i % 2 ? "#ffffff" : "#fbfdff" }}>
              <div style={{ ...S.cell, ...S.player, fontWeight: 700 }}>{r.player}</div>

              <div style={{ ...S.cell, ...S.collegePick }}>
                <PickCell pick={r.collegePick} result={r.collegeResult} />
              </div>
              <div style={{ ...S.cell, ...S.collegeStat, justifyContent: "center" }}>
                <StatStack pts={r.collegePts} dollars={r.collegeDollar} />
              </div>

              <div style={{ ...S.cell, ...S.proPick }}>
                <PickCell pick={r.proPick} result={r.proResult} />
              </div>
              <div style={{ ...S.cell, ...S.proStat, justifyContent: "center" }}>
                <StatStack pts={r.proPts} dollars={r.proDollar} />
              </div>

              <div style={{ ...S.cell, ...S.bonus }}>
                <div style={S.bonusWrap}>
                  <div style={S.bonusLabel}>
                    {r.bonusesLabels.length
                      ? r.bonusesLabels.map((n, idx) => (
                          <div key={idx} style={S.bonusName}>{n}</div>
                        ))
                      : <span style={{ color: "#94a3b8" }}>—</span>}
                  </div>
                  <span style={S.bonusMoney(r.bonusesTotal)}>{fmtMoney(r.bonusesTotal)}</span>
                </div>
              </div>

              <div style={{ ...S.cell, ...S.total, justifyContent: "center" }}>
                <span style={S.totalMoney(r.weekTotal)}>{fmtMoney(r.weekTotal)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Bonus Summary (derived from picks) */}
        <div style={{ marginTop: 16 }}>
          <h3 className="text-lg font-semibold">Bonus Summary</h3>
          {["DOG","LOY","LOQ","STEAL","PRESS"].map((key) => (
            <div key={key} style={{ marginTop: 6 }}>
              <strong>{key}:</strong>{" "}
              {bonusByType[key]?.length ? bonusByType[key].join(", ") : "—"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
