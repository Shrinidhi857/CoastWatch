import os
import json
import traceback
from datetime import datetime
from flask import Flask, request, jsonify, Blueprint
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, db as rtdb, firestore
from shapely.geometry import Point, Polygon
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# =============================================
# BLUEPRINT DEFINITIONS
# =============================================
boats_bp = Blueprint('boats', __name__, url_prefix='/api/boats')
geofences_bp = Blueprint('geofences', __name__, url_prefix='/api/geofences')
geofence_check_bp = Blueprint('geofence_check', __name__, url_prefix='/api/geofence-check')
alerts_bp = Blueprint('alerts', __name__, url_prefix='/api/alerts')
system_bp = Blueprint('system', __name__, url_prefix='/api')

# Initialize Firebase
db_firestore = None

try:
    if os.path.exists('firebase-credentials.json'):
        cred = credentials.Certificate('firebase-credentials.json')
    else:
        raw_private_key = os.getenv("FIREBASE_PRIVATE_KEY", "")
        private_key = raw_private_key.replace('\\n', '\n')
        client_id = os.getenv("FIREBASE_CLIENT_ID", "").lstrip('<').strip()

        firebase_config = {
            "type": "service_account",
            "project_id": os.getenv("FIREBASE_PROJECT_ID"),
            "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
            "private_key": private_key,
            "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
            "client_id": client_id,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": os.getenv("FIREBASE_CERT_URL")
        }

        print(f"[Firebase] project_id  = {firebase_config['project_id']}")
        print(f"[Firebase] client_email= {firebase_config['client_email']}")
        print(f"[Firebase] db_url      = {os.getenv('FIREBASE_DATABASE_URL')}")

        cred = credentials.Certificate(firebase_config)

    # IMPORTANT: databaseURL must be the full regional URL from your .env
    # e.g. https://samu-9fe19-default-rtdb.asia-southeast1.firebasedatabase.app
    firebase_admin.initialize_app(cred, {
        'databaseURL': os.getenv('FIREBASE_DATABASE_URL', ''),
        'storageBucket': os.getenv('FIREBASE_STORAGE_BUCKET', '')
    })

    db_firestore = firestore.client()
    print("[Firebase] Initialized successfully (Firestore + Realtime DB)")

except Exception as e:
    print(f"[Firebase] Initialization error: {e}")
    traceback.print_exc()
    db_firestore = None


# =============================================
# REALTIME DATABASE HELPERS
# =============================================

def get_rtdb_ref(path):
    """Return a Realtime Database reference. Works with regional URLs."""
    return rtdb.reference(path)


def rtdb_boat_to_api(boat_id, boat_data):
    """
    Convert a boats_live record from Realtime Database into the API shape
    that the React frontend expects (same shape as Firestore boats).

    Realtime DB schema:
      boat_metadata: { boat_id, boat_name, boat_type, owner }
      gps:           { fix, latitude, longitude, altitude, speed_kmh, satellites }
      imu:           { pitch, roll, temperature, accelerometer{x,y,z}, gyroscope{x,y,z} }
      timestamp:     ISO string
    """
    gps = boat_data.get('gps', {})
    meta = boat_data.get('boat_metadata', {})
    imu = boat_data.get('imu', {})

    lat = float(gps.get('latitude', 0))
    lng = float(gps.get('longitude', 0))
    gps_fix = bool(gps.get('fix', False))

    return {
        'id': boat_id,
        'name': meta.get('boat_name', boat_id),
        'latitude': lat,
        'longitude': lng,
        'gps_fix': gps_fix,                          # extra field — useful for UI warnings
        'satellites': int(gps.get('satellites', 0)),
        'altitude': float(gps.get('altitude', 0)),
        'speed': float(gps.get('speed_kmh', 0)),     # frontend uses 'speed'
        'heading': 0,                                 # not in GPS schema; default 0
        'status': 'Active',
        'vessel_type': meta.get('boat_type', 'Unknown'),
        'owner': meta.get('owner', ''),
        'crew_count': 0,
        'destination': '',
        'in_restricted_zone': False,
        # IMU telemetry — forwarded for details modal
        'imu': {
            'pitch': imu.get('pitch', 0),
            'roll': imu.get('roll', 0),
            'temperature': imu.get('temperature', 0),
            'accelerometer': imu.get('accelerometer', {}),
            'gyroscope': imu.get('gyroscope', {}),
        },
        'created_at': boat_data.get('timestamp', datetime.now().isoformat()),
        'updated_at': boat_data.get('timestamp', datetime.now().isoformat()),
    }


# =============================================
# COORDINATE CONVERSION HELPERS (Firestore)
# Firestore does NOT allow nested arrays ([[lng, lat], ...]).
# We store coordinates as objects [{"lng": x, "lat": y}] instead.
# =============================================

def coords_to_db(coordinates):
    result = []
    for c in coordinates:
        if isinstance(c, dict):
            result.append({"lng": float(c.get("lng", 0)), "lat": float(c.get("lat", 0))})
        else:
            result.append({"lng": float(c[0]), "lat": float(c[1])})
    return result


def coords_from_db(coordinates):
    result = []
    for c in coordinates:
        if isinstance(c, dict):
            result.append([c.get("lng", 0), c.get("lat", 0)])
        else:
            result.append([c[0], c[1]])
    return result


def coords_to_shapely(coordinates):
    result = []
    for c in coordinates:
        if isinstance(c, dict):
            result.append((float(c.get("lng", 0)), float(c.get("lat", 0))))
        else:
            result.append((float(c[0]), float(c[1])))
    return result


# =============================================
# BOAT ENDPOINTS  —  now reads Realtime Database
# =============================================

@boats_bp.route('', methods=['GET'])
def get_boats():
    """
    GET /api/boats
    Reads the boats_live node from Firebase Realtime Database.
    Returns ALL boats (including those without GPS fix) so the frontend
    can decide what to show. The 'gps_fix' field tells the UI whether
    coordinates are valid.
    """
    try:
        ref = get_rtdb_ref('boats_live')
        data = ref.get()

        if not data:
            return jsonify({'status': 'success', 'data': [], 'count': 0}), 200

        boats = []
        for boat_id, boat_data in data.items():
            if not isinstance(boat_data, dict):
                continue
            boat = rtdb_boat_to_api(boat_id, boat_data)
            boats.append(boat)

        return jsonify({
            'status': 'success',
            'data': boats,
            'count': len(boats)
        }), 200

    except Exception as e:
        print(f"[ERROR] get_boats (RTDB): {e}")
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': str(e)}), 500


@boats_bp.route('/<boat_id>', methods=['GET'])
def get_boat(boat_id):
    """GET /api/boats/<boat_id> — single boat from Realtime DB"""
    try:
        ref = get_rtdb_ref(f'boats_live/{boat_id}')
        boat_data = ref.get()

        if not boat_data:
            return jsonify({
                'status': 'error',
                'message': f'Boat {boat_id} not found'
            }), 404

        return jsonify({
            'status': 'success',
            'data': rtdb_boat_to_api(boat_id, boat_data)
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@boats_bp.route('/<boat_id>', methods=['DELETE'])
def delete_boat(boat_id):
    """DELETE /api/boats/<boat_id> — remove from Realtime DB"""
    try:
        ref = get_rtdb_ref(f'boats_live/{boat_id}')
        if ref.get() is None:
            return jsonify({'status': 'error', 'message': f'Boat {boat_id} not found'}), 404

        ref.delete()
        return jsonify({'status': 'success', 'message': 'Boat deleted successfully'}), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@boats_bp.route('/<boat_id>/location', methods=['PUT'])
def update_boat_location(boat_id):
    """PUT /api/boats/<boat_id>/location — update GPS coords in Realtime DB"""
    try:
        data = request.get_json()
        if 'latitude' not in data or 'longitude' not in data:
            return jsonify({'status': 'error', 'message': 'Missing latitude or longitude'}), 400

        ref = get_rtdb_ref(f'boats_live/{boat_id}')
        if ref.get() is None:
            return jsonify({'status': 'error', 'message': f'Boat {boat_id} not found'}), 404

        update_payload = {
            'gps/latitude': float(data['latitude']),
            'gps/longitude': float(data['longitude']),
            'timestamp': datetime.now().isoformat(),
        }
        if 'speed' in data:
            update_payload['gps/speed_kmh'] = float(data['speed'])

        ref.update(update_payload)

        return jsonify({
            'status': 'success',
            'message': 'Location updated successfully',
            'data': update_payload
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# =============================================
# GEOFENCING ENDPOINTS  —  unchanged (Firestore)
# =============================================

@geofences_bp.route('', methods=['GET'])
def get_geofences():
    try:
        if db_firestore is None:
            return jsonify({'status': 'error', 'message': 'Firestore not connected.'}), 503

        geofences_ref = db_firestore.collection('geofences')
        geofences = []

        for doc in geofences_ref.stream():
            geofence_data = doc.to_dict()
            geofence_data['id'] = doc.id
            if 'coordinates' in geofence_data:
                geofence_data['coordinates'] = coords_from_db(geofence_data['coordinates'])
            geofences.append(geofence_data)

        return jsonify({'status': 'success', 'data': geofences, 'count': len(geofences)}), 200

    except Exception as e:
        print(f"[ERROR] get_geofences: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofences_bp.route('/<geofence_id>', methods=['GET'])
def get_geofence(geofence_id):
    try:
        if db_firestore is None:
            return jsonify({'status': 'error', 'message': 'Firestore not connected.'}), 503

        geofence_ref = db_firestore.collection('geofences').document(geofence_id)
        geofence_doc = geofence_ref.get()

        if not geofence_doc.exists:
            return jsonify({'status': 'error', 'message': f'Geofence {geofence_id} not found'}), 404

        geofence_data = geofence_doc.to_dict()
        geofence_data['id'] = geofence_doc.id
        if 'coordinates' in geofence_data:
            geofence_data['coordinates'] = coords_from_db(geofence_data['coordinates'])

        return jsonify({'status': 'success', 'data': geofence_data}), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofences_bp.route('/batch/create', methods=['POST'])
def create_multiple_geofences():
    try:
        if db_firestore is None:
            return jsonify({'status': 'error', 'message': 'Firestore not connected.'}), 503

        data = request.get_json()
        if 'geofences' not in data or not isinstance(data['geofences'], list):
            return jsonify({'status': 'error', 'message': 'Missing or invalid geofences array'}), 400

        created, errors = [], []

        for idx, gf in enumerate(data['geofences']):
            try:
                if 'name' not in gf or 'coordinates' not in gf:
                    errors.append(f"Geofence {idx}: Missing name or coordinates")
                    continue
                coords = gf['coordinates']
                if not isinstance(coords, list) or len(coords) < 3:
                    errors.append(f"Geofence {idx}: Need at least 3 points")
                    continue

                gf_data = {
                    'name': gf['name'],
                    'description': gf.get('description', ''),
                    'coordinates': coords_to_db(coords),
                    'type': gf.get('type', 'restricted'),
                    'is_active': gf.get('is_active', True),
                    'created_at': datetime.now().isoformat(),
                    'updated_at': datetime.now().isoformat(),
                    'metadata': gf.get('metadata', {})
                }
                doc_ref = db_firestore.collection('geofences').add(gf_data)
                created.append({'geofence_id': doc_ref[1].id, 'name': gf_data['name']})
            except Exception as e:
                errors.append(f"Geofence {idx}: {str(e)}")

        return jsonify({
            'status': 'success',
            'message': f'Created {len(created)} geofences',
            'created': created,
            'errors': errors,
            'count': len(created)
        }), 201

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofences_bp.route('', methods=['POST'])
def create_geofence():
    try:
        if db_firestore is None:
            return jsonify({'status': 'error', 'message': 'Firestore not connected.'}), 503

        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body'}), 400

        for field in ['name', 'coordinates']:
            if field not in data:
                return jsonify({'status': 'error', 'message': f'Missing required field: {field}'}), 400

        coordinates = data['coordinates']
        if not isinstance(coordinates, list) or len(coordinates) < 3:
            return jsonify({'status': 'error', 'message': 'Need at least 3 coordinate points'}), 400

        gf_data = {
            'name': data['name'],
            'description': data.get('description', ''),
            'coordinates': coords_to_db(coordinates),
            'type': data.get('type', 'restricted'),
            'is_active': data.get('is_active', True),
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'metadata': data.get('metadata', {})
        }

        doc_ref = db_firestore.collection('geofences').add(gf_data)

        response_data = dict(gf_data)
        response_data['coordinates'] = coordinates  # return in frontend format
        return jsonify({
            'status': 'success',
            'message': 'Geofence created successfully',
            'geofence_id': doc_ref[1].id,
            'data': response_data
        }), 201

    except Exception as e:
        print(f"[ERROR] create_geofence: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofences_bp.route('/<geofence_id>', methods=['PUT'])
def update_geofence(geofence_id):
    try:
        data = request.get_json()
        geofence_ref = db_firestore.collection('geofences').document(geofence_id)

        if not geofence_ref.get().exists:
            return jsonify({'status': 'error', 'message': f'Geofence {geofence_id} not found'}), 404

        update_data = {}
        for field in ['name', 'description', 'type', 'is_active', 'metadata']:
            if field in data:
                update_data[field] = data[field]
        if 'coordinates' in data:
            coords = data['coordinates']
            if not isinstance(coords, list) or len(coords) < 3:
                return jsonify({'status': 'error', 'message': 'Need at least 3 points'}), 400
            update_data['coordinates'] = coords_to_db(coords)
        update_data['updated_at'] = datetime.now().isoformat()

        geofence_ref.update(update_data)
        return jsonify({'status': 'success', 'message': 'Geofence updated', 'data': update_data}), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofences_bp.route('/<geofence_id>', methods=['DELETE'])
def delete_geofence(geofence_id):
    try:
        geofence_ref = db_firestore.collection('geofences').document(geofence_id)
        if not geofence_ref.get().exists:
            return jsonify({'status': 'error', 'message': f'Geofence {geofence_id} not found'}), 404
        geofence_ref.delete()
        return jsonify({'status': 'success', 'message': 'Geofence deleted'}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofences_bp.route('/<geofence_id>/coordinates', methods=['PUT'])
def update_geofence_coordinates(geofence_id):
    try:
        data = request.get_json()
        if 'coordinates' not in data:
            return jsonify({'status': 'error', 'message': 'Missing coordinates'}), 400

        coordinates = data['coordinates']
        if not isinstance(coordinates, list) or len(coordinates) < 3:
            return jsonify({'status': 'error', 'message': 'Need at least 3 points'}), 400

        geofence_ref = db_firestore.collection('geofences').document(geofence_id)
        if not geofence_ref.get().exists:
            return jsonify({'status': 'error', 'message': f'Geofence {geofence_id} not found'}), 404

        update_data = {
            'coordinates': coords_to_db(coordinates),
            'updated_at': datetime.now().isoformat()
        }
        geofence_ref.update(update_data)

        return jsonify({
            'status': 'success',
            'message': 'Geofence coordinates updated',
            'geofence_id': geofence_id,
            'data': {'coordinates': coordinates, 'updated_at': update_data['updated_at']}
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# =============================================
# GEOFENCE CHECKING  —  now reads RTDB boats
# =============================================

def _get_all_active_geofence_polygons():
    """Load all active geofences from Firestore as Shapely Polygons."""
    geofences = {}
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


# =============================================
# ALERTS  —  now reads RTDB boats
# =============================================

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


# =============================================
# SYSTEM / HEALTH
# =============================================

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
    Returns mock seafloor depth data off the coast of Udupi.
    Format: [latitude, longitude, intensity]
    where intensity represents depth (0.0 = surface/shallow, 1.0 = deep).
    """
    import random
    
    # Generate 500 mock depth points in the Arabian Sea off Udupi coast.
    # Latitudes around Udupi (13.3 to 13.9)
    # Longitudes in the sea (74.2 to 74.65)
    points = []
    for _ in range(500):
        lat = random.uniform(13.3, 13.9)
        lng = random.uniform(74.2, 74.65)
        
        # Calculate depth intensity: deeper (closer to 1.0) further west (smaller longitude)
        # and shallower (closer to 0.0) closer to the coast (larger longitude)
        distance_factor = (74.65 - lng) / (74.65 - 74.2)  # 0.0 at coast, 1.0 at deep sea
        
        # Add some random variations for sea floor terrain realism
        intensity = distance_factor * 0.8 + 0.1 + random.uniform(-0.15, 0.15)
        intensity = max(0.0, min(1.0, intensity))
        
        points.append([lat, lng, intensity])
        
    return jsonify({
        'status': 'success',
        'points': points,
        'count': len(points)
    }), 200


# =============================================
# BLUEPRINT REGISTRATION
# =============================================

app.register_blueprint(boats_bp)
app.register_blueprint(geofences_bp)
app.register_blueprint(geofence_check_bp)
app.register_blueprint(alerts_bp)
app.register_blueprint(system_bp)


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('DEBUG', 'True') == 'True'
    )