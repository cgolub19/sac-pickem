import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

/** ================== DISPLAY WEEK LABEL ================== **/
const DISPLAY_WEEK_LABEL = "Q1-W1";

/** ================== CONFIG ================== **/
const CURRENT_QUARTER = "Q1";
const RATE = Number(process.env.REACT_APP_RATE ?? 1);

// Bonus amounts (stackable). Same for Sweep/Reverse & Quigger/Reverse.
const SWEEP_WINNER = 46.88;
const SWEEP_LOSER = -9.38;
const REVERSE_SWEEP_WINNER = 9.38;
const REVERSE_SWEEP_LOSER = -46.88;

/** ================== DB HELPERS ================== **/
async function savePickToDB({ weekId, userId, league, team, spread, odds, bonus, pressed }) {
  if (weekId == null) return { error: new Error("Missing numeric weekId") };
  const { data, error } = await supabase
    .from("picks")
    .upsert(
      [
        {
          week_id: weekId,
          user_id: userId,
          league, // 'NCAA' | 'NFL'
          team,
          spread,
          odds,
          bonus: bonus || null, // combo string like "LOY+LOQ" or "LOY+DOG", or null for NONE
          pressed: !!pressed,
        },
      ],
      { onConflict: "week_id,user_id,league" } // one row per user/league/week
    )
    .select();
  if (error) console.error("savePickToDB error:", error);
  else console.log("saved pick →", data);
  return { data, error };
}

/** ================== PLAYERS ================== **/
function mkPlayer(id, name) {
  return {
    id,
    name,
    picks: {},   // { [weekIdLabel]: { college: Pick, pro: Pick } }
    results: {}, // { [weekIdLabel]: { college:{for,against}, pro:{for,against} } }
    bonusUsage: {
      LOQ: { Q1: false, Q2: false, Q3: false, Q4: false },
      DOG: { Q1: false, Q2: false, Q3: false, Q4: false },
      LOY: false,
    },
  };
}
const initialPlayers = [
  mkPlayer("joey", "Joey"),
  mkPlayer("kevin", "Kevin"),
  mkPlayer("dan", "Dan"),
  mkPlayer("aaron", "Aaron"),
  mkPlayer("chris", "Chris"),
  mkPlayer("nick", "Nick"),
];

function ensurePlayerShape(p) {
  return {
    id: p.id,
    name: p.name,
    picks: p.picks || {},
    results: p.results || {},
    bonusUsage:
      p.bonusUsage || {
        LOQ: { Q1: false, Q2: false, Q3: false, Q4: false },
        DOG: { Q1: false, Q2: false, Q3: false, Q4: false },
        LOY: false,
      },
  };
}
function recalcBonusUsage(players) {
  return players.map((p) => {
    const usage = {
      LOQ: { Q1: false, Q2: false, Q3: false, Q4: false },
      DOG: { Q1: false, Q2: false, Q3: false, Q4: false },
      LOY: false,
    };
    for (const [wk, obj] of Object.entries(p.picks || {})) {
      const q = wk.split("-")[0] || "Q1";
      for (const kind of ["college", "pro"]) {
        const b = (obj?.[kind]?.bonus || "NONE").toUpperCase(); // combo string
        if (b.includes("LOY")) usage.LOY = true;
        if (b.includes("LOQ")) usage.LOQ[q] = true;
        if (b.includes("DOG")) usage.DOG[q] = true;
      }
    }
    return { ...p, bonusUsage: usage };
  });
}

/** ================== THEME & LOGOS ================== **/
const THEME = {
  bg: "#0b1d39",
  accent: "#991b1b",
  teal: "#2f6f75",
  text: "#0b1d39",
  blueSoft: "#dbeafe",
};
const teamLogos = {
  "Kansas Jayhawks": "https://a.espncdn.com/i/teamlogos/ncaa/500/2305.png",
  "Georgia Bulldogs": "https://a.espncdn.com/i/teamlogos/ncaa/500/61.png",
  "Wyoming Cowboys": "https://a.espncdn.com/i/teamlogos/ncaa/500/2751.png",
  "Arkansas Razorbacks": "https://a.espncdn.com/i/teamlogos/ncaa/500/8.png",
  "Kent State Golden Flashes": "https://a.espncdn.com/i/teamlogos/ncaa/500/2309.png",
  "Troy Trojans": "https://a.espncdn.com/i/teamlogos/ncaa/500/2653.png",
  "Georgia State Panthers": "https://a.espncdn.com/i/teamlogos/ncaa/500/2247.png",
  "Fresno State Bulldogs": "https://a.espncdn.com/i/teamlogos/ncaa/500/278.png",
  "Iowa State Cyclones": "https://a.espncdn.com/i/teamlogos/ncaa/500/66.png",
  "Kansas State Wildcats": "https://a.espncdn.com/i/teamlogos/ncaa/500/2306.png",
  "UNLV Rebels": "https://a.espncdn.com/i/teamlogos/ncaa/500/2439.png",
  "Kansas City Chiefs": "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
  "Philadelphia Eagles": "https://a.espncdn.com/i/teamlogos/nfl/500/phi.png",
};
function logoUrlFor(name) { return name && teamLogos[name] ? teamLogos[name] : null; }
function initialsOf(name = "") {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "??";
}
function TeamLogo({ name, size = 28 }) {
  const src = logoUrlFor(name);
  if (src) {
    return <img src={src} alt={name} width={size} height={size} style={{ borderRadius: 8, objectFit: "contain", background: "#fff" }} />;
  }
  return (
    <div title={name} style={{ width: size, height: size, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.45, background: "#475569", color: "white" }}>
      {initialsOf(name)}
    </div>
  );
}

/** ================== ODDS NORMALIZER (short) ================== **/
function normalizeOddsApiToGames(events = [], bookmakerKey = "betmgm") {
  const games = [];
  for (const ev of events) {
    const group = new Date(ev.commence_time).toLocaleString(undefined, {
      weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const bm = ev.bookmakers?.find(b => (b.key || "").toLowerCase() === bookmakerKey) || ev.bookmakers?.[0];
    const spreads = bm?.markets?.find(m => m.key === "spreads");
    const outcomes = spreads?.outcomes || [];
    const byTeam = {};
    for (const o of outcomes) {
      byTeam[o.name] = { spread: Number(o.point ?? 0), odds: Number(o.price ?? -110) };
    }
    const homeName = ev.home_team, awayName = ev.away_team;
    games.push({
      id: ev.id,
      group,
      commence: ev.commence_time,
      bookmaker: bm?.key || "betmgm",
      home: { name: homeName, spread: byTeam[homeName]?.spread ?? 0, odds: byTeam[homeName]?.odds ?? -110 },
      away: { name: awayName, spread: byTeam[awayName]?.spread ?? 0, odds: byTeam[awayName]?.odds ?? -110 },
    });
  }
  games.sort((a, b) => new Date(a.commence) - new Date(b.commence) || a.home.name.localeCompare(b.home.name));
  return games;
}

/** ================== SCORING HELPERS ================== **/
function wonPoints(margin, spread) { return spread >= 0 ? margin + spread : margin - Math.abs(spread); }
function pickMultiplier({ bonus, pressed }) {
  const b = String(bonus || "NONE").toUpperCase();
  let m = 1;
  // LOY gives x4, LOQ gives x2 (LOY dominates if both)
  if (b.includes("LOY")) m *= 4;
  else if (b.includes("LOQ")) m *= 2;
  if (pressed) m *= 2; // PRESS doubles on top
  return m;
}
function askipForPick(pick, result) {
  if (!pick || !result) return 0;
  const margin = Number(result.for ?? 0) - Number(result.against ?? 0);
  const won = wonPoints(margin, Number(pick.spread ?? 0));
  const base = won * pickMultiplier({ bonus: pick.bonus, pressed: !!pick.pressed });
  const coverKicker = won > 0 ? 7 : 0;
  return base + coverKicker;
}
function weeklyAskipByPlayer(players, weekIdLabel) {
  const out = {};
  for (const p of players) {
    const wkPicks = p.picks?.[weekIdLabel] || {};
    const wkRes = p.results?.[weekIdLabel] || {};
    out[p.id] = askipForPick(wkPicks.college, wkRes.college) + askipForPick(wkPicks.pro, wkRes.pro);
  }
  return out;
}
function weeklyDollarsBase(players, weekIdLabel) {
  const A = weeklyAskipByPlayer(players, weekIdLabel);
  const ids = players.map((p) => p.id);
  const n = ids.length || 1;
  const total = ids.reduce((s, id) => s + (A[id] || 0), 0);
  const dollars = {};
  for (const id of ids) dollars[id] = (n * (A[id] || 0) - total) * RATE;
  return { askip: A, dollars };
}
function pickOutcomeATS(pick, result) {
  if (!pick || !result) return null;
  const margin = Number(result.for ?? 0) - Number(result.against ?? 0);
  const spread = Number(pick.spread ?? 0);
  const coverMargin = spread >= 0 ? margin + spread : margin - Math.abs(spread);
  if (coverMargin > 0) return "W";
  if (coverMargin < 0) return "L";
  return "P";
}
function computeWeekBonuses(players, weekIdLabel) {
  const ids = players.map((p) => p.id);
  const byId = Object.fromEntries(ids.map((id) => [id, { total: 0, notes: [] }]));
  const cfbOutcomes = {}, nflOutcomes = {};
  for (const p of players) {
    cfbOutcomes[p.id] = pickOutcomeATS(p.picks?.[weekIdLabel]?.college, p.results?.[weekIdLabel]?.college);
    nflOutcomes[p.id] = pickOutcomeATS(p.picks?.[weekIdLabel]?.pro, p.results?.[weekIdLabel]?.pro);
  }
  function applySweep(outcomes, label) {
    const wins = ids.filter((id) => outcomes[id] === "W");
    const losses = ids.filter((id) => outcomes[id] === "L");
    const pushes = ids.filter((id) => outcomes[id] === "P");
    if (pushes.length > 0) return;
    if (wins.length === 1 && losses.length === ids.length - 1) {
      const w = wins[0]; byId[w].total += SWEEP_WINNER; byId[w].notes.push(`Sweep – ${label}`);
      for (const id of losses) byId[id].total += SWEEP_LOSER; return;
    }
    if (losses.length === 1 && wins.length === ids.length - 1) {
      const l = losses[0]; byId[l].total += REVERSE_SWEEP_LOSER; byId[l].notes.push(`Reverse Sweep – ${label}`);
      for (const id of wins) byId[id].total += REVERSE_SWEEP_WINNER;
    }
  }
  applySweep(cfbOutcomes, "CFB");
  applySweep(nflOutcomes, "NFL");

  const records = ids.map((id) => {
    const c = cfbOutcomes[id], n = nflOutcomes[id];
    const wins = Number(c === "W") + Number(n === "W");
    const losses = Number(c === "L") + Number(n === "L");
    const pushes = Number(c === "P") + Number(n === "P");
    return { id, wins, losses, pushes };
  });
  const twoAndO = records.filter((r) => r.wins === 2 && r.pushes === 0 && r.losses === 0);
  const ohAndTwo = records.filter((r) => r.losses === 2 && r.pushes === 0 && r.wins === 0);
  if (twoAndO.length === 1) {
    const wid = twoAndO[0].id; byId[wid].total += SWEEP_WINNER; byId[wid].notes.push("Quigger");
    for (const { id } of records) if (id !== wid) byId[id].total += SWEEP_LOSER;
  }
  if (ohAndTwo.length === 1) {
    const lid = ohAndTwo[0].id; byId[lid].total += REVERSE_SWEEP_LOSER; byId[lid].notes.push("Reverse Quigger");
    for (const { id } of records) if (id !== id) byId[id].total += REVERSE_SWEEP_WINNER;
  }
  return byId;
}
function cumulativeDollars(players) {
  const weekIds = new Set(players.flatMap((p) => Object.keys(p.picks || {})));
  const totals = Object.fromEntries(players.map((p) => [p.id, 0]));
  for (const wk of weekIds) {
    const { dollars } = weeklyDollarsBase(players, wk);
    const bonuses = computeWeekBonuses(players, wk);
    for (const p of players) totals[p.id] += (dollars[p.id] || 0) + (bonuses[p.id]?.total || 0);
  }
  return totals;
}
function cumulativeATS(players) {
  const out = Object.fromEntries(players.map((p) => [p.id, { w: 0, l: 0, p: 0 }]));
  const weekIds = new Set(players.flatMap((p) => Object.keys(p.picks || {})));
  for (const wk of weekIds) {
    for (const p of players) {
      const picks = p.picks?.[wk] || {};
      const res = p.results?.[wk] || {};
      for (const kind of ["college", "pro"]) {
        const pick = picks[kind]; const r = res[kind]; if (!pick || !r) continue;
        const outcome = pickOutcomeATS(pick, r);
        if (outcome === "W") out[p.id].w += 1;
        else if (outcome === "L") out[p.id].l += 1;
        else if (outcome === "P") out[p.id].p += 1;
      }
    }
  }
  return out;
}

/** ================== PRIORITY STEAL ORDER (seed) ================== **/
const PRIORITY_RANK = Object.freeze({
  joey: 1,
  chris: 2,
  dan: 3,
  nick: 4,
  kevin: 5,
  aaron: 6,
});
const priorityOf = (id) => (PRIORITY_RANK[(id || "").toLowerCase()] ?? 999);

/** ================== LADDER (token tiers) ==================
 * Tie-break index encodes your sheet:
 *   Token tier:  LOY+LOQ(0) > LOY(1) > LOQ(2) > NONE(3)
 *   Within tier: rank 6 > 5 > 4 > 3 > 2 > 1
 */
function ladderIndexFor(rank, token) {
  const t = String(token || "NONE").toUpperCase();
  const tier =
    (t.includes("LOY") && t.includes("LOQ")) ? 0 :
    (t.includes("LOY") ? 1 :
    (t.includes("LOQ") ? 2 : 3));
  const orderWithinTier = Math.max(0, 6 - Number(rank)); // 6→0 .. 1→5
  return tier * 10 + orderWithinTier; // smaller = stronger
}
function beatsByPrioritySheet(aRank, aToken, bRank, bToken) {
  const ia = ladderIndexFor(aRank, aToken);
  const ib = ladderIndexFor(bRank, bToken);
  if (ia < ib) return true;
  if (ib < ia) return false;
  if (aRank !== bRank) return aRank > bRank; // lower standing (bigger number) wins
  return false;
}

/** ================== PERMISSION MATRIX (LOY+LOQ-aware) ================== **/
function canTakeTeam({ attemptorId, victimId, victimBonus, chosenBonus }) {
  if (!victimId || attemptorId === victimId) return { ok: true };
  const aRank = priorityOf(attemptorId);
  const vRank = priorityOf(victimId);

  const tok = (x) => String(x || "NONE").toUpperCase();
  const vTok = tok(victimBonus);
  const aTok = tok(chosenBonus);
  const hasLOY = (t) => t.includes("LOY");
  const hasLOQ = (t) => t.includes("LOQ");

  // OWNER LOY → challenger must include LOY (LOY or LOY+LOQ)
  if (hasLOY(vTok)) {
    return { ok: hasLOY(aTok), reason: hasLOY(aTok) ? undefined : "LOY_REQUIRED" };
  }

  // OWNER LOQ
  if (hasLOQ(vTok)) {
    if (aRank >= vRank) {
      // lower/equal-ranked challenger → needs LOQ or LOY (LOY+LOQ also OK)
      const ok = hasLOQ(aTok) || hasLOY(aTok);
      return { ok, reason: ok ? undefined : "LOQ_OR_LOY_REQUIRED" };
    }
    // higher-ranked (better standing) challenger → must include LOY
    const ok = hasLOY(aTok);
    return { ok, reason: ok ? undefined : "LOY_REQUIRED" };
  }

  // OWNER NONE → spreadsheet ladder decides permission
  const wins = beatsByPrioritySheet(aRank, aTok, vRank, vTok);
  return { ok: wins, reason: wins ? undefined : "LADDER_PRIORITY" };
}

/** ================== MAIN COMPONENT ================== **/
export default function PickemLocal() {
  // Numeric week id from DB (for saving)
  const [currentWeekId, setCurrentWeekId] = useState(null);
  const [weekStatus, setWeekStatus] = useState(null);
const isWeekOne = Number(currentWeekId) === 1; // special: two college picks

  // TEMP: force unlocked while we finalize rules
  const locked = String(weekStatus).toUpperCase() === "LOCKED";


  const [currentUserId, setCurrentUserId] = useState("chris");

  useEffect(() => {
  (async () => {
    const { data, error } = await supabase
      .from("weeks")
      .select("id,status")
      .order("id", { ascending: false }) // newest first
      .limit(1)
      .single();
    if (error || !data) { console.error("weeks load error:", error || "no rows"); return; }
    setCurrentWeekId(data.id);
    setWeekStatus(data.status); // OPEN or LOCKED
  })();
}, []);


  // local players state (persist in localStorage)
  const [players, setPlayers] = useState(() => {
    try {
      const raw = localStorage.getItem("sac_players_v2");
      const data = raw ? JSON.parse(raw) : initialPlayers;
      const arr = Array.isArray(data) ? data : initialPlayers;
      return recalcBonusUsage(arr.map(ensurePlayerShape));
    } catch { return initialPlayers; }
  });

  // Load saved picks for the OPEN week from Supabase and hydrate the UI
  useEffect(() => {
    if (currentWeekId == null) return;
    (async () => {
      const { data, error } = await supabase
        .from("picks")
        .select("user_id, league, team, spread, odds, bonus, pressed")
        .eq("week_id", currentWeekId);
      if (error) { console.error("load picks error:", error); return; }

      setPlayers((prev) => {
        const copy = prev.map((p) => ({ ...p, picks: { ...(p.picks || {}) } }));
        const weekKey = DISPLAY_WEEK_LABEL; // e.g., "Q1-W1"

        for (const row of data || []) {
          const playerId = String(row.user_id).toLowerCase();
          const i = copy.findIndex((p) => p.id === playerId);
          if (i === -1) continue;

          const slot = row.league === "NCAA" ? "college" : "pro";
          const week = copy[i].picks?.[weekKey] ?? { college: {}, pro: {} };
          week[slot] = {
            team: row.team,
            spread: Number(row.spread ?? 0),
            odds: row.odds ?? null,
            bonus: String(row.bonus || "NONE").toUpperCase(), // combo string
            pressed: !!row.pressed,
          };
          copy[i].picks = { ...copy[i].picks, [weekKey]: week };
        }
        return recalcBonusUsage(copy);
      });
      console.log("[HYDRATE DONE] rows:", data);
    })();
  }, [currentWeekId]);

  const [selector, setSelector] = useState(null); // { playerId, type }
  // MULTI-SELECT bonuses in the modal
  const [tokLOY, setTokLOY] = useState(false);
  const [tokLOQ, setTokLOQ] = useState(false);
  const [tokDOG, setTokDOG] = useState(false);
  const [pressed, setPressed] = useState(false);

  const [collegeLines, setCollegeLines] = useState([]);
  const [nflLines, setNflLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState(null);
const [logosLoaded, setLogosLoaded] = useState(false);

  // Persist players to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("sac_players_v2", JSON.stringify(players));
    } catch {}
  }, [players]);

  // Load odds
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLinesLoading(true);
        setLinesError(null);
        const apiKey = process.env.REACT_APP_ODDS_API_KEY;
        const apiBase = process.env.REACT_APP_ODDS_API_BASE || "https://api.the-odds-api.com/v4";
        const region = process.env.REACT_APP_ODDS_REGION || "us";
        const bookmaker = (process.env.REACT_APP_ODDS_BOOKMAKER || "betmgm").toLowerCase();
        const markets = process.env.REACT_APP_ODDS_MARKETS || "spreads";
        const oddsFormat = process.env.REACT_APP_ODDS_FORMAT || "american";
        const endpoints = [
          `${apiBase}/sports/americanfootball_ncaaf/odds?regions=${region}&bookmakers=${bookmaker}&markets=${markets}&oddsFormat=${oddsFormat}&apiKey=${apiKey}`,
          `${apiBase}/sports/americanfootball_nfl/odds?regions=${region}&bookmakers=${bookmaker}&markets=${markets}&oddsFormat=${oddsFormat}&apiKey=${apiKey}`,
        ];
        const [cfbRes, nflRes] = await Promise.all(endpoints.map((u) => fetch(u)));
        const [cfbJson, nflJson] = await Promise.all([cfbRes.json(), nflRes.json()]);
        if (!alive) return;
        setCollegeLines(normalizeOddsApiToGames(Array.isArray(cfbJson) ? cfbJson : [], bookmaker));
        setNflLines(normalizeOddsApiToGames(Array.isArray(nflJson) ? nflJson : [], bookmaker));
      } catch (e) {
        if (!alive) return;
        setLinesError(String(e?.message || e));
      } finally {
        if (alive) setLinesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);
// Load team logos from Supabase (once) and merge into local map
useEffect(() => {
  (async () => {
    try {
      const { data, error } = await supabase
        .from("team_logos")
        .select("team, logo_url"); // league not needed for lookup

      if (error) {
        console.error("[logos] load error:", error);
        return;
      }

      // Merge DB rows into the existing local map so TeamLogo can use them.
      for (const row of data || []) {
        if (row?.team && row?.logo_url) {
          teamLogos[row.team] = row.logo_url;
        }
      }

      // Trigger a re-render so the new URLs are used
      setLogosLoaded((v) => !v);
    } catch (e) {
      console.error("[logos] unexpected:", e);
    }
  })();
}, []);

  /** Utilities */
  const canPress = (pid) => (overallDollars[pid] ?? 0) <= -100;
  const openSelector = (playerId, type) => {
    setSelector({ playerId, type });
    setTokLOY(false);
    setTokLOQ(false);
    setTokDOG(false);
    setPressed(false);
  };
  const closeSelector = () => setSelector(null);

  function findOwnerOfTeam(weekIdLabel, type, team) {
    for (const p of players) {
      const pk = p.picks?.[weekIdLabel]?.[type];
      if (pk && pk.team === team) return p.id;
    }
    return null;
  }

  function rulesTokenFromChecks({ loy, loq }) {
    if (loy && loq) return "LOY+LOQ";
    if (loy) return "LOY";
    if (loq) return "LOQ";
    return "NONE";
  }
  function saveComboFromChecks({ loy, loq, dogValid }) {
    const parts = [];
    if (loy) parts.push("LOY");
    if (loq) parts.push("LOQ");
    if (dogValid) parts.push("DOG"); // PRESS is stored in 'pressed'
    return parts.length ? parts.join("+") : "NONE";
  }

  const onConfirmPick = ({ playerId, type, line, steal }) => {
    const league = type === "college" ? "NCAA" : "NFL";
    const victimId = findOwnerOfTeam(DISPLAY_WEEK_LABEL, type, line.team);

    // current owner's bonus on that team (if any)
    let victimBonus = null;
    if (victimId) {
      const victim = players.find((p) => p.id === victimId);
      victimBonus = victim?.picks?.[DISPLAY_WEEK_LABEL]?.[type]?.bonus || null; // combo string
    }

    const dogValid = Number(line?.spread) >= 7 && tokDOG;
    const rulesToken = rulesTokenFromChecks({ loy: tokLOY, loq: tokLOQ });
    const saveCombo = saveComboFromChecks({ loy: tokLOY, loq: tokLOQ, dogValid });

    // enforce steal rule before changing state / DB
    const gate = canTakeTeam({
      attemptorId: playerId,
      victimId,
      victimBonus,
      chosenBonus: rulesToken,
    });
    if (!gate.ok) {
      if (gate.reason === "LOY_REQUIRED") {
        alert("Owner has LOY: you must include LOY (LOY or LOY+LOQ).");
      } else if (gate.reason === "LOQ_OR_LOY_REQUIRED") {
        alert("Owner protection/standing requires LOQ or LOY.");
      } else if (gate.reason === "LADDER_PRIORITY") {
        alert("You lose on the Priority sheet for this combo.");
      } else {
        alert("Not allowed by rules.");
      }
      return;
    }

    // If taking WITHOUT any LOY/LOQ, require the STEAL checkbox as confirmation
    if (!rulesToken.includes("LOY") && !rulesToken.includes("LOQ") && !steal) {
      alert("Check the STEAL box to confirm taking this team without a token.");
      return;
    }

    // remove from victim, add to attemptor (local state)
    setPlayers((prev) => {
      let next = prev;

      if (victimId && victimId !== playerId) {
        next = next.map((p) => {
          if (p.id !== victimId) return p;
          const nextPicks = { ...p.picks };
          const wk = { ...(nextPicks[DISPLAY_WEEK_LABEL] || {}) };
          delete wk[type];
          nextPicks[DISPLAY_WEEK_LABEL] = wk;
          return { ...p, picks: nextPicks };
        });
      }

      next = next.map((p) => {
        if (p.id !== playerId) return p;
        const nextPicks = { ...p.picks };
        const wk = { ...(nextPicks[DISPLAY_WEEK_LABEL] || {}) };
        wk[type] = {
          team: line.team,
          spread: line.spread,
          odds: line.odds,
          bonus: saveCombo,      // combo string e.g. "LOY+LOQ", "LOY+DOG", "NONE"
          pressed: !!pressed,    // PRESS is independent
          steal: !!steal,        // display only
        };
        nextPicks[DISPLAY_WEEK_LABEL] = wk;
        return { ...p, picks: nextPicks };
      });

      return recalcBonusUsage(next);
    });

    // save to DB with the numeric week id
    savePickToDB({
      weekId: currentWeekId,
      userId: playerId,
      league,
      team: line.team,
      spread: line.spread,
      odds: line.odds ?? null,
      bonus: saveCombo === "NONE" ? null : saveCombo,
      pressed: !!pressed,
    });

    closeSelector();
  };

  /** WEEK / OVERALL MATH (local display uses DISPLAY_WEEK_LABEL) */
  const { dollars: weekDollarsBaseMap } = useMemo(
    () => weeklyDollarsBase(players, DISPLAY_WEEK_LABEL),
    [players]
  );
  const weekBonuses = useMemo(
    () => computeWeekBonuses(players, DISPLAY_WEEK_LABEL),
    [players]
  );
  const weekDollarsTotal = useMemo(() => {
    const out = {};
    for (const p of players)
      out[p.id] = (weekDollarsBaseMap[p.id] || 0) + (weekBonuses[p.id]?.total || 0);
    return out;
  }, [players, weekDollarsBaseMap, weekBonuses]);

  // Totals (still shown on the right for info)
  const overallDollars = useMemo(() => cumulativeDollars(players), [players]);
  const ats = useMemo(() => cumulativeATS(players), [players]);

  // Order used in the table (Week-1 = your seed order)
  const playersForDisplay = useMemo(() => {
    const arr = [...players];
    const label = (DISPLAY_WEEK_LABEL || "").toUpperCase().replace(/\s+/g, "-");
    const isWeek1 = label === "Q1-W1";
    const byPriority = (a, b) => priorityOf(a.id) - priorityOf(b.id);
    const byMoneyThenPriority = (a, b) => {
      const da = Number(overallDollars[a.id] ?? 0);
      const db = Number(overallDollars[b.id] ?? 0);
      if (da !== db) return da - db; // lower first
      return byPriority(a, b);
    };
    return arr.sort(isWeek1 ? byPriority : byMoneyThenPriority);
  }, [players, overallDollars]);

  // Dev helper: wipe local state picks
  const clearLocalPicks = () => {
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        picks: {}, // remove all week picks
        bonusUsage: {}, // remove LOY/LOQ/DOG usage in local state
      }))
    );
    alert("Cleared local picks in React state.");
  };

  return (
    <>
      <div style={topBar}>
        <div style={{ color: "#e6edf6", fontWeight: 900, letterSpacing: 1 }}>
          SAC Pick’Em
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ color: "#c7d2fe", fontSize: 12 }}>Who am I?</label>
          <select
            value={currentUserId}
            onChange={(e) => setCurrentUserId(e.target.value)}
            style={{ padding: "4px 8px", borderRadius: 6 }}
          >
            <option value="joey">Joey</option>
            <option value="kevin">Kevin</option>
            <option value="dan">Dan</option>
            <option value="aaron">Aaron</option>
            <option value="chris">Chris</option>
            <option value="nick">Nick</option>
          </select>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        <button
          onClick={clearLocalPicks}
          style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb" }}
        >
          Clear Local Picks
        </button>
      </div>

      {/* Selector modal */}
      {selector && (
        <PickModal
          selector={selector}
          onClose={() => setSelector(null)}
          onConfirm={({ line, steal }) => onConfirmPick({ playerId: selector.playerId, type: selector.type, line, steal })}
          collegeLines={collegeLines}
          nflLines={nflLines}
          linesLoading={linesLoading}
          linesError={linesError}
          // multi-select checkboxes
          tokLOY={tokLOY} setTokLOY={setTokLOY}
          tokLOQ={tokLOQ} setTokLOQ={setTokLOQ}
          tokDOG={tokDOG} setTokDOG={setTokDOG}
          pressed={pressed} setPressed={setPressed}
          canPress={(pid) => (overallDollars[pid] ?? 0) <= -100}
          currentPlayer={players.find((p) => p.id === selector.playerId)}
          quarter={CURRENT_QUARTER}
          players={playersForDisplay}
          weekIdLabel={DISPLAY_WEEK_LABEL}
          overallDollars={overallDollars}
          isWeekOne={isWeekOne}
        />
      )}

      <div
        style={{
          padding: 16,
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 10 }}>
          Week {DISPLAY_WEEK_LABEL}
        </h2>
        <div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>
          Debug: user=<b>{currentUserId}</b> • locked=<b>{String(locked)}</b>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 16 }}>
          <MakePicksTable
            players={playersForDisplay}
            weekIdLabel={DISPLAY_WEEK_LABEL}
            locked={locked}
            currentUserId={currentUserId}
            onCellClick={(id, type) => setSelector({ playerId: id, type })}
            isWeekOne={isWeekOne} 
          />

          <div style={{ display: "grid", gap: 12 }}>
            {/* WEEK DOLLARS (includes bonuses) */}
            <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, display: "none" }}>

              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Week Dollars (with bonuses)
              </div>
              {players.map((p) => {
                const { dollars } = weeklyDollarsBase(players, DISPLAY_WEEK_LABEL);
                const bonus = computeWeekBonuses(players, DISPLAY_WEEK_LABEL)[p.id]?.total || 0;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 8,
                      padding: "4px 0",
                    }}
                  >
                    <div>{p.name}</div>
                    <div style={{ fontWeight: 700 }}>
                      ${((dollars[p.id] || 0) + bonus).toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
{/* --- Bonus Summary (per current quarter) --- */}
<div style={{ margin: "16px 16px 32px" }}>
  <div style={{
    border: "1px solid #e5e5e5",
    borderRadius: 12,
    padding: 12,
    background: "#fff",
  }}>
    <div style={{ fontWeight: 800, marginBottom: 8 }}>
{/* OVERALL STANDINGS (top copy) */}
<div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, marginBottom: 12 }}>
  <div style={{ fontWeight: 800, marginBottom: 6 }}>
    Overall Standings
  </div>
  {players.map((p) => {
    const d = overallDollars[p.id] ?? 0;
    const r = ats[p.id] ?? { w: 0, l: 0, p: 0 };
    return (
      <div
        key={p.id}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 8,
          padding: "4px 0",
        }}
      >
        <div>{p.name}</div>
        <div style={{ fontWeight: 700 }}>${d.toFixed(2)}</div>
        <div style={{ color: "#475569" }}>
          {r.w}-{r.l}-{r.p}
        </div>
      </div>
    );
  })}
  <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
    Dollars are cumulative across all weeks (including bonuses); ATS is wins–losses–pushes.
  </div>
</div>

      Bonus Summary — {CURRENT_QUARTER}
    </div>

    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto auto",
      gap: 8,
      padding: "4px 0",
      fontWeight: 700,
      borderBottom: "1px solid #eee",
      marginBottom: 6,
      color: "#475569"
    }}>
      <div>Player</div>
      <div>LOY (season)</div>
      <div>LOQ / DOG (this quarter)</div>
    </div>

    {players.map((p) => {
      const usedLOY = !!p.bonusUsage?.LOY;
      const usedLOQ = !!p.bonusUsage?.LOQ?.[CURRENT_QUARTER];
      const usedDOG = !!p.bonusUsage?.DOG?.[CURRENT_QUARTER];

      return (
        <div
          key={p.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: 8,
            padding: "6px 0",
            alignItems: "center",
            borderTop: "1px dashed #f1f5f9"
          }}
        >
          <div style={{ fontWeight: 600 }}>{p.name}</div>

          <div>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 8px",
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 800,
              color: "white",
              background: usedLOY ? "#a855f7" : "#94a3b8"
            }}>
              LOY {usedLOY ? "USED" : "open"}
            </span>
          </div>

          <div style={{ display: "inline-flex", gap: 8 }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 8px",
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 800,
              color: "white",
              background: usedLOQ ? "#22c55e" : "#94a3b8"
            }}>
              LOQ {usedLOQ ? "USED" : "open"}
            </span>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 8px",
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 800,
              color: "white",
              background: usedDOG ? "#0ea5e9" : "#94a3b8"
            }}>
              DOG {usedDOG ? "USED" : "open"}
            </span>
          </div>
        </div>
      );
    })}
    <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
      LOY is once per season. LOQ & DOG reset each quarter (showing usage for <b>{CURRENT_QUARTER}</b>).
    </div>
  </div>
</div>

            {/* OVERALL STANDINGS */}
            <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, display: "none" }}>

              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Overall Standings
              </div>
              {players.map((p) => {
                const d = overallDollars[p.id] ?? 0;
                const r = ats[p.id] ?? { w: 0, l: 0, p: 0 };
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      gap: 8,
                      padding: "4px 0",
                    }}
                  >
                    <div>{p.name}</div>
                    <div style={{ fontWeight: 700 }}>${d.toFixed(2)}</div>
                    <div style={{ color: "#475569" }}>
                      {r.w}-{r.l}-{r.p}
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                Dollars are cumulative across all weeks (including bonuses); ATS
                is wins-losses-pushes.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================== PICK MODAL ================== */
function PickModal({
  selector,
  onClose,
  onConfirm,
  collegeLines,
  nflLines,
  linesLoading,
  linesError,
  // multi-select
  tokLOY, setTokLOY,
  tokLOQ, setTokLOQ,
  tokDOG, setTokDOG,
  pressed, setPressed,
  canPress,
  currentPlayer,
  quarter,
  players = [],
  weekIdLabel,
  overallDollars,
  isWeekOne,
}) {
  const [steal, setSteal] = useState(false);

  // standings helpers
  function getOwner(teamName) {
    if (!teamName) return null;
    for (const p of players || []) {
      const wk = p.picks?.[weekIdLabel];
      if (!wk) continue;
      if (wk.college?.team === teamName)
        return { id: p.id, slot: "college", bonus: wk.college?.bonus || "NONE" };
      if (wk.pro?.team === teamName)
        return { id: p.id, slot: "pro", bonus: wk.pro?.bonus || "NONE" };
    }
    return null;
  }
  useEffect(() => setSteal(false), [selector?.playerId, selector?.type]);

  if (!selector) return null;

  const all = selector.type === "college"
  ? (collegeLines || [])
  : (isWeekOne ? (collegeLines || []) : (nflLines || []));

  const usedLOQ = !!currentPlayer?.bonusUsage?.LOQ?.[quarter];
  const usedLOY = !!currentPlayer?.bonusUsage?.LOY;
  const usedDOG = !!currentPlayer?.bonusUsage?.DOG?.[quarter];
  const pressAllowed = canPress(selector.playerId);

  // board empty?
  function isBoardEmpty() {
    const wk = weekIdLabel;
    return (players || []).every((p) => {
      const w = p.picks?.[wk];
      const noCollege = !w?.college?.team;
      const noPro = !w?.pro?.team;
      return !w || (noCollege && noPro);
    });
  }

  function rulesToken() {
    if (tokLOY && tokLOQ) return "LOY+LOQ";
    if (tokLOY) return "LOY";
    if (tokLOQ) return "LOQ";
    return "NONE";
  }

  // Used by the list to decide if a row should be clickable (not grey)
  function canAttempt(teamName) {
    if (!teamName) return false;
    if (isBoardEmpty()) return true;

    const owner = getOwner(teamName);
    const ownerId = owner?.id || null;
    if (!ownerId) return true;
    if (ownerId === selector.playerId) return true;

    const gate = canTakeTeam({
      attemptorId: selector.playerId,
      victimId: ownerId,
      victimBonus: (owner?.bonus || "NONE").toUpperCase(),
      chosenBonus: rulesToken(),
    });
    return !!gate.ok;
  }

  // DOG filter (only show games where at least one side is ≥ +7 when DOG checked)
  const items =
    !tokDOG
      ? all
      : all.filter((g) => Number(g.away.spread) >= 7 || Number(g.home.spread) >= 7);

  const overlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  };
  const box = {
    width: "min(760px, 95vw)",
    maxHeight: "85vh",
    overflow: "auto",
    background: "#fff",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,.3)",
  };
  const rowBase = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18 }}>
            Pick a {selector.type === "college" ? "College" : "Pro"} team
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        {/* Bonus controls */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <strong>Bonuses:</strong>

          <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: usedLOQ ? 0.5 : 1 }}>
            <input
              type="checkbox"
              disabled={usedLOQ}
              checked={tokLOQ}
              onChange={(e) => setTokLOQ(e.target.checked)}
            />
            LOQ
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: usedLOY ? 0.5 : 1 }}>
            <input
              type="checkbox"
              disabled={usedLOY}
              checked={tokLOY}
              onChange={(e) => setTokLOY(e.target.checked)}
            />
            LOY
          </label>

          <label style={{ display: "flex", gap: 6, alignItems: "center", opacity: usedDOG ? 0.5 : 1 }}>
            <input
              type="checkbox"
              disabled={usedDOG}
              checked={tokDOG}
              onChange={(e) => setTokDOG(e.target.checked)}
            />
            DOG (≥ +7)
          </label>

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", opacity: pressAllowed ? 1 : 0.5 }}>
            <input
              id="press-toggle"
              type="checkbox"
              disabled={!pressAllowed}
              checked={!!pressed}
              onChange={(e) => setPressed(!!e.target.checked)}
            />
            <label htmlFor="press-toggle">Press</label>

            <label style={{ marginLeft: 12 }}>
              <input
                type="checkbox"
                checked={steal}
                onChange={(e) => setSteal(e.target.checked)}
              />{" "}
              STEAL
            </label>
          </div>
        </div>

        {linesLoading ? (
          <div>Loading lines…</div>
        ) : linesError ? (
          <div style={{ color: "#b91c1c" }}>Error loading lines.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {items.map((g) => {
              const dogAwayOK = !tokDOG || Number(g.away.spread) >= 7;
              const dogHomeOK = !tokDOG || Number(g.home.spread) >= 7;

              const rulesAwayOK = canAttempt(g.away.name);
              const rulesHomeOK = canAttempt(g.home.name);

              const awayOK = dogAwayOK && rulesAwayOK;
              const homeOK = dogHomeOK && rulesHomeOK;

              const awayProps = {
                onClick: () => {
                  const dogValid = tokDOG && Number(g.away.spread) >= 7;
                  const owner = getOwner(g.away.name);
                  if (owner && owner.id !== selector.playerId) {
                    const gate = canTakeTeam({
                      attemptorId: selector.playerId,
                      victimId: owner.id,
                      victimBonus: (owner?.bonus || "NONE").toUpperCase(),
                      chosenBonus: rulesToken(),
                    });
                    if (!gate.ok) {
                      const msg =
                        gate.reason === "LOY_REQUIRED"
                          ? "Owner has LOY: you must include LOY (LOY or LOY+LOQ)."
                          : gate.reason === "LOQ_OR_LOY_REQUIRED"
                          ? "Owner protection/standing requires LOQ or LOY."
                          : gate.reason === "LADDER_PRIORITY"
                          ? "You lose on the Priority sheet for this combo."
                          : "Not allowed by rules.";
                      alert(msg); return;
                    }
                    if (!rulesToken().includes("LOY") && !rulesToken().includes("LOQ") && !steal) {
                      alert("Check the STEAL box to confirm taking this team without a token.");
                      return;
                    }
                  }
                  if (!awayOK) return;
                  onConfirm({
                    line: {
                      team: g.away.name,
                      spread: g.away.spread,
                      odds: g.away.odds,
                    },
                    steal,
                  });
                },
                style: {
                  ...rowBase,
                  cursor: awayOK ? "pointer" : "not-allowed",
                  opacity: awayOK ? 1 : 0.6,
                  background: awayOK ? "white" : "#f3f4f6",
                  borderTop: "1px solid #eee",
                },
              };

              const homeProps = {
                onClick: () => {
                  const dogValid = tokDOG && Number(g.home.spread) >= 7;
                  const owner = getOwner(g.home.name);
                  if (owner && owner.id !== selector.playerId) {
                    const gate = canTakeTeam({
                      attemptorId: selector.playerId,
                      victimId: owner.id,
                      victimBonus: (owner?.bonus || "NONE").toUpperCase(),
                      chosenBonus: rulesToken(),
                    });
                    if (!gate.ok) {
                      const msg =
                        gate.reason === "LOY_REQUIRED"
                          ? "Owner has LOY: you must include LOY (LOY or LOY+LOQ)."
                          : gate.reason === "LOQ_OR_LOY_REQUIRED"
                          ? "Owner protection/standing requires LOQ or LOY."
                          : gate.reason === "LADDER_PRIORITY"
                          ? "You lose on the Priority sheet for this combo."
                          : "Not allowed by rules.";
                      alert(msg); return;
                    }
                    if (!rulesToken().includes("LOY") && !rulesToken().includes("LOQ") && !steal) {
                      alert("Check the STEAL box to confirm taking this team without a token.");
                      return;
                    }
                  }
                  if (!homeOK) return;
                  onConfirm({
                    line: {
                      team: g.home.name,
                      spread: g.home.spread,
                      odds: g.home.odds,
                    },
                    steal,
                  });
                },
                style: {
                  ...rowBase,
                  cursor: homeOK ? "pointer" : "not-allowed",
                  opacity: homeOK ? 1 : 0.6,
                  background: homeOK ? "white" : "#f3f4f6",
                  borderTop: "1px solid #eee",
                },
              };

              return (
  <div
    key={g.id}
    style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}
  >
    {/* Game meta header: kickoff + location */}
    <div
      style={{
        padding: "8px 12px",
        background: "#f8fafc",
        borderBottom: "1px solid #eee",
        fontSize: 12,
        color: "#475569",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div>
        <div style={{ fontWeight: 700 }}>
          {new Date(g.commence).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
        <div style={{ opacity: 0.8 }}>
          at <b>{g.home.name}</b>
        </div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        {g.bookmaker?.toUpperCase?.() || "line"}
      </div>
    </div>

    {/* Away row */}
    <div {...awayProps}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamLogo name={g.away.name} />
        <div style={{ fontWeight: 700 }}>{g.away.name}</div>
      </div>
      <div>
        {g.away.spread} / {g.away.odds}
      </div>
    </div>

    {/* Home row */}
    <div {...homeProps}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamLogo name={g.home.name} />
        <div style={{ fontWeight: 700 }}>{g.home.name}</div>
      </div>
      <div>
        {g.home.spread} / {g.home.odds}
      </div>
    </div>
  </div>
);
;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== Small badge pills for LOY/LOQ/DOG/PRESS ===== */
const BADGE_COLORS = {
  loy: "#a855f7",  // purple
  loq: "#22c55e",  // green
  dog: "#0ea5e9",  // sky
  press: "#f97316",// orange
  steal: "#ef4444",// red
};
function Pill({ text, tone }) {
  const color = BADGE_COLORS[tone] || "#64748b";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 20,
        padding: "0 8px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: "18px",
        color: "white",
        background: color,
      }}
    >
      {text}
    </span>
  );
}
function renderBadges(pick) {
  if (!pick) return null;
  const b = String(pick.bonus || "NONE").toUpperCase();
  const badges = [];
  if (b.includes("LOY")) badges.push(<Pill key="LOY" text="LOY" tone="loy" />);
  if (b.includes("LOQ")) badges.push(<Pill key="LOQ" text="LOQ" tone="loq" />);
  if (b.includes("DOG")) badges.push(<Pill key="DOG" text="DOG" tone="dog" />);
  if (pick.pressed) badges.push(<Pill key="PRESS" text="PRESS" tone="press" />);
  if (pick.steal) badges.push(<Pill key="STEAL" text="STEAL" tone="steal" />);
  return <div style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>{badges}</div>;
}

/* ================== TABLE ================== */
function MakePicksTable({ players, weekIdLabel, onCellClick, locked, currentUserId, isWeekOne }) {

  const wrap = { border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, background: "#fff" };
  const head = { fontWeight: 800, marginBottom: 8 };
  const tableStyle = { borderCollapse: "collapse", width: "100%", minWidth: 560 };
  const th = { textAlign: "left", background: "#eef2ff", padding: 8, borderBottom: "1px solid #e5e5e5" };
  const td = { padding: 8, borderTop: "1px solid #eee" };
  const dash = { color: "#9ca3af" };

  const pickText = (pk) => {
    if (!pk || !pk.team) return "—";
    const s = Number(pk.spread);
    const spread = isNaN(s) ? "" : (s > 0 ? `+${s}` : `${s}`);
    return `${pk.team}${spread ? " " + spread : ""}`;
  };

  return (
    <div style={wrap}>
      <div style={head}>
        Current Week {(weekIdLabel || "").replace("-", " ")}
        {locked ? (
          <span style={{ marginLeft: 8, color: "#b91c1c", fontSize: 12 }}>(Locked)</span>
        ) : null}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle} cellPadding={0} cellSpacing={0}>
          <thead>
  <tr>
    <th style={th}>Draft Order</th>
    <th style={th}>{isWeekOne ? "College Pick A" : "College Pick"}</th>
    <th style={th}>{isWeekOne ? "College Pick B" : "Pro Pick"}</th>
  </tr>
</thead>
          <tbody>
            {players.map((p) => {
              const wk = (p && p.picks && weekIdLabel && p.picks[weekIdLabel]) || {};
              const col = wk.college;
              const pro = wk.pro;

              return (
                <tr key={p.id}>
                  <td style={td}>
                    <strong>{p.name}</strong>
                  </td>

                  <td
                    style={{ ...td, cursor: locked ? "default" : "pointer", opacity: locked ? 0.7 : 1 }}
                    onClick={() => !locked && onCellClick(p.id, "college")}
                    title={!locked ? "Click to pick" : ""}
                  >
                    {col ? (
                      <>
                        {pickText(col)}
                        {renderBadges(col)}
                      </>
                    ) : (
                      <span style={dash}>—</span>
                    )}
                  </td>

                  <td
                    style={{ ...td, cursor: locked ? "default" : "pointer", opacity: locked ? 0.7 : 1 }}
                    onClick={() => !locked && onCellClick(p.id, "pro")}
                    title={!locked ? "Click to pick" : ""}
                  >
                    {pro ? (
                      <>
                        {pickText(pro)}
                        {renderBadges(pro)}
                      </>
                    ) : (
                      <span style={dash}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
/* ===== Compact Bonus Summary (red when used) ===== */
function BonusSummaryCompact({ players, quarter }) {
  const Chip = ({ label, used }) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 18,
        padding: "0 6px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        background: used ? "#ef4444" : "#e5e7eb",
        color: used ? "white" : "#111827",
        border: used ? "none" : "1px solid #cbd5e1",
        letterSpacing: 0.2,
      }}
      title={used ? "Used" : "Available"}
    >
      {label}
    </span>
  );

  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 10, background: "#fff" }}>
      <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 13 }}>
        Bonus Summary — {quarter} <span style={{ fontSize: 11, color: "#64748b" }}>(red = used)</span>
      </div>

      <div style={{ display: "grid", rowGap: 6 }}>
        {players.map((p) => {
          const usedLOY = !!p.bonusUsage?.LOY;                        // season-wide
          const usedLOQ = !!p.bonusUsage?.LOQ?.[quarter];             // per quarter
          const usedDOG = !!p.bonusUsage?.DOG?.[quarter];             // per quarter
          return (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ display: "inline-flex", gap: 6 }}>
                <Chip label="LOY" used={usedLOY} />
                <Chip label="LOQ" used={usedLOQ} />
                <Chip label="DOG" used={usedDOG} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ================== STYLES ================== **/
const topBar = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 16px",
  background: THEME.bg,
  color: "#e6edf6",
  borderBottom: "1px solid #0d274e",
};
