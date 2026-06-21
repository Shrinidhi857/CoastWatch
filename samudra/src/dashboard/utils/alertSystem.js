/**
 * Alert System
 * Manages simulation alerts and notifications
 */

/**
 * Create a new alert object
 * @param {string} type - Alert type ('warning', 'danger', 'info', 'success')
 * @param {string} message - Alert message
 * @param {string} source - Source of alert (e.g., 'boat_sim', 'geofence')
 * @returns {Object} Alert object with metadata
 */
export const createAlert = (type, message, source = "simulation") => {
  return {
    id: `${source}-${Date.now()}-${Math.random()}`,
    type: type,
    message: message,
    source: source,
    timestamp: new Date(),
    read: false,
  };
};

/**
 * Alert manager class for handling multiple alerts
 */
export class AlertManager {
  constructor() {
    this.alerts = [];
    this.maxAlerts = 10; // Maximum number of alerts to keep
    this.triggerCallbacks = [];
  }

  /**
   * Add a new alert
   * @param {Object} alert - Alert object
   */
  addAlert(alert) {
    this.alerts.unshift(alert);

    // Keep only recent alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }

    // Trigger callbacks
    this.triggerCallbacks.forEach((cb) => cb(this.alerts));
  }

  /**
   * Remove alert by ID
   * @param {string} alertId - Alert ID to remove
   */
  removeAlert(alertId) {
    this.alerts = this.alerts.filter((alert) => alert.id !== alertId);
    this.triggerCallbacks.forEach((cb) => cb(this.alerts));
  }

  /**
   * Clear all alerts
   */
  clearAlerts() {
    this.alerts = [];
    this.triggerCallbacks.forEach((cb) => cb(this.alerts));
  }

  /**
   * Mark alert as read
   * @param {string} alertId - Alert ID
   */
  markAsRead(alertId) {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.read = true;
      this.triggerCallbacks.forEach((cb) => cb(this.alerts));
    }
  }

  /**
   * Subscribe to alert changes
   * @param {Function} callback - Callback function
   */
  onAlertsChange(callback) {
    this.triggerCallbacks.push(callback);
  }

  /**
   * Get all alerts
   * @returns {Array} Array of alerts
   */
  getAlerts() {
    return [...this.alerts];
  }

  /**
   * Get unread alert count
   * @returns {number} Number of unread alerts
   */
  getUnreadCount() {
    return this.alerts.filter((a) => !a.read).length;
  }
}

/**
 * Predefined alert messages
 */
export const ALERT_MESSAGES = {
  BOAT_ENTERED_RESTRICTED: "⚠️ Alert: Boat has entered restricted zone!",
  BOAT_LEFT_RESTRICTED: "✓ Boat has exited restricted zone.",
  BOAT_APPROACHING_RESTRICTED:
    "⚠️ Warning: Boat is approaching restricted zone!",
  SIMULATION_STARTED: "▶ Simulation started successfully.",
  SIMULATION_STOPPED: "⏹ Simulation stopped.",
  SIMULATION_COMPLETED: "✓ Simulation path completed.",
  SIMULATION_RESET: "↻ Simulation reset.",
  PATH_GENERATED: "✓ New simulation path generated.",
};

/**
 * Alert types
 */
export const ALERT_TYPES = {
  DANGER: "danger",
  WARNING: "warning",
  INFO: "info",
  SUCCESS: "success",
};

/**
 * Factory function to create themed alerts
 */
export const alertFactory = {
  danger: (message, source) => createAlert(ALERT_TYPES.DANGER, message, source),
  warning: (message, source) =>
    createAlert(ALERT_TYPES.WARNING, message, source),
  info: (message, source) => createAlert(ALERT_TYPES.INFO, message, source),
  success: (message, source) =>
    createAlert(ALERT_TYPES.SUCCESS, message, source),
};

/**
 * Format alert for display
 * @param {Object} alert - Alert object
 * @returns {Object} Formatted alert with styling
 */
export const formatAlertForDisplay = (alert) => {
  const typeStyles = {
    danger: {
      bgColor: "bg-red-100",
      borderColor: "border-red-500",
      textColor: "text-red-700",
      iconBg: "bg-red-500",
    },
    warning: {
      bgColor: "bg-amber-100",
      borderColor: "border-amber-500",
      textColor: "text-amber-700",
      iconBg: "bg-amber-500",
    },
    info: {
      bgColor: "bg-blue-100",
      borderColor: "border-blue-500",
      textColor: "text-blue-700",
      iconBg: "bg-blue-500",
    },
    success: {
      bgColor: "bg-green-100",
      borderColor: "border-green-500",
      textColor: "text-green-700",
      iconBg: "bg-green-500",
    },
  };

  const styles = typeStyles[alert.type] || typeStyles.info;

  return {
    ...alert,
    ...styles,
    timestamp: alert.timestamp.toLocaleTimeString(),
  };
};

/**
 * Debounce function to prevent alert spam
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function to limit event firing frequency
 * @param {Function} func - Function to throttle
 * @param {number} limit - Limit time in milliseconds
 * @returns {Function} Throttled function
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};
