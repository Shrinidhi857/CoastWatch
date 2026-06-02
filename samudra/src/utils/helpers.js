/**
 * Utility functions for Samudra Application
 */

/**
 * Convert boat data from server format to UI format
 */
export const formatBoatFromServer = (serverBoat) => {
  return {
    id: serverBoat.id,
    name: serverBoat.name,
    lat: serverBoat.latitude,
    lng: serverBoat.longitude,
    latitude: serverBoat.latitude,
    longitude: serverBoat.longitude,
    status: serverBoat.status,
    speed: serverBoat.speed,
    heading: serverBoat.heading,
    vessel_type: serverBoat.vessel_type,
    crew_count: serverBoat.crew_count,
    destination: serverBoat.destination,
    in_restricted_zone: serverBoat.in_restricted_zone,
    created_at: serverBoat.created_at,
    updated_at: serverBoat.updated_at,
  };
};

/**
 * Convert boat data from UI format to server format
 */
export const formatBoatForServer = (uiBoat) => {
  return {
    name: uiBoat.name,
    latitude: uiBoat.lat || uiBoat.latitude,
    longitude: uiBoat.lng || uiBoat.longitude,
    status: uiBoat.status,
    speed: uiBoat.speed,
    heading: uiBoat.heading,
    vessel_type: uiBoat.vessel_type,
    crew_count: uiBoat.crew_count,
    destination: uiBoat.destination,
  };
};

/**
 * Convert geofence data from server format to UI format
 */
export const formatGeofenceFromServer = (serverGeofence) => {
  return {
    id: serverGeofence.id,
    name: serverGeofence.name,
    description: serverGeofence.description,
    coordinates: serverGeofence.coordinates, // [lng, lat] format
    type: serverGeofence.type,
    is_active: serverGeofence.is_active,
    metadata: serverGeofence.metadata,
    created_at: serverGeofence.created_at,
    updated_at: serverGeofence.updated_at,
  };
};

/**
 * Convert geofence data from UI format to server format
 */
export const formatGeofenceForServer = (uiGeofence) => {
  return {
    name: uiGeofence.name,
    description: uiGeofence.description || "",
    coordinates: uiGeofence.coordinates, // [lng, lat] format
    type: uiGeofence.type,
    is_active: uiGeofence.is_active !== false,
    metadata: uiGeofence.metadata || {},
  };
};

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
export const isPointInPolygon = (point, polygon) => {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
};

/**
 * Convert coordinates from [lng, lat] to [lat, lng] (for Leaflet)
 */
export const coordsToLeaflet = (coords) => {
  return coords.map((coord) => [coord[1], coord[0]]);
};

/**
 * Convert coordinates from [lat, lng] to [lng, lat] (for server)
 */
export const coordsToServer = (coords) => {
  return coords.map((coord) => [coord[1], coord[0]]);
};

/**
 * Calculate distance between two points (Haversine formula)
 */
export const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Format timestamp to readable string
 */
export const formatTimestamp = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString();
};

/**
 * Get color based on geofence type
 */
export const getGeofenceColor = (type) => {
  const colors = {
    restricted: "#ef4444",
    safe_zone: "#22c55e",
    monitoring: "#eab308",
  };
  return colors[type] || "#3b82f6";
};

/**
 * Convert alert data from server format
 */
export const formatAlertFromServer = (serverAlert) => {
  return {
    boat_id: serverAlert.boat_id,
    boat_name: serverAlert.boat_name,
    location: serverAlert.location,
    status: serverAlert.status,
    speed: serverAlert.speed,
    updated_at: serverAlert.updated_at,
    severity: serverAlert.severity,
  };
};
