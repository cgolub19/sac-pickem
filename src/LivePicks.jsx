// src/LivePicks.jsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient"; // <-- adjust path if needed

/***********************
 * Utils / helpers
 ***********************/
const norm = (s = "") =>
  s.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const ymd = d => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

const espnLeaguePath = league =>
  league === "NFL" ? "football/nfl" : "football/college-football";

const fmtKick = d =>
  d
    ? d.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

/** which side of game is this pick choosing? */
// More tolerant side detection (handles "State" vs "St.", punctuation, partials)
const pickSide = (pickTeam, game) => {
  const alias = s =>
    s
      .replace(/\bstate\b/g, "st")
      .replace(/\bst\b/g, "state")
      .replace(/\bsaint\b/g, "st")
      .replace(/\bst\./g, "saint");

  const np = alias(norm(pickTeam || ""));
  const nh = alias(norm(game?.home || ""));
  const na = alias(norm(game?.away || ""));

  // exact
  if (np === nh) return "home";
  if (np === na) return "away";

  // contains / contained-in (helps with “Georgia State” vs “Georgia St”)
  if (nh.includes(np) || np.includes(nh)) return "home";
  if (na.includes(np) || np.includes(na)) return "away";

  return null;
};


/** live ATS differential: (pickScore - oppScore) + spread */
const liveATS = (pick, game) => {
  const side = pickSide(pick?.team, game);
  if (!side) return null;
  const ps = side === "home" ? Number(game?.homeScore ?? NaN) : Number(game?.awayScore ?? NaN);
  const os = side === "home" ? Number(game?.awayScore ?? NaN) : Number(game?.homeScore ?? NaN);
  if (!Number.isFinite(ps) || !Number.isFinite(os)) return null;
  const spread = Number(pick?.spread || 0);
  return (ps - os) + spread;
};

const statusLabel = g => {
  if (!g) return "";
  const st = g.statusText;
  if (st) return st;
  if (g.completed) return "Final";
  if (g.started) return "Live";
  return "Scheduled";
};

/***********************
 * ESPN fetch (no API key)
 ***********************/
async function fetchGamesForLeague({ league, start, end }) {
  // ESPN supports date ranges: ?dates=YYYYMMDD-YYYYMMDD
  const dates = `${ymd(start)}-${ymd(end)}`;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnLeaguePath(
    league
  )}/scoreboard?dates=${dates}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`espn feed error: ${res.status}`);
  const json = await res.json();
  const events = json?.events || [];

  return events.map(ev => {
    const comp = ev?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find(c => c.homeAway === "home");
    const away = competitors.find(c => c.homeAway === "away");

    const fmtTeam = c => ({
      name: c?.team?.name || "",
      abbr: c?.team?.abbreviation || "",
      short: c?.team?.shortDisplayName || "",
      logo: c?.team?.logo || c?.team?.logos?.[0]?.href || "",
      rank: c?.curatedRank?.current ?? null,
      record: c?.records?.[0]?.summary || null,
      score: c?.score != null ? Number(c.score) : null,
    });

    const H = fmtTeam(home || {});
    const A = fmtTeam(away || {});

    const t = comp?.status?.type || {};
    const started = t.state === "in";
    const completed = t.state === "post";
    const statusText =
      comp?.status?.type?.shortDetail ||
      comp?.status?.type?.description ||
      ev?.status?.type?.shortDetail ||
      null;

    const network =
      comp?.broadcasts?.[0]?.names?.[0] ||
      comp?.broadcasts?.[0]?.shortName ||
      null;

    const kickoff = comp?.date ? new Date(comp.date) : null;

    return {
      id: String(ev?.id || comp?.id || ""),
      commence: kickoff,
      home: H.name,
      away: A.name,
      homeScore: H.score,
      awayScore: A.score,
      started,
      completed,
      statusText,
      league,
      // extras for a nicer bug
      homeAbbr: H.abbr || H.short,
      awayAbbr: A.abbr || A.short,
      homeLogo: H.logo,
      awayLogo: A.logo,
      homeRank: H.rank,
      awayRank: A.rank,
      homeRecord: H.record,
      awayRecord: A.record,
      network,
    };
  });
}

function indexGames(games) {
  const byId = new Map();
  const list = [];
  for (const g of games) {
    list.push(g);
    if (g.id) byId.set(g.id, g);
  }
  return { byId, list };
}

function findGameForPick(pick, idx) {
  if (!idx) return null;
  // prefer id if present (future-proof if picks carry espn_event_id)
  if (pick.espn_event_id) {
    const g = idx.byId.get(String(pick.espn_event_id));
    if (g) return g;
  }
  // otherwise match by normalized team within same league
  for (const g of idx.list) {
    if (g.league !== pick.league) continue;
    if (pickSide(pick.team, g)) return g;
  }
  return null;
}

/***********************
 * Cards / UI
 ***********************/
const Chip = ({ children, color = "#6b7280" }) => (
  <span
    style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      background: `${color}22`,
      color,
    }}
  >
    {children}
  </span>
);

const BonusBadges = ({ pick }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {pick?.bonus?.includes("LOY") && <Chip>LOY</Chip>}
    {pick?.bonus?.includes("LOQ") && <Chip>LOQ</Chip>}
    {pick?.bonus?.includes("DOG") && <Chip>DOG</Chip>}
    {pick?.pressed && <Chip>Pressed</Chip>}
    {pick?.steal && <Chip>Steal</Chip>}
  </div>
);

const ScoreBug = ({ game }) => {
  if (!game) return <span style={{ color: "#6b7280" }}>No game found</span>;
  const status = statusLabel(game);
  const kick = game.commence ? fmtKick(game.commence) : "";

  return (
    <div className="bug">
      <div className="team">
        {game.homeLogo && <img src={game.homeLogo} alt="" />}
        <div className="meta">
          <div className="line1">
            {game.homeRank ? <span className="rank">{game.homeRank}</span> : null}
            <strong className="abbr">{game.homeAbbr || game.home}</strong>
            <strong className="score">{game.homeScore ?? "-"}</strong>
          </div>
          <div className="rec">{game.homeRecord || ""}</div>
        </div>
      </div>

      <div className="middle">
        <div className="status">{status}</div>
        <div className="net">{[kick, game.network].filter(Boolean).join(" • ")}</div>
      </div>

      <div className="team">
        {game.awayLogo && <img src={game.awayLogo} alt="" />}
        <div className="meta">
          <div className="line1">
            {game.awayRank ? <span className="rank">{game.awayRank}</span> : null}
            <strong className="abbr">{game.awayAbbr || game.away}</strong>
            <strong className="score">{game.awayScore ?? "-"}</strong>
          </div>
          <div className="rec">{game.awayRecord || ""}</div>
        </div>
      </div>
    </div>
  );
};

function PickCard({ pick, game }) {
    console.log("[LivePicks] PickCard v3 ->", pick?.team);

  if (!pick) return <div className="card empty">—</div>;

  // live ATS differential
  const ats = game ? liveATS(pick, game) : null;
  const atsNum =
    ats == null ? null : Math.round((Number(ats) + Number.EPSILON) * 10) / 10;

  const atsText =
    atsNum == null
      ? ""
      : atsNum > 0
      ? `Covering by +${atsNum}`
      : atsNum < 0
      ? `Short by ${Math.abs(atsNum)}`
      : "Push";

  // light transparent tints
  const bg =
    atsNum == null
      ? "rgba(255,255,255,1)"
      : atsNum > 0
      ? "rgba(16,185,129,0.08)"   // green
      : atsNum < 0
      ? "rgba(239,68,68,0.08)"    // red
      : "rgba(107,114,128,0.08)"; // gray

  const border =
    atsNum == null
      ? "#e5e7eb"
      : atsNum > 0
      ? "#10b981"
      : atsNum < 0
      ? "#ef4444"
      : "#9ca3af";

  return (
    <div className="card" style={{ background: bg, borderColor: border }}>
      <div className="pick-line">
        <strong>{pick.team}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="spread">
            {pick.spread > 0 ? `+${pick.spread}` : pick.spread}
          </span>
          {atsNum != null && (
            <span
              className="ats-pill"
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                color:
                  atsNum > 0
                    ? "#065f46"
                    : atsNum < 0
                    ? "#7f1d1d"
                    : "#374151",
                background:
                  atsNum > 0
                    ? "rgba(16,185,129,0.18)"
                    : atsNum < 0
                    ? "rgba(239,68,68,0.18)"
                    : "rgba(107,114,128,0.18)",
              }}
              title="ATS differential right now"
            >
              {atsText}
            </span>
          )}
        </div>
      </div>

      <div className="score-bug">
        <ScoreBug game={game} />
      </div>

      <div className="meta">
        <BonusBadges pick={pick} />
      </div>
    </div>
  );
}



/***********************
 * Page
 ***********************/
const STANDINGS_ORDER = ["joey", "chris", "dan", "nick", "kevin", "aaron"]; // adjust if needed

export default function LivePicks() {
  const [week, setWeek] = useState(null);
  const [picks, setPicks] = useState([]);
  const [gamesIndex, setGamesIndex] = useState(null);
  const [windowRange, setWindowRange] = useState(null);
  const [error, setError] = useState("");

  // load current OPEN week (fallback latest) + picks
  useEffect(() => {
    let cleanup;
    (async () => {
      setError("");
      // 1) week (auto-advance to NEXT week every Thursday morning)
const baseSel = "id, number, status, start_date, end_date";

// get current (OPEN else latest)
let { data: wk } = await supabase
  .from("weeks")
  .select(baseSel)
  .eq("status", "OPEN")
  .order("id", { ascending: false })
  .limit(1)
  .maybeSingle();

if (!wk) {
  const r = await supabase
    .from("weeks")
    .select(baseSel)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  wk = r.data || null;
}
if (!wk) {
  setError("No week found.");
  return;
}

// if it's Thursday morning (local time), advance to the next week (if any)
const now = new Date();
const THURSDAY = 4;   // 0=Sun, 4=Thu
const SWITCH_HOUR = 6; // after 06:00 local
const isThursdayMorning = now.getDay() === THURSDAY && now.getHours() >= SWITCH_HOUR;

if (isThursdayMorning) {
  const nextRes = await supabase
    .from("weeks")
    .select(baseSel)
    .gt("id", wk.id)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextRes.data) wk = nextRes.data;
}

setWeek(wk);


      // 2) window (start-3d .. end+3d) or derive from game_scores if present
      let start = new Date(new Date(wk.start_date).getTime() - 3 * 86400000);
      let end = new Date(new Date(wk.end_date).getTime() + 3 * 86400000);
      const gs = await supabase
        .from("game_scores")
        .select("commence")
        .eq("week_id", wk.id)
        .not("commence", "is", null);
      if (gs.data?.length) {
        const ts = gs.data.map(r => new Date(r.commence).getTime());
        start = new Date(Math.min(...ts) - 86400000);
        end = new Date(Math.max(...ts) + 86400000);
      }
      setWindowRange({ start, end });

      // 3) picks
      const { data: pk } = await supabase
        .from("picks")
        .select("user_id, week_id, league, team, spread, odds, bonus, pressed, steal, espn_event_id")
        .eq("week_id", wk.id);
      setPicks(pk || []);

      // 4) realtime subscription to picks for this week
      const channel = supabase
        .channel(`picks-week-${wk.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "picks", filter: `week_id=eq.${wk.id}` },
          async () => {
            const { data: fresh } = await supabase
              .from("picks")
              .select("user_id, week_id, league, team, spread, odds, bonus, pressed, steal, espn_event_id")
              .eq("week_id", wk.id);
            setPicks(fresh || []);
          }
        )
        .subscribe();
      cleanup = () => {
        try {
          supabase.removeChannel(channel);
        } catch {}
      };
    })();
    return () => cleanup && cleanup();
  }, []);

  // poll ESPN for this window
  useEffect(() => {
    if (!week || !windowRange) return;
    let alive = true;

    const tick = async () => {
  try {
    // NFL: last 8 days up to now (most recent completed NFL week)
    const MS_DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const nflEnd = now;
    const nflStart = new Date(now.getTime() - 8 * MS_DAY);

    // NCAA: current window
    const [nfl, ncaaf] = await Promise.all([
      fetchGamesForLeague({ league: "NFL",  start: nflStart, end: nflEnd }),
      fetchGamesForLeague({ league: "NCAA", start: windowRange.start, end: windowRange.end }),
    ]);

    if (!alive) return;
    setGamesIndex(indexGames([...nfl, ...ncaaf]));
  } catch (e) {
    if (!alive) return;
    console.warn("Live feed error", e);
    setError("Live feed unavailable. Retrying…");
  }
};


    tick(); // initial
    const fast = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(fast);
    };
  }, [week?.id, windowRange?.start, windowRange?.end]);

  // rows by player in your order
  const rows = useMemo(() => {
    const byUser = new Map();
    for (const p of picks) {
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
      byUser.get(p.user_id).push(p);
    }
    const orderedUsers = [
      ...STANDINGS_ORDER.filter(u => byUser.has(u)),
      ...Array.from(byUser.keys()).filter(u => !STANDINGS_ORDER.includes(u)).sort(),
    ];
    return orderedUsers.map(u => ({ user: u, picks: byUser.get(u) || [] }));
  }, [picks]);

  return (
    <div className="live-wrap">
      <header className="hdr">
        <h1>Live Picks {week ? `(Week ${week.number || week.id})` : ""}</h1>
        {error && <div className="err">{error}</div>}
      </header>

      <div className="legend">
        <div>College</div>
        <div>Pro</div>
      </div>

      <div className="board">
        {rows.map(r => {
          const college = (r.picks || []).find(p => p.league === "NCAA");
          const pro = (r.picks || []).find(p => p.league === "NFL");
          const gC = college ? findGameForPick(college, gamesIndex) : null;
          const gP = pro ? findGameForPick(pro, gamesIndex) : null;

          return (
            <div className="row" key={r.user}>
              <div className="player">{r.user}</div>
              <PickCard pick={college} game={gC} />
              <PickCard pick={pro} game={gP} />
            </div>
          );
        })}
      </div>

      <style>{`
        .live-wrap { padding: 12px; max-width: 980px; margin: 0 auto; }
        .hdr { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        h1 { font-size: 20px; margin: 0 0 6px; }
        .err { font-size:12px; color:#b91c1c; }
        .legend { display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin:10px 0; color:#6b7280; font-weight:600; }
        .board { display:flex; flex-direction:column; gap:8px; }
        .row { display:grid; grid-template-columns: 120px 1fr 1fr; gap:8px; align-items:stretch; }
        .player { display:flex; align-items:center; font-weight:700; }
        .card { border:1px solid #e5e7eb; border-radius:12px; padding:10px; display:flex; flex-direction:column; gap:10px; background:#fff; transition: border-color .2s, background .2s; }
        .card.empty { color:#9ca3af; display:flex; align-items:center; justify-content:center; }
        .pick-line { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .spread { color:#6b7280; font-weight:600; }
        .score-bug { font-size:14px; }
        .meta { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }

        /* ESPN-like bug */
        .bug { display:grid; grid-template-columns: 1fr auto 1fr; gap:8px; align-items:center; }
        .bug .team { display:flex; align-items:center; gap:8px; }
        .bug img { width:22px; height:22px; object-fit:contain; }
        .bug .meta { display:flex; flex-direction:column; gap:2px; }
        .bug .line1 { display:flex; align-items:center; gap:8px; }
        .bug .rank { font-size:11px; padding:0 6px; border-radius:999px; background:#111827; color:#fff; }
        .bug .abbr { letter-spacing:.3px; }
        .bug .score { font-size:16px; }
        .bug .rec { font-size:11px; color:#6b7280; }
        .bug .middle { text-align:center; }
        .bug .status { font-size:12px; color:#374151; }
        .bug .net { font-size:11px; color:#6b7280; }

        @media (max-width: 640px) {
          .legend { display:none; }
          .row { grid-template-columns: 1fr; }
          .player { font-size:14px; }
          .row > .player { order: 0; }
          .row > .card:nth-child(2) { order: 1; } /* College */
          .row > .card:nth-child(3) { order: 2; } /* Pro */
        }
      `}</style>
    </div>
  );
}
