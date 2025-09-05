// src/pages/WeekSummary.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
// Map your DB pick names → ESPN names
const NAME_ALIAS = {
  "Hawaii Rainbow Warriors": "Hawai'i Rainbow Warriors",
  "Fresno St": "Fresno State Bulldogs",
  "Stanford": "Stanford Cardinal",
};

/** ====== SCORING CONFIG ====== **/
const MONEY = {
  win: 10,
  loss: -10,
  push: 0,
  bonuses: { quigger: 5, reverseQuigger: 5, sweep: 5, reverseSweep: 5, dog: 5 },
};
function normName(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[’'‘`]/g, "")   // remove apostrophes
    .replace(/[\.\-]/g, " ")  // dots and dashes to spaces
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(iso) {
  // turn ISO into YYYY-MM-DD (day resolution)
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

/** ====== ENV for live scores ====== **/
const API_BASE = process.env.REACT_APP_ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const API_KEY = process.env.REACT_APP_ODDS_API_KEY; // required for live scores

/** ====== HELPERS ====== **/
const titleCase = (s) => (!s ? "" : s.slice(0, 1).toUpperCase() + s.slice(1));
const DISPLAY_NAME = { joey: "Joey", chris: "Chris", dan: "Dan", nick: "Nick", kevin: "Kevin", aaron: "Aaron" };
// Bonus amounts (total per person)
const BONUS_AMT = Object.freeze({
  SWEEP: 46.88,
  REVERSE_SWEEP: -46.88,
  QUIGGER: -46.88,
  REVERSE_QUIGGER: 46.88,
  DOG: 93.75,          // underdog +7 or more wins outright
  GOOSE: 93.75,        // your team shuts out opponent
  COOKED_GOOSE: -140.62 // favorite (>= -2.0) gets shut out
});

// Use your existing parseLine if you have it.
// If you DO NOT have one, uncomment this minimal fallback:
// function parseLine(x){ const n = Number(String(x||0).replace(/\s/g,'')); return Number.isFinite(n)?n:0; }
function buildWeekSnapshot(rows, { weekId, quarter, label }) {
  return {
    week_id: weekId,
    quarter,
    label,
    rows: rows.map((r) => ({
      player: r.player,
      college_pts: r.college?.res?.pts ?? null,
      college_dollars: Number(r.collegeDollar || 0).toFixed(2),
      pro_pts: r.pro?.res?.pts ?? null,
      pro_dollars: Number(r.proDollar || 0).toFixed(2),
      bonus_labels: r.bonuses || [],
      bonus_total: Number(r.bonusesTotal || 0).toFixed(2),
      week_total: Number(r.weekTotal || 0).toFixed(2),
    })),
    sum: Number(
      rows.reduce((a, r) => a + Number(r.weekTotal || 0), 0).toFixed(2)
    ),
  };
}

function gameFacts(meta, teamName, lineText) {
  if (!meta) return null;

  const homeTeam  = meta.home ?? meta.espn_home ?? meta.homeTeam;
  const awayTeam  = meta.away ?? meta.espn_away ?? meta.awayTeam;
  const homeScore = meta.homeScore ?? meta.home_score ?? null;
  const awayScore = meta.awayScore ?? meta.away_score ?? null;

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;

  // tolerate normName not existing
  const nn = (v) => (typeof normName === "function" ? normName(v) : String(v || "").toLowerCase());
  const isHome = nn(homeTeam) === nn(teamName);

  const my  = isHome ? homeScore : awayScore;
  const opp = isHome ? awayScore : homeScore;

  const line = Number.isFinite(lineText) ? Number(lineText)
             : (typeof parseLine === "function" ? parseLine(lineText) : Number(lineText) || 0);

  const covered = (my - opp) + line > 0;
  const won     = my > opp;
  const shutFor = opp === 0;
  const shutAgainst = my === 0;

  return {
    covered, won, shutFor, shutAgainst,
    line,
    isFav: line < 0,
    isDog: line > 0
  };
}

function dogBonusHit(pick, facts) {
  // must be tagged dog, be +7 or more, and win outright
  return Boolean(pick?.dog) && Boolean(facts?.isDog) && Number(facts?.line) >= 7 && Boolean(facts?.won);
}

const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const parseLine = (s) => (s === null || s === undefined ? 0 : Number(String(s).replace(/\s/g, "")));

function scoreline(g) {
  if (!g) return "—";
  const matchup = `${g.away} @ ${g.home}`;

  const haveScores =
    Number.isFinite(g.awayScore) && Number.isFinite(g.homeScore);

  if (haveScores) {
    const tail = g.completed ? " (FT)" : "";
    return `${matchup}: ${g.awayScore}–${g.homeScore}${tail}`;
  }

  // Not started yet — show kickoff time
  let when = "TBD";
  try {
    if (g.commence) {
      const d = new Date(g.commence);
      when = d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  } catch { /* noop */ }

  return `${matchup} — ${when}`;
}
function findByTeamOnDate(idx, team, iso) {
  if (!team || !iso) return null;
  const targetDay = dateKey(iso); // YYYY-MM-DD
  for (const meta of Object.values(idx)) {
    if (!meta || !meta.commence) continue;
    if (dateKey(meta.commence) !== targetDay) continue;
    const h = normName(meta.home);
    const a = normName(meta.away);
    const t = normName(team);
    if (h === t || a === t) return meta;
  }
  return null;
}
function balanceDollars(askips) {
  const total = askips.reduce((a, b) => a + b, 0);
  return askips.map(a => (6 * a - total) * RATE);
}

function coverageForPick(g, pick) {
  if (!g || !pick || !pick.team) return { dollars: 0, pts: 0, ok: null };
  if (!Number.isFinite(g.awayScore) || !Number.isFinite(g.homeScore)) {
    return { dollars: 0, pts: 0, ok: null }; // game not started / incomplete
  }
  const line = parseLine(pick.line || "0");
  const isAway = pick.team === g.away;
  const picked = isAway ? g.awayScore : g.homeScore;
  const opp = isAway ? g.homeScore : g.awayScore;
  const diff = picked + line - opp; // >0 covered, <0 missed
  if (diff > 0) return { dollars: MONEY.win, pts: diff, ok: true };
  if (diff < 0) return { dollars: MONEY.loss, pts: diff, ok: false };
  return { dollars: MONEY.push, pts: 0, ok: null };
}

const dollarsFmt = (n) => (n > 0 ? `+$${n}` : n < 0 ? `-$${Math.abs(n)}` : "$0");
const ptsFmt = (n) => `(${Number.isInteger(n) ? n : n.toFixed(1)})`;
const colorFor = (ok) => (ok === true ? "#067647" : ok === false ? "#b42318" : "#475569");

function bonusNames(bonuses) {
  return Object.entries(bonuses || {})
    .filter(([_, v]) => v)
    .map(([k]) => {
      switch (k) {
        case "quigger": return "Quigger";
        case "reverseQuigger": return "Reverse Quigger";
        case "sweep": return "Sweep";
        case "reverseSweep": return "Reverse Sweep";
        case "dog": return "Dog";
        default: return k;
      }
    });
}
function bonusTotal(bonuses) {
  return Object.entries(bonuses || {}).reduce(
    (sum, [k, v]) => (v ? sum + (MONEY.bonuses[k] || 0) : sum),
    0
  );
}
function pickTagPills(pick) {
  const order = ["loy", "loq", "press", "dog"];
  return order.filter((t) => pick?.[t]).map((t) => (t === "loy" ? "LOY" : t === "loq" ? "LOQ" : t === "press" ? "Press" : "Dog"));
}
// --- Askip calculation helper ---
const RATE = 0.3125;

// --- Askip calculation helper ---
function calcAskip({ teamName, spread, meta, pick }) {
  if (!meta) return 0;

  // normalize team & score fields
  const homeTeam  = meta.home ?? meta.espn_home ?? meta.homeTeam;
  const awayTeam  = meta.away ?? meta.espn_away ?? meta.awayTeam;
  const homeScore = meta.homeScore ?? meta.home_score ?? null;
  const awayScore = meta.awayScore ?? meta.away_score ?? null;

  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return 0;

  // determine which side this pick is on
  const isHome = normName(homeTeam) === normName(teamName);
  const my  = isHome ? homeScore : awayScore;
  const opp = isHome ? awayScore : homeScore;

  // use numeric spread if present, otherwise parse pick.line
  const line = Number.isFinite(spread) ? Number(spread) : parseLine(pick?.line);

  const cover = (my - opp) + line;    // >0 covered, <0 missed
  const mult  = pickMultiplier(pick); // LOY x4, LOQ x2, Press x2

  // Excel: add +7 when the bet covers
  return cover > 0 ? (cover * mult + 7) : (cover * mult);
}
// --- Askip calculation helper ---
function pickMultiplier(pick) {
  let m = 1;
  if (pick?.loy)   m *= 4;  // LOY
  if (pick?.loq)   m *= 2;  // LOQ
  if (pick?.press) m *= 2;  // Press
  return m;
}









/** ====== PAGE ====== **/
export default function WeekSummary() {
  const [week, setWeek] = useState(null);
  const [dbPicks, setDbPicks] = useState([]);
  const [gamesIndex, setGamesIndex] = useState({}); // name -> game meta
  const [scoresError, setScoresError] = useState(null);

  // Load latest week + its picks
  useEffect(() => {
    (async () => {
      const { data: w } = await supabase
        .from("weeks")
        .select("id, status, start_date, end_date")

        .order("id", { ascending: false })
        .limit(1)
        .single();

      if (!w) return;
      setWeek(w);

      const { data: rows } = await supabase
  .from("picks")
  .select(`
    user_id, league, team, spread, odds, bonus, pressed, slot,
    espn_event_id, espn_home, espn_away, espn_commence
  `)
  .eq("week_id", w.id);

  


      setDbPicks(rows || []);
    })();
  }, []);

// Live scores poll (NCAA + NFL) every 60s — uses SCORES endpoint
// Live scores poll (NCAA + NFL) every 60s — filter by THIS WEEK
// Live scores poll — ESPN fallback for completed/past games (NCAA + NFL)
// Live scores poll via ESPN (Week 1 dates) — includes alias matching
useEffect(() => {
  if (!week?.start_date || !week?.end_date) return;

  // Dates to fetch (YYYYMMDD). Add/remove as needed for a given week.
  const ESPN_DATES = ["20250823", "20250828", "20250829", "20250830", "20250831"];

  let stop = false;

  async function fetchEspnScores() {
    try {
      const mkUrls = (sport) =>
        ESPN_DATES.map(
          (d) =>
            `https://site.api.espn.com/apis/site/v2/sports/football/${sport}/scoreboard?dates=${d}`
        );

      const urls = [
        ...mkUrls("college-football"), // NCAAF
        ...mkUrls("nfl"),              // NFL
      ];

      const jsons = await Promise.all(
        urls.map((u) =>
          fetch(u)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .catch(() => null)
        )
      );

      // ── TEAM ALIASES (your DB team names → ESPN names) ────────────────
      const TEAM_ALIASES = {
        "Hawaii Rainbow Warriors": "Hawai'i Rainbow Warriors",
        "Fresno St": "Fresno State Bulldogs",
        "Stanford": "Stanford Cardinal",
      };

      const idx = {};
      let countEvents = 0;

      for (const j of jsons) {
        if (!j || !Array.isArray(j.events)) continue;

        for (const ev of j.events) {
          const comp = ev.competitions?.[0];
          if (!comp || !Array.isArray(comp.competitors) || comp.competitors.length < 2) continue;

          const a = comp.competitors.find((c) => c.homeAway === "away");
          const h = comp.competitors.find((c) => c.homeAway === "home");
          if (!a || !h) continue;

          // Names
          const awayRaw =
            a.team?.displayName || a.team?.shortDisplayName || a.team?.name;
          const homeRaw =
            h.team?.displayName || h.team?.shortDisplayName || h.team?.name;
          if (!awayRaw || !homeRaw) continue;

          // Normalize through aliases
          const away = TEAM_ALIASES[awayRaw] || awayRaw;
          const home = TEAM_ALIASES[homeRaw] || homeRaw;

          // Scores/meta
          const awayScore = Number(a.score ?? NaN);
          const homeScore = Number(h.score ?? NaN);
          const commence = ev.date || comp.date;
          const completed = !!comp.status?.type?.completed;
          const league = (ev.leagues?.[0]?.abbreviation || "").toUpperCase() || "NCAA";

          const meta = {
            id: ev.id,
            league,
            away,
            home,
            awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
            homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
            commence,
            completed,
          };

// 1) event id (odds-api id)
idx[`eid:${meta.id}`] = meta;

// 2) cross-provider team+date keys (away@home@YYYY-MM-DD)
const k1 = `k:${normName(away)}@${normName(home)}@${dateKey(meta.commence)}`;
const k2 = `k:${normName(home)}@${normName(away)}@${dateKey(meta.commence)}`;
idx[k1] = meta;
idx[k2] = meta;

// 3) legacy name fallbacks
idx[away] = meta;
idx[home] = meta;


countEvents++;

        }
      }

      if (!stop) {
        setGamesIndex(idx);
        console.log("gamesIndex keys:", Object.keys(idx));

        setScoresError(null);
        console.log("ESPN events indexed:", countEvents, "teams:", Object.keys(idx).length);
      }
    } catch (e) {
      if (!stop) setScoresError(String(e?.message || e));
    }
  }

  fetchEspnScores();
  const t = setInterval(fetchEspnScores, 60_000);
  return () => {
    stop = true;
    clearInterval(t);
  };
}, [week]);




  /** Build per-user picks STRICTLY by slot:
   *  - Slot A -> left column ("College Pick")
   *  - Slot B -> right column ("Pro Pick")
   *    (In Week 1, B will still be NCAA, which is fine.)
   */
  const picks = useMemo(() => {
    const byUser = new Map();

    for (const r of dbPicks ?? []) {
      const uid = String(r.user_id).toLowerCase();
      if (!byUser.has(uid)) {
        byUser.set(uid, {
          player: DISPLAY_NAME[uid] || titleCase(uid),
          A: null,
          B: null,
        });
      }

      // prefer text slot; fallback to numeric pick_slot
      const ab = r.slot ?? (r.pick_slot === 1 ? "A" : r.pick_slot === 2 ? "B" : null);
      if (!ab) continue;

      const upperBonus = String(r.bonus || "").toUpperCase();
      const pickObj = {
  team: r.team,
  line: r.spread ? (r.spread > 0 ? `+${r.spread}` : `${r.spread}`) : "",
  loy: (r.bonus || "").includes("LOY"),
  loq: (r.bonus || "").includes("LOQ"),
  dog: (r.bonus || "").includes("DOG"),
  press: !!r.pressed,
  league: r.league,

  // 🔑 carry through the ESPN fields from Supabase
  espn_event_id: r.espn_event_id || null,
  espn_home: r.espn_home || null,
  espn_away: r.espn_away || null,
  espn_commence: r.espn_commence || null,
};


      if (ab === "A") byUser.get(uid).A = pickObj;
      if (ab === "B") byUser.get(uid).B = pickObj;
    }

    return Array.from(byUser.values()).sort((a, b) => a.player.localeCompare(b.player));
  }, [dbPicks]);

  // Compute rows with live score lookup per team, plus bonuses
  const rows = useMemo(() => {
    return picks
      .map((p) => {
        const aTeam = p.A?.team ? (NAME_ALIAS[p.A.team] || p.A.team) : null;
const bTeam = p.B?.team ? (NAME_ALIAS[p.B.team] || p.B.team) : null;
// prefer event id; fall back to name (with alias)
const aKey = p.A
  ? (p.A.espn_event_id
      ? `eid:${p.A.espn_event_id}`
      : (NAME_ALIAS[p.A.team] || p.A.team))
  : null;
const bKey = p.B
  ? (p.B.espn_event_id
      ? `eid:${p.B.espn_event_id}`
      : (NAME_ALIAS[p.B.team] || p.B.team))
  : null;

// --- College pick meta ---
// --- College pick meta ---
const aIdKey   = p.A?.espn_event_id ? `eid:${p.A.espn_event_id}` : null;
const aTeamsKey= (p.A?.espn_away && p.A?.espn_home && p.A?.espn_commence)
  ? `k:${normName(p.A.espn_away)}@${normName(p.A.espn_home)}@${dateKey(p.A.espn_commence)}`
  : null;

const aMeta =
  (aIdKey && gamesIndex[aIdKey]) ||
  (aTeamsKey && gamesIndex[aTeamsKey]) ||
  findByTeamOnDate(gamesIndex, NAME_ALIAS[p.A?.team] || p.A?.team, p.A?.espn_commence || week?.start_date) ||
  (p.A ? gamesIndex[p.A.team] : null);

// --- Pro pick meta ---
const bIdKey   = p.B?.espn_event_id ? `eid:${p.B.espn_event_id}` : null;
const bTeamsKey= (p.B?.espn_away && p.B?.espn_home && p.B?.espn_commence)
  ? `k:${normName(p.B.espn_away)}@${normName(p.B.espn_home)}@${dateKey(p.B.espn_commence)}`
  : null;

const bMeta =
  (bIdKey && gamesIndex[bIdKey]) ||
  (bTeamsKey && gamesIndex[bTeamsKey]) ||
  findByTeamOnDate(gamesIndex, NAME_ALIAS[p.B?.team] || p.B?.team, p.B?.espn_commence || week?.start_date) ||
  (p.B ? gamesIndex[p.B.team] : null);
// --- Askip calculations ---
const aAskip = p.A ? calcAskip({
  teamName: NAME_ALIAS[p.A.team] || p.A.team,
  spread: p.A.num_line,
  meta: aMeta,
  pick: p.A
}) : 0;

const bAskip = p.B ? calcAskip({
  teamName: NAME_ALIAS[p.B.team] || p.B.team,
  spread: p.B.num_line,
  meta: bMeta,
  pick: p.B
}) : 0;
// Per-pick game facts (used for bonuses)
const aFacts = p.A
  ? gameFacts(aMeta, NAME_ALIAS[p.A.team] || p.A.team, p.A.line ?? p.A.num_line)
  : null;

const bFacts = p.B
  ? gameFacts(bMeta, NAME_ALIAS[p.B.team] || p.B.team, p.B.line ?? p.B.num_line)
  : null;

console.log("Askip Debug", {
  user: p.user_id,
  teamA: p.A?.team,
  teamB: p.B?.team,
  aMeta,
  bMeta,
  aAskip,
  bAskip
});






        const aRes = coverageForPick(aMeta, p.A);
        const bRes = coverageForPick(bMeta, p.B);

        const bonuses = {
          dog:   (p.A?.dog && aRes.ok === true) || (p.B?.dog && bRes.ok === true),
          sweep: aRes.ok === true && bRes.ok === true,
          reverseSweep: aRes.ok === false && bRes.ok === false,
          // keep quigger/reverseQuigger wiring here if/when you add the logic
        };

        const total$ = aRes.dollars + bRes.dollars + bonusTotal(bonuses);

        return {
  player: p.player,
  college: { meta: aMeta, pick: p.A, res: aRes },
  pro:     { meta: bMeta, pick: p.B, res: bRes },
  total$,
  aAskip,
  bAskip,

  // initialize/keep bonuses on the row
  bonuses: [],        // ← keep just this (remove the earlier `bonuses,`)
  bonusesTotal: 0,

  // facts used later for bonus logic
  _facts: {
    a: aFacts,
    b: bFacts,

    // Dog bonus: must be tagged dog, be +7 or more, and win outright
    aDogWin: !!(aFacts && dogBonusHit(p.A, aFacts)),
    bDogWin: !!(bFacts && dogBonusHit(p.B, bFacts)),

    // Goose / Cooked Goose
    aGoose:  !!(aFacts?.shutFor),
    bGoose:  !!(bFacts?.shutFor),
    aCooked: !!(aFacts && aFacts.shutAgainst && aFacts.isFav && Math.abs(aFacts.line) >= 2),
    bCooked: !!(bFacts && bFacts.shutAgainst && bFacts.isFav && Math.abs(bFacts.line) >= 2),
  },
};


      })
      .sort((a, b) => b.total$ - a.total$);
  }, [picks, gamesIndex]);
// --- Balance dollars by cohort ---
function applyDollarBalancing(rows) {
  const RATE = 0.3125;

  function balanceDollars(askips) {
    const total = askips.reduce((a, b) => a + b, 0);
    return askips.map(a => (6 * a - total) * RATE);
  }

  // collect askips
  const collegeAskip = rows.map(r => r.aAskip || 0);
  const proAskip = rows.map(r => r.bAskip || 0);

  // compute balanced dollars
  const collegeDollars = balanceDollars(collegeAskip);
  const proDollars = balanceDollars(proAskip);

  // return rows with new fields
  return rows.map((r, i) => ({
    ...r,
    collegeDollar: collegeDollars[i],
    proDollar: proDollars[i],
  }));
}



const balancedRows = applyDollarBalancing(rows);
// --- Aggregate bonuses and roll them into each row ---
function applyBonuses(rows) {
  // 1) Per-pick bonuses (Dog, Goose, Cooked Goose)
  const perPick = rows.map(r => {
    const labels = [];
    let total = r.bonusesTotal || 0;

    if (r._facts?.aDogWin) { labels.push("Dog"); total += BONUS_AMT.DOG; }
    if (r._facts?.bDogWin) { labels.push("Dog"); total += BONUS_AMT.DOG; }

    if (r._facts?.aGoose)  { labels.push("Goose"); total += BONUS_AMT.GOOSE; }
    if (r._facts?.bGoose)  { labels.push("Goose"); total += BONUS_AMT.GOOSE; }

    if (r._facts?.aCooked) { labels.push("Cooked Goose"); total += BONUS_AMT.COOKED_GOOSE; }
    if (r._facts?.bCooked) { labels.push("Cooked Goose"); total += BONUS_AMT.COOKED_GOOSE; }

    return { ...r, bonuses: [...(r.bonuses || []), ...labels], bonusesTotal: total };
  });

  // 2) Slot-level sweeps (college / pro)
  const aCovers = perPick.map(r => r._facts?.a?.covered === true);
  const bCovers = perPick.map(r => r._facts?.b?.covered === true);

  function applySweep(rows, covers) {
    const winners = covers.filter(Boolean).length;
    const losers  = covers.filter(v => v === false).length;

    return rows.map((r, i) => {
      let labels = r.bonuses ? [...r.bonuses] : [];
      let total  = r.bonusesTotal || 0;

      if (winners === 1 && covers[i] === true)  { labels.push("Sweep");         total += BONUS_AMT.SWEEP; }
      if (losers  === 1 && covers[i] === false) { labels.push("Reverse Sweep"); total += BONUS_AMT.REVERSE_SWEEP; }

      return { ...r, bonuses: labels, bonusesTotal: total };
    });
  }

  const afterA = applySweep(perPick, aCovers);
  const afterB = applySweep(afterA, bCovers);

// 3) League-wide (Quigger / Reverse Quigger) — with distribution + labels
const bothWon  = afterB.map(r => (r._facts?.a?.covered === true)  && (r._facts?.b?.covered === true));
const bothLost = afterB.map(r => (r._facts?.a?.covered === false) && (r._facts?.b?.covered === false));

const bothWonCnt  = bothWon.filter(Boolean).length;
const bothLostCnt = bothLost.filter(Boolean).length;

const n = afterB.length;
const quiggerIdx  = bothLostCnt  === 1 ? bothLost.indexOf(true) : -1;  // the one who lost both
const rQuiggerIdx = bothWonCnt   === 1 ? bothWon.indexOf(true)  : -1;  // the one who won both

const final = afterB.map((r, i) => {
  let labels = r.bonuses ? [...r.bonuses] : [];
  let total  = r.bonusesTotal || 0;

  // Quigger: trigger pays 46.88; everyone else receives 46.88/(n-1)
  if (quiggerIdx !== -1) {
    if (i === quiggerIdx) {
      if (!labels.includes("Quigger")) labels.push("Quigger");
      total += BONUS_AMT.QUIGGER; // -46.88
    } else {
      total += Math.abs(BONUS_AMT.QUIGGER) / (n - 1); // e.g. +9.38 with 6 players
    }
  }

  // Reverse Quigger: trigger receives 46.88; everyone else pays 46.88/(n-1)
  if (rQuiggerIdx !== -1) {
    if (i === rQuiggerIdx) {
      if (!labels.includes("Reverse Quigger")) labels.push("Reverse Quigger");
      total += BONUS_AMT.REVERSE_QUIGGER; // +46.88
    } else {
      total -= BONUS_AMT.REVERSE_QUIGGER / (n - 1);   // e.g. -9.38 with 6 players
    }
  }

  return { ...r, bonuses: labels, bonusesTotal: total };
});

return final;



}

const finalRows = applyBonuses(balancedRows);
function rowTotal(r) {
  return Number(r.collegeDollar || 0) +
         Number(r.proDollar || 0) +
         Number(r.bonusesTotal || 0);
}

// attach a computed total and sort by it (desc)
const finalRowsSorted = applyBonuses(balancedRows)
  .map(r => ({ ...r, weekTotal: rowTotal(r) }))
  .sort((a, b) => b.weekTotal - a.weekTotal);

  return (
    <div style={page}>
      <div style={pageHeader}>
        <h1 style={title}>SAC Pick’Em</h1>
      </div>
<div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
  <button
    onClick={async () => {
      try {
        const weekId  = week?.id ?? 0;
const quarter = week?.quarter ?? "Q1";
const label   = week?.label ?? "W1";


        const snapshot = buildWeekSnapshot(finalRowsSorted, { weekId, quarter, label });

        if (Math.abs(Number(snapshot.sum)) > 0.02) {
          alert(`Totals are not balanced (sum = ${snapshot.sum}). Fix before saving.`);
          return;
        }

        const { data, error } = await supabase
          .from("week_snapshots")
          .upsert(
            {
              week_id: weekId,
              quarter,
              label,
              payload: snapshot.rows,
              sum_check: snapshot.sum,
              status: "PENDING"
            },
            { onConflict: "week_id" }
          )
          .select()
          .single();

        if (error) throw error;
        alert("Snapshot saved for scheduler ✅");
        console.log("week_snapshots upsert:", data);
      } catch (err) {
        console.error(err);
        alert(`Save failed: ${err.message || err}`);
      }
    }}
    style={{ padding: "6px 10px", fontWeight: 600 }}
  >
    <button
  onClick={async () => {
    try {
      const weekId = week?.id ?? 0;

      // 1) Load the saved snapshot for this week
      const { data: snap, error: readErr } = await supabase
        .from("week_snapshots")
        .select("*")
        .eq("week_id", weekId)
        .single();

      if (readErr) throw readErr;
      if (!snap) {
        alert("No snapshot found for this week. Save one first.");
        return;
      }
      if (snap.status === "COMMITTED") {
        alert("This snapshot is already committed.");
        return;
      }

      // Optional sanity
      if (Math.abs(Number(snap.sum_check || 0)) > 0.02) {
        alert(`Snapshot not balanced (sum = ${snap.sum_check}). Fix before committing.`);
        return;
      }

      // 2) Commit it to weekly_results + quarter_standings
      const { data, error } = await supabase.rpc("finalize_week", {
        p_week_id: snap.week_id,
        p_quarter: snap.quarter,
        p_rows: snap.payload,          // the rows array we stored
        p_require_balanced: true
      });
      if (error) throw error;

      // 3) Mark snapshot committed
      const { error: updErr } = await supabase
        .from("week_snapshots")
        .update({ status: "COMMITTED", committed_at: new Date().toISOString() })
        .eq("week_id", snap.week_id);
      if (updErr) throw updErr;

      alert("Committed to standings ✅");
      console.log("finalize_week result:", data);
    } catch (err) {
      console.error(err);
      alert(`Commit failed: ${err.message || err}`);
    }
  }}
  style={{ padding: "6px 10px", fontWeight: 600 }}
>
  Commit Saved Snapshot
</button>

    Save Snapshot (for scheduler)
  </button>
</div>

      <div style={container}>
        <h2 style={sectionTitle}>
  Week {week?.number || "—"} Summary {week?.status ? `(${week.status})` : ""}
</h2>

        {scoresError && (
          <div style={{ margin: "6px 0 10px", color: "#b42318", fontSize: 12 }}>
            Live scores error: {scoresError}
          </div>
        )}

        <div style={card}>
          {/* Header */}
          <div style={tableHead}>
            <div style={{ ...th, flex: 2 }}>Player</div>

            {/* College (slot A) */}
            <div style={{ ...th, flex: 3, textAlign: "left" }}>College Pick</div>
            <div style={{ ...th, width: WIDTH_PTS, textAlign: "center" }}>Pts ±</div>
            <div style={{ ...th, width: WIDTH_MNY, textAlign: "center" }}>$ ±</div>

            {/* Pro / Week 1 second college shows here (slot B) */}
            <div style={{ ...th, flex: 3, textAlign: "left" }}>Pro Pick</div>
            <div style={{ ...th, width: WIDTH_PTS, textAlign: "center" }}>Pts ±</div>
            <div style={{ ...th, width: WIDTH_MNY, textAlign: "center" }}>$ ±</div>

            {/* Bonuses & Total */}
            <div style={{ ...th, flex: 2 }}>Bonuses</div>
            <div style={{ ...th, width: 160, textAlign: "center" }}>Week Total</div>
          </div>

          {/* Rows */}
          {finalRowsSorted.map((r, i) => (


  <div
    key={r.player}
    style={{
      ...tr,
      background: i % 2 ? "#ffffff" : "#fabff"
    }}
  >
    {/* Player name */}
    <div style={{ ...td, flex: 2, fontWeight: 700 }}>{r.player}</div>

   {/* College (A) */}
<div style={{ ...td, flex: 3 }}>
  <PickCell meta={r.college.meta} pick={r.college.pick} res={r.college.res} />
</div>
<div style={{ ...td, width: WIDTH_PTS, justifyContent: "center" }}>
<span style={{ ...ptsStyle(r.college.res.ok), fontSize: 14 }}>
  {ptsFmt(r.college.res.pts)}
</span>

</div>
<div style={{ ...td, width: WIDTH_MNY, justifyContent: "center" }}>
  <span style={{ ...moneyStyle(r.collegeDollar), fontSize: 14 }}>
  {(Number(r.collegeDollar || 0) >= 0 ? "+$" : "-$") +
    Math.abs(Number(r.collegeDollar || 0)).toFixed(2)}
</span>



</div>

{/* Pro (B) */}
<div style={{ ...td, flex: 3 }}>
  <PickCell meta={r.pro.meta} pick={r.pro.pick} res={r.pro.res} />
</div>
<div style={{ ...td, width: WIDTH_PTS, justifyContent: "center" }}>
  <span style={{ ...ptsStyle(r.pro.res.ok), fontSize: 14 }}>
  {ptsFmt(r.pro.res.pts)}
</span>

</div>
<div style={{ ...td, width: WIDTH_MNY, justifyContent: "center" }}>
  <span style={{ ...moneyStyle(r.proDollar), fontSize: 14 }}>
  {(Number(r.proDollar || 0) >= 0 ? "+$" : "-$") +
    Math.abs(Number(r.proDollar || 0)).toFixed(2)}
</span>



</div>

{/* Bonuses */}
<div style={{ ...td, flex: 2 }}>
  <BonusesCell bonuses={r.bonuses} />
</div>

{/* Week total */}
<div style={{ ...td, width: 160, justifyContent: "center" }}>
<div style={{ ...td, width: WIDTH_MNY, justifyContent: "center" }}>
  <span style={moneyStyle(r.weekTotal)}>
    {(Number(r.weekTotal || 0) >= 0 ? "+$" : "-$") +
      Math.abs(Number(r.weekTotal || 0)).toFixed(2)}
  </span>
</div>



</div>

  </div>
))}

        </div>
      </div>
    </div>
  );
}

/** ====== styles / cells ====== **/
const WIDTH_PTS = 76;
const WIDTH_MNY = 84;
const numBase = { fontWeight: 900, fontSize: 18, textAlign: "center" };
const ptsStyle = (ok) => ({ ...numBase, width: WIDTH_PTS, color: colorFor(ok) });
const moneyStyle = (n) => ({ ...numBase, width: WIDTH_MNY, color: n > 0 ? "#067647" : n < 0 ? "#b42318" : "#475569" });

const page = { minHeight: "100vh", background: "#f5f7fb", color: "#0f172a", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" };
const pageHeader = { background: "#0b2148", color: "#fff", padding: "10px 12px" };
const title = { margin: 0, fontSize: 16, fontWeight: 700 };
const container = { maxWidth: 1200, margin: "16px auto", padding: "0 12px" };
const sectionTitle = { margin: "6px 0 12px", fontSize: 24, fontWeight: 800 };
const card = { border: "1px solid #dce6f5", background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" };
const tableHead = { display: "flex", background: "#dfeeff", padding: "10px 12px", fontSize: 13, color: "#0b2148", fontWeight: 700 };
const th = { padding: "0 8px" };
const tr = { display: "flex", alignItems: "center", padding: "12px", borderTop: "1px solid #e8eef8", fontSize: 14 };
const td = { padding: "0 8px", display: "flex", alignItems: "center" };

const tagRow = { display: "inline-flex", gap: 6, alignItems: "center" };
const tagPill = { display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#eef2ff", color: "#1f3a8a", fontSize: 11, fontWeight: 800, textTransform: "uppercase" };

function PickCell({ meta, pick, res }) {
  const ticket = pick ? `${pick.team} ${pick.line || ""}`.trim() : "—";
  const tags = pickTagPills(pick);
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {tags.length > 0 && (
          <span style={tagRow}>
            {tags.map((t) => (
              <span key={t} style={tagPill}>{t}</span>
            ))}
          </span>
        )}
        <span style={{ fontWeight: 700, color: colorFor(res.ok) }}>{ticket}</span>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
        {scoreline(meta)}
      </div>
    </div>
  );
}

function BonusesCell({ bonuses }) {
  // accept either an array of strings, or an object with a `labels` array
  const names = Array.isArray(bonuses)
    ? bonuses
    : (Array.isArray(bonuses?.labels) ? bonuses.labels : []);

  if (!names.length) {
    return <span style={{ color: "#94a3b8" }}>—</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {names.map((n, i) => (
        <div key={i} style={{ fontSize: 13, fontWeight: 600, color: "#3730a3" }}>
          {n}
        </div>
      ))}
    </div>
  );
}

