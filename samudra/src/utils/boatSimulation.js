/**
 * Boat Simulation System
 * Handles boat movement, path tracking, and state management
 * Uses Turf.js for production-grade geofencing accuracy.
 * Also validates against all active Firestore geofences via the backend
 * /api/geofence-check/location endpoint on every position tick.
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon } from "@turf/helpers";
import { interpolateCoordinate, calculateBearing } from "./geoUtils";
import L from "leaflet";

// ---------------------------------------------------------------------------
// Backend geofence helpers
// ---------------------------------------------------------------------------

/**
 * Hit the backend /api/geofence-check/location endpoint to check whether
 * [lat, lng] falls inside any active geofence stored in Firestore.
 *
 * @param {number} lat  - Latitude
 * @param {number} lng  - Longitude
 * @param {string} [baseUrl=''] - API base URL (defaults to same origin)
 * @returns {Promise<{
 *   inRestrictedZone: boolean,
 *   violations: Array,
 *   safeZones: Array,
 *   monitoringZones: Array
 * }>} Geofence result from the server
 */
export const checkGeofenceWithBackend = async (lat, lng, baseUrl = "") => {
  try {
    let url;
    if (baseUrl) {
      const cleanBase = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
      url = `${cleanBase}/geofence-check/location`;
    } else {
      const defaultBase =
        process.env.REACT_APP_API_URL || "http://localhost:5000/api";
      url = `${defaultBase}/geofence-check/location`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng }),
    });

    if (!response.ok) {
      console.warn(
        `[GeofenceCheck] Backend returned ${response.status} for (${lat}, ${lng})`
      );
      return {
        inRestrictedZone: false,
        violations: [],
        safeZones: [],
        monitoringZones: [],
      };
    }

    const data = await response.json();
    return {
      inRestrictedZone: data.in_restricted_zone ?? false,
      violations: data.violations ?? [],
      safeZones: data.safe_zones ?? [],
      monitoringZones: data.monitoring_zones ?? [],
    };
  } catch (err) {
    // Network error — degrade gracefully, do not break simulation
    console.warn("[GeofenceCheck] Backend unreachable:", err.message);
    return {
      inRestrictedZone: false,
      violations: [],
      safeZones: [],
      monitoringZones: [],
    };
  }
};

/**
 * Generate a realistic sailing path around Udupi area
 * @param {Array} startPoint - [latitude, longitude]
 * @param {number} numWaypoints - Number of waypoints to generate
 * @returns {Array} Array of [latitude, longitude] coordinates
 */
export const generateRealisticPath = (startPoint, numWaypoints = 20) => {
  const [lat, lng] = startPoint;
  const path = [startPoint];

  // Generate waypoints with realistic variation
  for (let i = 1; i < numWaypoints; i++) {
    // Random variations (±0.02 degrees ≈ ±2 km)
    const latVariation = (Math.random() - 0.5) * 0.02;
    const lngVariation = (Math.random() - 0.5) * 0.02;

    const newPoint = [lat + latVariation * i, lng + lngVariation * i];

    path.push(newPoint);
  }

  return path;
};

/**
 * Initialize boat state object
 * @param {string} boatId - Unique identifier for boat
 * @param {Array} startPosition - [latitude, longitude]
 * @param {Array} path - Array of [latitude, longitude] waypoints
 * @returns {Object} Boat state object
 */
export const initializeBoat = (boatId, startPosition, path) => {
  return {
    id: boatId,
    position: startPosition, // Current [lat, lng]
    path: path, // Full path to follow
    pathIndex: 0, // Current index in path
    subPathProgress: 0, // Progress between two waypoints (0-1)
    traveledPath: [startPosition], // Array of all positions traveled
    heading: 0, // Direction of travel in degrees
    speed: 1, // Movement speed (waypoints per iteration)
    isMoving: false,
    // --- Local (Turf.js) restricted zone ---
    inRestrictedZone: false,
    hasEnteredRestrictedZone: false, // Track first entry
    // --- Backend (Firestore) geofence result ---
    inAnyRestrictedZone: false,   // true if backend reports a violation
    violations: [],               // Active restricted-zone violations from backend
    safeZones: [],                // Safe zones the boat is currently inside
    monitoringZones: [],          // Monitoring zones the boat is currently inside
  };
};

/**
 * Update boat position along the path.
 *
 * Two layers of geofence detection run on every tick:
 *  1. **Local (Turf.js)** — instant, synchronous check against `polygonCoords`
 *     (the single hardcoded restricted zone polygon).
 *  2. **Backend (Firestore)** — async POST to /api/geofence-check/location that
 *     validates the new position against ALL active geofences in the database.
 *     Results are surfaced via the optional `onGeofenceResult` callback so the
 *     caller can react (show alerts, update UI, etc.) without blocking the
 *     simulation loop.
 *
 * @param {Object}   boatState       - Current boat state
 * @param {Array}    polygonCoords   - Restricted zone polygon [lat, lng] format
 * @param {Function} [onGeofenceResult] - Optional async callback invoked with
 *   the backend result: ({ inAnyRestrictedZone, violations, safeZones, monitoringZones, position })
 * @param {string}   [apiBaseUrl=''] - API base URL for the geofence endpoint
 * @returns {Object} Updated boat state
 */
export const updateBoatPosition = (
  boatState,
  polygonCoords = null,
  onGeofenceResult = null,
  apiBaseUrl = ""
) => {
  const updatedState = { ...boatState };

  if (!updatedState.isMoving || updatedState.path.length === 0) {
    return updatedState;
  }

  // Check if we've reached the end of the path
  if (updatedState.pathIndex >= updatedState.path.length - 1) {
    updatedState.isMoving = false;
    return updatedState;
  }

  // Get current and next waypoint
  const currentWaypoint = updatedState.path[updatedState.pathIndex];
  const nextWaypoint = updatedState.path[updatedState.pathIndex + 1];

  // Update progress between waypoints
  updatedState.subPathProgress += 0.05; // Adjust speed here (0-1 range)

  if (updatedState.subPathProgress >= 1) {
    // Move to next waypoint
    updatedState.pathIndex += 1;
    updatedState.subPathProgress = 0;
  } else {
    // Interpolate position between current and next waypoint
    const newPosition = interpolateCoordinate(
      currentWaypoint,
      nextWaypoint,
      updatedState.subPathProgress,
    );

    updatedState.position = newPosition;
    updatedState.heading = calculateBearing(currentWaypoint, nextWaypoint);
    updatedState.traveledPath.push(newPosition);

    // ------------------------------------------------------------------
    // Layer 1 — Local Turf.js check (synchronous, instant)
    // Validates against the single hardcoded restricted zone polygon.
    // ------------------------------------------------------------------
    if (polygonCoords && polygonCoords.length >= 3) {
      try {
        // Convert boat position from [lat, lng] to [lng, lat] for GeoJSON
        const gpsPoint = point([newPosition[1], newPosition[0]]);

        // Convert polygon from [lat, lng] to [lng, lat] for GeoJSON
        const geoJsonCoords = polygonCoords.map(([lat, lng]) => [lng, lat]);

        // CRITICAL: Close the polygon ring - first and last coordinates must match
        const closedPolygon = [...geoJsonCoords];
        if (
          closedPolygon[0][0] !== closedPolygon[closedPolygon.length - 1][0] ||
          closedPolygon[0][1] !== closedPolygon[closedPolygon.length - 1][1]
        ) {
          closedPolygon.push(closedPolygon[0]);
        }

        // Create GeoJSON polygon
        const geoJsonPolygon = polygon([closedPolygon]);

        // Highly accurate point-in-polygon detection
        // ignoreBoundary: false ensures exact boundary intersections are counted as valid hits
        const inZone = booleanPointInPolygon(gpsPoint, geoJsonPolygon, {
          ignoreBoundary: false,
        });

        updatedState.inRestrictedZone = inZone;

        // Track first entry
        if (inZone && !updatedState.hasEnteredRestrictedZone) {
          updatedState.hasEnteredRestrictedZone = true;
          console.log(
            "🚨 [Local] BOAT ENTERED RESTRICTED ZONE at position:",
            newPosition,
          );
        }
      } catch (error) {
        console.error(
          "Error in restricted zone detection:",
          error.message,
          "Position:",
          newPosition,
        );
        // Fail-safe: keep previous state on error
        updatedState.inRestrictedZone = boatState.inRestrictedZone;
      }
    }

    // ------------------------------------------------------------------
    // Layer 2 — Backend Firestore geofence check (async, non-blocking)
    // Validates against ALL active geofences in the Firestore database
    // via POST /api/geofence-check/location.
    // The simulation loop is NOT paused; results arrive via callback.
    // ------------------------------------------------------------------
    checkGeofenceWithBackend(newPosition[0], newPosition[1], apiBaseUrl)
      .then((result) => {
        if (result.inRestrictedZone) {
          console.log(
            "🚨 [Backend] BOAT IN RESTRICTED ZONE — violations:",
            result.violations.map((v) => v.name).join(", "),
            "| position:",
            newPosition
          );
        }
        // Surface the result to the caller if they provided a callback
        if (typeof onGeofenceResult === "function") {
          onGeofenceResult({
            inAnyRestrictedZone: result.inRestrictedZone,
            violations: result.violations,
            safeZones: result.safeZones,
            monitoringZones: result.monitoringZones,
            position: newPosition,
          });
        }
      })
      .catch((err) => {
        // Should never reach here because checkGeofenceWithBackend swallows
        // errors, but keep a safety net just in case.
        console.warn("[GeofenceCheck] Unhandled promise rejection:", err);
      });
  }

  return updatedState;
};

/**
 * Reset boat to starting position
 * @param {Object} boatState - Current boat state
 * @param {Array} startPosition - [latitude, longitude]
 * @returns {Object} Reset boat state
 */
export const resetBoat = (boatState, startPosition) => {
  return {
    ...boatState,
    position: startPosition,
    pathIndex: 0,
    subPathProgress: 0,
    traveledPath: [startPosition],
    heading: 0,
    isMoving: false,
    inRestrictedZone: false,
    hasEnteredRestrictedZone: false,
  };
};

/**
 * Start boat movement
 * @param {Object} boatState - Current boat state
 * @returns {Object} Updated boat state with movement started
 */
export const startBoatMovement = (boatState) => {
  return {
    ...boatState,
    isMoving: true,
  };
};

/**
 * Stop boat movement
 * @param {Object} boatState - Current boat state
 * @returns {Object} Updated boat state with movement stopped
 */
export const stopBoatMovement = (boatState) => {
  return {
    ...boatState,
    isMoving: false,
  };
};

/**
 * Get boat marker icon based on state
 * @param {Object} boatState - Current boat state
 * @returns {Object} Leaflet icon configuration
 */
export const getBoatIcon = (boatState) => {
  const iconUrl = boatState.inRestrictedZone
    ? "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cGF0aCBkPSJNMTYgMkw0IDEwdjE2aDAuNXYyaDA3djIuNWgxdjIuNWg3di0yLjVoMXYtMmgwLjVWMTB6IiBmaWxsPSIjZGMyNjI2IiBzdHJva2U9IiM5OTAxMDEiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9zdmc+" // Red
    : "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48cGF0aCBkPSJNMTYgMkw0IDEwdjE2aDAuNXYyaDA3djIuNWgxdjIuNWg3di0yLjVoMXYtMmgwLjVWMTB6IiBmaWxsPSIjMjc3NGQ5IiBzdHJva2U9IiMxYTQzYjAiIHN0cm9rZS13aWR0aD0iMC41Ii8+PC9zdmc+"; // Blue

  return L.icon({
    iconUrl: iconUrl,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
    className: boatState.inRestrictedZone ? "boat-marker-alert" : "boat-marker",
  });
};

/**
 * Real-world path coordinates around Udupi area
 * Array of [latitude, longitude] waypoints for boat simulation
 */
export const REAL_WORLD_PATH = [
  [
    13.639937627304244,
    74.67130838482626
  ],
  [
    13.639353516563265,
    74.67126548733418
  ],
  [
    13.639019738348217,
    74.67130838482626
  ],
  [
    13.638978016038184,
    74.67130838482626
  ],
  [
    13.638769404377335,
    74.67130838482626
  ],
  [
    13.63851907014104,
    74.67130838482626
  ],
  [
    13.63772634330866,
    74.67126548733418
  ],
  [
    13.637517730542058,
    74.67126548733418
  ],
  [
    13.637100504456036,
    74.67126548733418
  ],
  [
    13.636975336486467,
    74.67126548733418
  ],
  [
    13.636599832179796,
    74.67126548733418
  ],
  [
    13.63630777286183,
    74.67126548733418
  ],
  [
    13.636057436016108,
    74.67117969235007
  ],
  [
    13.635765376027427,
    74.67105099987391
  ],
  [
    13.635556761528683,
    74.67092230739775
  ],
  [
    13.63476402475301,
    74.67027884501697
  ],
  [
    13.634722301691133,
    74.67006435755671
  ],
  [
    13.634471963164994,
    74.66993566508054
  ],
  [
    13.634221624373561,
    74.66959248514412
  ],
  [
    13.634054731698555,
    74.66924930520769
  ],
  [
    13.63397128531683,
    74.66912061273153
  ],
  [
    13.633887838905615,
    74.66894902276334
  ],
  [
    13.633762669233533,
    74.66877743279511
  ],
  [
    13.63363749949513,
    74.66830556038252
  ],
  [
    13.633512329690406,
    74.66791948295405
  ],
  [
    13.633410370726384,
    74.66779872577423
  ],
  [
    13.633347785772136,
    74.66758423831396
  ],
  [
    13.633243477478205,
    74.66732685336166
  ],
  [
    13.633139169138246,
    74.66704801966333
  ],
  [
    13.633034860752181,
    74.66676918596495
  ],
  [
    13.632951414010188,
    74.66653324975867
  ],
  [
    13.632867967238731,
    74.66625441606033
  ],
  [
    13.632784520437783,
    74.665975582362
  ],
  [
    13.632721935317738,
    74.66567529991761
  ],
  [
    13.632659350181102,
    74.66546081245734
  ],
  [
    13.632596765027891,
    74.66513908126697
  ],
  [
    13.632575903306469,
    74.66490314506068
  ],
  [
    13.632534179858089,
    74.66475300383846
  ],
  [
    13.632450732939256,
    74.66453851637823
  ],
  [
    13.632409009468766,
    74.6644312726481
  ],
  [
    13.632409009468766,
    74.6641309902037
  ],
  [
    13.632367285990934,
    74.66393795148949
  ],
  [
    13.63226297726408,
    74.66342318158483
  ],
  [
    13.632158668491172,
    74.66316579663253
  ],
  [
    13.632054359672221,
    74.66292986042623
  ],
  [
    13.6320334979029,
    74.66265102672789
  ],
  [
    13.631970912583892,
    74.66247943675967
  ],
  [
    13.631929189028671,
    74.66232929553749
  ],
  [
    13.63186660368203,
    74.66205046183916
  ],
  [
    13.63180435270442,
    74.66187603337347
  ],
  [
    13.631658320125966,
    74.66166154591322
  ],
  [
    13.631658320125966,
    74.66166154591322
  ],
  [
    13.631597115121153,
    74.66161201666159
  ],
  [
    13.631555391499942,
    74.6616012922886
  ],
  [
    13.63140935876759,
    74.6615369460505
  ],
  [
    13.63132591145148,
    74.66152622167752
  ],
  [
    13.63123203318558,
    74.66149404855847
  ],
  [
    13.63115901673078,
    74.66148332418544
  ],
  [
    13.631075569326216,
    74.66145115106643
  ],
  [
    13.630981690960864,
    74.66141897794738
  ],
  [
    13.630908674428676,
    74.66140825357435
  ],
  [
    13.630741779413265,
    74.6613760804553
  ],
  [
    13.630647900915287,
    74.66135463170927
  ],
  [
    13.630564453330205,
    74.66135463170927
  ],
  [
    13.630522729526634,
    74.66136535608231
  ],
  [
    13.630501867622074,
    74.66136535608231
  ],
  [
    13.630471502901402,
    74.6613780642794
  ],
  [
    13.630403701690165,
    74.66139415083893
  ],
  [
    13.630361977858199,
    74.66141023739846
  ],
  [
    13.630325469499162,
    74.66142632395797
  ],
  [
    13.63027853017214,
    74.6614424105175
  ],
  [
    13.630184651490096,
    74.66148530800953
  ],
  [
    13.630122065681345,
    74.6615174811286
  ],
  [
    13.630059479856032,
    74.66156037862062
  ],
  [
    13.629965562503696,
    74.66160863383612
  ],
  [
    13.629918623105189,
    74.66163544476869
  ],
  [
    13.629819528788781,
    74.66166761788773
  ],
  [
    13.629751727390476,
    74.66169442882024
  ],
  [
    13.629715218937156,
    74.66171587756627
  ],
  [
    13.629625365875016,
    74.66179417033318
  ],
  [
    13.629594072898646,
    74.66178344596014
  ],
  [
    13.629541917928828,
    74.66179417033318
  ],
  [
    13.629479331949842,
    74.66181561907919
  ],
  [
    13.629416745954291,
    74.66185851657123
  ],
  [
    13.629322866929854,
    74.66187996531725
  ],
  [
    13.629260280892854,
    74.66192286280933
  ],
  [
    13.629155970794367,
    74.66196576030137
  ],
  [
    13.628989074540995,
    74.66205155528549
  ],
  [
    13.628843040222602,
    74.66211590152355
  ],
  [
    13.6288027372719,
    74.66213957286666
  ],
  [
    13.62873493558185,
    74.66217710817222
  ],
  [
    13.62871407351946,
    74.66218247035872
  ],
  [
    13.628630625251448,
    74.66221464347777
  ],
  [
    13.62856282351201,
    74.66223609222378
  ],
  [
    13.628521099354977,
    74.6622521787833
  ],
  [
    13.628479375190592,
    74.66227898971582
  ],
  [
    13.628369849224034,
    74.66234333595392
  ],
  [
    13.628312478459375,
    74.66237014688643
  ],
  [
    13.62823424557604,
    74.66240768219197
  ],
  [
    13.62821338346944,
    74.66241304437851
  ],
  [
    13.628171659250743,
    74.66244521749752
  ],
  [
    13.628062840506905,
    74.66250999218805
  ],
  [
    13.627927236682758,
    74.66257970061264
  ],
  [
    13.62789594348151,
    74.66259042498568
  ],
  [
    13.627775986171725,
    74.66265477122373
  ],
  [
    13.62772383080065,
    74.66269230652927
  ],
  [
    13.627645597722449,
    74.66273520402136
  ],
  [
    13.627572580159429,
    74.66279955025941
  ],
  [
    13.627489131488353,
    74.66285853431101
  ],
  [
    13.627041737520349,
    74.66310901906643
  ],
  [
    13.626457594892095,
    74.66336640401873
  ],
  [
    13.62641587036341,
    74.66340930151077
  ],
  [
    13.626129294515831,
    74.66346217837443
  ],
  [
    13.625899809198119,
    74.6635265246125
  ],
  [
    13.625691185988662,
    74.66359087085058
  ],
  [
    13.625482562595089,
    74.66361231959661
  ],
  [
    13.625253076649473,
    74.66367666583466
  ],
  [
    13.62508617764001,
    74.66371956332674
  ],
  [
    13.624919278512703,
    74.66382680705686
  ],
  [
    13.624794104089878,
    74.66391260204095
  ],
  [
    13.624606342331369,
    74.6640412945171
  ],
  [
    13.624355993088022,
    74.66412708950122
  ],
  [
    13.624189093445171,
    74.66412708950122
  ],
  [
    13.623897018786641,
    74.66421288448534
  ],
  [
    13.623542356216149,
    74.66432012821548
  ],
  [
    13.62322941821209,
    74.6644273719456
  ],
  [
    13.623125105451999,
    74.66459896191381
  ],
  [
    13.622999930079168,
    74.66459896191381
  ],
  [
    13.62270785395146,
    74.66477055188204
  ],
  [
    13.622666128760889,
    74.66477055188204
  ],
  [
    13.62245750269766,
    74.66470620564395
  ],
  [
    13.622228013815462,
    74.66459896191381
  ],
  [
    13.622123700613555,
    74.66455606442176
  ],
  [
    13.622023027174967,
    74.66453984190296
  ],
  [
    13.621981301863533,
    74.66451839315694
  ],
  [
    13.621783106533742,
    74.66442187379984
  ],
  [
    13.621689224477446,
    74.6644111494268
  ],
  [
    13.621491028902831,
    74.66437897630776
  ],
  [
    13.621268047667705,
    74.66442749691089
  ],
  [
    13.621268047667705,
    74.66455618938704
  ],
  [
    13.621226322223057,
    74.66470633060926
  ],
  [
    13.621226322223057,
    74.66500661305362
  ],
  [
    13.621226322223057,
    74.66509240803774
  ],
  [
    13.621142871311662,
    74.66513530552977
  ],
  [
    13.620829930131654,
    74.66502806179963
  ],
  [
    13.620683890772577,
    74.66479212559334
  ],
  [
    13.620579576889458,
    74.6646848818632
  ],
  [
    13.6205378513233,
    74.6646848818632
  ],
  [
    13.620496125749813,
    74.66472777935529
  ],
  [
    13.62043764451441,
    74.66489384439943
  ],
  [
    13.62043764451441,
    74.66494746626451
  ],
  [
    13.620406350321707,
    74.66500108812957
  ],
  [
    13.620333330522657,
    74.66519412684379
  ],
  [
    13.620302036316136,
    74.66524774870885
  ],
  [
    13.620291604913051,
    74.66524774870885
  ],
  [
    13.62019460300426,
    74.66525581550145
  ],
  [
    13.62017374018814,
    74.66524509112841
  ],
  [
    13.62015287737019,
    74.6652182801959
  ],
  [
    13.620121583139804,
    74.6651592961443
  ],
  [
    13.620069426079953,
    74.66508958771975
  ],
  [
    13.62000220494539,
    74.66502041709225
  ],
  [
    13.61997612640374,
    74.66495607085413
  ],
  [
    13.619950047859216,
    74.66488100024306
  ],
  [
    13.619726027665155,
    74.66488029491809
  ],
  [
    13.619726027665155,
    74.66488029491809
  ],
  [
    13.619698085980032,
    74.66504520403326
  ],
  [
    13.619698085980032,
    74.66518462088241
  ],
  [
    13.619645928826762,
    74.6653454864776
  ],
  [
    13.619593771662029,
    74.66560287142993
  ],
  [
    13.619593771662029,
    74.66560287142993
  ],
  [
    13.619548534372752,
    74.66560504270197
  ],
  [
    13.619491161467261,
    74.6655514208369
  ],
  [
    13.61946508286924,
    74.66550316115837
  ],
  [
    13.61940770994352,
    74.66542809054728
  ],
  [
    13.619376415614523,
    74.6653851930552
  ],
  [
    13.619345121281393,
    74.66530476025761
  ],
  [
    13.619319042667264,
    74.66526186276553
  ],
  [
    13.61927731687871,
    74.66520824090047
  ],
  [
    13.619230375357793,
    74.6651492568489
  ],
  [
    13.619167786648708,
    74.66511172154337
  ],
  [
    13.619094766467201,
    74.6651492568489
  ],
  [
    13.619063472096794,
    74.66518142996796
  ],
  [
    13.619047824910039,
    74.66526722495207
  ],
  [
    13.619037393451613,
    74.66532084681714
  ],
  [
    13.61900609907361,
    74.66541200398775
  ],
  [
    13.618995667613364,
    74.66547098803932
  ],
  [
    13.6189695889607,
    74.6655460586504
  ],
  [
    13.618943510305188,
    74.66562649144798
  ],
  [
    13.618917431646802,
    74.66572837299162
  ],
  [
    13.618880921520203,
    74.66577127048366
  ],
  [
    13.618860058588197,
    74.66577127048366
  ],
  [
    13.618823548452733,
    74.66573909736466
  ],
  [
    13.618776606841742,
    74.6657122864321
  ],
  [
    13.618734880957478,
    74.66564794019405
  ],
  [
    13.618646213428967,
    74.66542272836075
  ],
  [
    13.618682723591785,
    74.6655460586504
  ],
  [
    13.6186044875217,
    74.66535301993615
  ],
  [
    13.618562761607055,
    74.66526186276553
  ]
];
export const COLLECTED_DATA = REAL_WORLD_PATH;
export const SYNTHETIC_BOAT_DATA_COAST = REAL_WORLD_PATH;


/**
 * Restricted zone polygon around Udupi area
 * Boat entering this polygon will trigger DANGER alerts
 * Array of [latitude, longitude] coordinates forming a closed polygon
 *
 * CRITICAL REQUIREMENTS:
 * - Must be a closed ring (first and last coordinates MUST match)
 * - Validated by Turf.js's booleanPointInPolygon with ignoreBoundary: false
 * - Boundary intersections are counted as valid zone entries
 */
export const RESTRICTED_ZONE_POLYGON = [
  [13.5995, 74.67],
  [13.5995, 74.6698],
  [13.5993, 74.66975],
  [13.5991, 74.66982],
  [13.5989, 74.67],
  [13.599, 74.67015],
  [13.5993, 74.67018],
  [13.5995, 74.67], // Closed ring - matches first coordinate
];

/**
 * Export simulation configuration
 */
export const SIMULATION_CONFIG = {
  DEFAULT_SPEED: 1, // Waypoints per update cycle
  UPDATE_INTERVAL: 100, // Milliseconds between updates
  PATH_WAYPOINTS: 30, // Number of waypoints for generated path
};
