import React, { useState } from "react";
import { DashboardPage } from "./dashboard";
import { SimulationPage } from "./simulation";

function App() {
  const [currentPage, setCurrentPage] = useState("dashboard");

  return (
    <div
      className="w-full h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--navy-950)", color: "var(--text-primary)", fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Frosted Glass Navigation Bar ── */}
      <nav className="glass-nav px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 select-none z-50 shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-3">
          {/* CoastWatch Logo */}
          <div
            className="shrink-0 flex items-center justify-center rounded-xl overflow-hidden"
            style={{
              width: 44,
              height: 44,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 2px 16px rgba(0,120,150,0.25), inset 0 1px 0 rgba(255,255,255,0.06)"
            }}
          >
            <img
              src="/assets/logo.png"
              alt="CoastWatch Logo"
              style={{ width: 36, height: 36, objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(0,150,180,0.4))" }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-sm uppercase"
                style={{ color: "var(--text-primary)", fontWeight: 700, letterSpacing: "0.12em" }}
              >
                CoastWatch
              </span>
              <span className="pro-badge">SAMUDRA v2</span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              Maritime Security &amp; Geofence Intelligence
            </p>
          </div>
        </div>


        {/* Page Tabs */}
        <div
          className="flex items-center p-1 rounded-lg w-full sm:w-auto"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <button
            onClick={() => setCurrentPage("dashboard")}
            className={`nav-tab flex items-center gap-1.5 ${currentPage === "dashboard" ? "active-dashboard" : ""}`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Live Dashboard
          </button>
          <button
            onClick={() => setCurrentPage("simulation")}
            className={`nav-tab flex items-center gap-1.5 ${currentPage === "simulation" ? "active-simulation" : ""}`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Simulation
          </button>
        </div>
      </nav>

      {/* Page Content */}
      <main className="flex-1 flex flex-col min-h-0">
        {currentPage === "dashboard" ? <DashboardPage /> : <SimulationPage />}
      </main>
    </div>
  );
}

export default App;
