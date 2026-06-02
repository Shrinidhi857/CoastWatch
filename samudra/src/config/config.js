/**
 * Configuration for Samudra Application
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_URL || "http://localhost:5000/api",
  TIMEOUT: 10000,
  RETRY_ATTEMPTS: 3,
};

// Map Configuration
export const MAP_CONFIG = {
  DEFAULT_CENTER: [13.6308, 74.6644], // Udupi, Karnataka
  DEFAULT_ZOOM: 11,
  TILE_LAYER: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  ATTRIBUTION:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// Geofence Types
export const GEOFENCE_TYPES = {
  RESTRICTED: "restricted",
  SAFE_ZONE: "safe_zone",
  MONITORING: "monitoring",
};

// Geofence Colors
export const GEOFENCE_COLORS = {
  restricted: "#ef4444", // red
  safe_zone: "#22c55e", // green
  monitoring: "#eab308", // yellow
};

// Vessel Status
export const VESSEL_STATUS = {
  ACTIVE: "Active",
  ANCHORED: "Anchored",
  MAINTENANCE: "Maintenance",
};

// Refresh Intervals (milliseconds)
export const REFRESH_INTERVALS = {
  BOATS: 5000, // 5 seconds
  ALERTS: 3000, // 3 seconds
  GEOFENCES: 10000, // 10 seconds
};

// Notification Types
export const NOTIFICATION_TYPES = {
  INFO: "info",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "error",
};

// =============================================
// BOAT SIMULATION CONFIGURATION
// =============================================

export const SIMULATION_CONFIG = {
  // Boat initial position (Udupi harbor)
  BOAT_START_POSITION: [13.6308, 74.6644],

  // Path generation
  PATH_WAYPOINTS: 30,
  PATH_VARIATION: 0.03, // Degrees of lat/lng variation

  // Movement timing
  UPDATE_INTERVAL: 100, // Milliseconds between updates
  INTERPOLATION_SPEED: 0.05, // Speed between waypoints (0-1)

  // Simulation paths (example routes around Udupi)
  PREDEFINED_PATHS: {
    harbor_tour: [
      [13.6308, 74.6644], // Start - Harbor
      [13.635, 74.665],
      [13.638, 74.668],
      [13.64, 74.672],
      [13.635, 74.675],
      [13.63, 74.67],
      [13.6308, 74.6644], // Return to harbor
    ],

    coastal_patrol: [
      [13.6308, 74.6644], // Harbor
      [13.62, 74.66],
      [13.61, 74.655],
      [13.605, 74.65],
      [13.61, 74.645],
      [13.62, 74.645],
      [13.6308, 74.6644], // Return
    ],

    restricted_zone_approach: [
      [13.6308, 74.6644], // Harbor
      [13.635, 74.67],
      [13.64, 74.68], // Approaching restricted zone
      [13.645, 74.685], // Entering restricted zone
      [13.648, 74.69], // Deep in restricted zone
      [13.64, 74.695],
      [13.6308, 74.6644], // Escape and return
    ],
  },

  // Alert settings
  ALERT_DEBOUNCE: 500, // Milliseconds to debounce alerts
  APPROACH_WARNING_DISTANCE: 0.5, // Kilometers

  // UI settings
  SHOW_BOAT_TRAIL: true,
  SHOW_HEADING_ARROW: true,
  TRAIL_COLOR: "#3b82f6", // Blue
  RESTRICTED_TRAIL_COLOR: "#ef4444", // Red
};
