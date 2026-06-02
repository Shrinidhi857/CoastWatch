import React, { useState, useRef, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  boatsAPI,
  geofencesAPI,
  geofenceCheckAPI,
  alertsAPI,
  systemAPI,
} from "./services/apiService";
import {
  formatBoatFromServer,
  formatGeofenceFromServer,
  formatBoatForServer,
  formatGeofenceForServer,
  coordsToLeaflet,
} from "./utils/helpers";
import { MAP_CONFIG } from "./config/config";

// Custom boat icon
const boatIcon = new L.Icon({
  iconUrl:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cGF0aCBkPSJNMTYgMkw0IDEwdjE2aDAuNXYyaDA3djIuNWgxdjIuNWg3di0yLjVoMXYtMmgwLjVWMTB6IiBmaWxsPSIjMjc3NGQ5IiBzdHJva2U9IiMxYTQzYjAiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9zdmc+",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
  className: "boat-marker",
});

// Red boat icon for vessels in restricted zones
const boatIconRed = new L.Icon({
  iconUrl:
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cGF0aCBkPSJNMTYgMkw0IDEwdjE2aDAuNXYyaDA3djIuNWgxdjIuNWg3di0yLjVoMXYtMmgwLjVWMTB6IiBmaWxsPSIjZGMyNjI2IiBzdHJva2U9IiM5OTAxMDEiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9zdmc+",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
  className: "boat-marker-alert",
});

// Point-in-polygon algorithm
const isPointInPolygon = (point, polygon) => {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
};

// MapClickHandler component to capture map clicks
const MapClickHandler = ({ drawMode, onMapClick, drawnPolygon }) => {
  useMapEvents({
    click: (e) => {
      if (drawMode) {
        const { lat, lng } = e.latlng;
        onMapClick([lng, lat]);
      }
    },
  });
  return null;
};

const VesselMap = () => {
  const [vessels, setVessels] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [drawMode, setDrawMode] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [drawnPolygon, setDrawnPolygon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serverConnected, setServerConnected] = useState(false);
  const mapRef = useRef();
  const boatsIntervalRef = useRef(null);
  const alertsIntervalRef = useRef(null);

  // Initialize and fetch data from server
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Check server health first
        await systemAPI.health();
        setServerConnected(true);
        setError(null);

        // Fetch initial data
        await fetchBoats();
        await fetchGeofences();
        await fetchAlerts();

        setLoading(false);

        // Set up polling intervals
        boatsIntervalRef.current = setInterval(() => {
          fetchBoats();
        }, 5000); // Refresh boats every 5 seconds

        alertsIntervalRef.current = setInterval(() => {
          fetchAlerts();
        }, 3000); // Refresh alerts every 3 seconds
      } catch (err) {
        console.error("Failed to initialize app:", err);
        setServerConnected(false);
        setError(
          "Unable to connect to server. Make sure the Flask server is running on http://localhost:5000",
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
        formatBoatFromServer(boat),
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
        formatGeofenceFromServer(gf),
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
        await fetchGeofences(); // Refresh geofences from server
        setDrawnPolygon(null);
        setDrawMode(false);
      } catch (err) {
        console.error("Error creating geofence:", err);
        alert(`Failed to create geofence: ${err.message || "Please try again."}`);
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
      await fetchGeofences(); // Refresh geofences from server
    } catch (err) {
      console.error("Error deleting geofence:", err);
      alert("Failed to delete geofence. Please try again.");
    }
  };

  const deleteVessel = async (id) => {
    try {
      await boatsAPI.delete(id);
      await fetchBoats(); // Refresh boats from server
    } catch (err) {
      console.error("Error deleting boat:", err);
      alert("Failed to delete boat. Please try again.");
    }
  };

  return (
    <div className="w-full h-screen flex flex-col">
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

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-900 to-blue-700 text-white p-6 shadow-lg">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Vessel Monitoring Dashboard</h1>
            <p className="text-blue-100 mt-1">
              Real-time tracking with Geofencing (Server-Connected)
            </p>
            {serverConnected && (
              <p className="text-xs text-green-300 mt-1">
                ✓ Connected to Flask Server
              </p>
            )}
          </div>
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
            className={`px-4 py-2 rounded font-semibold transition ${
              drawMode
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {drawMode ? "Exit Draw Mode" : "Add Geofence"}
          </button>
        </div>

        {/* Drawing Instructions */}
        {drawMode && (
          <div className="mt-3 bg-blue-800 p-2 rounded text-sm">
            <p>
              Click on the map to add points. Once you have at least 3 points,
              click "Complete Geofence"
            </p>
            {drawnPolygon && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={completeGeofence}
                  disabled={drawnPolygon.length < 3}
                  className={`px-3 py-1 rounded text-sm ${
                    drawnPolygon.length >= 3
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  Complete Geofence ({drawnPolygon.length} points)
                </button>
                <button
                  onClick={cancelDrawing}
                  className="px-3 py-1 rounded text-sm bg-yellow-500 hover:bg-yellow-600"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-4 rounded">
          <h3 className="text-red-800 font-bold mb-3">
            ⚠️ Vessels in Restricted Zones ({alerts.length})
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {alerts.map((alert) => (
              <div
                key={`${alert.boat_id}-alert`}
                className="bg-white border-l-4 border-red-600 p-3 rounded shadow-md"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-bold text-red-700">{alert.boat_name}</p>
                    <p className="text-sm text-red-600">
                      Position: {alert.location.latitude.toFixed(4)},{" "}
                      {alert.location.longitude.toFixed(4)}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 text-white text-xs font-bold rounded ${
                      alert.severity === "high" ? "bg-red-600" : "bg-orange-600"
                    }`}
                  >
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-gray-700 space-y-1">
                  <p>Speed: {alert.speed} knots</p>
                  <p>Status: {alert.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex gap-4 p-4 bg-gray-100">
        {/* Map Container */}
        <div className="flex-1">
          <MapContainer
            center={MAP_CONFIG.DEFAULT_CENTER}
            zoom={MAP_CONFIG.DEFAULT_ZOOM}
            className="w-full h-full rounded-lg shadow-lg"
            ref={mapRef}
          >
            <MapClickHandler
              drawMode={drawMode}
              onMapClick={handleMapClick}
              drawnPolygon={drawnPolygon}
            />
            <TileLayer
              url={MAP_CONFIG.TILE_LAYER}
              attribution={MAP_CONFIG.ATTRIBUTION}
            />

            {/* Geofence Polygons */}
            {geofences.map((geofence) => (
              <Polygon
                key={geofence.id}
                positions={coordsToLeaflet(geofence.coordinates)}
                pathOptions={{
                  color:
                    geofence.type === "restricted"
                      ? "red"
                      : geofence.type === "safe_zone"
                        ? "green"
                        : "yellow",
                  weight: 2,
                  opacity: 0.7,
                  fillOpacity: 0.2,
                }}
              >
                <Popup>
                  <div className="p-2">
                    <h3 className="font-bold text-lg">{geofence.name}</h3>
                    <p className="text-sm text-gray-600">
                      Type: {geofence.type}
                    </p>
                    <p className="text-sm text-gray-600">
                      Points: {geofence.coordinates.length}
                    </p>
                    {geofence.description && (
                      <p className="text-sm text-gray-600 mt-2">
                        {geofence.description}
                      </p>
                    )}
                  </div>
                </Popup>
              </Polygon>
            ))}

            {/* Drawn Polygon (while drawing) */}
            {drawnPolygon && drawnPolygon.length > 0 && (
              <>
                {/* Polyline for drawn points */}
                <Polygon
                  positions={coordsToLeaflet(drawnPolygon)}
                  pathOptions={{
                    color: "blue",
                    weight: 2,
                    opacity: 0.7,
                    fillOpacity: 0.1,
                  }}
                />
                {/* Draw points as markers */}
                {drawnPolygon.map((coord, idx) => (
                  <Marker
                    key={`drawn-${idx}`}
                    position={[coord[1], coord[0]]}
                    icon={L.icon({
                      iconUrl:
                        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIj48Y2lyY2xlIGN4PSIxMCIgY3k9IjEwIiByPSI4IiBmaWxsPSIjMzJhOGZmIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==",
                      iconSize: [20, 20],
                      iconAnchor: [10, 10],
                    })}
                  >
                    <Popup>Point {idx + 1}</Popup>
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
                >
                  <Popup>
                    <div className="p-2">
                      <h3 className="font-bold text-lg text-blue-900">
                        {vessel.name}
                      </h3>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Status:</span>{" "}
                        {vessel.status}
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Speed:</span>{" "}
                        {vessel.speed} knots
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Heading:</span>{" "}
                        {vessel.heading}°
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Type:</span>{" "}
                        {vessel.vessel_type}
                      </p>
                      <p className="text-sm text-gray-600 mt-2">
                        <span className="font-semibold">Position:</span>{" "}
                        {vessel.lat.toFixed(4)}, {vessel.lng.toFixed(4)}
                      </p>
                      {vessel.destination && (
                        <p className="text-sm text-gray-600">
                          <span className="font-semibold">Destination:</span>{" "}
                          {vessel.destination}
                        </p>
                      )}
                      {inGeofence && (
                        <p className="text-sm text-red-600 font-bold mt-2">
                          ⚠️ In Restricted Zone
                        </p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>

        {/* Sidebar */}
        <div className="w-96 bg-white rounded-lg shadow-lg overflow-hidden flex flex-col">
          {/* Vessels Tab */}
          <div>
            <div className="bg-blue-900 text-white p-4 font-bold">
              Fleet Status ({vessels.length})
            </div>
            <div className="flex-1 overflow-y-auto max-h-96">
              {vessels.length === 0 ? (
                <div className="p-4 text-gray-500 text-center">
                  <p>No vessels available</p>
                  <p className="text-sm mt-2">
                    Create boats in the Flask server to see them here
                  </p>
                </div>
              ) : (
                vessels.map((vessel) => {
                  const inGeofence = vessel.in_restricted_zone || false;

                  return (
                    <div
                      key={vessel.id}
                      className={`border-b border-gray-200 p-4 hover:shadow-md transition ${
                        inGeofence ? "bg-red-50" : "hover:bg-blue-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-bold text-gray-800">
                          {vessel.name}
                        </h4>
                        <div className="flex gap-2">
                          <span
                            className={`px-2 py-1 text-xs font-semibold rounded ${
                              vessel.status === "Active"
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {vessel.status}
                          </span>
                          <button
                            onClick={() => deleteVessel(vessel.id)}
                            className="text-red-600 hover:text-red-800 hover:bg-red-100 px-2 py-1 rounded transition text-xs font-bold"
                            title="Delete vessel"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>
                          <span className="font-semibold">Type:</span>{" "}
                          {vessel.vessel_type}
                        </p>
                        <p>
                          <span className="font-semibold">Speed:</span>{" "}
                          {vessel.speed} knots
                        </p>
                        <p>
                          <span className="font-semibold">Heading:</span>{" "}
                          {vessel.heading}°
                        </p>
                        {vessel.destination && (
                          <p>
                            <span className="font-semibold">Destination:</span>{" "}
                            {vessel.destination}
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          {vessel.lat.toFixed(4)}, {vessel.lng.toFixed(4)}
                        </p>
                      </div>
                      {inGeofence && (
                        <div className="mt-2 bg-red-100 border border-red-300 rounded p-2">
                          <p className="text-xs font-bold text-red-700">
                            ⚠️ In Restricted Zone
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Geofences Tab */}
          <div className="border-t border-gray-300">
            <div className="bg-red-700 text-white p-4 font-bold">
              Geofences ({geofences.length})
            </div>
            <div className="flex-1 overflow-y-auto max-h-96">
              {geofences.length === 0 ? (
                <div className="p-4 text-gray-500 text-center">
                  <p>No geofences set</p>
                  <p className="text-sm mt-2">
                    Click "Add Geofence" to create one
                  </p>
                </div>
              ) : (
                geofences.map((geofence) => (
                  <div
                    key={geofence.id}
                    className="border-b border-gray-200 p-4 hover:bg-red-50 transition"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-gray-800">
                        {geofence.name}
                      </h4>
                      <button
                        onClick={() => deleteGeofence(geofence.id)}
                        className="text-red-600 hover:text-red-800 font-bold"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        <span className="font-semibold">Type:</span>{" "}
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs ${
                            geofence.type === "restricted"
                              ? "bg-red-100 text-red-700"
                              : geofence.type === "safe_zone"
                                ? "bg-green-100 text-green-700"
                                : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {geofence.type}
                        </span>
                      </p>
                      <p>
                        <span className="font-semibold">Status:</span>{" "}
                        {geofence.is_active ? "Active" : "Inactive"}
                      </p>
                      <p>
                        <span className="font-semibold">Points:</span>{" "}
                        {geofence.coordinates.length}
                      </p>
                      {geofence.description && (
                        <p className="text-xs text-gray-500 mt-2">
                          {geofence.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VesselMap;
