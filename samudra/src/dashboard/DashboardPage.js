import React, { useState, useRef, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
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

  // Selected boat for detailed view
  const [selectedVessel, setSelectedVessel] = useState(null);

  // Heatmap state
  const [showHeatmap, setShowHeatmap] = useState(false);

  const mapRef = useRef();
  const boatsIntervalRef = useRef(null);
  const alertsIntervalRef = useRef(null);

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
        <div className="animate-fade-in px-5 py-2.5 text-center text-sm font-medium" style={{ background: "rgba(239,68,68,0.12)", borderBottom: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
          <span className="font-bold">Server Connection Error</span> — {error}
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="animate-fade-in px-5 py-2.5 text-center text-sm font-medium" style={{ background: "rgba(37,99,235,0.10)", borderBottom: "1px solid rgba(37,99,235,0.2)", color: "#93bbfd" }}>
          Connecting to server and loading vessel data…
        </div>
      )}

      {/* Sub-header toolbar */}
      <div
        className="px-5 py-3 flex justify-between items-center shrink-0"
        style={{ background: "var(--navy-900)", borderBottom: "1px solid var(--glass-border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "0.01em" }}>Vessel Monitoring Dashboard</h2>
          {serverConnected && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="status-dot online"></span>
              <span className="text-[11px]" style={{ color: "#4ade80" }}>Connected to Flask Server</span>
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
          style={{ background: "rgba(37,99,235,0.08)", borderBottom: "1px solid rgba(37,99,235,0.18)", color: "#93bbfd" }}
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

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div
          className="animate-fade-in px-5 py-3"
          style={{ background: "rgba(239,68,68,0.07)", borderBottom: "1px solid rgba(239,68,68,0.18)" }}
        >
          <h3 className="text-[11px] font-semibold uppercase tracking-widest mb-2.5 flex items-center gap-2" style={{ color: "#f87171" }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse-dot 1.5s infinite" }}></span>
            Restricted Zone Violations — {alerts.length} Active
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {alerts.map((alert) => (
              <div
                key={`${alert.boat_id}-alert`}
                className="p-3 rounded-xl flex flex-col justify-between"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-[13px]" style={{ color: "#fca5a5" }}>{alert.boat_name}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {alert.location.latitude.toFixed(5)}, {alert.location.longitude.toFixed(5)}
                    </p>
                  </div>
                  <span
                    className="text-[10px] uppercase font-bold px-2 py-0.5 rounded"
                    style={{ background: alert.severity === "high" ? "rgba(239,68,68,0.25)" : "rgba(234,88,12,0.25)", color: alert.severity === "high" ? "#fca5a5" : "#fdba74" }}
                  >
                    {alert.severity}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[11px] pt-2 mt-1" style={{ borderTop: "1px solid rgba(239,68,68,0.15)", color: "var(--text-muted)" }}>
                  <p>Speed: <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>{alert.speed} km/h</span></p>
                  <p className="text-[10px]">{alert.updated_at ? new Date(alert.updated_at).toLocaleTimeString() : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex gap-4 p-4 min-h-0" style={{ background: "var(--navy-950)" }}>
        {/* Map Container */}
        <div className="flex-1 relative h-full rounded-xl overflow-hidden shadow-2xl" style={{ border: "1px solid var(--glass-border)" }}>
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
                    click: () => setSelectedVessel(vessel),
                  }}
                >
                  <Popup>
                    <div className="p-2 w-60">
                      <h3 className="font-bold text-base text-slate-900">
                        {vessel.name}
                      </h3>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between border-b pb-0.5">
                          <span className="font-semibold">Status:</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              vessel.status === "Active"
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {vessel.status}
                          </span>
                        </div>
                        <div className="flex justify-between border-b pb-0.5">
                          <span className="font-semibold">Speed:</span>
                          <span>{vessel.speed} knots</span>
                        </div>
                        <div className="flex justify-between border-b pb-0.5">
                          <span className="font-semibold">Heading:</span>
                          <span>{vessel.heading}°</span>
                        </div>
                        <div className="flex justify-between border-b pb-0.5">
                          <span className="font-semibold">Crew:</span>
                          <span>{vessel.crew_count}</span>
                        </div>
                        <div className="pt-1 text-[10px] text-slate-400">
                          {vessel.lat.toFixed(5)}, {vessel.lng.toFixed(5)}
                        </div>
                        {inGeofence && (
                          <div className="mt-1 bg-red-50 border border-red-200 text-red-700 font-bold p-1 rounded text-center text-[10px]">
                            ⚠️ RESTRICTED ZONE VIOLATION
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => setSelectedVessel(vessel)}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-semibold transition"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => deleteVessel(vessel.id)}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs font-semibold transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        {/* Sidebar */}
        <div className="w-80 flex flex-col gap-3 max-h-full overflow-y-auto">
          {/* Vessels List */}
          <div className="glass-card rounded-xl overflow-hidden flex flex-col">
            <div
              className="px-4 py-3 flex justify-between items-center"
              style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(30,53,102,0.4)" }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Fleet Status</span>
              <span className="pro-badge">{vessels.length} Active</span>
            </div>
            <div className="overflow-y-auto max-h-[290px] divide-y" style={{ borderColor: "var(--glass-border)" }}>
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
                        setSelectedVessel(vessel);
                        if (mapRef.current) mapRef.current.setView([vessel.lat, vessel.lng], 12);
                      }}
                      className="px-4 py-3 flex justify-between items-start cursor-pointer transition-all"
                      style={{
                        background: inGeofence ? "rgba(239,68,68,0.06)" : "transparent",
                        borderLeft: inGeofence ? "3px solid rgba(239,68,68,0.6)" : "3px solid transparent",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = inGeofence ? "rgba(239,68,68,0.10)" : "rgba(255,255,255,0.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = inGeofence ? "rgba(239,68,68,0.06)" : "transparent"}
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

          {/* Geofences List */}
          <div className="glass-card rounded-xl overflow-hidden flex flex-col">
            <div
              className="px-4 py-3 flex justify-between items-center"
              style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(14,31,61,0.6)" }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Geofence Zones</span>
              <span className="pro-badge">{geofences.length} Total</span>
            </div>
            <div className="overflow-y-auto max-h-[290px] divide-y" style={{ borderColor: "var(--glass-border)" }}>
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
      {selectedVessel && (
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

              {/* Actions */}
              <div className="flex gap-3 pt-1" style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "16px" }}>
                <button
                  onClick={() => deleteVessel(selectedVessel.id)}
                  className="flex-1 pro-btn-ghost py-2.5"
                  style={{ color: "#fca5a5", borderColor: "rgba(239,68,68,0.25)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
                  onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                >Remove Vessel</button>
                <button onClick={() => setSelectedVessel(null)} className="flex-1 pro-btn-primary py-2.5">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
