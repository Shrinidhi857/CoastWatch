from flask import Blueprint, jsonify
from shapely.geometry import Point
from firebase_init import get_rtdb_ref
from routes.geofence_check import _get_all_active_geofence_polygons

alerts_bp = Blueprint('alerts', __name__, url_prefix='/api/alerts')

@alerts_bp.route('', methods=['GET'])
def get_alerts():
    """
    Returns boats that are currently in a restricted zone.
    Runs a live geofence check against all boats in Realtime DB.
    """
    try:
        boats_data = get_rtdb_ref('boats_live').get() or {}
        geofences = _get_all_active_geofence_polygons()
        alerts = []

        for boat_id, boat_raw in boats_data.items():
            if not isinstance(boat_raw, dict):
                continue

            gps = boat_raw.get('gps', {})
            lat = float(gps.get('latitude', 0))
            lng = float(gps.get('longitude', 0))

            # Skip boats with no GPS fix
            if not gps.get('fix', False):
                continue

            boat_point = Point(lng, lat)
            in_violation = any(
                gf['type'] == 'restricted' and gf['polygon'].contains(boat_point)
                for gf in geofences.values()
            )

            if in_violation:
                meta = boat_raw.get('boat_metadata', {})
                alerts.append({
                    'boat_id': boat_id,
                    'boat_name': meta.get('boat_name', boat_id),
                    'location': {'latitude': lat, 'longitude': lng},
                    'status': 'Active',
                    'speed': gps.get('speed_kmh', 0),
                    'updated_at': boat_raw.get('timestamp', ''),
                    'severity': 'high'
                })

        return jsonify({'status': 'success', 'alerts': alerts, 'alert_count': len(alerts)}), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@alerts_bp.route('/<boat_id>', methods=['GET'])
def get_boat_alerts(boat_id):
    try:
        ref = get_rtdb_ref(f'boats_live/{boat_id}')
        boat_raw = ref.get()

        if not boat_raw:
            return jsonify({'status': 'error', 'message': f'Boat {boat_id} not found'}), 404

        gps = boat_raw.get('gps', {})
        lat = float(gps.get('latitude', 0))
        lng = float(gps.get('longitude', 0))
        boat_point = Point(lng, lat)

        geofences = _get_all_active_geofence_polygons()
        violations = [
            {
                'geofence_id': gf_id,
                'geofence_name': gf['name'],
                'alert_type': 'GEOFENCE_VIOLATION'
            }
            for gf_id, gf in geofences.items()
            if gf['type'] == 'restricted' and gf['polygon'].contains(boat_point)
        ]

        boat_name = boat_raw.get('boat_metadata', {}).get('boat_name', boat_id)
        return jsonify({
            'status': 'success',
            'boat_id': boat_id,
            'boat_name': boat_name,
            'has_alerts': len(violations) > 0,
            'alerts': violations,
            'alert_count': len(violations)
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
