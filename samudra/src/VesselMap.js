import React, { useState, useRef, useEffect } from "react";
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
} from "./services/apiService";
import {
  formatBoatFromServer,
  formatGeofenceFromServer,
  coordsToLeaflet,
} from "./utils/helpers";
import { MAP_CONFIG, SIMULATION_CONFIG } from "./config/config";
import {
  generateRealisticPath,
  initializeBoat,
  updateBoatPosition,
  startBoatMovement,
  stopBoatMovement,
  getBoatIcon,
  REAL_WORLD_PATH,
  RESTRICTED_ZONE_POLYGON,
} from "./utils/boatSimulation";
import {
  AlertManager,
  createAlert,
  ALERT_MESSAGES,
  ALERT_TYPES,
} from "./utils/alertSystem";

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

// 1. Create the Custom Heatmap Component
const HeatmapLayer = ({ points }) => {
  const map = useMap(); // Access the underlying Leaflet map instance

  useEffect(() => {
    if (!points || points.length === 0) return;

    // Initialize the heat layer
    const heatLayer = L.heatLayer(points, {
      radius: 35,
      blur: 25,
      maxZoom: 13,
      // Custom gradient: 0.0 is shallow (warm), 1.0 is deep (cool)
      gradient: {
        0.2: "red",     // Shallow
        0.4: "orange",  // Medium-shallow
        0.6: "yellow",  // Medium
        0.8: "blue",    // Deep
        1.0: "navy",    // Trench/very deep
      },
    }).addTo(map);

    // Cleanup: remove the layer when the component unmounts or data changes
    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points]);

  return null; // This component doesn't render HTML, it mutates the map
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
  const [editingGeofence, setEditingGeofence] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editedCoordinates, setEditedCoordinates] = useState(null);

  // Simulation state
  const [boatState, setBoatState] = useState(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationAlerts, setSimulationAlerts] = useState([]);
  const [showSimulation, setShowSimulation] = useState(false);
  const [selectedPath, setSelectedPath] = useState("harbor_tour");
  const [boatTrail, setBoatTrail] = useState([]);

  // Selected boat for detailed view
  const [selectedVessel, setSelectedVessel] = useState(null);

  // Heatmap state
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapPoints, setHeatmapPoints] = useState([]);

  const mapRef = useRef();
  const boatsIntervalRef = useRef(null);
  const alertsIntervalRef = useRef(null);
  const simulationIntervalRef = useRef(null);
  const alertManagerRef = useRef(new AlertManager());
  const restrictedZoneEnteredRef = useRef(false);

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

  // Fetch depth heatmap data when showHeatmap is toggled
  useEffect(() => {
    if (showHeatmap && heatmapPoints.length === 0) {
      const fetchHeatmapData = async () => {
        try {
          const points = await depthAPI.getHeatmapData();
          setHeatmapPoints(points);
        } catch (err) {
          console.error("Failed to fetch depth heatmap data:", err);
        }
      };
      fetchHeatmapData();
    }
  }, [showHeatmap, heatmapPoints]);

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
        alert(
          `Failed to create geofence: ${err.message || "Please try again."}`,
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
      await fetchGeofences(); // Refresh geofences from server
    } catch (err) {
      console.error("Error deleting geofence:", err);
      alert("Failed to delete geofence. Please try again.");
    }
  };

  const deleteVessel = async (id) => {
    try {
      await boatsAPI.delete(id);
      // Close details modal if it was the selected vessel
      if (selectedVessel && selectedVessel.id === id) {
        setSelectedVessel(null);
      }
      await fetchBoats(); // Refresh boats from server
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
        editedCoordinates,
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

  // =============================================
  // SIMULATION FUNCTIONS
  // =============================================

  /**
   * Initialize boat simulation
   */
  const initializeSimulation = () => {
    // Use the real-world path for simulation
    const path = REAL_WORLD_PATH;
    const startPosition = path[0]; // Start from first coordinate in path

    const newBoatState = initializeBoat(
      "sim-boat-1",
      startPosition,
      path, // Use REAL_WORLD_PATH directly
    );

    setBoatState(newBoatState);
    setBoatTrail([startPosition]);
    setSimulationAlerts([]);
    restrictedZoneEnteredRef.current = false;

    // Add initialization alert
    const initAlert = createAlert(
      ALERT_TYPES.INFO,
      ALERT_MESSAGES.SIMULATION_STARTED,
      "boat_sim",
    );
    setSimulationAlerts([initAlert]);
    alertManagerRef.current.addAlert(initAlert);
  };

  /**
   * Start the boat simulation
   */
  const startSimulation = () => {
    if (!boatState) {
      initializeSimulation();
      setSimulationActive(true);
      return;
    }

    if (simulationActive) return; // Already running

    const updatedBoatState = startBoatMovement(boatState);
    setBoatState(updatedBoatState);
    setSimulationActive(true);

    const startAlert = createAlert(
      ALERT_TYPES.INFO,
      ALERT_MESSAGES.SIMULATION_STARTED,
      "boat_sim",
    );
    alertManagerRef.current.addAlert(startAlert);
  };

  /**
   * Stop the boat simulation
   */
  const stopSimulation = () => {
    if (!simulationActive || !boatState) return;

    const stoppedBoatState = stopBoatMovement(boatState);
    setBoatState(stoppedBoatState);
    setSimulationActive(false);

    const stopAlert = createAlert(
      ALERT_TYPES.INFO,
      ALERT_MESSAGES.SIMULATION_STOPPED,
      "boat_sim",
    );
    alertManagerRef.current.addAlert(stopAlert);
  };

  /**
   * Reset the simulation
   */
  const resetSimulation = () => {
    stopSimulation();
    setBoatState(null);
    setBoatTrail([]);
    setSimulationAlerts([]);
    restrictedZoneEnteredRef.current = false;

    const resetAlert = createAlert(
      ALERT_TYPES.INFO,
      ALERT_MESSAGES.SIMULATION_RESET,
      "boat_sim",
    );
    alertManagerRef.current.addAlert(resetAlert);
  };

  /**
   * Simulation update loop
   */
  useEffect(() => {
    if (!simulationActive || !boatState) {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
      }
      return;
    }

    // Use the predefined restricted zone polygon for collision detection
    // Pass coordinates in [lat, lng] format - updateBoatPosition handles GeoJSON conversion
    const polygonCoords = RESTRICTED_ZONE_POLYGON;

    simulationIntervalRef.current = setInterval(() => {
      setBoatState((prevState) => {
        if (!prevState || !prevState.isMoving) return prevState;

        // Update boat position with restricted zone polygon
        // Turf.js detects with production-grade accuracy
        const updatedState = updateBoatPosition(prevState, polygonCoords);

        // Update trail
        setBoatTrail((prev) => [...prev, updatedState.position]);

        // Handle restricted zone alerts
        if (updatedState.inRestrictedZone) {
          if (
            !restrictedZoneEnteredRef.current &&
            updatedState.hasEnteredRestrictedZone
          ) {
            // First time entering - SERIOUS ALERT!
            restrictedZoneEnteredRef.current = true;
            const alert = createAlert(
              ALERT_TYPES.DANGER,
              ALERT_MESSAGES.BOAT_ENTERED_RESTRICTED,
              "boat_sim",
            );
            setSimulationAlerts((prev) => [...prev, alert]);
            alertManagerRef.current.addAlert(alert);
            console.warn(
              "⚠️ BOAT ENTERED RESTRICTED ZONE!",
              updatedState.position,
            );
          }
        } else {
          // Left restricted zone
          if (restrictedZoneEnteredRef.current) {
            restrictedZoneEnteredRef.current = false;
            const alert = createAlert(
              ALERT_TYPES.INFO,
              ALERT_MESSAGES.BOAT_LEFT_RESTRICTED,
              "boat_sim",
            );
            setSimulationAlerts((prev) => [...prev, alert]);
            alertManagerRef.current.addAlert(alert);
          }
        }

        // Check if simulation is complete
        if (!updatedState.isMoving) {
          const completeAlert = createAlert(
            ALERT_TYPES.SUCCESS,
            ALERT_MESSAGES.SIMULATION_COMPLETED,
            "boat_sim",
          );
          alertManagerRef.current.addAlert(completeAlert);
          setSimulationActive(false);
        }

        return updatedState;
      });
    }, SIMULATION_CONFIG.UPDATE_INTERVAL);

    return () => {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
      }
    };
  }, [simulationActive, boatState, geofences]);

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
          <div className="flex gap-2">
            <button
              onClick={() => setShowSimulation(!showSimulation)}
              className="px-4 py-2 rounded font-semibold transition bg-purple-600 hover:bg-purple-700 text-white"
            >
              {showSimulation ? "Hide" : "Show"} Simulation
            </button>
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-4 py-2 rounded font-semibold transition ${
                showHeatmap
                  ? "bg-teal-600 hover:bg-teal-700 text-white"
                  : "bg-teal-800 hover:bg-teal-900 text-white"
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
              className={`px-4 py-2 rounded font-semibold transition ${
                drawMode
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              {drawMode ? "Exit Draw Mode" : "Add Geofence"}
            </button>
          </div>
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

      {/* Simulation Panel */}
      {showSimulation && (
        <div className="bg-purple-50 border-l-4 border-purple-500 p-4 mx-4 mt-4 rounded">
          <h3 className="text-purple-800 font-bold mb-3">
            🚤 Boat Simulation Control
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Controls */}
            <div>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">
                  Simulation Path:
                </label>
                <select
                  value={selectedPath}
                  onChange={(e) => {
                    setSelectedPath(e.target.value);
                    if (!simulationActive) initializeSimulation();
                  }}
                  disabled={simulationActive}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100"
                >
                  <option value="harbor_tour">🏖️ Harbor Tour</option>
                  <option value="coastal_patrol">🚢 Coastal Patrol</option>
                  <option value="restricted_zone_approach">
                    ⚠️ Restricted Zone Approach
                  </option>
                </select>

                <div className="flex gap-2 mt-3">
                  {!simulationActive ? (
                    <>
                      <button
                        onClick={() => {
                          if (!boatState) initializeSimulation();
                          startSimulation();
                        }}
                        className="flex-1 px-3 py-2 bg-green-600 text-white text-sm font-semibold rounded hover:bg-green-700 transition"
                      >
                        ▶ Start Simulation
                      </button>
                      <button
                        onClick={resetSimulation}
                        className="flex-1 px-3 py-2 bg-gray-600 text-white text-sm font-semibold rounded hover:bg-gray-700 transition"
                      >
                        ↻ Reset
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={stopSimulation}
                      className="flex-1 px-3 py-2 bg-red-600 text-white text-sm font-semibold rounded hover:bg-red-700 transition"
                    >
                      ⏹ Stop Simulation
                    </button>
                  )}
                </div>

                {boatState && (
                  <div className="mt-3 p-2 bg-white border border-purple-300 rounded text-xs">
                    <p className="text-gray-700">
                      <span className="font-semibold">Status:</span>{" "}
                      {simulationActive ? "▶ Running" : "⏸ Paused"}
                    </p>
                    <p className="text-gray-700">
                      <span className="font-semibold">Position:</span>{" "}
                      {boatState.position[0].toFixed(4)},{" "}
                      {boatState.position[1].toFixed(4)}
                    </p>
                    <p className="text-gray-700">
                      <span className="font-semibold">Heading:</span>{" "}
                      {boatState.heading.toFixed(0)}°
                    </p>
                    <p className="text-gray-700">
                      <span className="font-semibold">Progress:</span>{" "}
                      {boatState.pathIndex} / {boatState.path.length}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Alerts */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Simulation Alerts ({simulationAlerts.length}):
              </label>
              <div className="space-y-1 max-h-32 overflow-y-auto border border-purple-300 rounded p-2 bg-white">
                {simulationAlerts.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No alerts yet. Start the simulation...
                  </p>
                ) : (
                  simulationAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`text-xs p-2 rounded border-l-2 ${
                        alert.type === "danger"
                          ? "bg-red-50 border-red-500 text-red-700"
                          : alert.type === "warning"
                            ? "bg-amber-50 border-amber-500 text-amber-700"
                            : alert.type === "success"
                              ? "bg-green-50 border-green-500 text-green-700"
                              : "bg-blue-50 border-blue-500 text-blue-700"
                      }`}
                    >
                      {alert.message}
                      <span className="text-xs opacity-70">
                        {" "}
                        {alert.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
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
              editMode={editMode}
              onMapClick={handleMapClick}
              onEditMapClick={addCoordinateToEdit}
              drawnPolygon={drawnPolygon}
            />
            <TileLayer
              url={MAP_CONFIG.TILE_LAYER}
              attribution={MAP_CONFIG.ATTRIBUTION}
            />

            {/* Seafloor depth heatmap layer */}
            {showHeatmap && heatmapPoints.length > 0 && (
              <HeatmapLayer points={heatmapPoints} />
            )}

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

            {/* Edited Geofence Polygon (while editing) */}
            {editMode && editedCoordinates && editedCoordinates.length > 0 && (
              <>
                {/* Edited polygon */}
                {editedCoordinates.length >= 3 && (
                  <Polygon
                    positions={coordsToLeaflet(editedCoordinates)}
                    pathOptions={{
                      color: "purple",
                      weight: 3,
                      opacity: 0.8,
                      fillOpacity: 0.15,
                      dashArray: "5, 5",
                    }}
                  />
                )}
                {/* Edited points as markers */}
                {editedCoordinates.map((coord, idx) => (
                  <Marker
                    key={`edit-${idx}`}
                    position={[coord[1], coord[0]]}
                    icon={L.icon({
                      iconUrl:
                        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI5IiBmaWxsPSIjYTI1NWY3IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==",
                      iconSize: [24, 24],
                      iconAnchor: [12, 12],
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
                    <div className="p-3 w-64">
                      <h3 className="font-bold text-lg text-blue-900">
                        {vessel.name}
                      </h3>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <div className="flex justify-between">
                          <span className="font-semibold">Status:</span>
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              vessel.status === "Active"
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {vessel.status}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Speed:</span>
                          <span>{vessel.speed} knots</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Heading:</span>
                          <span>{vessel.heading}°</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Type:</span>
                          <span>{vessel.vessel_type}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Crew:</span>
                          <span>{vessel.crew_count}</span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-300">
                          <p className="text-xs text-gray-500">
                            <span className="font-semibold">Position:</span>
                            <br />
                            {vessel.lat.toFixed(6)}, {vessel.lng.toFixed(6)}
                          </p>
                        </div>
                        {vessel.destination && (
                          <div className="mt-2 pt-2 border-t border-gray-300">
                            <p className="text-xs">
                              <span className="font-semibold">
                                Destination:
                              </span>{" "}
                              {vessel.destination}
                            </p>
                          </div>
                        )}
                        {inGeofence && (
                          <div className="mt-2 pt-2 border-t border-red-300 bg-red-50 p-2 rounded">
                            <p className="text-red-700 font-bold text-xs">
                              ⚠️ In Restricted Zone
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => setSelectedVessel(vessel)}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold transition"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => deleteVessel(vessel.id)}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-semibold transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Boat Simulation Marker and Trail */}
            {showSimulation && boatState && (
              <>
                {/* Boat Trail Polyline */}
                {boatTrail.length > 1 && (
                  <Polyline
                    positions={boatTrail.map((pos) => [pos[0], pos[1]])}
                    pathOptions={{
                      color: boatState.inRestrictedZone ? "#ef4444" : "#3b82f6",
                      weight: 3,
                      opacity: 0.7,
                    }}
                  />
                )}

                {/* Boat Marker */}
                <Marker
                  position={[boatState.position[0], boatState.position[1]]}
                  icon={getBoatIcon(boatState)}
                  title="Simulated Boat"
                >
                  <Popup>
                    <div className="p-2">
                      <h3 className="font-bold text-lg text-purple-900">
                        🚤 Simulated Boat
                      </h3>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Position:</span>{" "}
                        {boatState.position[0].toFixed(4)},{" "}
                        {boatState.position[1].toFixed(4)}
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Heading:</span>{" "}
                        {boatState.heading.toFixed(0)}°
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">Speed:</span>{" "}
                        {boatState.speed} knots
                      </p>
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold">
                          Distance Traveled:
                        </span>{" "}
                        {(
                          boatState.traveledPath.length *
                          SIMULATION_CONFIG.INTERPOLATION_SPEED
                        ).toFixed(2)}{" "}
                        km
                      </p>
                      {boatState.inRestrictedZone && (
                        <p className="text-sm text-red-600 font-bold mt-2">
                          🚨 IN RESTRICTED ZONE
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        Status: {simulationActive ? "▶ Running" : "⏸ Paused"}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              </>
            )}
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
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEditingGeofence(geofence)}
                          className="text-blue-600 hover:text-blue-800 hover:bg-blue-100 px-2 py-1 rounded transition text-xs font-bold"
                          title="Edit geofence"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteGeofence(geofence.id)}
                          className="text-red-600 hover:text-red-800 hover:bg-red-100 px-2 py-1 rounded transition text-xs font-bold"
                          title="Delete geofence"
                        >
                          ✕
                        </button>
                      </div>
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

      {/* Edit Geofence Modal */}
      {editMode && editingGeofence && editedCoordinates && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-11/12 max-w-2xl max-h-96 overflow-y-auto">
            <div className="bg-blue-900 text-white p-4 font-bold flex justify-between items-center sticky top-0">
              <span>Edit Geofence: {editingGeofence.name}</span>
              <button
                onClick={cancelEditGeofence}
                className="text-xl font-bold hover:text-red-300"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
                <p className="text-sm text-blue-800 font-semibold mb-2">
                  💡 Instructions:
                </p>
                <p className="text-xs text-blue-700">
                  Click on the map to add new points. Use the remove button to
                  delete points. A minimum of 3 points is required.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-gray-800 mb-2">
                  Current Coordinates ({editedCoordinates.length} points):
                </h4>
                <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto border border-gray-200 rounded p-3 bg-gray-50">
                  {editedCoordinates.map((coord, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center bg-white p-2 rounded border border-gray-300 text-sm"
                    >
                      <span className="font-mono text-gray-700">
                        Point {idx + 1}: [{coord[0].toFixed(6)},{" "}
                        {coord[1].toFixed(6)}]
                      </span>
                      <button
                        onClick={() => removeCoordinateFromEdit(idx)}
                        disabled={editedCoordinates.length <= 3}
                        className={`px-2 py-1 text-xs font-bold rounded ${
                          editedCoordinates.length <= 3
                            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                            : "bg-red-500 text-white hover:bg-red-600"
                        }`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={saveGeofenceEdit}
                  className="flex-1 bg-green-600 text-white font-semibold py-2 px-4 rounded hover:bg-green-700 transition"
                >
                  ✓ Save Changes
                </button>
                <button
                  onClick={cancelEditGeofence}
                  className="flex-1 bg-gray-500 text-white font-semibold py-2 px-4 rounded hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-4">
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">Note:</span> To add new
                  coordinates in the modal, the map editing mode is being
                  bypassed. Click "Save Changes" to apply modifications, or
                  "Cancel" to discard them.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Boat Details Modal */}
      {selectedVessel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-11/12 max-w-2xl max-h-96 overflow-y-auto">
            <div className="bg-blue-900 text-white p-4 font-bold flex justify-between items-center sticky top-0">
              <span>⚓ Vessel Details: {selectedVessel.name}</span>
              <button
                onClick={() => setSelectedVessel(null)}
                className="text-xl font-bold hover:text-red-300"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Header Section */}
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">
                    {selectedVessel.name}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    ID: {selectedVessel.id}
                  </p>
                </div>
                <div>
                  <span
                    className={`inline-block px-3 py-2 rounded-full text-sm font-semibold ${
                      selectedVessel.status === "Active"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {selectedVessel.status}
                  </span>
                  {selectedVessel.in_restricted_zone && (
                    <div className="mt-2 bg-red-100 text-red-800 px-3 py-2 rounded-full text-sm font-semibold">
                      ⚠️ Restricted Zone
                    </div>
                  )}
                </div>
              </div>

              {/* Vessel Information Grid */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="font-bold text-gray-700 mb-3">Vessel Info</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase">
                        Vessel Type
                      </label>
                      <p className="text-sm text-gray-800 mt-1">
                        {selectedVessel.vessel_type}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase">
                        Crew Count
                      </label>
                      <p className="text-sm text-gray-800 mt-1">
                        {selectedVessel.crew_count} members
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase">
                        Destination
                      </label>
                      <p className="text-sm text-gray-800 mt-1">
                        {selectedVessel.destination || "Not set"}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-700 mb-3">
                    Movement Data
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase">
                        Speed
                      </label>
                      <p className="text-sm text-gray-800 mt-1">
                        {selectedVessel.speed} knots
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase">
                        Heading
                      </label>
                      <p className="text-sm text-gray-800 mt-1">
                        {selectedVessel.heading}°
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Position Section */}
              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <h3 className="font-bold text-gray-700 mb-3">Position</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">
                      Latitude
                    </label>
                    <p className="text-sm text-gray-800 mt-1 font-mono">
                      {selectedVessel.lat.toFixed(8)}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">
                      Longitude
                    </label>
                    <p className="text-sm text-gray-800 mt-1 font-mono">
                      {selectedVessel.lng.toFixed(8)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Timestamps Section */}
              <div className="bg-gray-50 border border-gray-200 rounded p-4">
                <h3 className="font-bold text-gray-700 mb-3">Timestamps</h3>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="font-semibold text-gray-500 uppercase">
                      Created
                    </label>
                    <p className="text-gray-700 mt-1">
                      {new Date(selectedVessel.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <label className="font-semibold text-gray-500 uppercase">
                      Updated
                    </label>
                    <p className="text-gray-700 mt-1">
                      {new Date(selectedVessel.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4 border-t">
                <button
                  onClick={() => deleteVessel(selectedVessel.id)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-semibold transition"
                >
                  Delete Vessel
                </button>
                <button
                  onClick={() => setSelectedVessel(null)}
                  className="flex-1 bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded font-semibold transition"
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

export default VesselMap;
