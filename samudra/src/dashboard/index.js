/**
 * dashboard/index.js — barrel export for the dashboard feature module
 *
 * Usage:
 *   import { boatsAPI, geofencesAPI, AlertManager } from '../dashboard';
 *   import { formatBoatFromServer, getGeofenceColor } from '../dashboard';
 */

// Utils
export * from "./utils/helpers";
export * from "./utils/alertSystem";

// Routes
export {
  boatsAPI,
  geofencesAPI,
  alertsAPI,
  systemAPI,
  depthAPI,
  default as dashboardRoutes,
} from "./routes/dashboardRoutes";

// Pages
export { default as DashboardPage } from "./DashboardPage";
