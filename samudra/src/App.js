import React, { useState, useEffect } from "react";
import { DashboardPage } from "./dashboard";
import { SimulationPage } from "./simulation";
import HistoryPage from "./simulation/HistoryPage";
import { boatsAPI, alertsAPI } from "./dashboard/routes/dashboardRoutes";

function App() {
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [history, setHistory] = useState([]);

  // Fetch enriched intrusion history on load
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // Try enriched intrusion-log first (has classification, est. duration, etc.)
        const logData = await alertsAPI.getIntrusionLog();
        if (logData && logData.length > 0) {
          // Normalise field names so HistoryPage works with both sources
          const normalised = logData
            .filter(r => !r.is_active)   // only completed records in history table
            .map(r => ({
              ...r,
              id:          r.id,
              boatId:      r.boat_id,
              boatName:    r.boat_name,
              entryTime:   r.entry_time,
              exitTime:    r.exit_time,
              duration:    String(r.actual_duration_sec || 0),
              actualDurationSec: r.actual_duration_sec,
              avgSpeed:    r.avg_speed_kmh,
              estDurationMin: r.est_duration_min,
              geofenceName: r.geofence_name,
              category:    r.classification?.category,
              classificationLabel:  r.classification?.label,
              classificationReason: r.classification?.reason,
              isLegal:     r.classification?.is_legal,
              isSuspicious: !r.classification?.is_legal,
            }));
          setHistory(normalised);
        } else {
          // Fallback to raw intrusion_history
          const data = await boatsAPI.getIntrusions();
          setHistory(data);
        }
      } catch (err) {
        console.error("Error fetching historical intrusions:", err);
        try {
          const data = await boatsAPI.getIntrusions();
          setHistory(data);
        } catch {}
      }
    };
    fetchHistory();
  }, []);


  const addHistoryItem = async (item) => {
    try {
      await boatsAPI.logIntrusion(item);
      const latestHistory = await boatsAPI.getIntrusions();
      setHistory(latestHistory);
    } catch (err) {
      console.error("Failed to log intrusion to server, using local fallback:", err);
      setHistory((prev) => [item, ...prev]);
    }
  };

  const clearHistory = async () => {
    try {
      await boatsAPI.clearIntrusions();
      setHistory([]);
    } catch (err) {
      console.error("Failed to clear intrusion history on server:", err);
    }
  };

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
          
            <img
              src="/assets/logo.png"
              alt="CoastWatch Logo"
              style={{ width: 40, height: 40}}
            />
          
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-lg uppercase"
                style={{ color: "var(--text-primary)", fontWeight: 900, letterSpacing: "0.12em" }}
              >
                CoastWatch
              </span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              Maritime Security &amp; Geofence Intelligence
            </p>
          </div>
        </div>


        {/* Page Tabs */}
        <div
          className="flex items-center p-1 rounded-lg w-full sm:w-auto"
          style={{ background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.10)" }}
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
          <button
            onClick={() => setCurrentPage("history")}
            className={`nav-tab flex items-center gap-1.5 ${currentPage === "history" ? "active-history" : ""}`}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            History
          </button>
        </div>
      </nav>

      {/* Page Content */}
      <main className="flex-1 flex flex-col min-h-0">
        {currentPage === "dashboard" ? (
          <DashboardPage />
        ) : currentPage === "simulation" ? (
          <SimulationPage addHistoryItem={addHistoryItem} />
        ) : (
          <HistoryPage history={history} clearHistory={clearHistory} />
        )}
      </main>
    </div>
  );
}

export default App;
