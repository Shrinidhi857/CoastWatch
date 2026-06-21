/**
 * Simulation Routes — Geofence Check API
 * Wraps the backend /api/geofence-check/* endpoints used during simulation.
 * Extracted from services/apiService.js for the simulation feature module.
 */

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5000/api";

const apiHeaders = { "Content-Type": "application/json" };

/**
 * Simulation-scoped geofence checking routes.
 * Mirrors the Flask blueprint registered at /api/geofence-check.
 */
export const geofenceCheckAPI = {
  /**
   * Check a single live boat against all active Firestore geofences.
   * Calls GET /api/geofence-check/boat/<boatId>
   * @param {string} boatId
   */
  checkBoat: async (boatId) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/geofence-check/boat/${boatId}`,
        { method: "GET", headers: apiHeaders }
      );
      if (!response.ok) throw new Error("Failed to check boat");
      return await response.json();
    } catch (error) {
      console.error(`[SimRoutes] Error checking boat ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Check all live boats against all active Firestore geofences.
   * Calls GET /api/geofence-check/all-boats
   */
  checkAllBoats: async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/geofence-check/all-boats`,
        { method: "GET", headers: apiHeaders }
      );
      if (!response.ok) throw new Error("Failed to check all boats");
      return await response.json();
    } catch (error) {
      console.error("[SimRoutes] Error checking all boats:", error);
      throw error;
    }
  },

  /**
   * Check an arbitrary lat/lng against all active Firestore geofences.
   * Calls POST /api/geofence-check/location
   * Used by the simulation loop on every position tick.
   * @param {number} latitude
   * @param {number} longitude
   */
  checkLocation: async (latitude, longitude) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/geofence-check/location`,
        {
          method: "POST",
          headers: apiHeaders,
          body: JSON.stringify({ latitude, longitude }),
        }
      );
      if (!response.ok) throw new Error("Failed to check location");
      const data = await response.json();
      return {
        inRestrictedZone: data.in_restricted_zone ?? false,
        violations: data.violations ?? [],
        safeZones: data.safe_zones ?? [],
        monitoringZones: data.monitoring_zones ?? [],
      };
    } catch (error) {
      console.error("[SimRoutes] Error checking location:", error);
      throw error;
    }
  },
};

export default geofenceCheckAPI;
