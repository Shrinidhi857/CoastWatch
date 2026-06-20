import math
from datetime import datetime
from flask import Blueprint, request, jsonify
from firebase_init import db_firestore, get_rtdb_ref

system_bp = Blueprint('system', __name__, url_prefix='/api')

@system_bp.route('/health', methods=['GET'])
def health():
    rtdb_ok = False
    try:
        get_rtdb_ref('boats_live').get()
        rtdb_ok = True
    except Exception:
        pass

    return jsonify({
        'status': 'healthy',
        'service': 'Samudra Boat Tracking Server',
        'timestamp': datetime.now().isoformat(),
        'firestore_connected': db_firestore is not None,
        'realtime_db_connected': rtdb_ok,
    }), 200


@system_bp.route('/stats', methods=['GET'])
def get_stats():
    try:
        boats_data = get_rtdb_ref('boats_live').get() or {}
        total_boats = len(boats_data)
        boats_with_fix = sum(
            1 for b in boats_data.values()
            if isinstance(b, dict) and b.get('gps', {}).get('fix', False)
        )

        geofences = list(db_firestore.collection('geofences').stream()) if db_firestore else []

        return jsonify({
            'status': 'success',
            'statistics': {
                'total_boats': total_boats,
                'boats_with_gps_fix': boats_with_fix,
                'boats_without_fix': total_boats - boats_with_fix,
                'total_geofences': len(geofences),
                'timestamp': datetime.now().isoformat()
            }
        }), 200
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@system_bp.route('/depth-heatmap', methods=['GET'])
def get_depth_heatmap():
    """
    Returns mock seafloor depth data within a bounding box.
    Format: [latitude, longitude, intensity]
    Intensity is normalised 0.0-1.0 per viewport so the full gradient is
    always visible regardless of which area of the world is shown.
    """
    # Get optional bounding box from query parameters
    try:
        min_lat = request.args.get('min_lat', type=float)
        max_lat = request.args.get('max_lat', type=float)
        min_lng = request.args.get('min_lng', type=float)
        max_lng = request.args.get('max_lng', type=float)
    except (ValueError, TypeError):
        min_lat = max_lat = min_lng = max_lng = None

    # Fall back to Udupi coast area if no bounds provided
    if None in (min_lat, max_lat, min_lng, max_lng):
        min_lat, max_lat = 13.3, 13.9
        min_lng, max_lng = 74.2, 74.65

    def raw_depth(lat, lng):
        """
        Un-normalised depth value using a realistic, smooth continental shelf model.
        - Shallow shelf near the west coast of India.
        - Steep drop-off (shelf break) moving westward.
        - Deep ocean basin further west.
        - Low-frequency terrain waves scaled to base_depth to prevent clamping to 5.0.
        """
        # Approximate coastline longitude for the Indian west coast
        coast_line = 74.8 - (lat - 13.0) * 0.22

        if lng >= coast_line:
            # Landward: very shallow
            return 0.0

        dist = coast_line - lng  # Distance westward into the sea (in degrees)

        # Continental shelf profile:
        # 1. Shallow shelf (0 to 0.8 degrees out)
        # 2. Shelf break / slope (0.8 to 1.8 degrees out)
        # 3. Deep ocean basin (1.8+ degrees out)
        if dist < 0.8:
            base_depth = 10.0 + dist * 50.0  # 10m to 50m
        elif dist < 1.8:
            # Steep slope down to the deep plain
            t = (dist - 0.8) / 1.0
            base_depth = 50.0 + (t * t) * 2000.0  # drops down to ~2050m
        else:
            # Deep sea basin
            base_depth = 2050.0 + (dist - 1.8) * 150.0

        terrain_mult = 0.15 * math.sin(lat * 0.5) * math.cos(lng * 0.5) + \
                       0.10 * math.cos(lat * 1.2 + lng * 0.8)

        total_depth = base_depth * (1.0 + terrain_mult)
        return max(5.0, total_depth)

    # Build 45x45 grid for higher resolution
    grid_size = 45
    lat_range = max_lat - min_lat
    lng_range = max_lng - min_lng

    # Step sizes for calculating jitter bounds
    lat_step = lat_range / (grid_size - 1) if grid_size > 1 else 0.0
    lng_step = lng_range / (grid_size - 1) if grid_size > 1 else 0.0

    raw_points = []
    for i in range(grid_size):
        for j in range(grid_size):
            # Calculate standard grid position
            lat = min_lat + (i / (grid_size - 1)) * lat_range
            lng = min_lng + (j / (grid_size - 1)) * lng_range

            # Apply pseudo-random deterministic jitter to break the egg carton pattern
            # Uses sin/cos hashes so it remains 100% deterministic per coordinate
            jitter_lat = math.sin(i * 12.9898 + j * 78.233) * 0.45 * lat_step
            jitter_lng = math.cos(i * 4.1414 + j * 37.719) * 0.45 * lng_step

            lat_j = lat + jitter_lat
            lng_j = lng + jitter_lng

            # Coastline boundary check (only include water points)
            coast_line = 74.8 - (lat_j - 13.0) * 0.22
            if lng_j < coast_line:
                depth_val = raw_depth(lat_j, lng_j)
                raw_points.append((lat_j, lng_j, depth_val))

    # If the entire viewport is land, return empty points list
    if not raw_points:
        return jsonify({
            'status': 'success',
            'points': [],
            'count': 0
        }), 200

    # Normalise to 0.0-1.0 so the full gradient is always rendered over the sea area
    raw_vals = [r[2] for r in raw_points]
    v_min = min(raw_vals)
    v_max = max(raw_vals)
    v_range = v_max - v_min if v_max != v_min else 1.0

    points = [
        [lat, lng, (v - v_min) / v_range]
        for lat, lng, v in raw_points
    ]

    return jsonify({
        'status': 'success',
        'points': points,
        'count': len(points)
    }), 200
