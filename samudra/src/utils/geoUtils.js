/**
 * Geospatial Utility Functions
 * Handles point-in-polygon detection and geographic calculations
 */

/**
 * Ray casting algorithm for point-in-polygon detection
 * Determines if a point [lng, lat] is inside a polygon
 * @param {Array} point - [longitude, latitude] point to check
 * @param {Array} polygon - Array of [longitude, latitude] coordinates forming a polygon
 * @returns {boolean} true if point is inside polygon, false otherwise
 */
export const isPointInPolygon = (point, polygon) => {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    // Check if point crosses the polygon edge
    const isIntersecting =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (isIntersecting) {
      inside = !inside;
    }
  }

  return inside;
};

/**
 * Calculate distance between two points in kilometers
 * Uses Haversine formula for accurate great-circle distance
 * @param {Array} point1 - [latitude, longitude]
 * @param {Array} point2 - [latitude, longitude]
 * @returns {number} Distance in kilometers
 */
export const calculateDistance = (point1, point2) => {
  const [lat1, lng1] = point1;
  const [lat2, lng2] = point2;

  const R = 6371; // Earth radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Linear interpolation between two points
 * Calculates intermediate coordinate based on progress ratio
 * @param {Array} point1 - [latitude, longitude] start point
 * @param {Array} point2 - [latitude, longitude] end point
 * @param {number} t - Progress ratio (0-1)
 * @returns {Array} Interpolated [latitude, longitude]
 */
export const interpolateCoordinate = (point1, point2, t) => {
  const [lat1, lng1] = point1;
  const [lat2, lng2] = point2;

  const lat = lat1 + (lat2 - lat1) * t;
  const lng = lng1 + (lng2 - lng1) * t;

  return [lat, lng];
};

/**
 * Calculate bearing (heading) between two points
 * @param {Array} point1 - [latitude, longitude]
 * @param {Array} point2 - [latitude, longitude]
 * @returns {number} Bearing in degrees (0-360)
 */
export const calculateBearing = (point1, point2) => {
  const [lat1, lng1] = point1;
  const [lat2, lng2] = point2;

  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const lngDiff = ((lng2 - lng1) * Math.PI) / 180;

  const y = Math.sin(lngDiff) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lngDiff);

  let bearing = Math.atan2(y, x);
  bearing = ((bearing * 180) / Math.PI + 360) % 360;

  return bearing;
};

/**
 * Check if point is near a polygon (within threshold distance)
 * Useful for detecting approaching restricted zones
 * @param {Array} point - [latitude, longitude]
 * @param {Array} polygon - Array of [latitude, longitude] coordinates
 * @param {number} threshold - Distance in kilometers
 * @returns {boolean} true if point is within threshold of polygon
 */
export const isNearPolygon = (point, polygon, threshold = 0.5) => {
  for (let i = 0; i < polygon.length; i++) {
    const dist = calculateDistance(point, polygon[i]);
    if (dist < threshold) {
      return true;
    }
  }
  return false;
};

/**
 * Validate if coordinates are within valid lat/lng bounds
 * @param {Array} coord - [latitude, longitude]
 * @returns {boolean} true if coordinates are valid
 */
export const isValidCoordinate = (coord) => {
  if (!Array.isArray(coord) || coord.length !== 2) return false;
  const [lat, lng] = coord;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

/**
 * Convert coordinates array format (lat,lng) to (lng,lat) for Leaflet
 * @param {Array} coords - Array of [latitude, longitude] points
 * @returns {Array} Array of [longitude, latitude] points
 */
export const coordsToLeafletFormat = (coords) => {
  return coords.map(([lat, lng]) => [lng, lat]);
};

/**
 * Convert Leaflet coordinates (lng,lat) to standard format (lat,lng)
 * @param {Array} coords - Array of [longitude, latitude] points
 * @returns {Array} Array of [latitude, longitude] points
 */
export const coordsFromLeafletFormat = (coords) => {
  return coords.map(([lng, lat]) => [lat, lng]);
};
