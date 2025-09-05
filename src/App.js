// src/App.js
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PickemLocal from "./PickemLocal";
import WeekSummary from "./WeekSummary.jsx";
import LivePicks from "./LivePicks.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/weekly-summary" element={<WeekSummary />} />
        <Route path="/live-picks" element={<LivePicks />} />
        <Route path="/" element={<PickemLocal />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
