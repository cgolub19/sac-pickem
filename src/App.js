// src/App.js
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Home from "./Home";
import PickemLocal from "./PickemLocal";
import WeekSummary from "./WeekSummary.jsx";
import LivePicks from "./LivePicks.jsx";
import SeasonGridScorecard from "./SeasonScorecardGrid.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Home (logo + buttons) */}
        <Route path="/" element={<Home />} />

        {/* Pages */}
        <Route path="/pickem" element={<PickemLocal />} />
        <Route path="/weekly-summary" element={<WeekSummary />} />
        <Route path="/live-picks" element={<LivePicks />} />
        <Route path="/season-grid" element={<SeasonGridScorecard />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
