import React, { useState } from "react";
import { DashboardPage } from "./dashboard";
import { SimulationPage } from "./simulation";

function App() {
  const [currentPage, setCurrentPage] = useState("dashboard"); // 'dashboard' or 'simulation'

  return (
    <div className="w-full h-screen bg-slate-950 flex flex-col font-sans text-slate-100 overflow-hidden">
      {/* Premium Navigation Header */}
      <nav className="bg-slate-900 border-b border-slate-800/80 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl select-none">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-blue-500/10">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-white uppercase">
              CoastWatch <span className="text-[10px] font-semibold tracking-normal px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 ml-1">SAMUDRA v2</span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">Real-time Maritime Security & Precise Geofence Simulation</p>
          </div>
        </div>

        <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 shadow-inner w-full sm:w-auto">
          <button
            onClick={() => setCurrentPage("dashboard")}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              currentPage === "dashboard"
                ? "bg-gradient-to-r from-blue-600 to-indigo-650 text-white shadow-md shadow-blue-600/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            📊 Live Dashboard
          </button>
          <button
            onClick={() => setCurrentPage("simulation")}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              currentPage === "simulation"
                ? "bg-gradient-to-r from-purple-600 to-fuchsia-650 text-white shadow-md shadow-purple-600/20"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            🚤 Boat Simulation
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
