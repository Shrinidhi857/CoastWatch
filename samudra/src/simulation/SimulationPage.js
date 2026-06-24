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
  COLLECTED_DATA,
  SYNTHETIC_BOAT_DATA_COAST,
} from "./utils/boatSimulation";
import {
  AlertManager,
  createAlert,
  ALERT_MESSAGES,
  ALERT_TYPES,
} from "../utils/alertSystem";

const SimulationPage = ({ addHistoryItem }) => {
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Simulation state
  const [boatState, setBoatState] = useState(null);
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationAlerts, setSimulationAlerts] = useState([]);
  const [selectedPath, setSelectedPath] = useState("collected_data");
  const [boatTrail, setBoatTrail] = useState([]);

  // Speed and Intrusion Tracking State
  const [expectedSpeed, setExpectedSpeed] = useState(12);
  const [actualSpeed, setActualSpeed] = useState(8);
  const [activeSession, setActiveSession] = useState(null);

  const mapRef = useRef();
  const simulationIntervalRef = useRef(null);
  const alertManagerRef = useRef(new AlertManager());
  const restrictedZoneEnteredRef = useRef(false);
  const backendRestrictedZoneEnteredRef = useRef(false);

  const activeSessionRef = useRef(null);
  const expectedSpeedRef = useRef(expectedSpeed);
  const actualSpeedRef = useRef(actualSpeed);

  useEffect(() => {
    expectedSpeedRef.current = expectedSpeed;
  }, [expectedSpeed]);

  useEffect(() => {
    actualSpeedRef.current = actualSpeed;
    if (boatState) {
      setBoatState((prev) => (prev ? { ...prev, speed: actualSpeed } : null));
    }
  }, [actualSpeed]);

  const checkIfSuspicious = (actual, expected) => {
    const deviation = Math.abs((actual - expected) / expected);
    return deviation > 0.20; // 20% deviation threshold
  };

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
      pathKey === "collected_data"
        ? COLLECTED_DATA
        : pathKey === "synthetic_boat_data_coast"
        ? SYNTHETIC_BOAT_DATA_COAST
        : SIMULATION_CONFIG.PREDEFINED_PATHS[pathKey] || COLLECTED_DATA;
    const startPosition = path[0];

    const newBoatState = initializeBoat("sim-boat-1", startPosition, path);
    newBoatState.speed = actualSpeed;

    setBoatState(newBoatState);
    setBoatTrail([startPosition]);
    setSimulationAlerts([]);
    restrictedZoneEnteredRef.current = false;
    backendRestrictedZoneEnteredRef.current = false;
    setActiveSession(null);
    activeSessionRef.current = null;

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
    updatedBoatState.speed = actualSpeed;
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

    if (activeSessionRef.current) {
      const exitTime = new Date();
      const exitCoords = boatState.position;
      const duration = ((exitTime - activeSessionRef.current.entryTime) / 1000).toFixed(1);
      const finalSession = {
        id: `session-${Date.now()}`,
        boatId: boatState.id,
        pathName: selectedPath,
        entryTime: activeSessionRef.current.entryTime.toISOString(),
        exitTime: exitTime.toISOString(),
        duration,
        expectedSpeed: activeSessionRef.current.expectedSpeed,
        actualSpeed: activeSessionRef.current.actualSpeed,
        isSuspicious: activeSessionRef.current.isSuspicious,
        entryCoords: activeSessionRef.current.entryCoords,
        exitCoords,
      };
      addHistoryItem(finalSession);
      setActiveSession({
        ...activeSessionRef.current,
        exitTime,
        duration,
      });
      activeSessionRef.current = null;
    }

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
    setActiveSession(null);
    activeSessionRef.current = null;

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
          { ...prevState, speed: actualSpeedRef.current },
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

            const entryTime = new Date();
            const entryCoords = updatedState.position;
            const isSusp = checkIfSuspicious(actualSpeedRef.current, expectedSpeedRef.current);
            const session = {
              entryTime,
              exitTime: null,
              duration: "0.0",
              expectedSpeed: expectedSpeedRef.current,
              actualSpeed: actualSpeedRef.current,
              isSuspicious: isSusp,
              entryCoords,
            };
            activeSessionRef.current = session;
            setActiveSession(session);

            const alert = createAlert(
              isSusp ? ALERT_TYPES.DANGER : ALERT_TYPES.WARNING,
              isSusp 
                ? `🚨 Alert: Boat entered restricted zone at SUSPICIOUS speed (${actualSpeedRef.current} kts vs Expected ${expectedSpeedRef.current} kts)!`
                : `⚠️ Info: Boat entered restricted zone at normal transit speed (${actualSpeedRef.current} kts).`,
              "boat_sim"
            );
            setSimulationAlerts((prev) => [...prev, alert]);
            alertManagerRef.current.addAlert(alert);
          } else if (activeSessionRef.current) {
            // Update active session duration live
            const dur = ((new Date() - activeSessionRef.current.entryTime) / 1000).toFixed(1);
            activeSessionRef.current.duration = dur;
            setActiveSession((prev) => (prev ? { ...prev, duration: dur } : null));
          }
        } else {
          if (restrictedZoneEnteredRef.current) {
            restrictedZoneEnteredRef.current = false;

            if (activeSessionRef.current) {
              const exitTime = new Date();
              const exitCoords = updatedState.position;
              const duration = ((exitTime - activeSessionRef.current.entryTime) / 1000).toFixed(1);
              const finalSession = {
                id: `session-${Date.now()}`,
                boatId: updatedState.id,
                pathName: selectedPath,
                entryTime: activeSessionRef.current.entryTime.toISOString(),
                exitTime: exitTime.toISOString(),
                duration,
                expectedSpeed: activeSessionRef.current.expectedSpeed,
                actualSpeed: activeSessionRef.current.actualSpeed,
                isSuspicious: activeSessionRef.current.isSuspicious,
                entryCoords: activeSessionRef.current.entryCoords,
                exitCoords,
              };

              addHistoryItem(finalSession);
              setActiveSession({
                ...activeSessionRef.current,
                exitTime,
                duration,
              });
              activeSessionRef.current = null;
            }

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
          if (activeSessionRef.current) {
            const exitTime = new Date();
            const exitCoords = updatedState.position;
            const duration = ((exitTime - activeSessionRef.current.entryTime) / 1000).toFixed(1);
            const finalSession = {
              id: `session-${Date.now()}`,
              boatId: updatedState.id,
              pathName: selectedPath,
              entryTime: activeSessionRef.current.entryTime.toISOString(),
              exitTime: exitTime.toISOString(),
              duration,
              expectedSpeed: activeSessionRef.current.expectedSpeed,
              actualSpeed: activeSessionRef.current.actualSpeed,
              isSuspicious: activeSessionRef.current.isSuspicious,
              entryCoords: activeSessionRef.current.entryCoords,
              exitCoords,
            };

            addHistoryItem(finalSession);
            setActiveSession({
              ...activeSessionRef.current,
              exitTime,
              duration,
            });
            activeSessionRef.current = null;
          }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationActive, boatState]);

  const formatTimeHHMMSS = (date) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

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
        <div className="flex flex-wrap items-end gap-3 w-full md:w-auto">
          {/* Simulation Route */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-secondary)" }}>Simulation Route</span>
            <select
              value={selectedPath}
              onChange={(e) => {
                const pathKey = e.target.value;
                setSelectedPath(pathKey);
                if (!simulationActive) initializeSimulation(pathKey);
              }}
              disabled={simulationActive}
              className="rounded-lg px-3 py-1.5 text-[12px] font-medium focus:outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)", minWidth: 160, height: 32 }}
            >
              <option value="collected_data">Collected data</option>
              <option value="synthetic_boat_data_coast">Synthetic boat data in coast</option>
              <option value="coastal_patrol">Coastal Patrol</option>
              <option value="restricted_zone_approach">Restricted Zone Approach</option>
            </select>
          </div>

          {/* Expected Speed */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-secondary)" }}>Expected Speed (kts)</span>
            <input
              type="number"
              value={expectedSpeed}
              min="1"
              max="50"
              onChange={(e) => setExpectedSpeed(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={simulationActive}
              className="rounded-lg px-2 text-[12px] font-mono text-center focus:outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", width: 90, height: 32 }}
            />
          </div>

          {/* Actual Speed */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: "var(--text-secondary)" }}>Actual Speed (kts)</span>
            <input
              type="number"
              value={actualSpeed}
              min="1"
              max="50"
              onChange={(e) => setActualSpeed(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={simulationActive}
              className="rounded-lg px-2 text-[12px] font-mono text-center focus:outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", width: 90, height: 32 }}
            />
          </div>

          <div className="flex items-center gap-2 h-[32px]">
            {!simulationActive ? (
              <>
                <button
                  onClick={() => { if (!boatState) initializeSimulation(); startSimulation(); }}
                  className="pro-btn-primary h-8 py-0 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#166534,#16a34a)", boxShadow: "0 2px 12px rgba(22,163,74,0.25)", border: "1px solid rgba(34,197,94,0.2)" }}
                >
                  ▶ Start
                </button>
                <button onClick={resetSimulation} className="pro-btn-ghost h-8 py-0 flex items-center justify-center">↻ Reset</button>
              </>
            ) : (
              <button
                onClick={stopSimulation}
                className="pro-btn-ghost h-8 py-0 flex items-center justify-center"
                style={{ color: "#fca5a5", borderColor: "rgba(239,68,68,0.25)" }}
              >
                ⏹ Stop
              </button>
            )}
          </div>
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
          {/* Active Intrusion Telemetry Panel */}
          <div 
            className="glass-card rounded-xl overflow-hidden transition-all duration-300"
            style={{ 
              borderLeft: activeSession 
                ? activeSession.isSuspicious 
                  ? "4px solid #ef4444" 
                  : "4px solid #f59e0b"
                : "4px solid var(--glass-border)",
              boxShadow: activeSession
                ? activeSession.isSuspicious
                  ? "0 4px 20px rgba(239, 68, 68, 0.15)"
                  : "0 4px 20px rgba(245, 158, 11, 0.15)"
                : "0 4px 24px rgba(0,0,0,0.35)"
            }}
          >
            <div className="px-4 py-3 flex justify-between items-center" style={{ borderBottom: "1px solid var(--glass-border)", background: "rgba(14,31,61,0.6)" }}>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-200">Active Intrusion Telemetry</span>
              {activeSession ? (
                <span 
                  className="status-dot online shrink-0" 
                  style={{ 
                    backgroundColor: activeSession.isSuspicious ? "#ef4444" : "#f59e0b",
                    boxShadow: activeSession.isSuspicious ? "0 0 10px rgba(239, 68, 68, 0.5)" : "0 0 10px rgba(245, 158, 11, 0.5)",
                    animationDuration: "1.5s"
                  }}
                />
              ) : (
                <span className="status-dot shrink-0" style={{ backgroundColor: "#22c55e", animation: "none" }} />
              )}
            </div>
            <div className="p-4 text-[12px]">
              {activeSession ? (
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
                    <span className="text-slate-400">Security Category</span>
                    {activeSession.isSuspicious ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                        Suspicious 🚩
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
                        Passing Vessel 🟢
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
                    <span className="text-slate-400">Entry Time</span>
                    <span className="font-mono text-slate-200">{formatTimeHHMMSS(activeSession.entryTime)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
                    <span className="text-slate-400">Time in Zone</span>
                    <span className="font-mono font-semibold text-red-400 animate-pulse">{activeSession.duration}s</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
                    <span className="text-slate-400">Target Passage Speed</span>
                    <span className="font-mono text-slate-200">{activeSession.expectedSpeed} knots</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
                    <span className="text-slate-400">Simulated Speed</span>
                    <span className="font-mono font-semibold text-slate-100">{activeSession.actualSpeed} knots</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5">
                    <span className="text-slate-400">Deviation</span>
                    <span className={`font-mono font-semibold ${activeSession.isSuspicious ? "text-red-400" : "text-green-400"}`}>
                      {(((activeSession.actualSpeed - activeSession.expectedSpeed) / activeSession.expectedSpeed) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-slate-400 space-y-2">
                  <svg className="w-6 h-6 text-green-400 mx-auto opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <p className="text-[11px] font-medium text-slate-300">Geofence Status Clear</p>
                  <p className="text-[10px] text-slate-500">Vessel is safely outside restricted perimeter.</p>
                </div>
              )}
            </div>
          </div>

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
