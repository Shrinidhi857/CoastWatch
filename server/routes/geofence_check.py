from flask import Blueprint, request, jsonify
from shapely.geometry import Point, Polygon
from firebase_init import db_firestore, get_rtdb_ref, coords_to_shapely

geofence_check_bp = Blueprint('geofence_check', __name__, url_prefix='/api/geofence-check')

def _get_all_active_geofence_polygons():
    """Load all active geofences from Firestore as Shapely Polygons."""
    geofences = {}
    if db_firestore:
        for doc in db_firestore.collection('geofences').stream():
            gf = doc.to_dict()
            if not gf.get('is_active', True):
                continue
            coords = coords_to_shapely(gf.get('coordinates', []))
            if len(coords) >= 3:
                geofences[doc.id] = {
                    'polygon': Polygon(coords),
                    'name': gf.get('name'),
                    'type': gf.get('type')
                }
    return geofences


@geofence_check_bp.route('/boat/<boat_id>', methods=['GET'])
def check_boat_in_geofence(boat_id):
    try:
        ref = get_rtdb_ref(f'boats_live/{boat_id}')
        boat_data = ref.get()

        if not boat_data:
            return jsonify({'status': 'error', 'message': f'Boat {boat_id} not found'}), 404

        gps = boat_data.get('gps', {})
        lat = float(gps.get('latitude', 0))
        lng = float(gps.get('longitude', 0))
        boat_point = Point(lng, lat)

        geofences = _get_all_active_geofence_polygons()
        violations, safe_zones = [], []

        for gf_id, gf_info in geofences.items():
            if gf_info['polygon'].contains(boat_point):
                entry = {'geofence_id': gf_id, 'name': gf_info['name'], 'type': gf_info['type']}
                if gf_info['type'] == 'restricted':
                    violations.append(entry)
                elif gf_info['type'] == 'safe_zone':
                    safe_zones.append(entry)

        return jsonify({
            'status': 'success',
            'boat_id': boat_id,
            'boat_name': boat_data.get('boat_metadata', {}).get('boat_name', boat_id),
            'location': {'latitude': lat, 'longitude': lng},
            'in_restricted_zone': len(violations) > 0,
            'violations': violations,
            'safe_zones': safe_zones,
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofence_check_bp.route('/all-boats', methods=['GET'])
def check_all_boats_geofence():
    try:
        boats_data = get_rtdb_ref('boats_live').get() or {}
        geofences = _get_all_active_geofence_polygons()

        results, violations_summary = [], []

        for boat_id, boat_raw in boats_data.items():
            if not isinstance(boat_raw, dict):
                continue

            gps = boat_raw.get('gps', {})
            lat = float(gps.get('latitude', 0))
            lng = float(gps.get('longitude', 0))
            boat_point = Point(lng, lat)

            violations, safe_zones = [], []
            for gf_id, gf_info in geofences.items():
                if gf_info['polygon'].contains(boat_point):
                    entry = {'geofence_id': gf_id, 'name': gf_info['name'], 'type': gf_info['type']}
                    if gf_info['type'] == 'restricted':
                        violations.append(entry)
                    elif gf_info['type'] == 'safe_zone':
                        safe_zones.append(entry)

            in_violation = len(violations) > 0
            boat_name = boat_raw.get('boat_metadata', {}).get('boat_name', boat_id)

            results.append({
                'boat_id': boat_id,
                'boat_name': boat_name,
                'location': {'latitude': lat, 'longitude': lng},
                'status': 'Active',
                'in_restricted_zone': in_violation,
                'violations': violations,
                'safe_zones': safe_zones
            })

            if in_violation:
                violations_summary.append({
                    'boat_id': boat_id,
                    'boat_name': boat_name,
                    'violation_count': len(violations),
                    'geofences': violations
                })

        return jsonify({
            'status': 'success',
            'total_boats': len(results),
            'boats_in_violation': len(violations_summary),
            'results': results,
            'violations_summary': violations_summary
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofence_check_bp.route('/location', methods=['POST'])
def check_location_in_geofence():
    try:
        data = request.get_json()
        if 'latitude' not in data or 'longitude' not in data:
            return jsonify({'status': 'error', 'message': 'Missing latitude or longitude'}), 400

        check_point = Point(float(data['longitude']), float(data['latitude']))
        violations, safe_zones, monitoring_zones = [], [], []

        if db_firestore:
            for doc in db_firestore.collection('geofences').stream():
                gf = doc.to_dict()
                if not gf.get('is_active', True):
                    continue
                coords = coords_to_shapely(gf.get('coordinates', []))
                if len(coords) >= 3:
                    polygon = Polygon(coords)
                    if polygon.contains(check_point):
                        entry = {
                            'geofence_id': doc.id,
                            'name': gf.get('name'),
                            'type': gf.get('type'),
                            'description': gf.get('description')
                        }
                        if gf['type'] == 'restricted':
                            violations.append(entry)
                        elif gf['type'] == 'safe_zone':
                            safe_zones.append(entry)
                        elif gf['type'] == 'monitoring':
                            monitoring_zones.append(entry)

        return jsonify({
            'status': 'success',
            'location': {'latitude': float(data['latitude']), 'longitude': float(data['longitude'])},
            'in_restricted_zone': len(violations) > 0,
            'violations': violations,
            'safe_zones': safe_zones,
            'monitoring_zones': monitoring_zones,
            'total_zones': len(violations) + len(safe_zones) + len(monitoring_zones)
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
