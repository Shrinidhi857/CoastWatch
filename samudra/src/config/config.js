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
  DEFAULT_CENTER: [13.0827, 80.2707], // Chennai port area
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
