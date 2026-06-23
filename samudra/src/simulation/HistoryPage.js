import React from "react";

const HistoryPage = ({ history, clearHistory }) => {
  // Helper to format path name
  const formatPathName = (pathKey) => {
    switch (pathKey) {
      case "harbor_tour":
        return "Harbor Tour";
      case "coastal_patrol":
        return "Coastal Patrol";
      case "restricted_zone_approach":
        return "Restricted Zone Approach";
      default:
        return pathKey || "Custom Route";
    }
  };

  // Calculations for stats
  const totalEntries = history.length;
  const suspiciousCount = history.filter((item) => item.isSuspicious).length;
  const safeCount = totalEntries - suspiciousCount;
  
  const avgDuration = totalEntries > 0
    ? (history.reduce((acc, item) => acc + parseFloat(item.duration || 0), 0) / totalEntries).toFixed(1)
    : 0;

  // Format date/time
  const formatTime = (timeString) => {
    if (!timeString) return "N/A";
    const date = new Date(timeString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (timeString) => {
    if (!timeString) return "N/A";
    const date = new Date(timeString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto" style={{ background: "var(--navy-950)" }}>
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Vessel Intrusion History
          </h2>
          <p className="text-[12px] mt-1" style={{ color: "var(--text-secondary)" }}>
            Detailed logs of simulated vessels entering and exiting the restricted geofence zone.
          </p>
        </div>
        {totalEntries > 0 && (
          <button
            onClick={clearHistory}
            className="pro-btn-ghost text-red-400 border-red-500/20 hover:bg-red-500/10 hover:text-red-300"
            style={{ borderColor: "rgba(239, 68, 68, 0.2)" }}
          >
            🗑 Clear All Logs
          </button>
        )}
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Card 1: Total Entries */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Total Intrusions
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono text-white">{totalEntries}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>events</span>
          </div>
        </div>

        {/* Card 2: Suspicious */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between" style={{ borderLeft: "3px solid #ef4444" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400">
            Suspicious Vessel Flagged
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono text-red-400">{suspiciousCount}</span>
            {totalEntries > 0 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ({((suspiciousCount / totalEntries) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>

        {/* Card 3: Safe Passages */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between" style={{ borderLeft: "3px solid #22c55e" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-green-400">
            Passing Vessel (Safe)
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono text-green-400">{safeCount}</span>
            {totalEntries > 0 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ({((safeCount / totalEntries) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>

        {/* Card 4: Avg Duration */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Avg Duration
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono text-white">{avgDuration}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>seconds</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {totalEntries === 0 ? (
        /* Empty State */
        <div className="flex-1 glass-panel rounded-xl flex flex-col items-center justify-center p-10 text-center border-dashed">
          <div className="p-4 rounded-full bg-slate-800/40 mb-4 border" style={{ borderColor: "var(--glass-border)" }}>
            <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-200">No Intrusion Logs Yet</h3>
          <p className="text-xs text-slate-400 mt-1.5 max-w-sm">
            Intrusion history is populated when a simulated boat enters and exits the restricted zone. Switch to the Simulation page to run a test scenario.
          </p>
        </div>
      ) : (
        /* History Log List */
        <div className="glass-card rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400" style={{ background: "rgba(14,31,61,0.6)", borderBottom: "1px solid var(--glass-border)" }}>
                  <th className="py-3.5 px-4">Date &amp; Route</th>
                  <th className="py-3.5 px-4">Vessel ID</th>
                  <th className="py-3.5 px-4">Timestamps</th>
                  <th className="py-3.5 px-4 text-center">Duration</th>
                  <th className="py-3.5 px-4 text-center">Expected Speed</th>
                  <th className="py-3.5 px-4 text-center">Actual Speed</th>
                  <th className="py-3.5 px-4 text-center">Speed Deviation</th>
                  <th className="py-3.5 px-4 text-right">Security Categorization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30 text-[12px]">
                {history.map((item) => {
                  const deviation = item.expectedSpeed 
                    ? ((item.actualSpeed - item.expectedSpeed) / item.expectedSpeed * 100).toFixed(0)
                    : 0;
                  const devColor = parseFloat(deviation) === 0 
                    ? "text-slate-400" 
                    : Math.abs(parseFloat(deviation)) > 20 
                      ? "text-red-400" 
                      : "text-green-400";

                  return (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                      {/* Date & Route */}
                      <td className="py-4 px-4">
                        <span className="font-semibold text-slate-200 block">{formatPathName(item.pathName)}</span>
                        <span className="text-[10px] text-slate-400 mt-0.5 block">{formatDate(item.entryTime)}</span>
                      </td>

                      {/* Vessel ID */}
                      <td className="py-4 px-4 font-mono text-[11px] text-slate-300">
                        {item.boatId}
                      </td>

                      {/* Entry/Exit Timestamps */}
                      <td className="py-4 px-4">
                        <div className="flex flex-col gap-0.5 text-slate-300">
                          <div>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wide mr-1 inline-block w-8">In:</span>
                            <span className="font-mono">{formatTime(item.entryTime)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wide mr-1 inline-block w-8">Out:</span>
                            <span className="font-mono">{formatTime(item.exitTime)}</span>
                          </div>
                        </div>
                      </td>

                      {/* Duration */}
                      <td className="py-4 px-4 text-center font-mono font-medium text-slate-200">
                        {item.duration}s
                      </td>

                      {/* Expected Speed */}
                      <td className="py-4 px-4 text-center font-mono text-slate-300">
                        {item.expectedSpeed} kts
                      </td>

                      {/* Actual Speed */}
                      <td className="py-4 px-4 text-center font-mono text-slate-200 font-semibold">
                        {item.actualSpeed} kts
                      </td>

                      {/* Speed Deviation */}
                      <td className={`py-4 px-4 text-center font-mono font-medium ${devColor}`}>
                        {deviation > 0 ? `+${deviation}` : deviation}%
                      </td>

                      {/* Classification Badge */}
                      <td className="py-4 px-4 text-right">
                        {item.isSuspicious ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: "rgba(239, 68, 68, 0.12)",
                              color: "#fca5a5",
                              border: "1px solid rgba(239, 68, 68, 0.25)"
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                            Suspicious 🚩
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: "rgba(34, 197, 94, 0.12)",
                              color: "#86efac",
                              border: "1px solid rgba(34, 197, 94, 0.25)"
                            }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            Passing 🟢
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
