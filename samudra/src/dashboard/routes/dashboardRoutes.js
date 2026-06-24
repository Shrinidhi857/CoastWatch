/**
 * Dashboard Routes — Boats, Geofences, Alerts, System, Depth
 * Wraps all Flask API endpoints consumed by the dashboard/map view.
 * Extracted from services/apiService.js for the dashboard feature module.
 */

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5000/api";

const apiHeaders = { "Content-Type": "application/json" };

// =============================================
// BOAT OPERATIONS
// =============================================

export const boatsAPI = {
  /** Get all boats */
  getAll: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch boats");
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("[DashRoutes] Error fetching boats:", error);
      throw error;
    }
  },

  /** Get specific boat */
  getById: async (boatId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch boat");
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error(`[DashRoutes] Error fetching boat ${boatId}:`, error);
      throw error;
    }
  },

  /** Create new boat */
  create: async (boatData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(boatData),
      });
      if (!response.ok) throw new Error("Failed to create boat");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error creating boat:", error);
      throw error;
    }
  },

  /** Update boat */
  update: async (boatId, boatData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}`, {
        method: "PUT",
        headers: apiHeaders,
        body: JSON.stringify(boatData),
      });
      if (!response.ok) throw new Error("Failed to update boat");
      return await response.json();
    } catch (error) {
      console.error(`[DashRoutes] Error updating boat ${boatId}:`, error);
      throw error;
    }
  },

  /** Update boat location only */
  updateLocation: async (boatId, location) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}/location`, {
        method: "PUT",
        headers: apiHeaders,
        body: JSON.stringify(location),
      });
      if (!response.ok) throw new Error("Failed to update boat location");
      return await response.json();
    } catch (error) {
      console.error(`[DashRoutes] Error updating boat location ${boatId}:`, error);
      throw error;
    }
  },

  /** Delete boat */
  delete: async (boatId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}`, {
        method: "DELETE",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to delete boat");
      return await response.json();
    } catch (error) {
      console.error(`[DashRoutes] Error deleting boat ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Get today's GPS path for a boat.
   * @param {string} boatId
   * @param {string} [date]  YYYY-MM-DD, defaults to today
   * @returns {{ boat_id, date, count, path: {lat,lng,timestamp,speed_kmh}[] }}
   */
  getPath: async (boatId, date) => {
    try {
      const dateParam = date || new Date().toISOString().slice(0, 10);
      const response = await fetch(
        `${API_BASE_URL}/boats/${boatId}/path?date=${dateParam}`,
        { method: "GET", headers: apiHeaders }
      );
      if (!response.ok) throw new Error("Failed to fetch boat path");
      return await response.json();
    } catch (error) {
      console.error(`[DashRoutes] Error fetching path for boat ${boatId}:`, error);
      throw error;
    }
  },

  /** Get all intrusion logs */
  getIntrusions: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/intrusions`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch intrusions");
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("[DashRoutes] Error fetching intrusions:", error);
      throw error;
    }
  },

  /** Log a new intrusion */
  logIntrusion: async (intrusionData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/intrusions`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(intrusionData),
      });
      if (!response.ok) throw new Error("Failed to log intrusion");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error logging intrusion:", error);
      throw error;
    }
  },

  /** Clear all intrusions */
  clearIntrusions: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/intrusions`, {
        method: "DELETE",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to clear intrusions");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error clearing intrusions:", error);
      throw error;
    }
  },
};

// =============================================
// GEOFENCE OPERATIONS
// =============================================

export const geofencesAPI = {
  /** Get all geofences */
  getAll: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch geofences");
      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("[DashRoutes] Error fetching geofences:", error);
      throw error;
    }
  },

  /** Get specific geofence */
  getById: async (geofenceId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/${geofenceId}`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch geofence");
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error(`[DashRoutes] Error fetching geofence ${geofenceId}:`, error);
      throw error;
    }
  },

  /** Create geofence */
  create: async (geofenceData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(geofenceData),
      });
      if (!response.ok) {
        let errMsg = "Failed to create geofence";
        try {
          const errData = await response.json();
          if (errData && errData.message) errMsg = errData.message;
        } catch (_) {}
        throw new Error(errMsg);
      }
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error creating geofence:", error);
      throw error;
    }
  },

  /** Create multiple geofences */
  createMultiple: async (geofences) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/batch/create`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ geofences }),
      });
      if (!response.ok) throw new Error("Failed to create geofences");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error creating multiple geofences:", error);
      throw error;
    }
  },

  /** Update geofence */
  update: async (geofenceId, geofenceData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/${geofenceId}`, {
        method: "PUT",
        headers: apiHeaders,
        body: JSON.stringify(geofenceData),
      });
      if (!response.ok) throw new Error("Failed to update geofence");
      return await response.json();
    } catch (error) {
      console.error(`[DashRoutes] Error updating geofence ${geofenceId}:`, error);
      throw error;
    }
  },

  /** Update geofence coordinates only */
  updateCoordinates: async (geofenceId, coordinates) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/geofences/${geofenceId}/coordinates`,
        {
          method: "PUT",
          headers: apiHeaders,
          body: JSON.stringify({ coordinates }),
        }
      );
      if (!response.ok) throw new Error("Failed to update geofence coordinates");
      return await response.json();
    } catch (error) {
      console.error(
        `[DashRoutes] Error updating geofence coordinates ${geofenceId}:`,
        error
      );
      throw error;
    }
  },

  /** Delete geofence */
  delete: async (geofenceId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/${geofenceId}`, {
        method: "DELETE",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to delete geofence");
      return await response.json();
    } catch (error) {
      console.error(`[DashRoutes] Error deleting geofence ${geofenceId}:`, error);
      throw error;
    }
  },
};

// =============================================
// ALERTS
// =============================================

export const alertsAPI = {
  /** Get all alerts */
  getAll: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch alerts");
      const data = await response.json();
      return data.alerts || [];
    } catch (error) {
      console.error("[DashRoutes] Error fetching alerts:", error);
      throw error;
    }
  },

  /** Get alerts for specific boat */
  getByBoatId: async (boatId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts/${boatId}`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch boat alerts");
      const data = await response.json();
      return data.alerts || [];
    } catch (error) {
      console.error(`[DashRoutes] Error fetching alerts for boat ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Get enriched intrusion log (active + historical).
   * Each record: { entry_time, exit_time, est_duration_min,
   *               actual_duration_sec, classification, is_active, ... }
   */
  getIntrusionLog: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts/intrusion-log`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch intrusion log");
      const data = await response.json();
      return data.log || [];
    } catch (error) {
      console.error("[DashRoutes] Error fetching intrusion log:", error);
      return [];
    }
  },

  /**
   * Record a boat entering a restricted zone.
   * @param {{ boat_id, boat_name, lat, lng, geofence_id, geofence_name, speed_kmh }} data
   */
  recordZoneEntry: async (data) => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts/zone-entry`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to record zone entry");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error recording zone entry:", error);
    }
  },

  /**
   * Record a boat exiting a restricted zone.
   * @param {{ boat_id, expected_speed_kmh? }} data
   */
  recordZoneExit: async (data) => {
    try {
      const response = await fetch(`${API_BASE_URL}/alerts/zone-exit`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to record zone exit");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Error recording zone exit:", error);
    }
  },
};

// =============================================
// SYSTEM INFO
// =============================================

export const systemAPI = {
  /** Health check */
  health: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Server is not healthy");
      return await response.json();
    } catch (error) {
      console.error("[DashRoutes] Health check failed:", error);
      throw error;
    }
  },

  /** Get system statistics */
  getStats: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/stats`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch stats");
      const data = await response.json();
      return data.statistics || {};
    } catch (error) {
      console.error("[DashRoutes] Error fetching stats:", error);
      throw error;
    }
  },
};

// =============================================
// DEPTH HEATMAP OPERATIONS
// =============================================

export const depthAPI = {
  getHeatmapData: async (minLat, maxLat, minLng, maxLng) => {
    try {
      let url = `${API_BASE_URL}/depth-heatmap`;
      if (
        minLat !== undefined &&
        maxLat !== undefined &&
        minLng !== undefined &&
        maxLng !== undefined
      ) {
        url += `?min_lat=${minLat}&max_lat=${maxLat}&min_lng=${minLng}&max_lng=${maxLng}`;
      }
      const response = await fetch(url, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to fetch depth heatmap data");
      const data = await response.json();
      return data.points || [];
    } catch (error) {
      console.error("[DashRoutes] Error fetching depth heatmap data:", error);
      throw error;
    }
  },
};

export default {
  boats: boatsAPI,
  geofences: geofencesAPI,
  alerts: alertsAPI,
  system: systemAPI,
  depth: depthAPI,
};
