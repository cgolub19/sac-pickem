import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

/** Pivot-style Season Scorecard (players as columns) — v0
 * Shows: header with player columns + one “Overall $” row.
 * Next steps will add rows for Quarter/Week and +/- expanders.
 */
export default function SeasonScorecardGrid() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true); setErr("");

        // pull weekly snapshots (week_total is your $ for the week)
        const { data: wr, error } = await supabase
          .from("weekly_results")
          .select("user_id, week_total");
        if (error) throw error;

        if (!alive) return;
        setRows(wr || []);
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || String(e));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const { players, totals } = useMemo(() => {
    const byPlayer = {};
    for (const r of rows || []) {
      const p = (r.user_id || "").toLowerCase();
      byPlayer[p] = (byPlayer[p] || 0) + Number(r.week_total || 0);
    }
    const names = Object.keys(byPlayer).sort((a, b) => byPlayer[b] - byPlayer[a]); // sort by $ desc
    return { players: names, totals: byPlayer };
  }, [rows]);

  const wrap  = { padding: 8, maxWidth: 980, margin: "0 auto", fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" };
  const table = { border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" };
  const head  = { position: "sticky", top: 0, background: "#f8fafc", borderBottom: "1px solid #e5e7eb", fontWeight: 700, fontSize: 13 };
  const row   = { display: "grid", gridTemplateColumns: `220px repeat(${players.length}, minmax(80px,1fr))`, alignItems: "center" };
  const cellH = { padding: "6px 8px", borderRight: "1px solid #e5e7eb", color: "#475569", whiteSpace: "nowrap" };
  const cell  = { padding: "6px 8px", borderRight: "1px solid #f1f5f9", fontSize: 13 };
  const first = { fontWeight: 600, background: "#eef5ff" };
  const money = (n) => {
    const v = Number(n || 0);
    const pos = v >= 0;
    return <span style={{ fontWeight: 700, color: pos ? "#136f3e" : "#b42323" }}>{pos?"+":"-"}${Math.abs(v).toFixed(2)}</span>;
  };

  if (loading) return <div style={wrap}>Loading…</div>;
  if (err) return <div style={wrap}><span style={{color:"#b91c1c"}}>{err}</span></div>;
  if (!players.length) return <div style={wrap}>No completed weeks yet.</div>;

  return (
    <div style={wrap}>
      <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800 }}>Season Scorecard — Grid</h3>

      <div style={table}>
        {/* header */}
        <div style={{ ...row, ...head }}>
          <div style={{ ...cellH, borderRight: "1px solid #e5e7eb" }}>Metric</div>
          {players.map((p) => (
            <div key={p} style={cellH}>{p}</div>
          ))}
        </div>

        {/* Overall $ row (first real row) */}
        <div style={{ ...row, borderTop: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ ...cell, ...first }}>Overall $</div>
          {players.map((p) => (
            <div key={p} style={cell}>{money(totals[p])}</div>
          ))}
        </div>

        {/* next: we’ll add Quarter rows, expandable Week groups, Bonus rows, and Pick rows */}
      </div>
    </div>
  );
}
