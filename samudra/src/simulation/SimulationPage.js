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
import { MAP_CONFIG, SIMULATION_CONFIG, API_CONFIG } from "../config/config";
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
  const backendRestrictedZoneEnteredRef = useRef(false);

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
  const initializeSimulation = (pathKey = selectedPath) => {
    const path =
      pathKey === "harbor_tour"
        ? REAL_WORLD_PATH
        : SIMULATION_CONFIG.PREDEFINED_PATHS[pathKey] || REAL_WORLD_PATH;
    const startPosition = path[0];

    const newBoatState = initializeBoat("sim-boat-1", startPosition, path);

    setBoatState(newBoatState);
    setBoatTrail([startPosition]);
    setSimulationAlerts([]);
    restrictedZoneEnteredRef.current = false;
    backendRestrictedZoneEnteredRef.current = false;

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
    backendRestrictedZoneEnteredRef.current = false;

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

            // Trigger alerts for backend geofence violations
            if (res.inAnyRestrictedZone) {
              if (!backendRestrictedZoneEnteredRef.current) {
                backendRestrictedZoneEnteredRef.current = true;
                const zoneNames =
                  res.violations && res.violations.length > 0
                    ? `: ${res.violations.map((v) => v.name).join(", ")}`
                    : "";
                const alert = createAlert(
                  ALERT_TYPES.DANGER,
                  `🚨 Backend Alert: Boat entered restricted zone${zoneNames}!`,
                  "boat_sim"
                );
                setSimulationAlerts((prev) => [...prev, alert]);
                alertManagerRef.current.addAlert(alert);
              }
            } else {
              if (backendRestrictedZoneEnteredRef.current) {
                backendRestrictedZoneEnteredRef.current = false;
                const alert = createAlert(
                  ALERT_TYPES.INFO,
                  "✓ Boat has exited backend restricted zone.",
                  "boat_sim"
                );
                setSimulationAlerts((prev) => [...prev, alert]);
                alertManagerRef.current.addAlert(alert);
              }
            }
          },
          API_CONFIG.BASE_URL
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
    <div className="w-full h-full flex flex-col flex-1" style={{ background: "var(--navy-950)" }}>
      {/* Loading Reference Info Banner */}
      {loading && (
        <div className="animate-fade-in px-5 py-2 text-center text-[12px] font-medium" style={{ background: "rgba(124,58,237,0.08)", borderBottom: "1px solid rgba(124,58,237,0.18)", color: "#c4b5fd" }}>
          Syncing geofence layers from Firestore…
        </div>
      )}

      {/* Error Reference Info Banner */}
      {error && (
        <div className="animate-fade-in px-5 py-2 text-center text-[12px] font-medium" style={{ background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      {/* Control Panel Header */}
      <div
        className="px-5 py-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0"
        style={{ background: "var(--navy-900)", borderBottom: "1px solid var(--glass-border)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "0.01em" }}>Boat Simulation Control Center</h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>Test and validate PIP precision and real-time geofence warning triggers.</p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={selectedPath}
            onChange={(e) => {
              const pathKey = e.target.value;
              setSelectedPath(pathKey);
              if (!simulationActive) initializeSimulation(pathKey);
            }}
            disabled={simulationActive}
            className="rounded-lg px-3 py-2 text-[12px] font-medium focus:outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)", minWidth: 180 }}
          >
            <option value="harbor_tour">Harbor Tour</option>
            <option value="coastal_patrol">Coastal Patrol</option>
            <option value="restricted_zone_approach">Restricted Zone Approach</option>
          </select>

          {!simulationActive ? (
            <>
              <button
                onClick={() => { if (!boatState) initializeSimulation(); startSimulation(); }}
                className="pro-btn-primary"
                style={{ background: "linear-gradient(135deg,#166534,#16a34a)", boxShadow: "0 2px 12px rgba(22,163,74,0.25)", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                ▶ Start
              </button>
              <button onClick={resetSimulation} className="pro-btn-ghost">↻ Reset</button>
            </>
          ) : (
            <button
              onClick={stopSimulation}
              className="pro-btn-ghost"
              style={{ color: "#fca5a5", borderColor: "rgba(239,68,68,0.25)" }}
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      {/* Main Simulation Layout */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 min-h-0" style={{ background: "var(--navy-950)" }}>
        {/* Map visualization */}
        <div className="flex-1 relative h-[50vh] lg:h-auto rounded-xl overflow-hidden shadow-2xl" style={{ border: "1px solid var(--glass-border)" }}>
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
        <div className="w-full lg:w-80 flex flex-col gap-3 overflow-y-auto lg:max-h-full">
          {/* Telemetry panel */}
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(14,31,61,0.6)" }}>
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>Live Telemetry</span>
            </div>
            <div className="p-4">
            {boatState ? (
              <div className="space-y-2.5 text-[12px]">
                {[
                  ["Simulation Status", <span key="status" className="text-[10px] font-semibold px-2 py-0.5 rounded" style={simulationActive ? { background: "rgba(34,197,94,0.1)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.2)" } : { background: "rgba(234,179,8,0.1)", color: "#facc15", border: "1px solid rgba(234,179,8,0.2)" }}>{simulationActive ? "Running" : "Paused"}</span>],
                  ["Latitude", <span key="lat" className="font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>{boatState.position[0].toFixed(6)}</span>],
                  ["Longitude", <span key="lng" className="font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>{boatState.position[1].toFixed(6)}</span>],
                  ["Heading", <span key="hdg" className="font-medium" style={{ color: "var(--text-primary)" }}>{boatState.heading.toFixed(0)}&deg;</span>],
                  ["Geofence Status", <span key="geo" className="text-[10px] font-semibold px-2 py-0.5 rounded uppercase" style={boatState.inRestrictedZone ? { background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" } : { background: "rgba(255,255,255,0.04)", color: "var(--text-muted)", border: "1px solid var(--glass-border)" }}>{boatState.inRestrictedZone ? "Breach" : "Clear"}</span>],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between items-center py-1.5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
                    <span style={{ color: "var(--text-muted)" }}>{label}</span>
                    {value}
                  </div>
                ))}
                {boatState.inAnyRestrictedZone && boatState.violations.length > 0 && (
                  <div className="p-2.5 rounded-lg text-[11px] mt-1" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", color: "#fca5a5" }}>
                    <p className="font-semibold uppercase tracking-wider text-[10px] mb-1">Backend Violations:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {boatState.violations.map((v, i) => <li key={i}>{v.name} ({v.type})</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>Simulation not initialized. Click Start to deploy the test vessel.</p>
            )}
            </div>
          </div>

          {/* Simulation Alerts Logger */}
          <div className="glass-card rounded-xl overflow-hidden flex-1 flex flex-col">
            <div className="px-4 py-3 flex justify-between items-center" style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(14,31,61,0.6)" }}>
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>System Alerts</span>
              <span className="pro-badge">{simulationAlerts.length} Logs</span>
            </div>
            <div className="overflow-y-auto max-h-[280px] lg:max-h-[320px] p-3 space-y-1.5 flex-1">
              {simulationAlerts.length === 0 ? (
                <p className="text-[12px] text-center py-10" style={{ color: "var(--text-muted)" }}>Deploy simulation to generate telemetry alerts.</p>
              ) : (
                simulationAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="text-[11px] px-3 py-2.5 rounded-lg border-l-2"
                    style={{
                      background: alert.type === "danger" ? "rgba(239,68,68,0.07)" : alert.type === "warning" ? "rgba(234,179,8,0.07)" : alert.type === "success" ? "rgba(34,197,94,0.07)" : "rgba(37,99,235,0.07)",
                      borderLeftColor: alert.type === "danger" ? "#ef4444" : alert.type === "warning" ? "#f59e0b" : alert.type === "success" ? "#22c55e" : "#3b82f6",
                      color: alert.type === "danger" ? "#fca5a5" : alert.type === "warning" ? "#fcd34d" : alert.type === "success" ? "#86efac" : "#93bbfd",
                    }}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <p className="font-medium leading-snug">{alert.message}</p>
                      <span className="text-[9px] opacity-50 shrink-0 mt-0.5">{alert.timestamp.toLocaleTimeString()}</span>
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
