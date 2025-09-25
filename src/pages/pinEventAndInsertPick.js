// src/lib/pinEventAndInsertPick.js
// Drop-in helper: resolves ESPN event_id for a pick (sport-aware), then INSERTS the pick with that ID.
// Usage example (next step): await pinEventAndInsertPick(supabase, { week_id, user_id, league, slot, team, spread, bonus, pressed });

/* ---------------- text normalize & similarity ---------------- */
const _strip = (s = "") =>
  s.normalize("NFKD")
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

const normalize = (s = "") => {
  const t = _expand(_strip(s));
  return t
    .split(" ")
    .map((w) => (w.length > 4 && !/ss$/.test(w) ? w.replace(/s$/, "") : w))
    .join(" ")
    .trim();
};

const tokens = (s = "") => normalize(s).split(" ").filter(Boolean);
const tokenSet = (s = "") => new Set(tokens(s));
const sim = (a, b) => {
  const A = tokenSet(a),
    B = tokenSet(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter || 1;
  const jac = inter / uni;
  const La = normalize(a),
    Lb = normalize(b);
  const m = Math.max(La.length, Lb.length) || 1;
  // quick char diff (cheap Levenshtein-ish)
  let diff = 0;
  for (let i = 0; i < Math.min(La.length, Lb.length); i++) if (La[i] !== Lb[i]) diff++;
  diff += Math.abs(La.length - Lb.length);
  const lev = 1 - diff / m;
  return 0.6 * jac + 0.4 * lev;
};

const dateKey = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
};

const pickSport = (p) => {
  const s = String(p?.league || "").toLowerCase();
  if (/nfl/.test(s) || p?.slot === "pro" || p?.pick_slot === 2) return "nfl";
  return "cfb";
};

/* ---------------- ESPN fetching ---------------- */
async function fetchSummary(sport, eventId) {
  const bases = ["apis/site/v2", "apis/v2"];
  for (const base of bases) {
    const url = `https://site.api.espn.com/${base}/sports/football/${sport}/summary?event=${eventId}`;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const comp = j?.header?.competitions?.[0] || j?.competitions?.[0] || {};
      const cs = comp?.competitors || [];
      const away = cs.find((c) => c.homeAway === "away");
      const home = cs.find((c) => c.homeAway === "home");
      if (!away || !home) continue;
      return {
        id: String(eventId),
        away: away?.team?.displayName || away?.team?.name || "",
        home: home?.team?.displayName || home?.team?.name || "",
        awayScore: Number(away?.score ?? NaN),
        homeScore: Number(home?.score ?? NaN),
        commence: comp?.date || j?.gameInfo?.game?.date || j?.header?.competitions?.[0]?.date || null,
        completed: !!(comp?.status?.type?.completed),
      };
    } catch {}
  }
  return null;
}

async function fetchScoreboards(sport, days) {
  const urls = days.map(
    (d) => `https://site.api.espn.com/apis/site/v2/sports/football/${sport}/scoreboard?dates=${d}`
  );
  const out = [];
  const js = await Promise.all(
    urls.map((u) =>
      fetch(u, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )
  );
  for (const j of js) {
    if (!j || !Array.isArray(j.events)) continue;
    const sportTag =
      j.leagues?.[0]?.abbreviation?.toLowerCase() === "nfl" ? "nfl" : "college-football";
    for (const ev of j.events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const away = comp.competitors?.find((c) => c.homeAway === "away");
      const home = comp.competitors?.find((c) => c.homeAway === "home");
      if (!away || !home) continue;
      out.push({
        id: String(ev.id),
        sport: sportTag,
        away: away?.team?.displayName || away?.team?.name || "",
        home: home?.team?.displayName || home?.team?.name || "",
        awayScore: Number(away?.score ?? NaN),
        homeScore: Number(home?.score ?? NaN),
        commence: ev.date || comp.date || null,
      });
    }
  }
  // filter to requested sport
  return out.filter((m) => (sport === "nfl" ? m.sport === "nfl" : m.sport !== "nfl"));
}

/* ---------------- resolver: find ESPN event id once ---------------- */
async function resolveEspnEventId({ pick, weekMeta }) {
  if (pick?.espn_event_id) return String(pick.espn_event_id);

  const sport = pickSport(pick);
  const tNorm = normalize(pick.team || "");

  // Build dates to search: prefer pick.espn_commence day; otherwise week window ±3 days
  let days = [];
  if (pick?.espn_commence) {
    const dk = dateKey(pick.espn_commence).replace(/-/g, "");
    days = [dk];
  } else if (weekMeta?.start_date && weekMeta?.end_date) {
    const start = new Date(weekMeta.start_date);
    const end = new Date(weekMeta.end_date);
    start.setDate(start.getDate() - 3);
    end.setDate(end.getDate() + 3);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear(),
        m = String(d.getMonth() + 1).padStart(2, "0"),
        dd = String(d.getDate()).padStart(2, "0");
      days.push(`${y}${m}${dd}`);
    }
  } else {
    // fallback to today
    const d = new Date();
    const y = d.getFullYear(),
      m = String(d.getMonth() + 1).padStart(2, "0"),
      dd = String(d.getDate()).padStart(2, "0");
    days = [`${y}${m}${dd}`];
  }

  const metas = await fetchScoreboards(sport === "cfb" ? "college-football" : "nfl", days);

  // Choose best by token overlap (≥2) or high similarity
  let best = null;
  let bestScore = -1;
  const pickTokens = tokenSet(pick.team || "");
  const insideWeek = (meta) => {
    if (!weekMeta?.start_date || !weekMeta?.end_date || !meta?.commence) return 0;
    const t = new Date(meta.commence).getTime();
    return t >= new Date(weekMeta.start_date).getTime() &&
      t <= new Date(weekMeta.end_date).getTime()
      ? 0.1
      : 0;
  };
  for (const m of metas) {
    const homeT = tokenSet(m.home || "");
    const awayT = tokenSet(m.away || "");
    const interHome = [...pickTokens].filter((x) => homeT.has(x)).length;
    const interAway = [...pickTokens].filter((x) => awayT.has(x)).length;
    const interMax = Math.max(interHome, interAway);
    const s = Math.max(sim(pick.team || "", m.home || ""), sim(pick.team || "", m.away || ""));
    const ok = interMax >= 2 || s >= 0.82;
    if (!ok) continue;
    const score = s + insideWeek(m);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  if (best && bestScore >= 0.65) return best.id;
  return null;
}

/* ---------------- main export ---------------- */
/**
 * pinEventAndInsertPick(supabase, pickInput)
 * - Resolves ESPN event_id once, enriches with summary fields (espn_home/away/commence), INSERTS into "picks".
 * - Returns { inserted, resolvedEventId }.
 *
 * Required pickInput fields:
 *   week_id, user_id, league, slot OR pick_slot, team
 * Optional:
 *   spread, bonus, pressed, espn_event_id, espn_home, espn_away, espn_commence
 */
export async function pinEventAndInsertPick(supabase, pickInput) {
  if (!supabase) throw new Error("supabase client is required");
  if (!pickInput?.week_id) throw new Error("pickInput.week_id is required");
  if (!pickInput?.user_id) throw new Error("pickInput.user_id is required");
  if (!pickInput?.team) throw new Error("pickInput.team is required");

  // Grab week dates for better matching
  const { data: week } = await supabase
    .from("week_schedule")
    .select("week_id,label,start_date,end_date")
    .eq("week_id", pickInput.week_id)
    .single();

  // Resolve event id if missing
  let resolvedEventId = pickInput.espn_event_id ? String(pickInput.espn_event_id) : null;
  if (!resolvedEventId) {
    resolvedEventId = await resolveEspnEventId({
      pick: pickInput,
      weekMeta: week || null,
    });
  }

  // If we have an id, fetch summary once to enrich fields
  let enrich = null;
  if (resolvedEventId) {
    const sport = pickSport(pickInput) === "cfb" ? "college-football" : "nfl";
    enrich = await fetchSummary(sport, resolvedEventId);
  }

  const insertRow = {
    ...pickInput,
    espn_event_id: resolvedEventId || null,
    espn_home: enrich?.home || pickInput.espn_home || null,
    espn_away: enrich?.away || pickInput.espn_away || null,
    espn_commence: enrich?.commence || pickInput.espn_commence || null,
  };

  // Insert the pick
  const { data: inserted, error } = await supabase
    .from("picks")
    .insert([insertRow])
    .select()
    .single();

  if (error) throw error;

  return { inserted, resolvedEventId };
}
