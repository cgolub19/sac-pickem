// src/pages/WeekSummary.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

/** ====== SCORING CONFIG ====== **/
const MONEY = {
  win: 10,
  loss: -10,
  push: 0,
  bonuses: { quigger: 5, reverseQuigger: 5, sweep: 5, reverseSweep: 5, dog: 5 },
};

/** ====== ENV for live scores ====== **/
const API_BASE = process.env.REACT_APP_ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const API_KEY = process.env.REACT_APP_ODDS_API_KEY; // required for live scores

/** ====== HELPERS ====== **/
const titleCase = (s) => (!s ? "" : s.slice(0, 1).toUpperCase() + s.slice(1));
const DISPLAY_NAME = { joey: "Joey", chris: "Chris", dan: "Dan", nick: "Nick", kevin: "Kevin", aaron: "Aaron" };

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
        .select("id,status")
        .order("id", { ascending: false })
        .limit(1)
        .single();
      if (!w) return;
      setWeek(w);

      const { data: rows } = await supabase
        .from("picks")
        .select("user_id, league, team, spread, odds, bonus, pressed")
        .eq("week_id", w.id);
      setDbPicks(rows || []);
    })();
  }, []);

  // Live scores poll (NCAA + NFL) every 60s
  useEffect(() => {
    if (!API_KEY) {
      setScoresError("Missing REACT_APP_ODDS_API_KEY");
      return;
    }
    let stop = false;
    const fetchScores = async () => {
      try {
        const urls = [
          `${API_BASE}/sports/americanfootball_ncaaf/scores?daysFrom=14&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_nfl/scores?daysFrom=14&dateFormat=iso&apiKey=${API_KEY}`,
        ];
        const [ncaaf, nfl] = await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())));
        const all = [...(Array.isArray(ncaaf) ? ncaaf : []), ...(Array.isArray(nfl) ? nfl : [])];

        // Build { teamName -> meta }
        const idx = {};
        for (const ev of all) {
          const away = ev.away_team || ev.teams?.[0];
          const home = ev.home_team || ev.teams?.[1];
          if (!away || !home) continue;

          // scores array is like [{name:'',score:'24'},{...}]
          const sA = (ev.scores || []).find((s) => s.name === away);
          const sH = (ev.scores || []).find((s) => s.name === home);
          const meta = {
            id: ev.id,
            league: ev.sport_key?.includes("nfl") ? "NFL" : "NCAA",
            away,
            home,
            awayScore: toNum(sA?.score),
            homeScore: toNum(sH?.score),
            commence: ev.commence_time,
            completed: !!ev.completed,
          };
          idx[away] = meta;
          idx[home] = meta;
        }
        if (!stop) {
          setGamesIndex(idx);
          setScoresError(null);
        }
      } catch (e) {
        if (!stop) setScoresError(String(e.message || e));
      }
    };

    fetchScores();
    const t = setInterval(fetchScores, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // Build page picks with real names
 const picks = useMemo(() => {
  const byUser = {};
  for (const r of dbPicks) {
    const id = r.user_id;
    if (!byUser[id]) {
      byUser[id] = {
        player: DISPLAY_NAME[id] || titleCase(id),
        selections: { C1: null, N1: null }, // C1 = first college; N1 = NFL OR second college when no NFL
      };
    }

    // Normalize row -> pick object
    const pickObj = {
      team: r.team,
      line:
        r.spread === null || r.spread === undefined
          ? ""
          : r.spread > 0
          ? `+${r.spread}`
          : `${r.spread}`,
      loy: (r.bonus || "").includes("LOY"),
      loq: (r.bonus || "").includes("LOQ"),
      dog: (r.bonus || "").includes("DOG"),
      press: !!r.pressed,
      league: r.league,
    };

    if (r.league === "NCAA") {
      // First NCAA goes to C1, second NCAA (if present) goes to N1 (Week 1 behavior)
      if (!byUser[id].selections.C1) {
        byUser[id].selections.C1 = pickObj;
      } else if (!byUser[id].selections.N1) {
        byUser[id].selections.N1 = pickObj; // show under the "Pro Pick" column per Week 1 rules
      }
    } else if (r.league === "NFL") {
      byUser[id].selections.N1 = pickObj; // normal weeks
    }
  }

  return Object.values(byUser).sort((a, b) => a.player.localeCompare(b.player));
}, [dbPicks]);


  // Compute rows with live score lookup per team
  const rows = useMemo(() => {
    return picks
      .map((p) => {
        const cPick = p.selections.C1;
        const nPick = p.selections.N1;

        const gC = cPick ? gamesIndex[cPick.team] : null;
        const gN = nPick ? gamesIndex[nPick.team] : null;

        const c = coverageForPick(gC, cPick);
        const n = coverageForPick(gN, nPick);
        const b$ = bonusTotal(p.bonuses);

        return {
          player: p.player,
          college: { meta: gC, pick: cPick, res: c },
          pro:     { meta: gN, pick: nPick, res: n },
          bonuses: p.bonuses,
          total$: c.dollars + n.dollars + b$,
        };
      })
      .sort((a, b) => b.total$ - a.total$);
  }, [picks, gamesIndex]);

  return (
    <div style={page}>
      <div style={pageHeader}>
        <h1 style={title}>SAC Pick’Em</h1>
      </div>

      <div style={container}>
        <h2 style={sectionTitle}>
          Week {week?.id || "—"} Summary {week?.status ? `(${week.status})` : ""}
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

            {/* College */}
            <div style={{ ...th, flex: 3, textAlign: "left" }}>College Pick</div>
            <div style={{ ...th, width: WIDTH_PTS, textAlign: "center" }}>Pts ±</div>
            <div style={{ ...th, width: WIDTH_MNY, textAlign: "center" }}>$ ±</div>

            {/* Pro / Week 1 second college shows here */}
            <div style={{ ...th, flex: 3, textAlign: "left" }}>Pro Pick</div>
            <div style={{ ...th, width: WIDTH_PTS, textAlign: "center" }}>Pts ±</div>
            <div style={{ ...th, width: WIDTH_MNY, textAlign: "center" }}>$ ±</div>

            {/* Bonuses & Total */}
            <div style={{ ...th, flex: 2 }}>Bonuses</div>
            <div style={{ ...th, width: 160, textAlign: "center" }}>Week Total</div>
          </div>

          {/* Rows */}
          {rows.map((r, i) => (
            <div key={r.player} style={{ ...tr, background: i % 2 ? "#ffffff" : "#fafbff" }}>
              <div style={{ ...td, flex: 2, fontWeight: 700 }}>{r.player}</div>

              {/* College */}
              <div style={{ ...td, flex: 3 }}>
                <PickCell meta={r.college.meta} pick={r.college.pick} res={r.college.res} />
              </div>
              <div style={{ ...td, width: WIDTH_PTS, justifyContent: "center" }}>
                <span style={ptsStyle(r.college.res.ok)}>{ptsFmt(r.college.res.pts)}</span>
              </div>
              <div style={{ ...td, width: WIDTH_MNY, justifyContent: "center" }}>
                <span style={moneyStyle(r.college.res.dollars)}>{dollarsFmt(r.college.res.dollars)}</span>
              </div>

              {/* Pro */}
              <div style={{ ...td, flex: 3 }}>
                <PickCell meta={r.pro.meta} pick={r.pro.pick} res={r.pro.res} />
              </div>
              <div style={{ ...td, width: WIDTH_PTS, justifyContent: "center" }}>
                <span style={ptsStyle(r.pro.res.ok)}>{ptsFmt(r.pro.res.pts)}</span>
              </div>
              <div style={{ ...td, width: WIDTH_MNY, justifyContent: "center" }}>
                <span style={moneyStyle(r.pro.res.dollars)}>{dollarsFmt(r.pro.res.dollars)}</span>
              </div>

              {/* Bonuses */}
              <div style={{ ...td, flex: 2 }}>
                <BonusesCell bonuses={r.bonuses} />
              </div>

              {/* Week total */}
              <div style={{ ...td, width: 160, justifyContent: "center" }}>
                <span
                  style={{
                    fontWeight: 900,
                    fontSize: 18,
                    color: r.total$ > 0 ? "#067647" : r.total$ < 0 ? "#b42318" : "#475569",
                  }}
                >
                  {dollarsFmt(r.total$)}
                </span>
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
  const names = bonusNames(bonuses);
  if (!names.length) return <span style={{ color: "#94a3b8" }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {names.map((n) => (
        <div key={n} style={{ fontSize: 13, fontWeight: 600, color: "#3730a3" }}>{n}</div>
      ))}
    </div>
  );
}
