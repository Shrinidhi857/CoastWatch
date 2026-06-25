import React, { useState } from "react";

const HistoryPage = ({ history, clearHistory }) => {
  const [expandedIds, setExpandedIds] = useState({});

  const toggleExpand = (id) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Helper to format path name
  const formatPathName = (pathKey) => {
    switch (pathKey) {
      case "collected_data":              return "Collected Data";
      case "collected_data_illegal":      return "Collected Data — Illegal Route";
      case "synthetic_boat_data_coast":   return "Synthetic Boat Data in Coast";
      case "harbor_tour":                 return "Harbor Tour";
      case "coastal_patrol":              return "Coastal Patrol";
      case "restricted_zone_approach":    return "Restricted Zone Approach";
      default: return pathKey || "Custom Route";
    }
  };

  // Calculations for stats
  const totalEntries    = history.length;
  const illegalCount    = history.filter(i => i.category === 'illegal' || (i.isSuspicious && i.isLegal === false)).length;
  const suspiciousCount = history.filter(i => i.category === 'suspicious' || (i.isSuspicious && i.category == null)).length;
  const legalCount      = history.filter(i => i.category === 'legal' || (!i.isSuspicious && i.isLegal !== false)).length;

  const avgDuration = totalEntries > 0
    ? (history.reduce((acc, item) => acc + parseFloat(item.actualDurationSec || item.duration || 0), 0) / totalEntries).toFixed(1)
    : 0;

  // ── Formatting helpers ──────────────────────────────────────────────────

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

  /** Convert raw seconds to human-readable HH:MM:SS / Mm Ss */
  const formatDuration = (rawSeconds) => {
    const sec = parseFloat(rawSeconds || 0);
    if (isNaN(sec) || sec < 0) return "0s";
    const totalSec = Math.floor(sec);
    if (totalSec < 60) return `${totalSec}s`;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  /** Derive category from stored data (handles both old and new payload shapes) */
  const getCategory = (item) => {
    if (item.category) return item.category;
    if (item.isLegal === true)  return 'legal';
    if (item.isLegal === false) {
      // Use speed deviation as a heuristic for illegal vs suspicious
      const dev = item.expectedSpeed
        ? Math.abs((item.actualSpeed - item.expectedSpeed) / item.expectedSpeed)
        : 0;
      return dev > 0.50 ? 'illegal' : 'suspicious';
    }
    if (item.isSuspicious) return 'suspicious';
    return 'legal';
  };

  /** Return badge config based on category */
  const getBadge = (category, item) => {
    const label  = item.classificationLabel;
    const reason = item.classificationReason;
    switch (category) {
      case 'illegal':
        return {
          bg: 'rgba(239,68,68,0.09)', color: '#dc2626', border: 'rgba(239,68,68,0.22)',
          pulse: true,
          text: label || '🔴 Illegal Activity',
          reason: reason || 'Speed or duration exceeds legal thresholds',
        };
      case 'suspicious':
        return {
          bg: 'rgba(234,179,8,0.10)', color: '#ca8a04', border: 'rgba(234,179,8,0.28)',
          pulse: false,
          text: label || '🟡 Suspicious',
          reason: reason || 'Speed or duration outside normal range',
        };
      default:
        return {
          bg: 'rgba(34,197,94,0.08)', color: '#16a34a', border: 'rgba(34,197,94,0.22)',
          pulse: false,
          text: label || '🟢 Legal Transit',
          reason: reason || 'Speed and duration within normal parameters',
        };
    }
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
            Detailed logs of vessels entering and exiting restricted geofence zones — including estimated vs actual duration and legal classification.
          </p>
        </div>
        {totalEntries > 0 && (
          <button
            onClick={clearHistory}
            className="pro-btn-ghost text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
          >
            🗑 Clear All Logs
          </button>
        )}
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Card 1: Total */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between" style={{ background: "var(--navy-900)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Total Intrusions
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{totalEntries}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>events</span>
          </div>
        </div>

        {/* Card 2: Illegal */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between" style={{ background: "var(--navy-900)", borderLeft: "3px solid #dc2626" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-red-600">
            Illegal Activity
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono text-red-600">{illegalCount}</span>
            {totalEntries > 0 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ({((illegalCount / totalEntries) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>

        {/* Card 3: Suspicious */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between" style={{ background: "var(--navy-900)", borderLeft: "3px solid #ca8a04" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#ca8a04' }}>
            Suspicious
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono" style={{ color: '#ca8a04' }}>{suspiciousCount}</span>
            {totalEntries > 0 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ({((suspiciousCount / totalEntries) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>

        {/* Card 4: Avg Duration */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between" style={{ background: "var(--navy-900)", borderLeft: "3px solid #16a34a" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-green-600">
            Legal Transits
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-2xl font-bold font-mono text-green-600">{legalCount}</span>
            {totalEntries > 0 && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ({((legalCount / totalEntries) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {totalEntries === 0 ? (
        /* Empty State */
        <div className="flex-1 glass-card rounded-xl flex flex-col items-center justify-center p-10 text-center border-dashed" style={{ borderStyle: "dashed", borderColor: "var(--glass-border)", background: "var(--navy-900)" }}>
          <div className="p-4 rounded-full mb-4 border" style={{ background: "rgba(37,99,235,0.05)", borderColor: "var(--glass-border)" }}>
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>No Intrusion Logs Yet</h3>
          <p className="text-xs mt-1.5 max-w-sm" style={{ color: "var(--text-muted)" }}>
            Intrusion history is populated when a vessel enters and exits a restricted zone. Use the Simulation page to test, or wait for real boats to be detected by the geofence engine.
          </p>
        </div>
      ) : (
        /* History Log Cards List */
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            {history.map((item) => {
              const category = getCategory(item);
              const badge    = getBadge(category, item);
              const isExpanded = !!expandedIds[item.id];

              // Estimated duration calculation (default to 2.0 km width transit)
              let estMinutes = item.estDurationMin ?? item.est_duration_min;
              if (estMinutes == null || isNaN(estMinutes)) {
                const spd = parseFloat(item.avgSpeed || item.actualSpeed || item.speed || 0);
                estMinutes = spd > 0.1 ? parseFloat(((2.0 / spd) * 60).toFixed(2)) : null;
              }

              const actualSec = parseFloat(item.actualDurationSec ?? item.duration ?? 0);
              const speed = parseFloat(item.avgSpeed ?? item.actualSpeed ?? 0);
              const zoneName = item.geofenceName || item.pathName;
              const isSuspicious = item.isSuspicious ?? !item.isLegal;

              return (
                <div
                  key={item.id}
                  className="glass-card rounded-xl transition-all duration-300 border overflow-hidden"
                  style={{
                    background: isExpanded ? "rgba(14, 31, 61, 0.85)" : "var(--navy-900)",
                    borderColor: isExpanded ? "rgba(37, 99, 235, 0.4)" : "var(--glass-border)",
                    boxShadow: isExpanded ? "0 4px 20px rgba(0, 0, 0, 0.4)" : "none",
                  }}
                >
                  {/* Card Summary Header (Horizontal) */}
                  <div
                    onClick={() => toggleExpand(item.id)}
                    className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer select-none"
                    style={{
                      background: category === 'illegal'
                        ? 'rgba(239, 68, 68, 0.015)'
                        : category === 'suspicious'
                          ? 'rgba(234, 179, 8, 0.012)'
                          : 'transparent',
                    }}
                  >
                    {/* 1. Zone & Vessel Info */}
                    <div className="flex items-start gap-3 min-w-[240px]">
                      <div className="p-2 rounded-lg bg-blue-500/5 border border-blue-500/10 text-blue-400 shrink-0">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L16 4m0 13V4m0 0L9 7" />
                        </svg>
                      </div>
                      <div>
                        <span className="font-semibold block text-[13px] text-slate-100">
                          {zoneName ? (
                            <span>{zoneName.charAt(0).toUpperCase() + zoneName.slice(1).replace(/_/g, ' ')}</span>
                          ) : 'Unknown Area'}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {formatDate(item.entryTime)}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="text-[11px] font-medium text-blue-400">
                            🚤 {item.boatName || item.boatId || 'Unnamed Vessel'}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">({item.boatId})</span>
                        </div>
                      </div>
                    </div>

                    {/* 2. Timeline and Time Stamps */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <span>Entry: <strong>{formatTime(item.entryTime)}</strong></span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.exitTime ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span>Exit: <strong>{formatTime(item.exitTime)}</strong></span>
                          </>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse">
                            Still inside
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 font-mono">
                        Avg Speed: <span className="text-slate-200 font-bold">{speed > 0 ? `${speed.toFixed(1)} km/h` : '—'}</span>
                      </div>
                    </div>

                    {/* 3. Duration & Badge Info */}
                    <div className="flex items-center justify-between lg:justify-end gap-4">
                      <div className="text-right lg:min-w-[120px]">
                        <span className="text-[10px] text-slate-500 block">Actual Duration</span>
                        <span className="font-mono font-bold text-[13px] block mt-0.5" style={{
                          color: category === 'illegal' ? '#ef4444' : category === 'suspicious' ? '#f59e0b' : '#22c55e'
                        }}>
                          {formatDuration(actualSec)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0"
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderColor: badge.border,
                          }}
                        >
                          {badge.pulse && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                          {badge.text}
                        </span>

                        {/* Expand Icon */}
                        <div className="text-slate-400 p-1 hover:text-slate-200">
                          <svg
                            className={`w-4 h-4 transform transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content Details Drawer */}
                  {isExpanded && (() => {
                    const expectedSpd = parseFloat(item.expectedSpeed ?? item.estSpeed ?? 0);
                    const actualSpd   = speed; // already parsed above
                    const speedDevPct = expectedSpd > 0
                      ? (((actualSpd - expectedSpd) / expectedSpd) * 100)
                      : null;
                    const durRatio = (() => {
                      const estSec = estMinutes != null ? estMinutes * 60 : null;
                      return estSec && estSec > 0 ? (actualSec / estSec) : null;
                    })();

                    const illegalVerdict = (() => {
                      if (category === 'illegal')    return { label: '🔴 ILLEGAL ACTIVITY', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' };
                      if (category === 'suspicious') return { label: '🟡 SUSPICIOUS', color: '#f59e0b', bg: 'rgba(234,179,8,0.10)', border: 'rgba(234,179,8,0.3)' };
                      return { label: '🟢 LEGAL TRANSIT', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)' };
                    })();

                    return (
                    <div className="px-6 pb-5 pt-4 border-t border-white/[0.05] bg-black/10 text-[12px] text-slate-300 space-y-4 animate-fade-in">

                      {/* ── Verdict Banner ─────────────────────────────────── */}
                      <div
                        className="flex items-center justify-between px-4 py-3 rounded-xl border"
                        style={{ background: illegalVerdict.bg, borderColor: illegalVerdict.border }}
                      >
                        <div className="flex items-center gap-2">
                          {category === 'illegal' && (
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                          )}
                          <span className="font-bold text-[12px] tracking-wider" style={{ color: illegalVerdict.color }}>
                            {illegalVerdict.label}
                          </span>
                        </div>
                        <span className="text-[11px] italic" style={{ color: illegalVerdict.color, opacity: 0.85 }}>
                          {badge.reason}
                        </span>
                      </div>

                      {/* ── Detail Grid ────────────────────────────────────── */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

                        {/* Box 1: Entry / Exit Times */}
                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.04] col-span-1">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                            🕒 Zone Times
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Entry Time</span>
                              <span className="font-mono text-green-400 font-semibold text-[11px]">
                                {formatTime(item.entryTime)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Exit Time</span>
                              {item.exitTime ? (
                                <span className="font-mono text-amber-400 font-semibold text-[11px]">
                                  {formatTime(item.exitTime)}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-red-400 animate-pulse">Still Inside</span>
                              )}
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-slate-400">Duration</span>
                              <span className="font-mono font-bold text-[12px]" style={{
                                color: category === 'illegal' ? '#ef4444' : category === 'suspicious' ? '#f59e0b' : '#22c55e'
                              }}>
                                {formatDuration(actualSec)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Box 2: Speed Analysis */}
                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.04] col-span-1">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                            🚤 Speed Analysis
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Actual Avg Speed</span>
                              <span className="font-mono text-slate-200 font-bold text-[12px]">
                                {actualSpd > 0 ? `${actualSpd.toFixed(1)} km/h` : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Expected Speed</span>
                              <span className="font-mono text-slate-300 text-[11px]">
                                {expectedSpd > 0 ? `${expectedSpd.toFixed(1)} km/h` : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-slate-400">Speed Deviation</span>
                              {speedDevPct !== null ? (
                                <span className="font-mono font-bold text-[11px]" style={{
                                  color: Math.abs(speedDevPct) > 50 ? '#ef4444' : Math.abs(speedDevPct) > 25 ? '#f59e0b' : '#22c55e'
                                }}>
                                  {speedDevPct > 0 ? '+' : ''}{speedDevPct.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Box 3: Transit Duration */}
                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.04] col-span-1">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                            ⏳ Duration Comparison
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Actual In Zone</span>
                              <span className="font-mono text-slate-200 font-bold">
                                {formatDuration(actualSec)}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Expected Transit</span>
                              <span className="font-mono text-slate-300">
                                {estMinutes != null ? (
                                  estMinutes < 1
                                    ? `${(estMinutes * 60).toFixed(0)}s`
                                    : `${estMinutes.toFixed(1)} min`
                                ) : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-slate-400">Duration Ratio</span>
                              {durRatio !== null ? (
                                <span className="font-mono font-bold text-[11px]" style={{
                                  color: durRatio > 3 ? '#ef4444' : durRatio > 2 ? '#f59e0b' : '#22c55e'
                                }}>
                                  {durRatio.toFixed(1)}× est.
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Box 4: Coordinates */}
                        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/[0.04] col-span-1">
                          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
                            📍 Coordinates
                          </h4>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center py-1 border-b border-white/[0.02]">
                              <span className="text-slate-400">Entry</span>
                              <span className="font-mono text-slate-200 font-medium text-[10px]">
                                {item.entryLat != null && item.entryLng != null ? (
                                  `${parseFloat(item.entryLat).toFixed(5)}, ${parseFloat(item.entryLng).toFixed(5)}`
                                ) : '—'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-slate-400">Exit</span>
                              <span className="font-mono text-slate-200 font-medium text-[10px]">
                                {item.exitLat != null && item.exitLng != null ? (
                                  `${parseFloat(item.exitLat).toFixed(5)}, ${parseFloat(item.exitLng).toFixed(5)}`
                                ) : 'Still Inside'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>

          {/* Footer summary */}
          <div
            className="px-4 py-3 flex items-center justify-between text-[11px] shrink-0 glass-card rounded-xl"
            style={{ background: "var(--navy-900)", border: "1px solid var(--glass-border)", color: 'var(--text-muted)' }}
          >
            <span>{totalEntries} total record{totalEntries !== 1 ? 's' : ''}</span>
            <span>Avg duration in zone: <strong style={{ color: 'var(--text-secondary)' }}>{formatDuration(avgDuration)}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
