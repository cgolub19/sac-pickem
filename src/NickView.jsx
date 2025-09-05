// src/NickView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

// ====== External Scores/Odds (The Odds API) ======
const API_BASE =
  process.env.REACT_APP_ODDS_API_BASE || "https://api.the-odds-api.com/v4";
const API_KEY = (process.env.REACT_APP_ODDS_API_KEY || "").trim();

const TZ = "America/Chicago";
const DAYS = ["Thu", "Fri", "Sat", "Sun", "Mon"];
const norm = (s = "") => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

export default function NickView() {
  const [loading, setLoading] = useState(true);
  const [week, setWeek] = useState(null);
  const [picks, setPicks] = useState([]);
  const [feed, setFeed] = useState({ odds: [], scores: [] });
  const [err, setErr] = useState("");

  // ---- 1) Resolve current week (OPEN → else latest) ----
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
    return () => { alive = false; };
  }, []);

  // ---- 2) Load picks for that week ----
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
          .eq("week_id", week.id);

        if (error) throw error;
        if (alive) setPicks(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, [week]);

  // ---- 3) Scores/Odds feed (polling for live) ----
  useEffect(() => {
    if (!API_KEY) return;
    let alive = true;
    let timer = null;

    const load = async () => {
      try {
        const since = 30;
        const urls = [
          `${API_BASE}/sports/americanfootball_ncaaf/scores?daysFrom=${since}&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_nfl/scores?daysFrom=${since}&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_ncaaf/odds?regions=us&markets=spreads&oddsFormat=american&dateFormat=iso&apiKey=${API_KEY}`,
          `${API_BASE}/sports/americanfootball_nfl/odds?regions=us&markets=spreads&oddsFormat=american&dateFormat=iso&apiKey=${API_KEY}`,
        ];
        const res = await Promise.all(urls.map(u => fetch(u)));
        const [scCfb, scNfl, odCfb, odNfl] = await Promise.all(res.map(r => r.json()));

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
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  // ---- 4) Normalize feed items ----
  const allEvents = useMemo(() => {
    const shape = (e) => ({
      home: e.home_team || e.homeTeam,
      away: e.away_team || e.awayTeam,
      commence: e.commence_time || e.start || e.kickoff,
      completed: Boolean(e.completed),
      scores: e.scores || null,
      status: e.status || null,
    });

    const finals = (Array.isArray(feed.scores) ? feed.scores : []).map(shape);
    const odds   = (Array.isArray(feed.odds)   ? feed.odds   : []).map(shape);

    // Prefer finals/live first if we need to choose later
    return [...finals, ...odds];
  }, [feed]);

  // ---- 5) Match an event for a given team inside the week window ----
  const findWeekEvent = (team, wk, espnHome, espnAway, espnCommence) => {
    if (!wk?.start_date || !wk?.end_date) return null;

    const start = new Date(`${wk.start_date}T00:00:00Z`).getTime();
    const end   = new Date(`${wk.end_date}T23:59:59Z`).getTime();
    const tnorm = norm(team);

    const cands = allEvents.filter(ev => {
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
        return Math.abs(new Date(a.commence) - (start + end) / 2) -
               Math.abs(new Date(b.commence) - (start + end) / 2);
      });
      return prioritized[0];
    }

    if (espnHome && espnAway && espnCommence) {
      return {
        home: espnHome,
        away: espnAway,
        commence: espnCommence,
        completed: false,
        scores: null,
      };
    }

    const o = (Array.isArray(feed.odds) ? feed.odds : []).find(e =>
      norm(e.home_team || "") === tnorm || norm(e.away_team || "") === tnorm
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

  // ---- 6) Build a unique list of events from the picks for the current week ----
  const weekEvents = useMemo(() => {
    if (!week) return [];
    const events = [];

    const pushUnique = (ev) => {
      if (!ev?.home || !ev?.away || !ev?.commence) return;
      const key = `${norm(ev.home)}|${norm(ev.away)}|${new Date(ev.commence).toISOString()}`;
      if (!events.find(x => x._key === key)) {
        events.push({ ...ev, _key: key });
      }
    };

    for (const p of picks) {
      if (p.stolen) continue; // ignore voided
      const ev = findWeekEvent(p.team, week, p.espn_home, p.espn_away, p.espn_commence);
      if (ev) pushUnique(ev);
    }

    // Sort by time
    events.sort((a, b) => new Date(a.commence) - new Date(b.commence));
    return events;
  }, [picks, week, allEvents]);

  // ---- 7) Group into Thu/Fri/Sat/Sun/Mon columns (local to America/Chicago) ----
  const grouped = useMemo(() => {
    const by = Object.fromEntries(DAYS.map(d => [d, []]));
    for (const ev of weekEvents) {
      const d = new Date(ev.commence);
      const label = d.toLocaleString("en-US", { weekday: "short", timeZone: TZ });
      const day = DAYS.includes(label) ? label : null;
      if (day) by[day].push(ev);
    }
    // ensure per-day sort (redundant but safe)
    for (const k of DAYS) {
      by[k].sort((a, b) => new Date(a.commence) - new Date(b.commence));
    }
    return by;
  }, [weekEvents]);

  useEffect(() => {
    if (week) setLoading(false);
  }, [week]);

  if (err) return <div style={{ padding: 16, color: "#b91c1c" }}>Error: {String(err)}</div>;
  if (loading) return <div style={{ padding: 16, color: "#1f2937" }}>Loading…</div>;

  return (
    <div
      style={{
        padding: 16,
        background: "#f4f7fb",
        minHeight: "100vh",
        color: "#1f2937",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <header style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0b2a5b" }}>
          Week {week?.number ?? ""} • Schedule
        </div>
        <div style={{ fontSize: 13, color: "#475569" }}>
          {week?.start_date} – {week?.end_date} (Central Time)
        </div>
      </header>

      {/* Five-column calendar */}
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
        }}
      >
        {DAYS.map((day) => (
          <div
            key={day}
            style={{
              background: "#ffffff",
              border: "1px solid #e3e8f3",
              borderRadius: 12,
              boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                fontWeight: 800,
                fontSize: 14,
                color: "#0b2a5b",
                background: "#f6f8fc",
                borderBottom: "1px solid #e7ecf6",
              }}
            >
              {day}
            </div>

            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {grouped[day]?.length ? (
                grouped[day].map((ev) => {
                  const d = new Date(ev.commence);
                  const time = d.toLocaleString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: TZ,
                  });
                  const live = !ev.completed && ev?.scores && Array.isArray(ev.scores);
                  const final = Boolean(ev.completed);

                  const homeScore = ev?.scores?.find?.(s => s.name === "home")?.score ?? null;
                  const awayScore = ev?.scores?.find?.(s => s.name === "away")?.score ?? null;
                  const hasScore = homeScore != null && awayScore != null;

                  return (
                    <div
                      key={ev._key}
                      style={{
                        border: "1px solid #eef2fb",
                        borderRadius: 10,
                        padding: 10,
                        background: "#fff",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#475569", marginBottom: 2 }}>
                        {time}
                      </div>
                      <div style={{ fontWeight: 800, color: "#0b2a5b", lineHeight: 1.2 }}>
                        {ev.away} @ {ev.home}
                      </div>

                      {/* Simple state line */}
                      {hasScore ? (
                        <div style={{ marginTop: 2, fontSize: 13, fontWeight: 700, color: "#0b2a5b" }}>
                          {`${ev.away} ${awayScore} – ${ev.home} ${homeScore}`}
                          {final ? " (Final)" : live ? " (Live)" : ""}
                        </div>
                      ) : (
                        <div style={{ marginTop: 2, fontSize: 12, color: "#64748b" }}>
                          {final ? "Final" : live ? "Live" : "Scheduled"}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div style={{ fontSize: 12, color: "#94a3b8", padding: "6px 2px" }}>
                  No games
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
