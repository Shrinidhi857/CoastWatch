import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  Polyline,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import {
  boatsAPI,
  geofencesAPI,
  alertsAPI,
  systemAPI,
  depthAPI,
  geofenceCheckAPI,
} from "./routes/dashboardRoutes";
import {
  formatBoatFromServer,
  formatGeofenceFromServer,
  coordsToLeaflet,
} from "./utils/helpers";
import { MAP_CONFIG } from "../config/config";

// ── WDPA zone realm config ──────────────────────────────────────
const REALM_CONFIG = {
  Coastal:     { color: "#06b6d4", fill: "#06b6d4", label: "Coastal",     icon: "🏖️" },
  Marine:      { color: "#3b82f6", fill: "#3b82f6", label: "Marine",      icon: "🌊" },
  Terrestrial: { color: "#22c55e", fill: "#22c55e", label: "Terrestrial", icon: "🌿" },
};
const ALL_REALMS = ["Coastal", "Marine", "Terrestrial"];

// Custom boat icon
const boatIcon = new L.Icon({
  iconUrl: "/assets/boat-blue.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
  className: "boat-marker",
});

// Red boat icon for vessels in restricted zones
const boatIconRed = new L.Icon({
  iconUrl: "/assets/boat-red.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
  className: "boat-marker-alert",
});

// MapClickHandler component to capture map clicks
const MapClickHandler = ({
  drawMode,
  editMode,
  onMapClick,
  onEditMapClick,
}) => {
  useMapEvents({
    click: (e) => {
      if (drawMode) {
        const { lat, lng } = e.latlng;
        onMapClick([lng, lat]);
      } else if (editMode) {
        const { lat, lng } = e.latlng;
        onEditMapClick([lng, lat]);
      }
    },
  });
  return null;
};

// Custom Heatmap Layer — viewport-bounded, recycle-view style
const HeatmapLayer = () => {
  const map = useMap();
  const heatLayerRef = useRef(null);

  const getHeatmapOptions = (zoom) => {
    if (zoom <= 6)  return { radius: 35, blur: 25, max: 1.0, minOpacity: 0.2 };
    if (zoom <= 8)  return { radius: 40, blur: 30, max: 1.0, minOpacity: 0.2 };
    if (zoom <= 10) return { radius: 45, blur: 32, max: 1.0, minOpacity: 0.25 };
    if (zoom <= 12) return { radius: 50, blur: 35, max: 1.0, minOpacity: 0.3 };
    return              { radius: 60, blur: 40, max: 1.0, minOpacity: 0.3 };
  };

  const gradient = {
    0.0: "red",        // Shallowest: Warm Red
    0.25: "orange",    // Shallow-medium: Warm Orange
    0.5: "yellow",     // Medium: Warm Yellow
    0.7: "cyan",       // Medium-deep: Cool Cyan
    0.85: "blue",      // Deep: Cool Blue
    1.0: "navy",       // Deepest: Cool Navy
  };

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      const bounds = map.getBounds();
      const minLat = bounds.getSouth();
      const maxLat = bounds.getNorth();
      const minLng = bounds.getWest();
      const maxLng = bounds.getEast();
      const zoom   = map.getZoom();

      try {
        const pts = await depthAPI.getHeatmapData(minLat, maxLat, minLng, maxLng);
        if (!isMounted) return;

        const opts = { ...getHeatmapOptions(zoom), gradient };

        if (heatLayerRef.current) {
          heatLayerRef.current.setLatLngs(pts);
          heatLayerRef.current.setOptions(opts);
          heatLayerRef.current.redraw();
        } else {
          heatLayerRef.current = L.heatLayer(pts, opts).addTo(map);
        }
      } catch (err) {
        console.error("Depth heatmap fetch error:", err);
      }
    };

    refresh();

    map.on("moveend", refresh);
    map.on("zoomend", refresh);

    return () => {
      isMounted = false;
      map.off("moveend", refresh);
      map.off("zoomend", refresh);
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

const DashboardPage = () => {
  const [vessels, setVessels] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const [geofences, setGeofences] = useState([]);
  const [drawMode, setDrawMode] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [intrusionLog, setIntrusionLog] = useState([]);  // enriched per-boat records
  const [drawnPolygon, setDrawnPolygon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [editingGeofence, setEditingGeofence] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedCoordinates, setEditedCoordinates] = useState(null);

  // WDPA official restricted zones
  const [wdpaFeatures, setWdpaFeatures] = useState([]);
  const [showWdpa, setShowWdpa] = useState(true);
  const [activeRealms, setActiveRealms] = useState(new Set(ALL_REALMS));

  // Selected boat for detailed view (modal open)
  const [selectedVessel, setSelectedVessel] = useState(null);

  // Vessel whose path is currently drawn on the map
  const [pathVessel, setPathVessel] = useState(null);

  // Boat path (GPS track for today)
  const [boatPath, setBoatPath] = useState(null);   // { boat_id, date, count, path[] }
  const [pathLoading, setPathLoading] = useState(false);

  // Heatmap state
  const [showHeatmap, setShowHeatmap] = useState(false);

  const mapRef = useRef();
  const boatsIntervalRef = useRef(null);
  const alertsIntervalRef = useRef(null);

  // Load WDPA GeoJSON on mount
  useEffect(() => {
    fetch("/wdpa_polygons.geojson")
      .then((r) => r.json())
      .then((geojson) => setWdpaFeatures(geojson.features || []))
      .catch((err) => console.error("WDPA load error:", err));
  }, []);

  const toggleRealm = (realm) => {
    setActiveRealms((prev) => {
      const next = new Set(prev);
      if (next.has(realm)) next.delete(realm);
      else next.add(realm);
      return next;
    });
  };

  // Initialize and fetch data from server
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await systemAPI.health();
        setServerConnected(true);
        setError(null);

        await fetchBoats();
        await fetchGeofences();
        await fetchAlerts();

        setLoading(false);

        boatsIntervalRef.current = setInterval(() => {
          fetchBoats();
        }, 5000);

        alertsIntervalRef.current = setInterval(() => {
          fetchAlerts();
        }, 3000);
      } catch (err) {
        console.error("Failed to initialize app:", err);
        setServerConnected(false);
        setError(
          "Unable to connect to server. Make sure the Flask server is running on http://localhost:5000"
        );
        setLoading(false);
      }
    };

    initializeApp();

    return () => {
      if (boatsIntervalRef.current) clearInterval(boatsIntervalRef.current);
      if (alertsIntervalRef.current) clearInterval(alertsIntervalRef.current);
    };
  }, []);

  // Fetch boats from server
  const fetchBoats = async () => {
    try {
      const boatsData = await boatsAPI.getAll();
      const formattedBoats = boatsData.map((boat) =>
        formatBoatFromServer(boat)
      );
      setVessels(formattedBoats);
    } catch (err) {
      console.error("Error fetching boats:", err);
    }
  };

  // Fetch geofences from server
  const fetchGeofences = async () => {
    try {
      const geofencesData = await geofencesAPI.getAll();
      const formattedGeofences = geofencesData.map((gf) =>
        formatGeofenceFromServer(gf)
      );
      setGeofences(formattedGeofences);
    } catch (err) {
      console.error("Error fetching geofences:", err);
    }
  };

  // Fetch alerts from server (enriched with intrusion log)
  const fetchAlerts = async () => {
    try {
      // Trigger geofence checks for all boats on the server to update entry/exit transitions
      await geofenceCheckAPI.checkAllBoats().catch((err) => console.error("Error running geofence check:", err));

      const [alertsData, logData] = await Promise.all([
        alertsAPI.getAll(),
        alertsAPI.getIntrusionLog().catch(() => []),
      ]);
      setAlerts(alertsData);
      setIntrusionLog(logData);
    } catch (err) {
      console.error("Error fetching alerts:", err);
    }
  };

  // Fetch today's GPS path for a vessel
  const fetchBoatPath = useCallback(async (vessel) => {
    setBoatPath(null);
    setPathLoading(true);
    try {
      const result = await boatsAPI.getPath(vessel.id);
      setBoatPath(result);
    } catch (err) {
      console.error("Error fetching boat path:", err);
      setBoatPath({ boat_id: vessel.id, count: 0, path: [] });
    } finally {
      setPathLoading(false);
    }
  }, []);

  const handleMapClick = (e) => {
    if (!drawMode) return;

    setDrawnPolygon((prev) => {
      const newPolygon = prev ? [...prev, e] : [e];
      return newPolygon;
    });
  };

  const completeGeofence = async () => {
    if (drawnPolygon && drawnPolygon.length >= 3) {
      const newGeofence = {
        name: `Geofence ${geofences.length + 1}`,
        coordinates: drawnPolygon,
        type: "restricted",
        description: "Created from map",
        is_active: true,
      };

      try {
        await geofencesAPI.create(newGeofence);
        await fetchGeofences();
        setDrawnPolygon(null);
        setDrawMode(false);
      } catch (err) {
        console.error("Error creating geofence:", err);
        alert(
          `Failed to create geofence: ${err.message || "Please try again."}`
        );
      }
    } else {
      alert("A geofence must have at least 3 points");
    }
  };

  const cancelDrawing = () => {
    setDrawnPolygon(null);
    setDrawMode(false);
  };

  const deleteGeofence = async (id) => {
    try {
      await geofencesAPI.delete(id);
      await fetchGeofences();
    } catch (err) {
      console.error("Error deleting geofence:", err);
      alert("Failed to delete geofence. Please try again.");
    }
  };

  const deleteVessel = async (id) => {
    try {
      await boatsAPI.delete(id);
      if (selectedVessel && selectedVessel.id === id) {
        setSelectedVessel(null);
      }
      await fetchBoats();
    } catch (err) {
      console.error("Error deleting boat:", err);
      alert("Failed to delete boat. Please try again.");
    }
  };

  const startEditingGeofence = (geofence) => {
    setEditingGeofence(geofence);
    setEditedCoordinates([...geofence.coordinates]);
    setEditMode(true);
  };

  const cancelEditGeofence = () => {
    setEditingGeofence(null);
    setEditedCoordinates(null);
    setEditMode(false);
  };

  const saveGeofenceEdit = async () => {
    if (!editingGeofence || !editedCoordinates) return;

    if (editedCoordinates.length < 3) {
      alert("A geofence must have at least 3 points");
      return;
    }

    try {
      await geofencesAPI.updateCoordinates(
        editingGeofence.id,
        editedCoordinates
      );
      await fetchGeofences();
      cancelEditGeofence();
    } catch (err) {
      console.error("Error updating geofence coordinates:", err);
      alert(`Failed to update geofence: ${err.message || "Please try again."}`);
    }
  };

  const addCoordinateToEdit = (coord) => {
    if (editedCoordinates) {
      setEditedCoordinates([...editedCoordinates, coord]);
    }
  };

  const removeCoordinateFromEdit = (index) => {
    if (editedCoordinates && editedCoordinates.length > 3) {
      setEditedCoordinates(editedCoordinates.filter((_, i) => i !== index));
    } else {
      alert("A geofence must have at least 3 points");
    }
  };

  return (
    <div className="w-full h-full flex flex-col flex-1" style={{ background: "var(--navy-950)" }}>
      {/* Server Connection Status */}
      {!serverConnected && (
        <div className="animate-fade-in px-5 py-2.5 text-center text-sm font-medium" style={{ background: "rgba(220,38,38,0.07)", borderBottom: "1px solid rgba(220,38,38,0.18)", color: "#b91c1c" }}>
          <span className="font-bold">Server Connection Error</span> — {error}
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="animate-fade-in px-5 py-2.5 text-center text-sm font-medium" style={{ background: "rgba(37,99,235,0.06)", borderBottom: "1px solid rgba(37,99,235,0.14)", color: "#1d4ed8" }}>
          Connecting to server and loading vessel data…
        </div>
      )}

      {/* Sub-header toolbar */}
      <div
        className="px-5 py-3 flex flex-wrap justify-between items-center gap-3 shrink-0"
        style={{ background: "var(--navy-900)", borderBottom: "1px solid var(--glass-border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "0.01em" }}>Vessel Monitoring Dashboard</h2>
          {serverConnected && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="status-dot online"></span>
              <span className="text-[11px]" style={{ color: "#16a34a" }}>Connected to Flask Server</span>
            </div>
          )}
        </div>

        {/* WDPA Realm filter tabs */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--glass-border)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)", marginRight: 4 }}>Protected Zones</span>
          <button
            onClick={() => setShowWdpa(!showWdpa)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 focus:outline-none"
            style={showWdpa
              ? { background: "linear-gradient(135deg, #ef4444, #dc2626)", color: "#ffffff", border: "1px solid rgba(239,68,68,0.2)", boxShadow: "0 2px 8px rgba(239,68,68,0.25)" }
              : { background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid var(--glass-border)" }}
            title={showWdpa ? "Hide all protected zones" : "Show protected zones"}
          >
            <span style={{ 
              display: "inline-block", 
              width: 6, 
              height: 6, 
              borderRadius: "50%", 
              background: showWdpa ? "#ffffff" : "#94a3b8",
              boxShadow: showWdpa ? "0 0 6px #ffffff" : "none"
            }}></span>
            {showWdpa ? "Visible" : "Hidden"}
          </button>
          {showWdpa && (
            <div className="flex items-center gap-1.5 border-l pl-2.5 animate-fade-in" style={{ borderColor: "var(--glass-border)" }}>
              {ALL_REALMS.map((realm) => {
                const cfg = REALM_CONFIG[realm];
                const active = activeRealms.has(realm);
                return (
                  <button
                    key={realm}
                    onClick={() => toggleRealm(realm)}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 focus:outline-none"
                    style={active
                      ? { background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}35`, boxShadow: `0 1px 2px ${cfg.color}08` }
                      : { background: "transparent", color: "var(--text-muted)", border: "1px solid transparent", opacity: 0.5 }}
                    title={`${active ? "Hide" : "Show"} ${cfg.label} zones`}
                  >
                    <span>{cfg.icon}</span>
                    <span>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={showHeatmap ? "pro-btn-primary" : "pro-btn-ghost"}
            style={showHeatmap ? { background: "linear-gradient(135deg,#0f766e,#14b8a6)", boxShadow: "0 2px 12px rgba(20,184,166,0.25)" } : {}}
          >
            {showHeatmap ? "Hide" : "Show"} Depth Heatmap
          </button>
          <button
            onClick={() => {
              if (!drawMode) { setDrawMode(true); setDrawnPolygon(null); }
              else { setDrawMode(false); setDrawnPolygon(null); }
            }}
            className={drawMode ? "pro-btn-ghost" : "pro-btn-primary"}
            style={drawMode ? { color: "#fca5a5", borderColor: "rgba(239,68,68,0.25)" } : {}}
          >
            {drawMode ? "Exit Draw Mode" : "+ Add Geofence"}
          </button>
        </div>
      </div>

      {/* Drawing Instructions */}
      {drawMode && (
        <div
          className="animate-fade-in px-5 py-2.5 flex justify-between items-center text-sm"
          style={{ background: "rgba(37,99,235,0.05)", borderBottom: "1px solid rgba(37,99,235,0.12)", color: "#1d4ed8" }}
        >
          <p className="text-[12px] font-medium">Click on the map to add vertices. Need at least 3 points to complete a geofence.</p>
          {drawnPolygon && (
            <div className="flex gap-2 shrink-0 ml-4">
              <button
                onClick={completeGeofence}
                disabled={drawnPolygon.length < 3}
                className="pro-btn-primary text-[11px] py-1.5 px-3"
                style={drawnPolygon.length < 3 ? { opacity: 0.45, cursor: "not-allowed" } : { background: "linear-gradient(135deg,#166534,#16a34a)" }}
              >
                Complete ({drawnPolygon.length} pts)
              </button>
              <button onClick={cancelDrawing} className="pro-btn-ghost text-[11px] py-1.5 px-3">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 min-h-0 overflow-y-auto lg:overflow-hidden" style={{ background: "#f8fafc" }}>
        {/* Map Container */}
        <div className="flex-1 relative min-h-[450px] lg:h-full rounded-xl overflow-hidden shadow-2xl" style={{ border: "1px solid #e2e8f0" }}>
          {/* Alerts Section (Floating on Map) */}
          {alerts.length > 0 && (() => {
            // Merge intrusion log lookup by boat_id for enriched data
            const logByBoat = {};
            intrusionLog.forEach(r => { if (r.is_active) logByBoat[r.boat_id] = r; });

            // Live clock tick for duration display — re-renders every 1s via key
            const now = Date.now();

            const fmtDuration = (seconds) => {
              if (!seconds || seconds < 0) return '0s';
              const s = Math.floor(seconds);
              if (s < 60) return `${s}s`;
              const m = Math.floor(s / 60);
              if (m < 60) return `${m}m ${s % 60}s`;
              return `${Math.floor(m / 60)}h ${m % 60}m`;
            };

            const fmtTime = (iso) => {
              if (!iso) return '—';
              try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
              catch { return '—'; }
            };

            const badgeStyle = (category) => {
              if (category === 'illegal')    return { bg: 'rgba(239,68,68,0.13)',   color: '#dc2626', border: 'rgba(239,68,68,0.3)' };
              if (category === 'suspicious') return { bg: 'rgba(234,179,8,0.13)',   color: '#ca8a04', border: 'rgba(234,179,8,0.3)' };
              return                                { bg: 'rgba(34,197,94,0.10)',   color: '#16a34a', border: 'rgba(34,197,94,0.25)' };
            };

            return (
              <div
                className="absolute top-3 left-[56px] z-[1000] max-w-[340px] w-full flex flex-col gap-2 p-3.5 rounded-xl border animate-fade-in shadow-lg"
                style={{
                  background: "rgba(255, 255, 255, 0.96)",
                  backdropFilter: "blur(8px)",
                  borderColor: "rgba(239, 68, 68, 0.25)",
                  maxHeight: "calc(100% - 24px)",
                }}
              >
                <h3 className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "#dc2626" }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse-dot 1.5s infinite" }}></span>
                  Restricted Violations ({alerts.length})
                </h3>
                <div className="overflow-y-auto flex flex-col gap-2 pr-0.5" style={{ maxHeight: "400px" }}>
                  {alerts.map((alert) => {
                    const log = logByBoat[alert.boat_id] || {};
                    const classification = alert.classification || log.classification || {};
                    const category = classification.category || (alert.isSuspicious ? 'suspicious' : 'legal');
                    const badge = badgeStyle(category);

                    // Compute live duration
                    const entryTime = alert.entry_time || log.entry_time;
                    let liveDurSec = alert.actual_duration_sec || 0;
                    if (entryTime) {
                      try {
                        liveDurSec = Math.max(0, (now - new Date(entryTime).getTime()) / 1000);
                      } catch {}
                    }

                    const estMin = alert.est_duration_min ?? log.est_duration_min;

                    return (
                      <div
                        key={`${alert.boat_id}-alert`}
                        className="rounded-xl flex flex-col gap-1.5"
                        style={{ background: "rgba(239,68,68,0.03)", border: "1px solid rgba(239,68,68,0.10)", padding: "10px 12px" }}
                      >
                        {/* Row 1: Name + Classification badge */}
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <p className="font-bold text-[12px] text-slate-900">{alert.boat_name}</p>
                            {alert.geofence_name && (
                              <p className="text-[9px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: '#dc2626' }}>⚠ {alert.geofence_name}</p>
                            )}
                          </div>
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap"
                            style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
                          >
                            {classification.label || (category === 'illegal' ? '🔴 Illegal' : category === 'suspicious' ? '🟡 Suspicious' : '🟢 Legal')}
                          </span>
                        </div>

                        {/* Row 2: Coordinates */}
                        <p className="text-[10px] font-mono text-slate-400">
                          {alert.location.latitude.toFixed(5)}, {alert.location.longitude.toFixed(5)}
                        </p>

                        {/* Row 3: Time grid */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-1 pt-1.5" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Entry Time</p>
                            <p className="text-[11px] font-mono font-semibold text-slate-700 mt-0.5">{fmtTime(entryTime)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Exit Time</p>
                            <p className="text-[11px] font-mono font-semibold text-slate-700 mt-0.5">
                              {alert.exit_time ? fmtTime(alert.exit_time) : <span className="text-red-500 font-semibold">Still Inside</span>}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Duration inside zone</p>
                            <p className="text-[11px] font-mono font-bold mt-0.5" style={{ color: category === 'illegal' ? '#dc2626' : category === 'suspicious' ? '#ca8a04' : '#16a34a' }}>
                              {fmtDuration(liveDurSec)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Speed</p>
                            <p className="text-[11px] font-mono text-slate-600 mt-0.5">{alert.speed} km/h</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">Est. Transit</p>
                            <p className="text-[11px] font-mono text-slate-600 mt-0.5">
                              {estMin != null ? `${estMin.toFixed(1)} min` : '—'}
                            </p>
                          </div>
                        </div>

                        {/* Row 4: Reason */}
                        {classification.reason && (
                          <p className="text-[9px] mt-0.5 italic" style={{ color: category === 'illegal' ? '#dc2626' : category === 'suspicious' ? '#b45309' : '#15803d' }}>
                            {classification.reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <MapContainer
            center={MAP_CONFIG.DEFAULT_CENTER}
            zoom={MAP_CONFIG.DEFAULT_ZOOM}
            className="w-full h-full"
            ref={mapRef}
          >
            <MapClickHandler
              drawMode={drawMode}
              editMode={editMode}
              onMapClick={handleMapClick}
              onEditMapClick={addCoordinateToEdit}
            />
            <TileLayer
              url={MAP_CONFIG.TILE_LAYER}
              attribution={MAP_CONFIG.ATTRIBUTION}
            />

            {/* Seafloor depth heatmap layer */}
            {showHeatmap && <HeatmapLayer />}

            {/* ── Official Restricted Zones (WDPA) ─────────────── */}
            {showWdpa && wdpaFeatures
              .filter((f) => activeRealms.has(f.properties.REALM))
              .map((feature) => {
                const props = feature.properties;
                const realm = props.REALM || "Terrestrial";
                const cfg = REALM_CONFIG[realm] || REALM_CONFIG.Terrestrial;
                const geom = feature.geometry;
                if (!geom) return null;

                // Flatten MultiPolygon / Polygon rings to Leaflet [lat,lng] arrays
                const rings =
                  geom.type === "MultiPolygon"
                    ? geom.coordinates.flatMap((poly) =>
                        poly.map((ring) => ring.map(([lng, lat]) => [lat, lng]))
                      )
                    : geom.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]));

                return rings.map((positions, ri) => (
                  <Polygon
                    key={`wdpa-${props.SITE_ID}-${ri}`}
                    positions={positions}
                    pathOptions={{
                      color: "#ef4444",
                      weight: 1.5,
                      opacity: 0.75,
                      fillColor: "#ef4444",
                      fillOpacity: 0.12,
                      dashArray: "4 3",
                    }}
                  >
                    <Popup>
                      <div style={{ minWidth: 200, fontFamily: "Inter, sans-serif" }}>
                        {/* Header stripe */}
                        <div style={{
                          margin: "-8px -8px 10px -8px",
                          padding: "8px 12px",
                          background: `${cfg.color}18`,
                          borderBottom: `2px solid ${cfg.color}44`,
                          borderRadius: "10px 10px 0 0",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}>
                          <span style={{ fontSize: 14 }}>{cfg.icon}</span>
                          <div>
                            <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: cfg.color, marginBottom: 1 }}>Official Restricted Zone</p>
                            <p style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{props.NAME_ENG}</p>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 10px", fontSize: 10 }}>
                          {[
                            ["Realm", props.REALM],
                            ["Status", props.STATUS],
                            ["Designation", props.DESIG?.split(" (")[0] || props.DESIG],
                            ["IUCN Cat.", props.IUCN_CAT],
                            ["Area", props.GIS_AREA ? `${props.GIS_AREA.toFixed(1)} km²` : "—"],
                            ["Year", props.STATUS_YR || "—"],
                          ].map(([label, val]) => (
                            <div key={label}>
                              <p style={{ color: "#94a3b8", fontWeight: 600, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
                              <p style={{ color: "#1e293b", fontWeight: 500, marginTop: 1 }}>{val}</p>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: cfg.color }} />
                          <span style={{ fontSize: 9, color: cfg.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{realm} Protected Area · WDPA</span>
                        </div>
                      </div>
                    </Popup>
                  </Polygon>
                ));
              })
            }

            {/* Geofence Polygons */}
            {geofences.map((geofence) => (
              <Polygon
                key={geofence.id}
                positions={coordsToLeaflet(geofence.coordinates)}
                pathOptions={{
                  color:
                    geofence.type === "restricted"
                      ? "#ef4444"
                      : geofence.type === "safe_zone"
                        ? "#22c55e"
                        : "#eab308",
                  weight: 2,
                  opacity: 0.7,
                  fillColor:
                    geofence.type === "restricted"
                      ? "#ef4444"
                      : geofence.type === "safe_zone"
                        ? "#22c55e"
                        : "#eab308",
                  fillOpacity: 0.15,
                }}
              >
                <Popup>
                  <div className="p-1 min-w-[150px]">
                    <h3 className="font-bold text-slate-900 text-sm">{geofence.name}</h3>
                    <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                      <p><span className="font-semibold">Type:</span> {geofence.type}</p>
                      <p><span className="font-semibold">Vertices:</span> {geofence.coordinates.length}</p>
                      {geofence.description && (
                        <p className="mt-1 border-t pt-1 border-slate-200 italic">{geofence.description}</p>
                      )}
                    </div>
                  </div>
                </Popup>
              </Polygon>
            ))}

            {/* Drawn Polygon (while drawing) */}
            {drawnPolygon && drawnPolygon.length > 0 && (
              <>
                <Polygon
                  positions={coordsToLeaflet(drawnPolygon)}
                  pathOptions={{
                    color: "#3b82f6",
                    weight: 2,
                    opacity: 0.8,
                    fillColor: "#3b82f6",
                    fillOpacity: 0.1,
                  }}
                />
                {drawnPolygon.map((coord, idx) => (
                  <Marker
                    key={`drawn-${idx}`}
                    position={[coord[1], coord[0]]}
                    icon={L.icon({
                      iconUrl:
                        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIj48Y2lyY2xlIGN4PSIxMCIgY3k9IjEwIiByPSI4IiBmaWxsPSIjMzJhOGZmIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
                      iconSize: [16, 16],
                      iconAnchor: [8, 8],
                    })}
                  >
                    <Popup>Point {idx + 1}</Popup>
                  </Marker>
                ))}
              </>
            )}

            {/* Edited Geofence Polygon (while editing) */}
            {editMode && editedCoordinates && editedCoordinates.length > 0 && (
              <>
                {editedCoordinates.length >= 3 && (
                  <Polygon
                    positions={coordsToLeaflet(editedCoordinates)}
                    pathOptions={{
                      color: "#a855f7",
                      weight: 3,
                      opacity: 0.8,
                      fillColor: "#a855f7",
                      fillOpacity: 0.15,
                      dashArray: "5, 5",
                    }}
                  />
                )}
                {editedCoordinates.map((coord, idx) => (
                  <Marker
                    key={`edit-${idx}`}
                    position={[coord[1], coord[0]]}
                    icon={L.icon({
                      iconUrl:
                        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEwIiByPSI2IiBmaWxsPSIjYTI1NWY3IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==",
                      iconSize: [20, 20],
                      iconAnchor: [10, 10],
                    })}
                  >
                    <Popup>Edit Point {idx + 1}</Popup>
                  </Marker>
                ))}
              </>
            )}

            {/* ── Boat GPS Track Polyline ───────────────────────── */}
            {boatPath && boatPath.path && boatPath.path.length > 1 && (() => {
              const pts = boatPath.path.map(p => [p.lat, p.lng]);
              const first = pts[0];
              const last  = pts[pts.length - 1];
              return (
                <>
                  {/* Track line */}
                  <Polyline
                    positions={pts}
                    pathOptions={{
                      color: "#38bdf8",
                      weight: 3,
                      opacity: 0.85,
                      dashArray: null,
                    }}
                  />
                  {/* Start dot — green */}
                  <Marker
                    position={first}
                    icon={L.divIcon({
                      className: "",
                      html: `<div style="width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid #fff;box-shadow:0 0 6px rgba(34,197,94,0.7)"></div>`,
                      iconSize: [12, 12],
                      iconAnchor: [6, 6],
                    })}
                  >
                    <Popup><span style={{fontSize:12}}>&#x25CF; Track start<br/>{boatPath.path[0].timestamp}</span></Popup>
                  </Marker>
                  {/* End dot — yellow */}
                  <Marker
                    position={last}
                    icon={L.divIcon({
                      className: "",
                      html: `<div style="width:12px;height:12px;border-radius:50%;background:#facc15;border:2px solid #fff;box-shadow:0 0 6px rgba(250,204,21,0.7)"></div>`,
                      iconSize: [12, 12],
                      iconAnchor: [6, 6],
                    })}
                  >
                    <Popup><span style={{fontSize:12}}>&#x25CF; Latest position<br/>{boatPath.path[boatPath.path.length-1].timestamp}</span></Popup>
                  </Marker>
                </>
              );
            })()}

            {/* Vessel Markers */}
            {vessels.map((vessel) => {
              const inGeofence = vessel.in_restricted_zone || false;

              return (
                <Marker
                  key={vessel.id}
                  position={[vessel.lat, vessel.lng]}
                  icon={inGeofence ? boatIconRed : boatIcon}
                  title={vessel.name}
                  eventHandlers={{
                    click: () => {
                      if (pathVessel && pathVessel.id === vessel.id) {
                        // 2nd tap on the same vessel → open details modal
                        setSelectedVessel(vessel);
                      } else {
                        // 1st tap → draw path, close any open modal
                        setSelectedVessel(null);
                        setPathVessel(vessel);
                        fetchBoatPath(vessel);
                        if (mapRef.current) mapRef.current.setView([vessel.lat, vessel.lng], 14);
                      }
                    },
                  }}
                >
                  {/* No auto-opening Popup — path renders first; 2nd tap opens modal */}
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-80 flex flex-col gap-3 lg:max-h-full overflow-y-auto shrink-0">
          {/* Vessels List */}
          <div className="glass-card rounded-xl overflow-hidden flex flex-col">
            <div
              className="px-4 py-3 flex justify-between items-center"
              style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(37,99,235,0.04)" }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Fleet Status</span>
              <span className="pro-badge">{vessels.length} Active</span>
            </div>
            <div className="overflow-y-auto max-h-[500px] divide-y" style={{ borderColor: "var(--glass-border)" }}>
              {vessels.length === 0 ? (
                <div className="p-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
                  <p>No active vessels</p>
                  <p className="mt-1 text-[11px]">Vessels will appear automatically.</p>
                </div>
              ) : (() => {
                // Build lookup maps from live alerts and intrusion log
                const alertByBoat = {};
                alerts.forEach(a => { alertByBoat[a.boat_id] = a; });
                const activeLogByBoat = {};
                intrusionLog.forEach(r => { if (r.is_active) activeLogByBoat[r.boat_id] = r; });

                const fmtVesselDur = (secs) => {
                  if (!secs || secs < 0) return '0s';
                  const s = Math.floor(secs);
                  if (s < 60) return `${s}s`;
                  const m = Math.floor(s / 60);
                  if (m < 60) return `${m}m ${s % 60}s`;
                  return `${Math.floor(m / 60)}h ${m % 60}m`;
                };
                const fmtVesselTime = (iso) => {
                  if (!iso) return '—';
                  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
                  catch { return '—'; }
                };

                return vessels.map((vessel) => {
                  const inGeofence = vessel.in_restricted_zone || false;
                  const alertRec   = alertByBoat[vessel.id];
                  const logRec     = activeLogByBoat[vessel.id];

                  // Zone intrusion enrichment — prefer live alert, fall back to intrusion log
                  const classification = alertRec?.classification || logRec?.classification || {};
                  const category = classification.category || (inGeofence ? 'suspicious' : null);
                  const entryTime = alertRec?.entry_time || logRec?.entry_time;
                  const zoneName  = alertRec?.geofence_name || logRec?.geofence_name || '';
                  const avgSpd    = alertRec?.speed ?? logRec?.avg_speed_kmh ?? null;
                  const estMin    = alertRec?.est_duration_min ?? logRec?.est_duration_min ?? null;

                  // Live duration — recompute from entryTime for real-time ticking
                  let liveDurSec = alertRec?.actual_duration_sec || 0;
                  if (entryTime) {
                    try { liveDurSec = Math.max(0, (Date.now() - new Date(entryTime).getTime()) / 1000); } catch {}
                  }

                  const verdictStyle = (() => {
                    if (category === 'illegal')    return { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)', label: '🔴 Illegal' };
                    if (category === 'suspicious') return { color: '#f59e0b', bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.25)',  label: '🟡 Suspicious' };
                    return                                { color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.25)',  label: '🟢 Legal' };
                  })();

                  return (
                    <div key={vessel.id}>
                      {/* ── Main card row ── */}
                      <div
                        onClick={() => {
                          if (pathVessel && pathVessel.id === vessel.id) {
                            setSelectedVessel(vessel);
                          } else {
                            setSelectedVessel(null);
                            setPathVessel(vessel);
                            fetchBoatPath(vessel);
                            if (mapRef.current) mapRef.current.setView([vessel.lat, vessel.lng], 14);
                          }
                        }}
                        className="px-4 py-3 flex justify-between items-start cursor-pointer transition-all"
                        style={{
                          background: pathVessel && pathVessel.id === vessel.id
                            ? "rgba(56,189,248,0.08)"
                            : inGeofence ? "rgba(239,68,68,0.06)" : "transparent",
                          borderLeft: pathVessel && pathVessel.id === vessel.id
                            ? "3px solid rgba(56,189,248,0.7)"
                            : inGeofence ? "3px solid rgba(239,68,68,0.6)" : "3px solid transparent",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = pathVessel && pathVessel.id === vessel.id ? "rgba(56,189,248,0.13)" : inGeofence ? "rgba(239,68,68,0.10)" : "rgba(255,255,255,0.03)"}
                        onMouseLeave={e => e.currentTarget.style.background = pathVessel && pathVessel.id === vessel.id ? "rgba(56,189,248,0.08)" : inGeofence ? "rgba(239,68,68,0.06)" : "transparent"}
                      >
                        <div className="space-y-0.5 flex-1 min-w-0 mr-2">
                          <h4 className="font-semibold text-[13px]" style={{ color: "var(--text-primary)" }}>{vessel.name}</h4>
                          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{vessel.vessel_type} · {vessel.speed} kn · {vessel.heading}°</p>
                          <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{vessel.lat.toFixed(4)}, {vessel.lng.toFixed(4)}</p>
                          {inGeofence && zoneName && (
                            <p className="text-[9px] font-bold uppercase tracking-wider mt-0.5" style={{ color: '#dc2626' }}>⚠ {zoneName}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded"
                            style={vessel.status === "Active"
                              ? { background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" }
                              : { background: "rgba(234,179,8,0.1)", color: "#facc15", border: "1px solid rgba(234,179,8,0.2)" }}
                          >
                            {vessel.status}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); deleteVessel(vessel.id); }}
                            className="text-[11px] font-semibold px-1.5 py-0.5 rounded transition"
                            style={{ color: "var(--text-muted)" }}
                            onMouseEnter={e => { e.currentTarget.style.color = "#fca5a5"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
                            title="Remove vessel"
                          >✕</button>
                        </div>
                      </div>

                      {/* ── Zone intrusion detail panel (only when in restricted zone) ── */}
                      {inGeofence && (
                        <div
                          className="mx-3 mb-3 px-3 py-2.5 rounded-xl text-[10px] space-y-2"
                          style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.14)" }}
                        >
                          {/* Verdict badge row */}
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: '#dc2626' }}>
                              🚫 Restricted Zone Intrusion
                            </span>
                            {category && (
                              <span
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: verdictStyle.bg, color: verdictStyle.color, border: `1px solid ${verdictStyle.border}` }}
                              >
                                {verdictStyle.label}
                              </span>
                            )}
                          </div>

                          {/* Time grid */}
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                            <div>
                              <p className="text-[8px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Entry Time</p>
                              <p className="font-mono font-semibold mt-0.5" style={{ color: '#86efac', fontSize: 10 }}>
                                {fmtVesselTime(entryTime)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[8px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Time Inside</p>
                              <p className="font-mono font-bold mt-0.5" style={{
                                color: category === 'illegal' ? '#ef4444' : category === 'suspicious' ? '#f59e0b' : '#22c55e',
                                fontSize: 10
                              }}>
                                {fmtVesselDur(liveDurSec)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[8px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Avg Speed</p>
                              <p className="font-mono mt-0.5" style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                                {avgSpd != null ? `${parseFloat(avgSpd).toFixed(1)} km/h` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[8px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Est. Transit</p>
                              <p className="font-mono mt-0.5" style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                                {estMin != null ? `${parseFloat(estMin).toFixed(1)} min` : '—'}
                              </p>
                            </div>
                          </div>

                          {/* Classification reason */}
                          {classification.reason && (
                            <p className="text-[9px] italic leading-relaxed pt-1" style={{
                              color: category === 'illegal' ? '#fca5a5' : category === 'suspicious' ? '#fcd34d' : '#86efac',
                              borderTop: '1px solid rgba(255,255,255,0.05)'
                            }}>
                              {classification.reason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Path-active hint */}
          {pathVessel && !selectedVessel && (
            <div
              className="animate-fade-in px-4 py-2.5 rounded-xl text-[11px] flex items-center gap-2"
              style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", color: "#38bdf8" }}
            >
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#38bdf8", flexShrink: 0 }}></span>
              <span>Path shown for <strong>{pathVessel.name}</strong>. Tap the boat again to open details.</span>
              <button
                onClick={() => { setBoatPath(null); setPathVessel(null); }}
                style={{ marginLeft: "auto", flexShrink: 0, color: "#38bdf8", opacity: 0.7, fontWeight: 700, fontSize: 13 }}
                title="Clear track"
              >✕</button>
            </div>
          )}
          {/* Geofences List */}
          <div className="glass-card rounded-xl overflow-hidden flex flex-col">
            <div
              className="px-4 py-3 flex justify-between items-center"
              style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(37,99,235,0.04)" }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Geofence Zones</span>
              <span className="pro-badge">{geofences.length} Total</span>
            </div>
            <div className="overflow-y-auto max-h-[380px] divide-y" style={{ borderColor: "var(--glass-border)" }}>
              {geofences.length === 0 ? (
                <div className="p-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
                  <p>No geofences defined</p>
                  <p className="mt-1 text-[11px]">Use "+ Add Geofence" above to create one.</p>
                </div>
              ) : (
                geofences.map((geofence) => (
                  <div
                    key={geofence.id}
                    className="px-4 py-3 flex justify-between items-start transition-all"
                    style={{ background: "transparent" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.025)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div className="space-y-0.5">
                      <h4 className="font-semibold text-[13px]" style={{ color: "var(--text-primary)" }}>{geofence.name}</h4>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={geofence.type === "restricted"
                            ? { background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }
                            : geofence.type === "safe_zone"
                            ? { background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" }
                            : { background: "rgba(234,179,8,0.1)", color: "#facc15", border: "1px solid rgba(234,179,8,0.2)" }}
                        >{geofence.type}</span>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{geofence.coordinates.length} pts</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => startEditingGeofence(geofence)}
                        className="text-[11px] font-semibold px-2 py-1 rounded transition"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#93bbfd"; e.currentTarget.style.background = "rgba(37,99,235,0.1)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
                        title="Edit"
                      >Edit</button>
                      <button
                        onClick={() => deleteGeofence(geofence.id)}
                        className="text-[11px] font-semibold px-2 py-1 rounded transition"
                        style={{ color: "var(--text-muted)" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#fca5a5"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
                        title="Delete"
                      >✕</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Geofence Modal */}
      {editMode && editingGeofence && editedCoordinates && (
        <div className="fixed inset-0 flex items-center justify-center z-[9999]" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
          <div className="w-11/12 max-w-xl rounded-2xl overflow-hidden animate-fade-in" style={{ background: "var(--navy-900)", border: "1px solid var(--glass-border)", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>
            <div className="px-6 py-4 flex justify-between items-center" style={{ borderBottom: "1px solid var(--glass-border)" }}>
              <div>
                <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>Edit Zone</p>
                <h3 className="font-semibold text-[15px] mt-0.5" style={{ color: "var(--text-primary)" }}>{editingGeofence.name}</h3>
              </div>
              <button onClick={cancelEditGeofence} className="pro-btn-ghost text-sm py-1 px-2.5">✕</button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl p-3.5 text-[12px]" style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.15)", color: "#93bbfd" }}>
                Click on the map to add new vertices, or remove existing ones below. At least 3 points required.
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Vertices — {editedCoordinates.length} pts</p>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto p-3 rounded-xl" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--glass-border)" }}>
                  {editedCoordinates.map((coord, idx) => (
                    <div key={idx} className="flex justify-between items-center px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }}>
                      <span className="text-[11px] font-mono" style={{ color: "var(--text-secondary)" }}>Pt {idx+1}: [{coord[0].toFixed(5)}, {coord[1].toFixed(5)}]</span>
                      <button
                        onClick={() => removeCoordinateFromEdit(idx)}
                        disabled={editedCoordinates.length <= 3}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded transition"
                        style={editedCoordinates.length <= 3 ? { color: "var(--text-muted)", cursor: "not-allowed" } : { color: "#fca5a5", background: "rgba(239,68,68,0.08)" }}
                      >Remove</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={saveGeofenceEdit} className="flex-1 pro-btn-primary py-2.5" style={{ background: "linear-gradient(135deg,#166534,#16a34a)", boxShadow: "0 2px 12px rgba(22,163,74,0.25)" }}>Save Changes</button>
                <button onClick={cancelEditGeofence} className="flex-1 pro-btn-ghost py-2.5">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vessel Details Modal */}
      {selectedVessel && (() => {
        // Calculate approx total distance for path display
        let totalKm = 0;
        if (boatPath && boatPath.path && boatPath.path.length > 1) {
          for (let i = 1; i < boatPath.path.length; i++) {
            const a = boatPath.path[i - 1], b = boatPath.path[i];
            const R = 6371;
            const dLat = (b.lat - a.lat) * Math.PI / 180;
            const dLng = (b.lng - a.lng) * Math.PI / 180;
            const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
            totalKm += R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
          }
        }
        return (
        <div className="fixed inset-0 flex items-center justify-center z-[9999]" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
          <div className="w-11/12 max-w-xl rounded-2xl overflow-hidden animate-fade-in" style={{ background: "var(--navy-900)", border: "1px solid var(--glass-border)", boxShadow: "0 24px 80px rgba(0,0,0,0.6)" }}>
            {/* Modal Header */}
            <div className="px-6 py-4 flex items-start justify-between" style={{ borderBottom: "1px solid var(--glass-border)" }}>
              <div>
                <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>Vessel Details</p>
                <h2 className="font-bold text-[17px] mt-0.5" style={{ color: "var(--text-primary)" }}>{selectedVessel.name}</h2>
                <p className="text-[11px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>ID: {selectedVessel.id}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button onClick={() => setSelectedVessel(null)} className="pro-btn-ghost text-sm py-1 px-2.5">✕</button>
                <span
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                  style={selectedVessel.status === "Active"
                    ? { background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" }
                    : { background: "rgba(234,179,8,0.1)", color: "#facc15", border: "1px solid rgba(234,179,8,0.2)" }}
                >{selectedVessel.status}</span>
                {selectedVessel.in_restricted_zone && (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}>⚠ Restricted Zone</span>
                )}
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-4">
                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>Vessel Info</p>
                  {[
                    ["Type", selectedVessel.vessel_type],
                    ["Crew", `${selectedVessel.crew_count} members`],
                    ["Destination", selectedVessel.destination || "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</p>
                      <p className="text-[13px] font-medium mt-0.5" style={{ color: "var(--text-primary)" }}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--text-muted)" }}>Movement</p>
                  {[
                    ["Speed", `${selectedVessel.speed} knots`],
                    ["Heading", `${selectedVessel.heading}°`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</p>
                      <p className="text-[13px] font-medium mt-0.5" style={{ color: "var(--text-primary)" }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Coordinates block */}
              <div className="p-4 rounded-xl" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--glass-border)" }}>
                <p className="text-[10px] uppercase tracking-wider mb-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Position</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Latitude</p>
                    <p className="font-mono text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{selectedVessel.lat.toFixed(6)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Longitude</p>
                    <p className="font-mono text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{selectedVessel.lng.toFixed(6)}</p>
                  </div>
                </div>
              </div>

              {/* Today's Path Summary */}
              <div className="p-4 rounded-xl" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.2)" }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "#38bdf8" }}>
                    Today's Track
                  </p>
                  {pathLoading && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Loading…</span>
                  )}
                  {boatPath && !pathLoading && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(56,189,248,0.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,0.25)" }}>
                      {boatPath.count} points
                    </span>
                  )}
                </div>
                {boatPath && !pathLoading && boatPath.count > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Points</p>
                      <p className="text-[14px] font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>{boatPath.count}</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Distance</p>
                      <p className="text-[14px] font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>{totalKm.toFixed(2)} km</p>
                    </div>
                    <div>
                      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Date</p>
                      <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--text-secondary)" }}>{boatPath.date}</p>
                    </div>
                  </div>
                ) : !pathLoading ? (
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>No track data for today yet.</p>
                ) : null}
                {boatPath && boatPath.count > 0 && (
                  <div className="mt-3 flex items-center gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#22c55e", marginRight: 4, verticalAlign: "middle" }}></span>Start
                    <span style={{ display: "inline-block", width: 30, height: 2, background: "#38bdf8", verticalAlign: "middle" }}></span>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#facc15", marginLeft: 4, verticalAlign: "middle" }}></span>Current
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1" style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "16px" }}>
                <button
                  onClick={() => { setBoatPath(null); setPathVessel(null); setSelectedVessel(null); }}
                  className="pro-btn-ghost py-2.5 px-3"
                  style={{ color: "#38bdf8", borderColor: "rgba(56,189,248,0.25)" }}
                  title="Clear track from map"
                >Clear Track</button>
                <button
                  onClick={() => deleteVessel(selectedVessel.id)}
                  className="flex-1 pro-btn-ghost py-2.5"
                  style={{ color: "#fca5a5", borderColor: "rgba(239,68,68,0.25)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                >Remove Vessel</button>
                <button onClick={() => { setBoatPath(null); setPathVessel(null); setSelectedVessel(null); }} className="flex-1 pro-btn-primary py-2.5">Close</button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};

export default DashboardPage;
