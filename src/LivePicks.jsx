// src/LivePicks.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * LIVE PICKS with Scoreboard Mode
 * - Keeps your current look & layout
 * - Loads OPEN week (else latest) and the week’s picks from Supabase
 * - Resolves matchup/kickoff for every pick
 * - When a game is LIVE/FINAL, replaces the matchup line with a compact scoreboard:
 *     state (e.g., "Q3 04:13", "Halftime", "Final")
 *     Away Team  NN
 *     Home Team  NN
 * - Polls a scores/odds feed every 45s for updates
 *
 * Requires env:
 *   REACT_APP_ODDS_API_KEY = <The Odds API key>
 * Optional:
 *   REACT_APP_ODDS_API_BASE (defaults to https://api.the-odds-api.com/v4)
 */

// ====== External Scores/Odds (The Odds API) ======
const API_BASE =
  process.env.REACT_APP_ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const API_KEY = (process.env.REACT_APP_ODDS_API_KEY || "").trim();

const norm = (s = "") => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

// ===== Display order to match your UI / standings =====
const STANDINGS_ORDER = ["joey", "chris", "dan", "nick", "kevin", "aaron"];

// ===== Badge colors (match your UI) =====
const BADGE_COLORS = {
  DOG: { bg: "#0ea5e9", fg: "#ffffff" },
  LOQ: { bg: "#22c55e", fg: "#ffffff" },
  LOY: { bg: "#f59e0b", fg: "#ffffff" },
  STEAL: { bg: "#ef4444", fg: "#ffffff" },
  PRESSED: { bg: "#f59e0b", fg: "#ffffff" },
};

// ===== Helpers for game state & scoreboard =====
const getGameState = (ev) => {
  if (!ev) return null;
  if (ev.completed) return "Final";

  // Providers vary: status / game_state / time / clock may exist
  const s =
    ev.status || ev.game_state || ev.clock || ev.time || null; // e.g., "Q3 04:13", "Halftime", "In Progress"
  if (s) return s;

  // If kickoff is in the past but we lack a proper string, show "Live"
  if (ev.commence && new Date(ev.commence) <= new Date()) return "Live";
  return null;
};

const Scoreboard = ({ away, awayScore, home, homeScore, state }) => (
  <div style={{ marginTop: 6 }}>
    <div style={{ fontSize: 12, color: "#475569", marginBottom: 2 }}>{state}</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 2 }}>
      <div style={{ color: "#334155" }}>{away}</div>
      <div style={{ fontWeight: 700, color: "#0b2a5b" }}>{awayScore}</div>
      <div style={{ color: "#334155" }}>{home}</div>
      <div style={{ fontWeight: 800, color: "#0b2a5b" }}>{homeScore}</div>
    </div>
  </div>
);

export default function LivePicks() {
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState(null);
  const [picks, setPicks] = useState([]);
  const [feed, setFeed] = useState({ odds: [], scores: [] });
  const [err, setErr] = useState("");

  // ---- 1) Determine current week (OPEN → else latest) ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: open } = await supabase
          .from("weeks")
          .select("id, number, status, start_date, end_date")
          .eq("status", "OPEN")
          .order("number", { ascending: false })
          .limit(1);

        let w = open?.[0];
        if (!w) {
          const { data: last } = await supabase
            .from("weeks")
            .select("id, number, status, start_date, end_date")
            .order("number", { ascending: false })
            .limit(1);
          w = last?.[0] || null;
        }
        if (alive) setWeek(w);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- 2) Load picks for the selected week ----
  useEffect(() => {
    if (!week?.id) return;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("picks")
          .select(`
            user_id,
            week_id,
            league,
            team,
            spread,
            odds,
            bonus,
            pressed,
            steal,
            stolen,
            stolen_by,
            espn_commence,
            espn_home,
            espn_away,
            pick_slot,
            created_at
          `)
          .eq("week_id", week.id)
          .order("user_id", { ascending: true });

        if (error) throw error;
        if (alive) setPicks(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [week]);

  // ---- 3) Scores/Odds feed (poll for live updates) ----
  useEffect(() => {
    if (!API_KEY) return;
    let alive = true;
    let timer = null;

    const load = async () => {
      try {
        const since = 30; // days back for finals
        const urls = [
          `${API_BASE}/sports/americanfootball_ncaaf/scores?daysFrom=${since}&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_nfl/scores?daysFrom=${since}&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_ncaaf/odds?regions=us&markets=spreads&oddsFormat=american&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_nfl/odds?regions=us&markets=spreads&oddsFormat=american&dateFormat=iso&apiKey=${API_KEY}`,
        ];
        const res = await Promise.all(urls.map((u) => fetch(u)));
        const [scCfb, scNfl, odCfb, odNfl] = await Promise.all(res.map((r) => r.json()));
        if (!alive) return;
        setFeed({
          scores: [
            ...(Array.isArray(scCfb) ? scCfb : []),
            ...(Array.isArray(scNfl) ? scNfl : []),
          ],
          odds: [
            ...(Array.isArray(odCfb) ? odCfb : []),
            ...(Array.isArray(odNfl) ? odNfl : []),
          ],
        });
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    };

    load();
    timer = setInterval(load, 45_000);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  // ---- 4) Normalize events from feeds ----
  const allEvents = useMemo(() => {
    const shape = (e) => ({
      home: e.home_team || e.homeTeam,
      away: e.away_team || e.awayTeam,
      commence: e.commence_time || e.start || e.kickoff,
      completed: Boolean(e.completed),
      scores: e.scores || null, // [{name:'home',score:'..'},{name:'away',score:'..'}]
      status: e.status || null, // live/in_progress/halftime/final etc (varies)
      clock: e.clock || e.time || null,
    });

    const finals = (Array.isArray(feed.scores) ? feed.scores : []).map(shape);
    const odds = (Array.isArray(feed.odds) ? feed.odds : []).map(shape);
    return [...finals, ...odds]; // prefer finals/live by order
  }, [feed]);

  // ---- 5) Find the event for a given team inside the current week ----
  const findWeekEvent = (team, wk, espnHome, espnAway, espnCommence) => {
    if (!wk?.start_date || !wk?.end_date) return null;

    const start = new Date(`${wk.start_date}T00:00:00Z`).getTime();
    const end = new Date(`${wk.end_date}T23:59:59Z`).getTime();
    const tnorm = norm(team);

    const cands = allEvents.filter((ev) => {
      if (!ev.home || !ev.away || !ev.commence) return false;
      const t = new Date(ev.commence).getTime();
      if (isNaN(t) || t < start || t > end) return false;
      return norm(ev.home) === tnorm || norm(ev.away) === tnorm;
    });

    if (cands.length) {
      const prioritized = cands.sort((a, b) => {
        const ap = a.completed ? 0 : 1;
        const bp = b.completed ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (
          Math.abs(new Date(a.commence) - (start + end) / 2) -
          Math.abs(new Date(b.commence) - (start + end) / 2)
        );
      });
      return prioritized[0];
    }

    // Fallback 1: ESPN fields saved on the pick
    if (espnHome && espnAway && espnCommence) {
      return {
        home: espnHome,
        away: espnAway,
        commence: espnCommence,
        completed: false,
        scores: null,
      };
    }

    // Fallback 2: nearest upcoming odds event that involves the team
    const o = (Array.isArray(feed.odds) ? feed.odds : []).find(
      (e) => norm(e.home_team || "") === tnorm || norm(e.away_team || "") === tnorm
    );
    return o
      ? {
          home: o.home_team,
          away: o.away_team,
          commence: o.commence_time,
          completed: false,
          scores: null,
        }
      : null;
  };

  // ---- Group picks by user for display ----
  const byUser = useMemo(() => {
    return picks.reduce((acc, p) => {
      const u = p.user_id || "unknown";
      (acc[u] = acc[u] || []).push(p);
      return acc;
    }, {});
  }, [picks]);

  // ---- Loading guard ----
  useEffect(() => {
    if (week && Array.isArray(picks)) setLoading(false);
  }, [week, picks]);

  const Badge = ({ label }) => {
    const key = (label || "").toUpperCase();
    const c = BADGE_COLORS[key] || { bg: "#94a3b8", fg: "#ffffff" };
    return (
      <span
        style={{
          display: "inline-block",
          marginLeft: 8,
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 999,
          background: c.bg,
          color: c.fg,
          fontWeight: 700,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {key}
      </span>
    );
  };

  // ---- Cell renderer with Scoreboard mode ----
  const renderCell = (p) => {
    if (!p) return <span style={{ opacity: 0.5 }}>—</span>;
    if (p.stolen) return <span>—</span>; // hide stolen/voided picks

    const ev = findWeekEvent(p.team, week, p.espn_home, p.espn_away, p.espn_commence);

    // Build matchup + time text (pregame)
    const kickoff = ev?.commence || p?.espn_commence || null;
    const home = ev?.home || p?.espn_home || "";
    const away = ev?.away || p?.espn_away || "";

    const infoText = kickoff
      ? `${new Date(kickoff).toLocaleString([], {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })} • ${home} vs ${away}`
      : "TBD";

    // Scores + state
    const homeScore = ev?.scores?.find?.((s) => s.name === "home")?.score ?? null;
    const awayScore = ev?.scores?.find?.((s) => s.name === "away")?.score ?? null;
    const hasScore = homeScore != null && awayScore != null;
    const state = getGameState(ev); // "Final", "Q2 07:41", "Halftime", "Live"

    const badges = [];
    if (p.bonus) badges.push(String(p.bonus).toUpperCase()); // DOG/LOQ/LOY
    if (p.pressed) badges.push("PRESSED");
    if (p.steal) badges.push("STEAL");

    return (
      <div>
        {/* line 1: pick + badges */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontWeight: 800, color: "#0b2a5b", lineHeight: 1.25 }}>
            {p.team} {p.spread > 0 ? `+${p.spread}` : p.spread}
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            {badges.map((b) => (
              <Badge key={b} label={b} />
            ))}
          </div>
        </div>

        {/* Scoreboard (live/final) OR pregame matchup */}
        {state && hasScore ? (
          <Scoreboard
            away={away}
            awayScore={awayScore}
            home={home}
            homeScore={homeScore}
            state={state}
          />
        ) : (
          <div style={{ color: "#475569", lineHeight: 1.2 }}>{infoText}</div>
        )}
      </div>
    );
  };

  // ===== guards =====
  if (err) return <div style={{ padding: 16, color: "#b91c1c" }}>Error: {String(err)}</div>;
  if (loading) return <div style={{ padding: 16, color: "#1f2937" }}>Loading…</div>;
  if (!picks.length)
    return (
      <div style={{ padding: 16, color: "#1f2937" }}>
        No picks found for week {week?.number ?? ""}.
      </div>
    );

  // ===== UI (unchanged look) =====
  const orderedUsers = Object.entries(byUser).sort(([ua], [ub]) => {
    const ia = STANDINGS_ORDER.indexOf((ua || "").toLowerCase());
    const ib = STANDINGS_ORDER.indexOf((ub || "").toLowerCase());
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return (
    <div
      style={{
        padding: 16,
        background: "#f4f7fb",
        minHeight: "100vh",
        color: "#1f2937",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <header style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0b2a5b" }}>
          Live Picks
        </div>
        <div style={{ fontSize: 13, color: "#475569" }}>
          Week {week?.number ?? ""}
        </div>
      </header>

      <div
        style={{
          width: "100%",
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {orderedUsers.map(([user, list]) => {
          const sorted = [...list].sort((a, b) => {
            const sa = a.pick_slot ?? 99;
            const sb = b.pick_slot ?? 99;
            if (sa !== sb) return sa - sb;
            return new Date(a.created_at) - new Date(b.created_at);
          });
          const pLeft = sorted[0] || null;
          const pRight = sorted[1] || null;

          return (
            <div
              key={user}
              style={{
                width: 560,
                margin: "0 auto",
                background: "#ffffff",
                border: "1px solid #e3e8f3",
                borderRadius: 12,
                boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
              }}
            >
              {/* Name bar */}
              <div
                style={{
                  padding: "10px 14px",
                  fontWeight: 700,
                  fontSize: 14,
                  color: "#0b2a5b",
                  background: "#f6f8fc",
                  borderBottom: "1px solid #e7ecf6",
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                }}
              >
                {user}
              </div>

              {/* Two columns: Pick A / Pick B */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  columnGap: 16,
                  padding: 12,
                  fontSize: 13,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {renderCell(pLeft)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {renderCell(pRight)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
