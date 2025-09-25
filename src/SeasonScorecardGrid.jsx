import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient";

export default function SeasonScorecardGrid() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [wr, setWR] = useState([]);                // weekly_results
  const [weeksMeta, setWeeksMeta] = useState([]);  // week_schedule
  const [picks, setPicks] = useState([]);          // picks (still used in the per-player detail block)

  // View mode for columns: "overall" | "quarter" | "week"
  const [view, setView] = useState("week");

  // Per-player expand/collapse (detail section under the row)
  const [openPlayers, setOpenPlayers] = useState({});
  const togglePlayer = (p) => setOpenPlayers(prev => ({ ...prev, [p]: !prev[p] }));

  const navigate = useNavigate();
  const WEEKLY_SUMMARY_PATH = "/weekly-summary";
  const navigateToWeek = (wid) => {
    // Query-param style (default):
    navigate(`${WEEKLY_SUMMARY_PATH}?week=${wid}`);

    // If your route is /weekly-summary/:weekId, use this instead:
    // navigate(`${WEEKLY_SUMMARY_PATH}/${wid}`);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true); setErr("");

        const { data: wrRows, error: e2 } = await supabase
          .from("weekly_results")
          .select("user_id, week_id, quarter, week_total");
        if (e2) throw e2;

        const uniqWeeks = Array.from(new Set((wrRows||[]).map(r => r.week_id)));
        const { data: wm, error: e3 } = await supabase
          .from("week_schedule")
          .select("week_id, quarter, label")
          .in("week_id", uniqWeeks.length ? uniqWeeks : [0]);
        if (e3) throw e3;

        const userIds = Array.from(new Set((wrRows||[]).map(r => (r.user_id||""))));
        const { data: px, error: e4 } = await supabase
          .from("picks")
          .select("user_id, week_id, league, team, spread, odds, bonus, pressed")
          .in("week_id", uniqWeeks.length ? uniqWeeks : [0])
          .in("user_id", userIds.length ? userIds : ["-"]);
        if (e4) throw e4;

        if (!alive) return;
        setWR(wrRows || []);
        setWeeksMeta(wm || []);
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

  // ---------- Build structures ----------
  const weekInfo = useMemo(() => {
    const m = {};
    for (const w of weeksMeta || []) m[w.week_id] = { label: w.label, quarter: w.quarter || "Q1" };
    return m;
  }, [weeksMeta]);

  const quarterOrder = useMemo(() => {
    const s = new Set();
    for (const w of weeksMeta || []) s.add(w.quarter || "Q1");
    return Array.from(s).sort();
  }, [weeksMeta]);

  const weeksByQuarter = useMemo(() => {
    const qmap = {};
    for (const q of quarterOrder) qmap[q] = [];
    for (const w of weeksMeta || []) {
      const q = w.quarter || "Q1";
      if (!qmap[q]) qmap[q] = [];
      qmap[q].push(w);
    }
    for (const q of Object.keys(qmap)) {
      qmap[q].sort((a,b) => Number(a.week_id) - Number(b.week_id));
    }
    return qmap;
  }, [weeksMeta, quarterOrder]);

  const pickIndex = useMemo(() => {
    const idx = {};
    for (const pk of picks || []) {
      const key = `${pk.user_id}|${pk.week_id}`;
      (idx[key] ||= []).push(pk);
    }
    return idx;
  }, [picks]);

  // player -> { overall, quarters: { Q1: { total, weeks: { wid: { label, total, picks[] } } } } }
  const byPlayer = useMemo(() => {
    const root = {};
    for (const r of wr || []) {
      const p = String(r.user_id || "");
      const wid = Number(r.week_id);
      const q = r.quarter || weekInfo[wid]?.quarter || "Q1";
      const lab = weekInfo[wid]?.label || `W${wid}`;

      (root[p] ||= { overall: 0, quarters: {} });
      (root[p].quarters[q] ||= { total: 0, weeks: {} });
      const w = (root[p].quarters[q].weeks[wid] ||= { label: lab, total: 0, picks: [] });

      const wt = Number(r.week_total || 0);
      w.total += wt;
      root[p].quarters[q].total += wt;
      root[p].overall += wt;
    }

    // attach picks under each week
    for (const p of Object.keys(root)) {
      for (const q of Object.keys(root[p].quarters)) {
        for (const wid of Object.keys(root[p].quarters[q].weeks)) {
          const key = `${p}|${Number(wid)}`;
          root[p].quarters[q].weeks[wid].picks = pickIndex[key] || [];
        }
      }
    }
    return root;
  }, [wr, weekInfo, pickIndex]);

  // Players sorted by season total (desc)
  const playerOrder = useMemo(() => {
    return Object.keys(byPlayer)
      .sort((a, b) => (byPlayer[b]?.overall || 0) - (byPlayer[a]?.overall || 0));
  }, [byPlayer]);

  // ---------- UI helpers ----------
  const fmtMoney = (n) => {
    const v = Number(n||0);
    const pos = v >= 0;
    const style = { fontWeight: 800, color: pos ? "#15803d" : "#b91c1c" };
    const sign = pos ? "+" : "-";
    return <span style={style}>{sign}${Math.abs(v).toFixed(2)}</span>;
  };

  // ---------- Styles ----------
  const S = {
    wrap: { padding: 10, maxWidth: 1100, margin: "0 auto", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" },
    card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" },
    head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e5e7eb" },
    h1: { margin: 0, fontSize: 18, fontWeight: 900, color: "#0f172a" },
    controls: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
    tabOn: { border: "1px solid #4338ca", background: "#eef2ff", color: "#4338ca", padding: "6px 10px", borderRadius: 8, fontWeight: 800, cursor: "pointer" },
    tabOff: { border: "1px solid #e5e7eb", background: "#fff", color: "#111827", padding: "6px 10px", borderRadius: 8, fontWeight: 700, cursor: "pointer" },

    table: { width: "100%", borderCollapse: "collapse" },
    th: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "#475569", background: "#f8fafc", borderBottom: "1px solid #e5e7eb", padding: "10px 8px", textAlign: "right" },
    thLeft: { textAlign: "left", position: "sticky", left: 0, background: "#f8fafc" },
    td: { borderBottom: "1px solid #f1f5f9", padding: "10px 8px", fontVariantNumeric: "tabular-nums", textAlign: "right" },
    tdLeft: { textAlign: "left", position: "sticky", left: 0, background: "#fff" },

    playerCell: { display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#111827" },
    expandBtn: { border: "1px solid #e5e7eb", width: 24, height: 24, borderRadius: 6, background: "#fff", fontWeight: 900, cursor: "pointer" },

    linkBtn: { background: "transparent", border: "none", padding: 0, margin: 0, cursor: "pointer", font: "inherit" },
    detailWrap: { background: "#fbfdff", borderTop: "1px dashed #e2e8f0" },
    detailRow: { padding: "8px 12px 8px 48px", display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "baseline" },
    detailLabel: { fontWeight: 700, color: "#334155" },
    pick: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace", fontSize: 12, color: "#334155" },
  };

  const tableRef = useRef(null);

  if (loading) return <div style={S.wrap}>Loading…</div>;
  if (err) return <div style={S.wrap}><span style={{color:'#b91c1c'}}>{err}</span></div>;

  // Build dynamic headers
  const headers = [{ key: "player", label: "Player", left: true }];
  if (view === "overall") {
    headers.push({ key: "overall", label: "Overall" });
  } else if (view === "quarter") {
    for (const q of quarterOrder) headers.push({ key: `Q:${q}`, label: q });
    headers.push({ key: "overall", label: "Overall" });
  } else {
    for (const q of quarterOrder) {
      for (const w of weeksByQuarter[q] || []) {
        headers.push({ key: `W:${w.week_id}`, label: w.label });
      }
    }
    headers.push({ key: "overall", label: "Overall" });
  }

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.head}>
          <h3 style={S.h1}>Season Grid</h3>
          <div style={S.controls}>
            <button style={view === "overall" ? S.tabOn : S.tabOff} onClick={() => setView("overall")}>Overall</button>
            <button style={view === "quarter" ? S.tabOn : S.tabOff} onClick={() => setView("quarter")}>Quarter</button>
            <button style={view === "week" ? S.tabOn : S.tabOff} onClick={() => setView("week")}>Week</button>
          </div>
        </div>

        <div ref={tableRef}>
          <table style={S.table}>
            <thead>
              <tr>
                {headers.map(h => (
                  <th key={h.key} style={{ ...S.th, ...(h.left ? S.thLeft : null) }}>{h.label}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {playerOrder.map((p) => {
                const pdata = byPlayer[p] || { overall: 0, quarters: {} };

                const cells = [];
                if (view === "overall") {
                  cells.push(<td key="overall" style={S.td}>{fmtMoney(pdata.overall)}</td>);
                } else if (view === "quarter") {
                  for (const q of quarterOrder) {
                    const qdata = pdata.quarters[q];
                    const val = qdata?.total ?? 0;
                    cells.push(<td key={`Q:${q}`} style={S.td}>{fmtMoney(val)}</td>);
                  }
                  cells.push(<td key="overall" style={S.td}>{fmtMoney(pdata.overall)}</td>);
                } else {
                  // week view with clickable cells → Weekly Summary
                  for (const q of quarterOrder) {
                    for (const w of weeksByQuarter[q] || []) {
                      const wid = Number(w.week_id);
                      const wdata = pdata.quarters?.[q]?.weeks?.[wid];
                      const val = wdata?.total ?? 0;
                      cells.push(
                        <td key={`W:${wid}`} style={S.td}>
                          <button
                            style={S.linkBtn}
                            onClick={() => navigateToWeek(wid)}
                            title={`Go to ${w.label} summary`}
                          >
                            {fmtMoney(val)}
                          </button>
                        </td>
                      );
                    }
                  }
                  cells.push(<td key="overall" style={S.td}>{fmtMoney(pdata.overall)}</td>);
                }

                return (
                  <React.Fragment key={p}>
                    <tr>
                      <td style={{ ...S.td, ...S.tdLeft }}>
                        <div style={S.playerCell}>
                          <button onClick={() => togglePlayer(p)} aria-label="toggle player details" style={S.expandBtn}>
                            {openPlayers[p] ? "–" : "+"}
                          </button>
                          <span>{p}</span>
                        </div>
                      </td>
                      {cells}
                    </tr>

                    {/* Optional: keep a simple detail block below player (weeks & picks) */}
                    {openPlayers[p] && (
                      <tr>
                        <td colSpan={headers.length} style={S.td}>
                          <div style={S.detailWrap}>
                            {Object.keys(pdata.quarters).sort().map((q) => {
                              const qdata = pdata.quarters[q];
                              return (
                                <div key={`${p}|detail|${q}`} style={S.detailRow}>
                                  <div style={S.detailLabel}>{q}</div>
                                  <div>
                                    {Object.entries(qdata.weeks).sort((a,b)=>Number(a[0])-Number(b[0])).map(([wid, w]) => (
                                      <div key={`${p}|${q}|${wid}`} style={{ marginBottom: 8 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                          <span style={{ color: "#475569", fontWeight: 600 }}>{w.label}</span>
                                          <span>{fmtMoney(w.total)}</span>
                                        </div>
                                        {w.picks?.length ? (
                                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                            {w.picks.map((pk, i) => (
                                              <div key={i} style={S.pick}>
                                                <span>
                                                  <strong>{pk.league}</strong>{" · "}
                                                  {pk.team} ({Number(pk.spread ?? 0)})
                                                  {pk.bonus ? " · " + String(pk.bonus).toUpperCase() : ""}
                                                  {pk.pressed ? " · PRESS" : ""}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div style={{ ...S.pick, color: "#94a3b8" }}>No picks recorded</div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
