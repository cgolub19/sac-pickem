import React from "react";
import sacLogo from "./sac-logo.png";




// Brand colors
const THEME = {
  bg: "#0b1d39",
  text: "#e6edf6",
  sub: "#c7d2fe",
  cardBorder: "rgba(255,255,255,.14)",
  btn: "rgba(255,255,255,.08)",
  btnHover: "rgba(255,255,255,.14)",
};

// Past champions (newest on the left)
const CHAMPIONS = [
  { year: 2024, name: "Joey" },
  { year: 2023, name: "Kevin" },
  { year: 2022, name: "Kevin" },
  { year: 2021, name: "Dan" },
  { year: 2020, name: "Joey" },
  { year: 2019, name: "Joey" },
  { year: 2018, name: "Nick" },
  { year: 2017, name: "Dan" },
];

// Edit these paths if your routes differ
const routes = {
  pickem: "/pickem",
  live: "/live-picks",
  grid: "/season-grid",
  weekly: "/weekly-summary",

};

function NavButton({ label, sub, href }) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: "14px 16px",
        borderRadius: 12,
        textDecoration: "none",
        color: THEME.text,
        background: THEME.btn,
        border: `1px solid ${THEME.cardBorder}`,
        boxShadow: "0 6px 20px rgba(0,0,0,.35)",
        transition: "background .15s ease",
        marginBottom: 10,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = THEME.btnHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = THEME.btn)}
    >
      <div style={{ fontWeight: 900, fontSize: 18 }}>{label}</div>
      {sub ? (
        <div style={{ marginTop: 4, color: THEME.sub, fontSize: 13 }}>{sub}</div>
      ) : null}
    </a>
  );
}

function ChampionsBanner() {
  return (
    <div className="champ-strip">
      {CHAMPIONS.map((c) => (
        <div key={c.year} className="champ-card">
          <div className="champ-year">{c.year}</div>
          <div className="champ-name">{c.name}</div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: THEME.bg,
        color: THEME.text,
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      }}
    >
      {/* small CSS for layout + champions banner */}
      <style>{`
        .home-wrap { max-width: 980px; margin: 0 auto; padding: 18px 16px 44px; }
        .actions { max-width: 420px; margin: 0 auto; } /* narrower buttons */

        /* Champions tiny banner (Notre Dame gold w/ blue text) */
        .champ-strip {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 6px 2px 10px;
          margin: 0 0 10px;
        }
        .champ-card {
          min-width: 80px;
          padding: 6px 10px;
          border-radius: 10px;
          background: #AE9142;           /* ND gold */
          border: 1px solid #8a6a1f;     /* darker gold border */
          box-shadow: 0 4px 14px rgba(0,0,0,.25);
          text-align: center;
          color: #0b1d39;                 /* SAC blue text */
        }
        .champ-year {
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .25px;
        }
        .champ-name {
          font-size: 12px;
          font-weight: 800;
          margin-top: 1px;
        }
      `}</style>

      <div className="home-wrap">
        {/* Champions banner at the very top */}
        <ChampionsBanner />

        {/* Logo centered (inline SVG wrapped in a white card) */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div
            style={{
              display: "inline-block",
              background: "#fff",
              borderRadius: 16,
              border: `1px solid ${THEME.cardBorder}`,
              padding: 8,
              boxShadow: "0 10px 28px rgba(0,0,0,.45)",
            }}
          >
           <img src={sacLogo} alt="SAC" style={{ width: 160, height: "auto", display: "block" }} />



          </div>
        </div>

        {/* Buttons directly under the logo */}
        <div className="actions">
          <NavButton
            label="Pick’em"
            sub="Make and manage weekly picks."
            href={routes.pickem}
          />
          <NavButton
            label="Weekly Summary"
            sub="See results and payouts for the week."
            href={routes.weekly}
          />
          <NavButton
            label="Live Picks"
            sub="Realtime board of everyone’s picks."
            href={routes.live}
          />
          <NavButton
            label="Season Grid"
            sub="Pivot-style standings by quarter/week."
            href={routes.grid}
          />
        </div>
      </div>
    </div>
  );
}
