/**
 * API Service for Samudra Boat Tracking
 * Communicates with Flask server
 */

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5000/api";

const apiHeaders = {
  "Content-Type": "application/json",
};

// =============================================
// BOAT OPERATIONS
// =============================================

export const boatsAPI = {
  /**
   * Get all boats
   */
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
      console.error("Error fetching boats:", error);
      throw error;
    }
  },

  /**
   * Get specific boat
   */
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
      console.error(`Error fetching boat ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Create new boat
   */
  create: async (boatData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(boatData),
      });
      if (!response.ok) throw new Error("Failed to create boat");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error creating boat:", error);
      throw error;
    }
  },

  /**
   * Update boat
   */
  update: async (boatId, boatData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}`, {
        method: "PUT",
        headers: apiHeaders,
        body: JSON.stringify(boatData),
      });
      if (!response.ok) throw new Error("Failed to update boat");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error updating boat ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Update boat location only
   */
  updateLocation: async (boatId, location) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}/location`, {
        method: "PUT",
        headers: apiHeaders,
        body: JSON.stringify(location),
      });
      if (!response.ok) throw new Error("Failed to update boat location");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error updating boat location ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Delete boat
   */
  delete: async (boatId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/boats/${boatId}`, {
        method: "DELETE",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to delete boat");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error deleting boat ${boatId}:`, error);
      throw error;
    }
  },
};

// =============================================
// GEOFENCE OPERATIONS
// =============================================

export const geofencesAPI = {
  /**
   * Get all geofences
   */
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
      console.error("Error fetching geofences:", error);
      throw error;
    }
  },

  /**
   * Get specific geofence
   */
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
      console.error(`Error fetching geofence ${geofenceId}:`, error);
      throw error;
    }
  },

  /**
   * Create geofence
   */
  create: async (geofenceData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify(geofenceData),
      });
      if (!response.ok) {
        // Try to extract the server's error message for better debugging
        let errMsg = "Failed to create geofence";
        try {
          const errData = await response.json();
          if (errData && errData.message) errMsg = errData.message;
        } catch (_) {}
        throw new Error(errMsg);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error creating geofence:", error);
      throw error;
    }
  },

  /**
   * Create multiple geofences
   */
  createMultiple: async (geofences) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/batch/create`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ geofences }),
      });
      if (!response.ok) throw new Error("Failed to create geofences");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error creating multiple geofences:", error);
      throw error;
    }
  },

  /**
   * Update geofence
   */
  update: async (geofenceId, geofenceData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/${geofenceId}`, {
        method: "PUT",
        headers: apiHeaders,
        body: JSON.stringify(geofenceData),
      });
      if (!response.ok) throw new Error("Failed to update geofence");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error updating geofence ${geofenceId}:`, error);
      throw error;
    }
  },

  /**
   * Update geofence coordinates only
   */
  updateCoordinates: async (geofenceId, coordinates) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/geofences/${geofenceId}/coordinates`,
        {
          method: "PUT",
          headers: apiHeaders,
          body: JSON.stringify({ coordinates }),
        },
      );
      if (!response.ok)
        throw new Error("Failed to update geofence coordinates");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(
        `Error updating geofence coordinates ${geofenceId}:`,
        error,
      );
      throw error;
    }
  },

  /**
   * Delete geofence
   */
  delete: async (geofenceId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofences/${geofenceId}`, {
        method: "DELETE",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to delete geofence");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error deleting geofence ${geofenceId}:`, error);
      throw error;
    }
  },
};

// =============================================
// GEOFENCE CHECKING
// =============================================

export const geofenceCheckAPI = {
  /**
   * Check single boat against geofences
   */
  checkBoat: async (boatId) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/geofence-check/boat/${boatId}`,
        {
          method: "GET",
          headers: apiHeaders,
        },
      );
      if (!response.ok) throw new Error("Failed to check boat");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error checking boat ${boatId}:`, error);
      throw error;
    }
  },

  /**
   * Check all boats against geofences
   */
  checkAllBoats: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofence-check/all-boats`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Failed to check boats");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error checking all boats:", error);
      throw error;
    }
  },

  /**
   * Check specific location
   */
  checkLocation: async (latitude, longitude) => {
    try {
      const response = await fetch(`${API_BASE_URL}/geofence-check/location`, {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({ latitude, longitude }),
      });
      if (!response.ok) throw new Error("Failed to check location");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error checking location:", error);
      throw error;
    }
  },
};

// =============================================
// ALERTS
// =============================================

export const alertsAPI = {
  /**
   * Get all alerts
   */
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
      console.error("Error fetching alerts:", error);
      throw error;
    }
  },

  /**
   * Get alerts for specific boat
   */
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
      console.error(`Error fetching alerts for boat ${boatId}:`, error);
      throw error;
    }
  },
};

// =============================================
// SYSTEM INFO
// =============================================

export const systemAPI = {
  /**
   * Health check
   */
  health: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: "GET",
        headers: apiHeaders,
      });
      if (!response.ok) throw new Error("Server is not healthy");
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Health check failed:", error);
      throw error;
    }
  },

  /**
   * Get system statistics
   */
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
      console.error("Error fetching stats:", error);
      throw error;
    }
  },
};

export default {
  boats: boatsAPI,
  geofences: geofencesAPI,
  geofenceCheck: geofenceCheckAPI,
  alerts: alertsAPI,
  system: systemAPI,
};
