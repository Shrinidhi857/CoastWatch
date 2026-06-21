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
    <div className="w-full h-full flex flex-col flex-1">
      {/* Server Connection Status */}
      {!serverConnected && (
        <div className="bg-red-600 text-white px-4 py-3 text-center">
          <p className="font-bold">⚠️ Server Connection Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="bg-blue-600 text-white px-4 py-3 text-center">
          <p className="font-bold">Loading data from server...</p>
        </div>
      )}

      {/* Header controls inside page */}
      <div className="bg-slate-900 border-b border-slate-800 text-white p-4 shadow-lg flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold">Vessel Monitoring Dashboard</h2>
          {serverConnected && (
            <p className="text-xs text-green-400 mt-0.5">
              ● Connected to Flask Server
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-4 py-2 rounded font-semibold text-sm transition ${
              showHeatmap
                ? "bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-600/20"
                : "bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
            }`}
          >
            {showHeatmap ? "Hide" : "Show"} Depth Heatmap
          </button>
          <button
            onClick={() => {
              if (!drawMode) {
                setDrawMode(true);
                setDrawnPolygon(null);
              } else {
                setDrawMode(false);
                setDrawnPolygon(null);
              }
            }}
            className={`px-4 py-2 rounded font-semibold text-sm transition ${
              drawMode
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20"
            }`}
          >
            {drawMode ? "Exit Draw Mode" : "Add Geofence"}
          </button>
        </div>
      </div>

      {/* Drawing Instructions */}
      {drawMode && (
        <div className="bg-blue-950/80 border-b border-blue-900/50 p-3 text-sm text-blue-200 px-6 flex justify-between items-center">
          <p>
            📍 Click on the map to add vertices. Complete the geofence once you have at least 3 points.
          </p>
          {drawnPolygon && (
            <div className="flex gap-2">
              <button
                onClick={completeGeofence}
                disabled={drawnPolygon.length < 3}
                className={`px-3 py-1.5 rounded text-xs font-semibold ${
                  drawnPolygon.length >= 3
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-slate-700 text-slate-500 cursor-not-allowed"
                }`}
              >
                Complete Geofence ({drawnPolygon.length} pts)
              </button>
              <button
                onClick={cancelDrawing}
                className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="bg-red-950/40 border-b border-red-900/40 p-4 px-6">
          <h3 className="text-red-400 font-bold mb-3 flex items-center gap-2">
            <span>⚠️</span> Vessels in Restricted Zones ({alerts.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {alerts.map((alert) => (
              <div
                key={`${alert.boat_id}-alert`}
                className="bg-slate-900/90 border border-red-900/50 p-3 rounded-lg shadow-md flex flex-col justify-between"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-bold text-red-400">{alert.boat_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Lat: {alert.location.latitude.toFixed(5)}, Lng: {alert.location.longitude.toFixed(5)}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-white text-[10px] uppercase font-bold rounded ${
                      alert.severity === "high" ? "bg-red-600" : "bg-orange-600"
                    }`}
                  >
                    {alert.severity}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-400 border-t border-slate-800/80 pt-2 mt-1">
                  <p>Speed: <span className="text-slate-200 font-semibold">{alert.speed} km/h</span></p>
                  <p className="text-[10px] text-slate-500">{alert.updated_at ? new Date(alert.updated_at).toLocaleTimeString() : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex gap-4 p-4 bg-slate-950 min-h-0">
        {/* Map Container */}
        <div className="flex-1 relative h-full rounded-xl overflow-hidden border border-slate-800 shadow-xl">
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
        <div className="w-96 flex flex-col gap-4 max-h-full overflow-y-auto pr-1">
          {/* Vessels List */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
            <div className="bg-blue-950/70 border-b border-blue-900/40 p-4 font-bold text-white flex justify-between items-center">
              <span>Fleet Status</span>
              <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-semibold">
                {vessels.length} Active
              </span>
            </div>
            <div className="overflow-y-auto max-h-[300px] divide-y divide-slate-800/60">
              {vessels.length === 0 ? (
                <div className="p-6 text-slate-500 text-center text-sm">
                  <p>No vessels available</p>
                  <p className="text-xs mt-1 text-slate-600">
                    Active vessels will appear here automatically.
                  </p>
                </div>
              ) : (
                vessels.map((vessel) => {
                  const inGeofence = vessel.in_restricted_zone || false;

                  return (
                    <div
                      key={vessel.id}
                      onClick={() => {
                        setSelectedVessel(vessel);
                        if (mapRef.current) {
                          mapRef.current.setView([vessel.lat, vessel.lng], 12);
                        }
                      }}
                      className={`p-4 hover:bg-slate-800/40 transition cursor-pointer flex justify-between items-start ${
                        inGeofence ? "bg-red-950/20 border-l-4 border-l-red-500" : ""
                      }`}
                    >
                      <div className="space-y-1">
                        <h4 className="font-bold text-slate-200 text-sm">
                          {vessel.name}
                        </h4>
                        <p className="text-xs text-slate-400">
                          {vessel.vessel_type} • {vessel.speed} kn • {vessel.heading}°
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {vessel.lat.toFixed(4)}, {vessel.lng.toFixed(4)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                            vessel.status === "Active"
                              ? "bg-green-500/10 text-green-400 border border-green-500/20"
                              : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                          }`}
                        >
                          {vessel.status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteVessel(vessel.id);
                          }}
                          className="text-slate-500 hover:text-red-400 hover:bg-slate-800/80 px-1.5 py-0.5 rounded transition text-xs font-bold"
                          title="Delete vessel"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Geofences List */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
            <div className="bg-slate-950 border-b border-slate-800 p-4 font-bold text-white flex justify-between items-center">
              <span>Geofences</span>
              <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-semibold">
                {geofences.length} Total
              </span>
            </div>
            <div className="overflow-y-auto max-h-[300px] divide-y divide-slate-800/60">
              {geofences.length === 0 ? (
                <div className="p-6 text-slate-500 text-center text-sm">
                  <p>No geofences set</p>
                  <p className="text-xs mt-1 text-slate-600">
                    Click "Add Geofence" to create one
                  </p>
                </div>
              ) : (
                geofences.map((geofence) => (
                  <div
                    key={geofence.id}
                    className="p-4 hover:bg-slate-800/40 transition flex justify-between items-start"
                  >
                    <div className="space-y-1">
                      <h4 className="font-bold text-slate-200 text-sm">
                        {geofence.name}
                      </h4>
                      <p className="text-xs text-slate-400">
                        Type:{" "}
                        <span
                          className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold ${
                            geofence.type === "restricted"
                              ? "bg-red-500/10 text-red-400 border border-red-500/20"
                              : geofence.type === "safe_zone"
                                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                          }`}
                        >
                          {geofence.type}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Vertices: {geofence.coordinates.length}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => startEditingGeofence(geofence)}
                        className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 px-2 py-1 rounded transition text-xs font-bold"
                        title="Edit geofence"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => deleteGeofence(geofence.id)}
                        className="text-red-400 hover:text-red-350 hover:bg-red-900/30 px-2 py-1 rounded transition text-xs font-bold"
                        title="Delete geofence"
                      >
                        ✕
                      </button>
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
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[9999] backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-11/12 max-w-xl overflow-hidden">
            <div className="bg-slate-950 border-b border-slate-800 text-white p-4 px-6 font-bold flex justify-between items-center">
              <span>Edit Geofence: {editingGeofence.name}</span>
              <button
                onClick={cancelEditGeofence}
                className="text-lg font-bold text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-950/20 border border-blue-900/40 rounded-xl p-4 text-xs text-blue-200">
                <p className="font-semibold mb-1">💡 Instructions:</p>
                <p className="opacity-80">
                  You can click on the map to add new points. Click "Remove" next to any coordinates below to delete points. At least 3 points are required to save.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-sm text-slate-350 mb-2">
                  Coordinates List ({editedCoordinates.length} vertices):
                </h4>
                <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto border border-slate-800 rounded-xl p-3 bg-slate-950">
                  {editedCoordinates.map((coord, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center bg-slate-900/80 p-2 px-3 rounded-lg border border-slate-800 text-xs"
                    >
                      <span className="font-mono text-slate-300">
                        Pt {idx + 1}: [{coord[0].toFixed(5)}, {coord[1].toFixed(5)}]
                      </span>
                      <button
                        onClick={() => removeCoordinateFromEdit(idx)}
                        disabled={editedCoordinates.length <= 3}
                        className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                          editedCoordinates.length <= 3
                            ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                            : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        }`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={saveGeofenceEdit}
                  className="flex-1 bg-green-600 text-white font-semibold py-2.5 px-4 rounded-xl hover:bg-green-700 transition text-sm"
                >
                  ✓ Save Changes
                </button>
                <button
                  onClick={cancelEditGeofence}
                  className="flex-1 bg-slate-800 text-slate-300 font-semibold py-2.5 px-4 rounded-xl hover:bg-slate-700 transition text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Boat Details Modal */}
      {selectedVessel && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[9999] backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-11/12 max-w-xl overflow-hidden">
            <div className="bg-slate-950 border-b border-slate-800 text-white p-4 px-6 font-bold flex justify-between items-center">
              <span>⚓ Vessel Details: {selectedVessel.name}</span>
              <button
                onClick={() => setSelectedVessel(null)}
                className="text-lg font-bold text-slate-400 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6 text-sm text-slate-300">
              <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedVessel.name}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Database ID: {selectedVessel.id}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                      selectedVessel.status === "Active"
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                    }`}
                  >
                    {selectedVessel.status}
                  </span>
                  {selectedVessel.in_restricted_zone && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-bold">
                      ⚠️ Restricted Zone
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider text-slate-400">Vessel Info</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold">
                        Vessel Type
                      </label>
                      <p className="text-slate-200 mt-0.5">{selectedVessel.vessel_type}</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold">
                        Crew Count
                      </label>
                      <p className="text-slate-200 mt-0.5">{selectedVessel.crew_count} members</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold">
                        Destination
                      </label>
                      <p className="text-slate-200 mt-0.5">{selectedVessel.destination || "Not set"}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider text-slate-400">Movement Data</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold">
                        Speed
                      </label>
                      <p className="text-slate-200 mt-0.5">{selectedVessel.speed} knots</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase font-semibold">
                        Heading
                      </label>
                      <p className="text-slate-200 mt-0.5">{selectedVessel.heading}°</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <h3 className="font-bold text-white text-xs uppercase tracking-wider text-slate-400 mb-2">Coordinates</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold">
                      Latitude
                    </label>
                    <p className="text-slate-200 mt-0.5 font-mono">{selectedVessel.lat.toFixed(6)}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase font-semibold">
                      Longitude
                    </label>
                    <p className="text-slate-200 mt-0.5 font-mono">{selectedVessel.lng.toFixed(6)}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-800">
                <button
                  onClick={() => deleteVessel(selectedVessel.id)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-xl font-semibold transition text-sm"
                >
                  Delete Vessel
                </button>
                <button
                  onClick={() => setSelectedVessel(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-350 py-2 px-4 rounded-xl font-semibold transition text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
