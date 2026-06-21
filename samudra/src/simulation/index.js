/**
 * simulation/index.js — barrel export for the simulation feature module
 *
 * Usage:
 *   import { initializeBoat, updateBoatPosition, REAL_WORLD_PATH } from '../simulation';
 *   import { geofenceCheckAPI } from '../simulation';
 */

// Utils
export * from "./utils/boatSimulation";
export * from "./utils/geoUtils";

// Routes
export { geofenceCheckAPI, default as geofenceCheckRoutes } from "./routes/geofenceCheckRoutes";

// Pages
export { default as SimulationPage } from "./SimulationPage";
