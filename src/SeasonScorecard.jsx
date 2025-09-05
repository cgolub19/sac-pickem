import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Season Scorecard (condensed, depth-controlled, colored levels)
 * Depth: overall | quarter | week | picks
 * Data: weekly_results (week_total, college_dollars, pro_dollars, bonus_total, bonus_labels),
 *       week_schedule (labels),
 *       picks (detail rows; no per-pick dollars in schema yet)
 */
export default function SeasonScorecard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);          // weekly_results rows
  const [weekMeta, setWeekMeta] = useState({});  // week_id -> { quarter, label }
  const [picks, setPicks] = useState([]);        // picks for played weeks
  const [depth, setDepth] = useState("overall"); // "overall" | "quarter" | "week" | "picks"

  // Fetch snapshots + labels + picks
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        // 1) weekly_results snapshot rows
        const { data: wr, error: e1 } = await supabase
          .from("weekly_results")
          .select("user_id, week_id, quarter, week_total, college_dollars, pro_dollars, bonus_total, bonus_labels");
        if (e1) throw e1;

        if (!wr?.length) {
          if (!alive) return;
          setRows([]); setWeekMeta({}); setPicks([]); setLoading(false);
          return;
        }

        // 2) labels for weeks
        const weekIds = Array.from(new Set(wr.map(r => r.week_id))).sort((a, b) => a - b);
        const { data: ws, error: e2 } = await supabase
          .from("week_schedule")
          .select("week_id, quarter, label")
          .in("week_id", weekIds);
        if (e2) throw e2;

        const meta = {};
        for (const w of ws || []) meta[w.week_id] = { quarter: w.quarter, label: w.label };

        // 3) picks (schema has no per-pick dollars)
        const userIds = Array.from(new Set(wr.map(r => (r.user_id || "").toLowerCase())));
        const { data: px, error: e3 } = await supabase
          .from("picks")
          .select("user_id, week_id, league, team, spread, odds, bonus, pressed")
          .in("week_id", weekIds)
          .in("user_id", userIds);
        if (e3) throw e3;

        if (!alive) return;
        setRows(wr);
        setWeekMeta(meta);
        setPicks(px || []);
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || String(e));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Build: player -> quarter -> week (aggregate money; attach picks, bonuses)
  const tree = useMemo(() => {
    const byPlayer = {};

    const parseLabels = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      try { const j = JSON.parse(val); return Array.isArray(j) ? j : []; } catch { return []; }
    };

    for (const r of rows || []) {
      const pid = (r.user_id || "").toLowerCase();
      const quarter = r.quarter || (weekMeta[r.week_id]?.quarter ?? "Q1");
      const weekAmt = Number(r.week_total || 0);
      const colAmt  = Number(r.college_dollars || 0);
      const proAmt  = Number(r.pro_dollars || 0);
      const bAmt    = Number(r.bonus_total || 0);
      const bLabels = parseLabels(r.bonus_labels);

      if (!byPlayer[pid]) {
        byPlayer[pid] = {
          playerId: pid,
          overall: { dollars: 0 },
          quarters: {}, // quarter -> { dollars, weeks: { week_id -> {...} } }
        };
      }
      if (!byPlayer[pid].quarters[quarter]) {
        byPlayer[pid].quarters[quarter] = { dollars: 0, weeks: {} };
      }

      const q = byPlayer[pid].quarters[quarter];
      const wk = q.weeks[r.week_id] || {
        dollars: 0,
        college_dollars: 0,
        pro_dollars: 0,
        label: weekMeta[r.week_id]?.label || `W${r.week_id}`,
        picks: [],
        bonus_total: 0,
        bonus_labels: [],
      };

      wk.dollars += weekAmt;
      wk.college_dollars += colAmt;
      wk.pro_dollars += proAmt;
      wk.bonus_total += bAmt;
      const set = new Set([...(wk.bonus_labels || []), ...bLabels]);
      wk.bonus_labels = Array.from(set);

      q.weeks[r.week_id] = wk;
      q.dollars += weekAmt;
      byPlayer[pid].overall.dollars += weekAmt;
    }

    // Attach picks per week
    const index = {};
    for (const pk of picks || []) {
      const pid = (pk.user_id || "").toLowerCase();
      const qtr = weekMeta[pk.week_id]?.quarter || "Q1";
      const key = `${pid}|${qtr}|${pk.week_id}`;
      (index[key] ||= []).push(pk);
    }

    const players = Object.values(byPlayer);
    for (const p of players) {
      const qList = Object.entries(p.quarters).map(([qtr, obj]) => {
        const wList = Object.entries(obj.weeks)
          .map(([wid, w]) => ({
            week_id: Number(wid),
            label: w.label,
            dollars: w.dollars,
            college_dollars: w.college_dollars,
            pro_dollars: w.pro_dollars,
            bonus_total: w.bonus_total,
            bonus_labels: w.bonus_labels,
            picks: index[`${p.playerId}|${qtr}|${Number(wid)}`] || [],
          }))
          .sort((a, b) => a.week_id - b.week_id);
        return { quarter: qtr, dollars: obj.dollars, weeks: wList };
      });
      p.quarterList = qList.sort((a, b) => a.quarter.localeCompare(b.quarter));
    }

    players.sort((a, b) => b.overall.dollars - a.overall.dollars);
    return players;
  }, [rows, weekMeta, picks]);

  // Tight, vertical-first styling + level colors
  const wrap  = { padding: 8, maxWidth: 860, margin: "0 auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" };
  const card  = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 6, background: "#fff" };
  const head  = { fontWeight: 800, margin: 0, fontSize: 18 };
  const muted = { fontSize: 12, color: "#6b7280" };

  const lvl = {
    overall: { bg: "#e6efff", font: 14 },
    quarter: { bg: "#eef5ff", font: 13 },
    week:    { bg: "#f5f9ff", font: 12 },
    picks:   { bg: "#ffffff", font: 12 },
  };

  const row = (level) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 6px",
    margin: "2px 0",
    borderRadius: 6,
    background: lvl[level].bg,
    fontSize: lvl[level].font,
    border: level === "picks" ? "1px solid #f1f5f9" : "1px solid transparent",
  });

  const money = (n, level) => {
    const v = Number(n || 0);
    const sz = lvl[level].font + (level === "overall" ? 1 : 0);
    return (
      <span style={{ fontWeight: 700, fontSize: sz, color: v >= 0 ? "#136f3e" : "#b42323" }}>
        {v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}
      </span>
    );
  };

  if (loading) return <div style={wrap}>Loading Season Scorecard…</div>;
  if (err) return <div style={wrap}><div style={{ color: "#b91c1c" }}>{err}</div></div>;
  if (!tree.length) return <div style={wrap}>No completed weeks yet.</div>;

  return (
    <div style={wrap}>
      {/* header with depth dropdown */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <h3 style={head}>Season Scorecard</h3>
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12 }}
        >
          <option value="overall">Overall only</option>
          <option value="quarter">Quarters</option>
          <option value="week">Weeks</option>
          <option value="picks">Picks</option>
        </select>
      </div>
      <div style={muted}>Compact layout. Dollars appear inline; week shows College/Pro split and Bonuses.</div>

      <div style={{ marginTop: 6, ...card }}>
        {/* header */}
        <div style={{ ...row("picks"), background: "#fafafa", border: "1px solid #f1f5f9", fontWeight: 700, color: "#475569" }}>
          <div>Player / Quarter / Week / Pick</div>
          <div>Dollars</div>
        </div>

        {tree.map((p) => (
          <div key={p.playerId} style={{ paddingTop: 2 }}>
            {/* OVERALL */}
            <div style={row("overall")}>
              <div style={{ fontWeight: 700, textTransform: "lowercase" }}>{p.playerId}</div>
              <div>{money(p.overall.dollars, "overall")}</div>
            </div>

            {/* QUARTERS */}
            {depth !== "overall" && (
              <div style={{ marginLeft: 8 }}>
                {p.quarterList.map((q) => (
                  <div key={`${p.playerId}-${q.quarter}`} style={{ margin: "2px 0" }}>
                    <div style={row("quarter")}>
                      <div>↳ {q.quarter}</div>
                      <div>{money(q.dollars, "quarter")}</div>
                    </div>

                    {/* WEEKS */}
                    {depth !== "quarter" && (
                      <div style={{ marginLeft: 10 }}>
                        {q.weeks.map((w) => (
                          <div key={`${p.playerId}-${q.quarter}-${w.week_id}`} style={{ margin: "2px 0" }}>
                            <div style={row("week")}>
                              <div>↳ {q.quarter}-{w.label}</div>
                              <div>{money(w.dollars, "week")}</div>
                            </div>

                            {/* Week split: College / Pro */}
                            <div style={{ marginLeft: 10 }}>
                              <div style={row("picks")}>
                                <div style={{ color: "#475569" }}>College $</div>
                                <div>{money(w.college_dollars, "picks")}</div>
                              </div>
                              <div style={row("picks")}>
                                <div style={{ color: "#475569" }}>Pro $</div>
                                <div>{money(w.pro_dollars, "picks")}</div>
                              </div>
                            </div>

                            {/* Week bonuses row */}
                            {(w.bonus_total || 0) !== 0 || (w.bonus_labels?.length || 0) > 0 ? (
                              <div style={{ ...row("picks"), marginLeft: 10, background: "#fcfdff" }}>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <strong style={{ color: "#475569", fontSize: 12 }}>Bonuses:</strong>
                                  {(w.bonus_labels || []).map((b, i) => (
                                    <span key={i} style={{
                                      fontSize: 11,
                                      padding: "1px 6px",
                                      borderRadius: 999,
                                      border: "1px solid #dbeafe",
                                      background: "#eff6ff",
                                      color: "#475569"
                                    }}>
                                      {String(b)}
                                    </span>
                                  ))}
                                </div>
                                <div>{money(w.bonus_total, "picks")}</div>
                              </div>
                            ) : null}

                            {/* PICKS */}
                            {depth === "picks" && (
                              <div style={{ marginLeft: 10 }}>
                                {(w.picks || []).map((pk, i) => (
                                  <div key={i} style={row("picks")}>
                                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                      <span>{pk.league || "—"} — {pk.team || "—"}</span>
                                      <span style={{ fontSize: 12, color: "#475569" }}>
                                        {Number(pk.spread ?? 0)} / {pk.odds ?? "—"}
                                      </span>
                                      {pk.bonus ? (
                                        <span style={{
                                          fontSize: 11,
                                          padding: "1px 6px",
                                          borderRadius: 999,
                                          border: "1px solid #dbeafe",
                                          background: "#eff6ff",
                                          color: "#1d4ed8"
                                        }}>
                                          {(String(pk.bonus)).toUpperCase()}
                                        </span>
                                      ) : null}
                                      {pk.pressed ? (
                                        <span style={{
                                          fontSize: 11,
                                          padding: "1px 6px",
                                          borderRadius: 999,
                                          border: "1px solid #fee2e2",
                                          background: "#fef2f2",
                                          color: "#b91c1c"
                                        }}>
                                          PRESS
                                        </span>
                                      ) : null}
                                    </div>
                                    {/* Per-pick dollars not stored in schema yet */}
                                    <div style={{ color: "#94a3b8", fontSize: 12 }}>—</div>
                                  </div>
                                ))}
                                {!w.picks?.length && (
                                  <div style={{ ...row("picks"), background: "#ffffff" }}>
                                    <div style={{ color: "#6b7280" }}>No picks recorded.</div>
                                    <div />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
