import React, { useState, useRef, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  Polyline,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { geofencesAPI } from "../dashboard/routes/dashboardRoutes";
import { formatGeofenceFromServer, coordsToLeaflet } from "../utils/helpers";
import { MAP_CONFIG, SIMULATION_CONFIG } from "../config/config";
import {
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
} from "../utils/alertSystem";

const SimulationPage = () => {
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Simulation state
  const [boatState, setBoatState] = useState(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationAlerts, setSimulationAlerts] = useState([]);
  const [selectedPath, setSelectedPath] = useState("harbor_tour");
  const [boatTrail, setBoatTrail] = useState([]);

  const mapRef = useRef();
  const simulationIntervalRef = useRef(null);
  const alertManagerRef = useRef(new AlertManager());
  const restrictedZoneEnteredRef = useRef(false);

  // Fetch geofences to display on the map for reference
  useEffect(() => {
    const fetchGeofences = async () => {
      try {
        const geofencesData = await geofencesAPI.getAll();
        const formattedGeofences = geofencesData.map((gf) =>
          formatGeofenceFromServer(gf)
        );
        setGeofences(formattedGeofences);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching geofences for simulation:", err);
        setError("Unable to load geofences reference layout from Firestore.");
        setLoading(false);
      }
    };
    fetchGeofences();
  }, []);

  /**
   * Initialize boat simulation
   */
  const initializeSimulation = () => {
    const path = REAL_WORLD_PATH;
    const startPosition = path[0];

    const newBoatState = initializeBoat("sim-boat-1", startPosition, path);

    setBoatState(newBoatState);
    setBoatTrail([startPosition]);
    setSimulationAlerts([]);
    restrictedZoneEnteredRef.current = false;

    const initAlert = createAlert(
      ALERT_TYPES.INFO,
      ALERT_MESSAGES.SIMULATION_STARTED,
      "boat_sim"
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

    if (simulationActive) return;

    const updatedBoatState = startBoatMovement(boatState);
    setBoatState(updatedBoatState);
    setSimulationActive(true);

    const startAlert = createAlert(
      ALERT_TYPES.INFO,
      ALERT_MESSAGES.SIMULATION_STARTED,
      "boat_sim"
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
      "boat_sim"
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
      "boat_sim"
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

    const polygonCoords = RESTRICTED_ZONE_POLYGON;

    simulationIntervalRef.current = setInterval(() => {
      setBoatState((prevState) => {
        if (!prevState || !prevState.isMoving) return prevState;

        // Two layer check occurs inside updateBoatPosition (synchronous Turf.js and async backend)
        const updatedState = updateBoatPosition(
          prevState,
          polygonCoords,
          (res) => {
            // Update state with backend classification results asynchronously
            setBoatState((current) => {
              if (!current || current.id !== prevState.id) return current;
              return {
                ...current,
                inAnyRestrictedZone: res.inAnyRestrictedZone,
                violations: res.violations,
                safeZones: res.safeZones,
                monitoringZones: res.monitoringZones,
              };
            });
          }
        );

        // Update trail path
        setBoatTrail((prev) => [...prev, updatedState.position]);

        // Local geofence alert handling
        if (updatedState.inRestrictedZone) {
          if (
            !restrictedZoneEnteredRef.current &&
            updatedState.hasEnteredRestrictedZone
          ) {
            restrictedZoneEnteredRef.current = true;
            const alert = createAlert(
              ALERT_TYPES.DANGER,
              ALERT_MESSAGES.BOAT_ENTERED_RESTRICTED,
              "boat_sim"
            );
            setSimulationAlerts((prev) => [...prev, alert]);
            alertManagerRef.current.addAlert(alert);
          }
        } else {
          if (restrictedZoneEnteredRef.current) {
            restrictedZoneEnteredRef.current = false;
            const alert = createAlert(
              ALERT_TYPES.INFO,
              ALERT_MESSAGES.BOAT_LEFT_RESTRICTED,
              "boat_sim"
            );
            setSimulationAlerts((prev) => [...prev, alert]);
            alertManagerRef.current.addAlert(alert);
          }
        }

        // Complete path check
        if (!updatedState.isMoving) {
          const completeAlert = createAlert(
            ALERT_TYPES.SUCCESS,
            ALERT_MESSAGES.SIMULATION_COMPLETED,
            "boat_sim"
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
  }, [simulationActive, boatState]);

  return (
    <div className="w-full h-full flex flex-col flex-1">
      {/* Loading Reference Info Banner */}
      {loading && (
        <div className="bg-purple-900/40 text-purple-200 px-4 py-2 text-center text-xs border-b border-purple-800/40">
          Syncing geofence layers from Firestore for reference...
        </div>
      )}

      {/* Error Reference Info Banner */}
      {error && (
        <div className="bg-red-950/40 text-red-400 px-4 py-2 text-center text-xs border-b border-red-900/40">
          ⚠️ {error}
        </div>
      )}

      {/* Control Panel Header */}
      <div className="bg-slate-900 border-b border-slate-800 text-white p-4 shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span>🚤</span> Boat Simulation Control Center
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Test and validate PIP precision and real-time geofence warning triggers.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex gap-2">
            <select
              value={selectedPath}
              onChange={(e) => {
                setSelectedPath(e.target.value);
                if (!simulationActive) initializeSimulation();
              }}
              disabled={simulationActive}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
            >
              <option value="harbor_tour">🏖️ Harbor Tour</option>
              <option value="coastal_patrol">🚢 Coastal Patrol</option>
              <option value="restricted_zone_approach">⚠️ Restricted Zone Approach</option>
            </select>

            {!simulationActive ? (
              <>
                <button
                  onClick={() => {
                    if (!boatState) initializeSimulation();
                    startSimulation();
                  }}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-md shadow-green-600/20 transition"
                >
                  ▶ Start
                </button>
                <button
                  onClick={resetSimulation}
                  className="px-4 py-2 bg-slate-850 hover:bg-slate-750 border border-slate-700 text-slate-300 text-xs font-bold rounded-lg transition"
                >
                  ↻ Reset
                </button>
              </>
            ) : (
              <button
                onClick={stopSimulation}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-md shadow-red-600/20 transition"
              >
                ⏹ Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Simulation Layout */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 bg-slate-950 min-h-0">
        {/* Map visualization */}
        <div className="flex-1 relative h-[50vh] lg:h-auto rounded-xl overflow-hidden border border-slate-800 shadow-xl">
          <MapContainer
            center={MAP_CONFIG.DEFAULT_CENTER}
            zoom={MAP_CONFIG.DEFAULT_ZOOM}
            className="w-full h-full"
            ref={mapRef}
          >
            <TileLayer
              url={MAP_CONFIG.TILE_LAYER}
              attribution={MAP_CONFIG.ATTRIBUTION}
            />

            {/* Geofences reference layout */}
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
                  weight: 1.5,
                  opacity: 0.5,
                  fillOpacity: 0.05,
                }}
              />
            ))}

            {/* Boat Trail Polyline */}
            {boatTrail.length > 1 && (
              <Polyline
                positions={boatTrail.map((pos) => [pos[0], pos[1]])}
                pathOptions={{
                  color: boatState?.inRestrictedZone ? "#ef4444" : "#a855f7",
                  weight: 3.5,
                  opacity: 0.8,
                  dashArray: "4, 6",
                }}
              />
            )}

            {/* Boat Marker */}
            {boatState && (
              <Marker
                position={[boatState.position[0], boatState.position[1]]}
                icon={getBoatIcon(boatState)}
                title="Simulated Vessel"
              >
                <Popup>
                  <div className="p-2 min-w-[180px]">
                    <h3 className="font-bold text-slate-900 text-sm">🚤 Simulated Vessel</h3>
                    <div className="text-xs text-slate-600 mt-2 space-y-1">
                      <p><span className="font-semibold">Heading:</span> {boatState.heading.toFixed(1)}°</p>
                      <p><span className="font-semibold">Speed:</span> {boatState.speed} knots</p>
                      <p><span className="font-semibold">Local (Turf):</span> {boatState.inRestrictedZone ? "🚨 VIOLATION" : "✅ SAFE"}</p>
                      <p><span className="font-semibold">Backend (PIP):</span> {boatState.inAnyRestrictedZone ? "🚨 VIOLATION" : "✅ SAFE"}</p>
                      <p className="text-[10px] text-slate-400 mt-1 border-t pt-1">
                        {boatState.position[0].toFixed(5)}, {boatState.position[1].toFixed(5)}
                      </p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>

        {/* Sidebar panels */}
        <div className="w-full lg:w-96 flex flex-col gap-4 overflow-y-auto lg:max-h-full">
          {/* Telemetry panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg p-4">
            <h3 className="font-bold text-white text-sm mb-3 pb-2 border-b border-slate-800">
              📊 Live Telemetry
            </h3>
            {boatState ? (
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                  <span className="text-slate-400">Simulation Status</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      simulationActive
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                    }`}
                  >
                    {simulationActive ? "Running" : "Paused"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                  <span className="text-slate-400">Vessel Latitude</span>
                  <span className="font-mono text-slate-200">{boatState.position[0].toFixed(6)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                  <span className="text-slate-400">Vessel Longitude</span>
                  <span className="font-mono text-slate-200">{boatState.position[1].toFixed(6)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                  <span className="text-slate-400">Heading Angle</span>
                  <span className="text-slate-200 font-semibold">{boatState.heading.toFixed(0)}°</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-800/40">
                  <span className="text-slate-400">Geofencing Warning</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      boatState.inRestrictedZone
                        ? "bg-red-500/15 text-red-400 border border-red-500/20"
                        : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}
                  >
                    {boatState.inRestrictedZone ? "Breach Detected" : "Clear"}
                  </span>
                </div>
                {boatState.inAnyRestrictedZone && boatState.violations.length > 0 && (
                  <div className="bg-red-950/20 border border-red-900/50 p-2.5 rounded-lg text-[10px] text-red-400">
                    <p className="font-bold uppercase tracking-wider mb-1">Backend Violations:</p>
                    <ul className="list-disc list-inside">
                      {boatState.violations.map((violation, i) => (
                        <li key={i} className="opacity-90">{violation.name} ({violation.type})</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">
                Simulation not initialized. Click "Start" to deploy the test boat.
              </p>
            )}
          </div>

          {/* Simulation Alerts Logger */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex-1 flex flex-col">
            <div className="bg-slate-950 border-b border-slate-800 p-4 font-bold text-white flex justify-between items-center">
              <span>🔔 System Alerts</span>
              <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-semibold">
                {simulationAlerts.length} Logs
              </span>
            </div>
            <div className="overflow-y-auto max-h-[300px] lg:max-h-[320px] p-3 space-y-2 flex-1">
              {simulationAlerts.length === 0 ? (
                <p className="text-xs text-slate-550 text-center py-12">
                  Logs is empty. Deploy simulation to generate telemetry alerts.
                </p>
              ) : (
                simulationAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`text-xs p-2.5 rounded-lg border-l-4 ${
                      alert.type === "danger"
                        ? "bg-red-950/15 border-red-500 text-red-400"
                        : alert.type === "warning"
                          ? "bg-amber-950/15 border-amber-500 text-amber-400"
                          : alert.type === "success"
                            ? "bg-green-950/15 border-green-500 text-green-400"
                            : "bg-blue-950/15 border-blue-500 text-blue-400"
                    }`}
                  >
                    <div className="flex justify-between items-start gap-1">
                      <p className="font-semibold leading-relaxed">{alert.message}</p>
                      <span className="text-[9px] opacity-60 shrink-0 mt-0.5">
                        {alert.timestamp.toLocaleTimeString()}
                      </span>
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

export default SimulationPage;
