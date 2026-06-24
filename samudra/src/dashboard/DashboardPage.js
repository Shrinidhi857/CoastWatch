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
  const [geofences, setGeofences] = useState([]);
  const [drawMode, setDrawMode] = useState(false);
  const [alerts, setAlerts] = useState([]);
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

  // Fetch alerts from server
  const fetchAlerts = async () => {
    try {
      const alertsData = await alertsAPI.getAll();
      setAlerts(alertsData);
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
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest mr-1" style={{ color: "var(--text-muted)" }}>Protected Zones</span>
          <button
            onClick={() => setShowWdpa(!showWdpa)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all"
            style={showWdpa
              ? { background: "rgba(239,68,68,0.10)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.22)" }
              : { background: "rgba(100,116,139,0.08)", color: "#64748b", border: "1px solid #e2e8f0" }}
            title={showWdpa ? "Hide all WDPA zones" : "Show WDPA zones"}
          >
            {showWdpa ? "🔴 Visible" : "⬜ Hidden"}
          </button>
          {showWdpa && ALL_REALMS.map((realm) => {
            const cfg = REALM_CONFIG[realm];
            const active = activeRealms.has(realm);
            return (
              <button
                key={realm}
                onClick={() => toggleRealm(realm)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                style={active
                  ? { background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}44` }
                  : { background: "rgba(100,116,139,0.06)", color: "#94a3b8", border: "1px solid #e2e8f0", textDecoration: "line-through" }}
                title={`${active ? "Hide" : "Show"} ${cfg.label} zones`}
              >
                {cfg.icon} {cfg.label}
              </button>
            );
          })}
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
          {alerts.length > 0 && (
            <div
              className="absolute top-3 left-[56px] z-[1000] max-w-[320px] w-full flex flex-col gap-2 p-3.5 rounded-xl border animate-fade-in shadow-lg"
              style={{
                background: "rgba(255, 255, 255, 0.95)",
                backdropFilter: "blur(8px)",
                borderColor: "rgba(239, 68, 68, 0.25)",
                maxHeight: "calc(100% - 24px)",
              }}
            >
              <h3 className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "#dc2626" }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse-dot 1.5s infinite" }}></span>
                Restricted Violations ({alerts.length})
              </h3>
              <div className="overflow-y-auto flex flex-col gap-1.5 pr-0.5" style={{ maxHeight: "220px" }}>
                {alerts.map((alert) => (
                  <div
                    key={`${alert.boat_id}-alert`}
                    className="p-2.5 rounded-lg flex flex-col justify-between"
                    style={{ background: "rgba(239, 68, 68, 0.04)", border: "1px solid rgba(239, 68, 68, 0.08)" }}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-xs text-slate-900">{alert.boat_name}</p>
                        <p className="text-[10px] mt-0.5 text-slate-500 font-mono">
                          {alert.location.latitude.toFixed(5)}, {alert.location.longitude.toFixed(5)}
                        </p>
                      </div>
                      <span
                        className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded"
                        style={{ background: alert.severity === "high" ? "rgba(239,68,68,0.12)" : "rgba(234,88,12,0.12)", color: alert.severity === "high" ? "#dc2626" : "#ea580c" }}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] pt-1.5 mt-1 border-t border-slate-100 text-slate-500">
                      <p>Speed: <span className="font-semibold text-slate-700">{alert.speed} km/h</span></p>
                      <p className="text-[9px]">{alert.updated_at ? new Date(alert.updated_at).toLocaleTimeString() : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                      color: cfg.color,
                      weight: 1.5,
                      opacity: 0.75,
                      fillColor: cfg.fill,
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
            <div className="overflow-y-auto max-h-[380px] divide-y" style={{ borderColor: "var(--glass-border)" }}>
              {vessels.length === 0 ? (
                <div className="p-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
                  <p>No active vessels</p>
                  <p className="mt-1 text-[11px]">Vessels will appear automatically.</p>
                </div>
              ) : (
                vessels.map((vessel) => {
                  const inGeofence = vessel.in_restricted_zone || false;
                  return (
                    <div
                      key={vessel.id}
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
                      <div className="space-y-0.5">
                        <h4 className="font-semibold text-[13px]" style={{ color: "var(--text-primary)" }}>{vessel.name}</h4>
                        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{vessel.vessel_type} · {vessel.speed} kn · {vessel.heading}°</p>
                        <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{vessel.lat.toFixed(4)}, {vessel.lng.toFixed(4)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
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
                  );
                })
              )}
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
