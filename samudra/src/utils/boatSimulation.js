/**
 * Boat Simulation System
 * Handles boat movement, path tracking, and state management
 * Uses Turf.js for production-grade geofencing accuracy
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon } from "@turf/helpers";
import { interpolateCoordinate, calculateBearing } from "./geoUtils";
import L from "leaflet";

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
    inRestrictedZone: false,
    hasEnteredRestrictedZone: false, // Track first entry
  };
};

/**
 * Update boat position along the path
 * Uses interpolation for smooth movement between waypoints
 * Detects restricted zone entry with Turf.js (production-grade accuracy)
 * @param {Object} boatState - Current boat state
 * @param {Array} polygonCoords - Restricted zone polygon coordinates [lat, lng] format
 * @returns {Object} Updated boat state
 */
export const updateBoatPosition = (boatState, polygonCoords = null) => {
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

    // Check if boat is in restricted zone using Turf.js
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
            "🚨 BOAT ENTERED RESTRICTED ZONE at position:",
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
  [13.602808878099422, 74.67225629230002],
  [13.602631603961866, 74.67223483993952],
  [13.602496041296542, 74.67219193521855],
  [13.602454329691593, 74.67217048285806],
  [13.602308339016416, 74.67209539959637],
  [13.60216234825124, 74.67202031633465],
  [13.60202678531726, 74.67195595925322],
  [13.601964217783086, 74.67190232835199],
  [13.60184951059419, 74.67181651891008],
  [13.601703519546124, 74.67169853092737],
  [13.601547100466181, 74.6715269120435],
  [13.601494960749909, 74.6714732811423],
  [13.601453248968618, 74.67139819788058],
  [13.601380253333692, 74.67133384079915],
  [13.601338541532199, 74.67125875753742],
  [13.601255117907177, 74.67116222191525],
  [13.601202978126606, 74.67111931719427],
  [13.601161266293891, 74.67105496011285],
  [13.601077842606417, 74.67099060303137],
  [13.601046558716051, 74.67095842449064],
  [13.600983990922892, 74.67090479358943],
  [13.600869283259165, 74.67084043650797],
  [13.600671151709138, 74.67070099616481],
  [13.60055644389389, 74.67058300818215],
  [13.600473019993355, 74.67048647255997],
  [13.600285316109707, 74.67035778495524],
  [13.60023317611562, 74.67030415405404],
  [13.600181036110069, 74.67023979697258],
  [13.600108040082992, 74.67019689225161],
  [13.59996204796136, 74.67007890426893],
  [13.599857767819373, 74.67001454718748],
  [13.599774343672728, 74.66996091628627],
  [13.599732631588381, 74.66993946392579],
  [13.599659635423103, 74.66990728538504],
  [13.599513643025057, 74.66984292830361],
  [13.599294654259246, 74.66978929740237],
  [13.599263370133329, 74.66982147594312],
  [13.599200801869065, 74.66982147594312],
  [13.599086093341665, 74.66982147594312],
  [13.599044381136114, 74.66982147594312],
  [13.598971384758718, 74.66982147594312],
  [13.598887960299857, 74.66982147594312],
  [13.598867104180549, 74.66982147594312],
  [13.598820177905392, 74.66981183506402],
  [13.598794107748512, 74.66981183506402],
  [13.598773251620948, 74.66981183506402],
  [13.598752395491537, 74.66981183506402],
  [13.598736753393275, 74.66981183506402],
  [13.598700255159992, 74.66981183506402],
  [13.598668970955554, 74.66981183506402],
  [13.598616830605625, 74.6698064719739],
  [13.59861161657, 74.66981157479394],
  [13.598580332353858, 74.66980084861372],
  [13.598512549871367, 74.66980084861372],
  [13.59845519544794, 74.66981157479394],
  [13.598418697171274, 74.6698223009742],
  [13.598397841010645, 74.66982766406429],
  [13.598340486559444, 74.66983302715443],
  [13.598293560179965, 74.66983302715443],
  [13.598251847834836, 74.66983839024456],
  [13.598225777615403, 74.66984375333469],
  [13.598178851213188, 74.66985447951491],
  [13.598137138847859, 74.66986520569517],
  [13.598084998380873, 74.6698759318754],
  [13.598053714095178, 74.66988129496553],
  [13.598017215756618, 74.66988129496553],
  [13.5979337909617, 74.66989202114577],
  [13.5979337909617, 74.66989202114577],
  [13.597892078553217, 74.669918711773],
  [13.597866008294178, 74.669918711773],
  [13.597839938032289, 74.66992943795321],
  [13.597813867767512, 74.6699508903137],
  [13.59773044290098, 74.66996161649396],
  [13.597720014790584, 74.66996161649396],
  [13.597720014790584, 74.67000992414228],
  [13.59769915856844, 74.67000992414228],
  [13.597688730456683, 74.67000992414228],
  [13.59765744611865, 74.67005812423005],
  [13.597626161776468, 74.67010100106494],
  [13.597626161776468, 74.67009027488471],
  [13.597600091488166, 74.67010100106494],
  [13.597589663372045, 74.67010100106494],
  [13.597584449313812, 74.67009026691724],
  [13.597584449313812, 74.67009026691724],
  [13.597584449313812, 74.67006880924512],
  [13.597574021197005, 74.6700580830649],
  [13.597511452486497, 74.67000444552413],
  [13.597506238426547, 74.67000980861427],
  [13.597485382185562, 74.67002053479449],
  [13.597469740003639, 74.67003126097475],
  [13.597454097820671, 74.67003662406483],
  [13.597433241575121, 74.67004198715497],
  [13.59741759938975, 74.67004198715497],
  [13.597412385327726, 74.67004198715497],
  [13.59733800150644, 74.67002300998978],
  [13.597328960319786, 74.67001516639272],
  [13.597328960319786, 74.67000980330263],
  [13.597323746255803, 74.67000980330263],
  [13.597318532191718, 74.6700044402125],
  [13.597233932275671, 74.66997750705742],
  [13.597209036819374, 74.66996689061419],
  [13.597209036819374, 74.66996689061419],
  [13.597099541396434, 74.66993470410601],
  [13.597099541396434, 74.66993470410601],
  [13.597094327327426, 74.66993470410601],
  [13.597089113258278, 74.66994006719614],
  [13.597016452064464, 74.6699187082293],
  [13.59697440370824, 74.66990788068796],
  [13.59697440370824, 74.66990788068796],
  [13.59696918963647, 74.6699132437781],
  [13.59696918963647, 74.6699132437781],
  [13.596854375746872, 74.66988883567603],
  [13.596838837804766, 74.66989178477805],
  [13.596838837804766, 74.66989714786817],
  [13.596838837804766, 74.6699025109583],
  [13.596838837804766, 74.66991323713853],
  [13.596708485901333, 74.66991859491702],
  [13.596625060645488, 74.66991859491702],
  [13.59654163536028, 74.66994541169554],
  [13.59654163536028, 74.66994541169554],
  [13.59654163536028, 74.66994541169554],
  [13.596536421278982, 74.66994541169554],
  [13.596505136788751, 74.66994541169554],
  [13.596505136788751, 74.66994541169554],
  [13.596380240386392, 74.66995031750714],
  [13.596369570616725, 74.66995613787577],
  [13.596364356531648, 74.66995613787577],
  [13.596233581734007, 74.6699716623299],
  [13.596228790279053, 74.66997223112986],
  [13.596228790279053, 74.66997223112986],
  [13.596218362102563, 74.66997223112986],
  [13.596218362102563, 74.66997223112986],
  [13.596218362102563, 74.66997223112986],
  [13.596119294403023, 74.66997759820372],
  [13.596119294403023, 74.66997759820372],
  [13.596030654847262, 74.66998832703977],
  [13.596030654847262, 74.66998832703977],
  [13.595937592037707, 74.66999790162474],
  [13.595926372974505, 74.66999905587583],
  [13.595926372974505, 74.66999905587583],
  [13.595926372974505, 74.66999905587583],
  [13.595926372974505, 74.66999905587583],
  [13.595895088403717, 74.66999905587583],
  [13.595879446116772, 74.66999905587583],
  [13.595879446116772, 74.66999905587583],
  [13.595753734233243, 74.67000379899274],
  [13.595733451388867, 74.67000441896597],
  [13.595733451388867, 74.67000441896597],
  [13.595696127363402, 74.66998819523937],
  [13.59569091326349, 74.66999355832947],
  [13.595546816138718, 74.66999880191423],
  [13.595535315542802, 74.66999905853167],
  [13.595535315542802, 74.66999905853167],
  [13.595373678282488, 74.6700044229497],
  [13.595243325572875, 74.66999369676944],
  [13.595243325572875, 74.66999369676944],
  [13.595248539682645, 74.66999369676944],
  [13.595243325572875, 74.66999369676944],
  [13.595243325572875, 74.66999369676944],
  [13.595222469132688, 74.66999905985956],
  [13.595206826801341, 74.66999905985956],
  [13.595206826801341, 74.66999905985956],
  [13.595176421443256, 74.66999369714246],
  [13.594972191707155, 74.66999369676944],
  [13.594893979957462, 74.6700097860398],
  [13.594893979957462, 74.6700097860398],
  [13.59463096103702, 74.67001958520324],
  [13.59457591857604, 74.6700258766381],
];

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
