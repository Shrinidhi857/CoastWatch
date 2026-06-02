import os
import json
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, db, firestore
from shapely.geometry import Point, Polygon
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Initialize Firebase
try:
    # Try to initialize with credentials file if it exists
    if os.path.exists('firebase-credentials.json'):
        cred = credentials.Certificate('firebase-credentials.json')
    else:
        # python-dotenv does NOT auto-convert \\n → \n in single-line values,
        # so we must do it manually for the PEM private key.
        raw_private_key = os.getenv("FIREBASE_PRIVATE_KEY", "")
        private_key = raw_private_key.replace('\\n', '\n')

        # Strip stray leading/trailing characters from client_id (e.g. accidental '<')
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

        print(f"[Firebase] project_id={firebase_config['project_id']}")
        print(f"[Firebase] client_email={firebase_config['client_email']}")
        print(f"[Firebase] private_key starts with: {private_key[:40]!r}")

        cred = credentials.Certificate(firebase_config)

    firebase_admin.initialize_app(cred, {
        'databaseURL': os.getenv('FIREBASE_DATABASE_URL', ''),
        'storageBucket': os.getenv('FIREBASE_STORAGE_BUCKET', '')
    })

    # Initialize Firestore
    db_firestore = firestore.client()
    print("Firebase initialized successfully")
except Exception as e:
    import traceback
    print(f"Firebase initialization error: {e}")
    traceback.print_exc()
    db_firestore = None


# =============================================
# COORDINATE CONVERSION HELPERS
# Firestore does NOT allow nested arrays ([[lng, lat], ...]).
# We store coordinates as objects [{"lng": x, "lat": y}] instead.
# =============================================

def coords_to_db(coordinates):
    """Convert [[lng, lat], ...] → [{"lng": x, "lat": y}, ...] for Firestore storage."""
    result = []
    for c in coordinates:
        if isinstance(c, dict):
            result.append({"lng": float(c.get("lng", c.get("0", 0))), "lat": float(c.get("lat", c.get("1", 0)))})
        else:
            result.append({"lng": float(c[0]), "lat": float(c[1])})
    return result


def coords_from_db(coordinates):
    """Convert [{"lng": x, "lat": y}, ...] → [[lng, lat], ...] for API responses (frontend format)."""
    result = []
    for c in coordinates:
        if isinstance(c, dict):
            result.append([c.get("lng", 0), c.get("lat", 0)])
        else:
            result.append([c[0], c[1]])
    return result


def coords_to_shapely(coordinates):
    """Convert stored coordinates to Shapely (lng, lat) tuples. Handles both formats."""
    result = []
    for c in coordinates:
        if isinstance(c, dict):
            result.append((float(c.get("lng", 0)), float(c.get("lat", 0))))
        else:
            result.append((float(c[0]), float(c[1])))
    return result


# =============================================
# BOAT GEOMARKER ENDPOINTS
# =============================================

@app.route('/api/boats', methods=['GET'])
def get_boats():
    """Get all boats with their geomarkers"""
    try:
        boats_ref = db_firestore.collection('boats')
        boats = []
        
        for doc in boats_ref.stream():
            boat_data = doc.to_dict()
            boat_data['id'] = doc.id
            boats.append(boat_data)
        
        return jsonify({
            'status': 'success',
            'data': boats,
            'count': len(boats)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/boats/<boat_id>', methods=['GET'])
def get_boat(boat_id):
    """Get a specific boat by ID"""
    try:
        boat_ref = db_firestore.collection('boats').document(boat_id)
        boat_doc = boat_ref.get()
        
        if not boat_doc.exists:
            return jsonify({
                'status': 'error',
                'message': f'Boat with ID {boat_id} not found'
            }), 404
        
        boat_data = boat_doc.to_dict()
        boat_data['id'] = boat_doc.id
        
        return jsonify({
            'status': 'success',
            'data': boat_data
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/boats', methods=['POST'])
def create_boat():
    """Create a new boat with geomarker"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['name', 'latitude', 'longitude']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'status': 'error',
                    'message': f'Missing required field: {field}'
                }), 400
        
        boat_data = {
            'name': data.get('name'),
            'latitude': float(data.get('latitude')),
            'longitude': float(data.get('longitude')),
            'status': data.get('status', 'Active'),
            'speed': float(data.get('speed', 0)),
            'heading': float(data.get('heading', 0)),
            'vessel_type': data.get('vessel_type', 'General'),
            'crew_count': int(data.get('crew_count', 0)),
            'destination': data.get('destination', ''),
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'in_restricted_zone': False
        }
        
        # Add to Firestore
        doc_ref = db_firestore.collection('boats').add(boat_data)
        
        return jsonify({
            'status': 'success',
            'message': 'Boat created successfully',
            'boat_id': doc_ref[1].id,
            'data': boat_data
        }), 201
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/boats/<boat_id>', methods=['PUT'])
def update_boat(boat_id):
    """Update a boat's geomarker and details"""
    try:
        data = request.get_json()
        boat_ref = db_firestore.collection('boats').document(boat_id)
        
        if not boat_ref.get().exists:
            return jsonify({
                'status': 'error',
                'message': f'Boat with ID {boat_id} not found'
            }), 404
        
        # Prepare update data
        update_data = {}
        
        if 'name' in data:
            update_data['name'] = data['name']
        if 'latitude' in data:
            update_data['latitude'] = float(data['latitude'])
        if 'longitude' in data:
            update_data['longitude'] = float(data['longitude'])
        if 'status' in data:
            update_data['status'] = data['status']
        if 'speed' in data:
            update_data['speed'] = float(data['speed'])
        if 'heading' in data:
            update_data['heading'] = float(data['heading'])
        if 'vessel_type' in data:
            update_data['vessel_type'] = data['vessel_type']
        if 'crew_count' in data:
            update_data['crew_count'] = int(data['crew_count'])
        if 'destination' in data:
            update_data['destination'] = data['destination']
        
        update_data['updated_at'] = datetime.now().isoformat()
        
        boat_ref.update(update_data)
        
        return jsonify({
            'status': 'success',
            'message': 'Boat updated successfully',
            'data': update_data
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/boats/<boat_id>', methods=['DELETE'])
def delete_boat(boat_id):
    """Delete a boat"""
    try:
        boat_ref = db_firestore.collection('boats').document(boat_id)
        
        if not boat_ref.get().exists:
            return jsonify({
                'status': 'error',
                'message': f'Boat with ID {boat_id} not found'
            }), 404
        
        boat_ref.delete()
        
        return jsonify({
            'status': 'success',
            'message': 'Boat deleted successfully'
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/boats/<boat_id>/location', methods=['PUT'])
def update_boat_location(boat_id):
    """Update only the location of a boat"""
    try:
        data = request.get_json()
        
        if 'latitude' not in data or 'longitude' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Missing latitude or longitude'
            }), 400
        
        boat_ref = db_firestore.collection('boats').document(boat_id)
        
        if not boat_ref.get().exists:
            return jsonify({
                'status': 'error',
                'message': f'Boat with ID {boat_id} not found'
            }), 404
        
        update_data = {
            'latitude': float(data['latitude']),
            'longitude': float(data['longitude']),
            'updated_at': datetime.now().isoformat()
        }
        
        if 'speed' in data:
            update_data['speed'] = float(data['speed'])
        if 'heading' in data:
            update_data['heading'] = float(data['heading'])
        
        boat_ref.update(update_data)
        
        return jsonify({
            'status': 'success',
            'message': 'Location updated successfully',
            'data': update_data
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


# =============================================
# GEOFENCING ENDPOINTS
# =============================================

@app.route('/api/geofences', methods=['GET'])
def get_geofences():
    """Get all geofences"""
    try:
        if db_firestore is None:
            return jsonify({
                'status': 'error',
                'message': 'Firebase not connected. Check server credentials.'
            }), 503

        geofences_ref = db_firestore.collection('geofences')
        geofences = []

        for doc in geofences_ref.stream():
            geofence_data = doc.to_dict()
            geofence_data['id'] = doc.id
            # Convert stored {lng,lat} objects back to [[lng,lat]] arrays for frontend
            if 'coordinates' in geofence_data:
                geofence_data['coordinates'] = coords_from_db(geofence_data['coordinates'])
            geofences.append(geofence_data)

        return jsonify({
            'status': 'success',
            'data': geofences,
            'count': len(geofences)
        }), 200
    except Exception as e:
        print(f"[ERROR] get_geofences: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofences/<geofence_id>', methods=['GET'])
def get_geofence(geofence_id):
    """Get a specific geofence by ID"""
    try:
        if db_firestore is None:
            return jsonify({
                'status': 'error',
                'message': 'Firebase not connected. Check server credentials.'
            }), 503

        geofence_ref = db_firestore.collection('geofences').document(geofence_id)
        geofence_doc = geofence_ref.get()

        if not geofence_doc.exists:
            return jsonify({
                'status': 'error',
                'message': f'Geofence with ID {geofence_id} not found'
            }), 404

        geofence_data = geofence_doc.to_dict()
        geofence_data['id'] = geofence_doc.id
        if 'coordinates' in geofence_data:
            geofence_data['coordinates'] = coords_from_db(geofence_data['coordinates'])

        return jsonify({
            'status': 'success',
            'data': geofence_data
        }), 200
    except Exception as e:
        print(f"[ERROR] get_geofence: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofences/batch/create', methods=['POST'])
def create_multiple_geofences():
    """Create multiple geofences at once"""
    try:
        if db_firestore is None:
            return jsonify({
                'status': 'error',
                'message': 'Firebase not connected. Check server credentials.'
            }), 503

        data = request.get_json()

        if 'geofences' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Missing geofences array'
            }), 400

        geofences = data.get('geofences')
        if not isinstance(geofences, list):
            return jsonify({
                'status': 'error',
                'message': 'Geofences must be an array'
            }), 400

        created_geofences = []
        errors = []

        for idx, geofence in enumerate(geofences):
            try:
                if 'name' not in geofence or 'coordinates' not in geofence:
                    errors.append(f"Geofence {idx}: Missing name or coordinates")
                    continue

                coordinates = geofence.get('coordinates')
                if not isinstance(coordinates, list) or len(coordinates) < 3:
                    errors.append(f"Geofence {idx}: Invalid coordinates")
                    continue

                geofence_data = {
                    'name': geofence.get('name'),
                    'description': geofence.get('description', ''),
                    'coordinates': coords_to_db(coordinates),  # Convert [[lng,lat]] → [{lng,lat}]
                    'type': geofence.get('type', 'restricted'),
                    'is_active': geofence.get('is_active', True),
                    'created_at': datetime.now().isoformat(),
                    'updated_at': datetime.now().isoformat(),
                    'metadata': geofence.get('metadata', {})
                }

                doc_ref = db_firestore.collection('geofences').add(geofence_data)
                created_geofences.append({
                    'geofence_id': doc_ref[1].id,
                    'name': geofence_data['name']
                })
            except Exception as e:
                errors.append(f"Geofence {idx}: {str(e)}")

        return jsonify({
            'status': 'success',
            'message': f'Created {len(created_geofences)} geofences',
            'created': created_geofences,
            'errors': errors,
            'count': len(created_geofences)
        }), 201
    except Exception as e:
        print(f"[ERROR] create_multiple_geofences: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofences', methods=['POST'])
def create_geofence():
    """Create a new geofence with coordinates"""
    try:
        if db_firestore is None:
            return jsonify({
                'status': 'error',
                'message': 'Firebase not connected. Check server credentials and firebase-credentials.json.'
            }), 503

        data = request.get_json()
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'Invalid or missing JSON body'
            }), 400

        # Validate required fields
        required_fields = ['name', 'coordinates']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'status': 'error',
                    'message': f'Missing required field: {field}'
                }), 400

        coordinates = data.get('coordinates')
        if not isinstance(coordinates, list) or len(coordinates) < 3:
            return jsonify({
                'status': 'error',
                'message': 'Coordinates must be a list of at least 3 points [lng, lat]'
            }), 400

        # Convert [[lng,lat],...] → [{lng,lat},...] — Firestore forbids nested arrays
        coordinates_for_db = coords_to_db(coordinates)

        geofence_data = {
            'name': data.get('name'),
            'description': data.get('description', ''),
            'coordinates': coordinates_for_db,
            'type': data.get('type', 'restricted'),  # 'restricted', 'safe_zone', 'monitoring'
            'is_active': data.get('is_active', True),
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'metadata': data.get('metadata', {})
        }

        print(f"[INFO] Creating geofence: {geofence_data['name']} with {len(coordinates)} points")

        # Add to Firestore
        doc_ref = db_firestore.collection('geofences').add(geofence_data)

        print(f"[INFO] Geofence created with ID: {doc_ref[1].id}")

        # Return coordinates in frontend format [[lng,lat],...]
        response_data = dict(geofence_data)
        response_data['coordinates'] = coordinates
        return jsonify({
            'status': 'success',
            'message': 'Geofence created successfully',
            'geofence_id': doc_ref[1].id,
            'data': response_data
        }), 201
    except Exception as e:
        print(f"[ERROR] create_geofence: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofences/<geofence_id>', methods=['PUT'])
def update_geofence(geofence_id):
    """Update a geofence"""
    try:
        data = request.get_json()
        geofence_ref = db_firestore.collection('geofences').document(geofence_id)
        
        if not geofence_ref.get().exists:
            return jsonify({
                'status': 'error',
                'message': f'Geofence with ID {geofence_id} not found'
            }), 404
        
        # Prepare update data
        update_data = {}
        
        if 'name' in data:
            update_data['name'] = data['name']
        if 'description' in data:
            update_data['description'] = data['description']
        if 'coordinates' in data:
            coordinates = data['coordinates']
            if not isinstance(coordinates, list) or len(coordinates) < 3:
                return jsonify({
                    'status': 'error',
                    'message': 'Coordinates must be a list of at least 3 points [lng, lat]'
                }), 400
            update_data['coordinates'] = coords_to_db(coordinates)  # Convert for Firestore
        if 'type' in data:
            update_data['type'] = data['type']
        if 'is_active' in data:
            update_data['is_active'] = data['is_active']
        if 'metadata' in data:
            update_data['metadata'] = data['metadata']
        
        update_data['updated_at'] = datetime.now().isoformat()
        
        geofence_ref.update(update_data)
        
        return jsonify({
            'status': 'success',
            'message': 'Geofence updated successfully',
            'data': update_data
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofences/<geofence_id>', methods=['DELETE'])
def delete_geofence(geofence_id):
    """Delete a geofence"""
    try:
        geofence_ref = db_firestore.collection('geofences').document(geofence_id)
        
        if not geofence_ref.get().exists:
            return jsonify({
                'status': 'error',
                'message': f'Geofence with ID {geofence_id} not found'
            }), 404
        
        geofence_ref.delete()
        
        return jsonify({
            'status': 'success',
            'message': 'Geofence deleted successfully'
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


# NOTE: batch/create route moved above <geofence_id> routes to avoid Flask matching
# 'batch' as a geofence_id. The implementation is defined above at line ~329.


# =============================================
# GEOFENCE CHECKING ENDPOINTS
# =============================================

@app.route('/api/geofence-check/boat/<boat_id>', methods=['GET'])
def check_boat_in_geofence(boat_id):
    """Check if a boat is in any geofence"""
    try:
        # Get boat
        boat_ref = db_firestore.collection('boats').document(boat_id)
        boat_doc = boat_ref.get()
        
        if not boat_doc.exists:
            return jsonify({
                'status': 'error',
                'message': f'Boat with ID {boat_id} not found'
            }), 404
        
        boat_data = boat_doc.to_dict()
        boat_point = Point(boat_data['longitude'], boat_data['latitude'])
        
        # Check against all geofences
        geofences_ref = db_firestore.collection('geofences')
        violations = []
        safe_zones = []
        
        for doc in geofences_ref.stream():
            geofence_data = doc.to_dict()
            
            if not geofence_data.get('is_active', True):
                continue
            
            coordinates = geofence_data.get('coordinates', [])
            # Use helper — handles both [{lng,lat}] objects and [[lng,lat]] arrays
            polygon_coords = coords_to_shapely(coordinates)
            
            if len(polygon_coords) >= 3:
                polygon = Polygon(polygon_coords)
                
                if boat_point.within(polygon) or polygon.contains(boat_point):
                    geofence_info = {
                        'geofence_id': doc.id,
                        'name': geofence_data.get('name'),
                        'type': geofence_data.get('type')
                    }
                    
                    if geofence_data.get('type') == 'restricted':
                        violations.append(geofence_info)
                    elif geofence_data.get('type') == 'safe_zone':
                        safe_zones.append(geofence_info)
        
        # Update boat's in_restricted_zone flag
        if violations:
            boat_ref.update({'in_restricted_zone': True})
        else:
            boat_ref.update({'in_restricted_zone': False})
        
        return jsonify({
            'status': 'success',
            'boat_id': boat_id,
            'boat_name': boat_data.get('name'),
            'location': {
                'latitude': boat_data.get('latitude'),
                'longitude': boat_data.get('longitude')
            },
            'in_restricted_zone': len(violations) > 0,
            'violations': violations,
            'safe_zones': safe_zones,
            'violation_count': len(violations),
            'safe_zone_count': len(safe_zones)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofence-check/all-boats', methods=['GET'])
def check_all_boats_geofence():
    """Check all boats against geofences"""
    try:
        boats_ref = db_firestore.collection('boats')
        geofences_ref = db_firestore.collection('geofences')
        
        # Get all geofences
        geofences_data = {}
        for doc in geofences_ref.stream():
            geofence_info = doc.to_dict()
            if geofence_info.get('is_active', True):
                coordinates = geofence_info.get('coordinates', [])
                polygon_coords = coords_to_shapely(coordinates)
                if len(polygon_coords) >= 3:
                    geofences_data[doc.id] = {
                        'polygon': Polygon(polygon_coords),
                        'name': geofence_info.get('name'),
                        'type': geofence_info.get('type')
                    }
        
        # Check each boat
        results = []
        violations_summary = []
        
        for boat_doc in boats_ref.stream():
            boat_data = boat_doc.to_dict()
            boat_point = Point(boat_data['longitude'], boat_data['latitude'])
            
            violations = []
            safe_zones = []
            
            for geofence_id, geofence_info in geofences_data.items():
                polygon = geofence_info['polygon']
                
                if boat_point.within(polygon) or polygon.contains(boat_point):
                    geofence_detail = {
                        'geofence_id': geofence_id,
                        'name': geofence_info['name'],
                        'type': geofence_info['type']
                    }
                    
                    if geofence_info['type'] == 'restricted':
                        violations.append(geofence_detail)
                    elif geofence_info['type'] == 'safe_zone':
                        safe_zones.append(geofence_detail)
            
            in_violation = len(violations) > 0
            
            # Update boat in database
            db_firestore.collection('boats').document(boat_doc.id).update({
                'in_restricted_zone': in_violation
            })
            
            boat_result = {
                'boat_id': boat_doc.id,
                'boat_name': boat_data.get('name'),
                'location': {
                    'latitude': boat_data.get('latitude'),
                    'longitude': boat_data.get('longitude')
                },
                'status': boat_data.get('status'),
                'in_restricted_zone': in_violation,
                'violations': violations,
                'safe_zones': safe_zones
            }
            
            results.append(boat_result)
            
            if in_violation:
                violations_summary.append({
                    'boat_id': boat_doc.id,
                    'boat_name': boat_data.get('name'),
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
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/geofence-check/location', methods=['POST'])
def check_location_in_geofence():
    """Check if a specific location is in any geofence"""
    try:
        data = request.get_json()
        
        if 'latitude' not in data or 'longitude' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Missing latitude or longitude'
            }), 400
        
        check_point = Point(float(data['longitude']), float(data['latitude']))
        
        geofences_ref = db_firestore.collection('geofences')
        violations = []
        safe_zones = []
        monitoring_zones = []

        
        for doc in geofences_ref.stream():
            geofence_data = doc.to_dict()
            
            if not geofence_data.get('is_active', True):
                continue
            
            coordinates = geofence_data.get('coordinates', [])
            polygon_coords = coords_to_shapely(coordinates)
            
            if len(polygon_coords) >= 3:
                polygon = Polygon(polygon_coords)
                
                if check_point.within(polygon) or polygon.contains(check_point):
                    geofence_info = {
                        'geofence_id': doc.id,
                        'name': geofence_data.get('name'),
                        'type': geofence_data.get('type'),
                        'description': geofence_data.get('description')
                    }
                    
                    if geofence_data.get('type') == 'restricted':
                        violations.append(geofence_info)
                    elif geofence_data.get('type') == 'safe_zone':
                        safe_zones.append(geofence_info)
                    elif geofence_data.get('type') == 'monitoring':
                        monitoring_zones.append(geofence_info)
        
        return jsonify({
            'status': 'success',
            'location': {
                'latitude': float(data['latitude']),
                'longitude': float(data['longitude'])
            },
            'in_restricted_zone': len(violations) > 0,
            'violations': violations,
            'safe_zones': safe_zones,
            'monitoring_zones': monitoring_zones,
            'total_zones': len(violations) + len(safe_zones) + len(monitoring_zones)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


# =============================================
# ALERTS AND NOTIFICATIONS
# =============================================

@app.route('/api/alerts', methods=['GET'])
def get_alerts():
    """Get all geofence violations/alerts"""
    try:
        alerts = []
        boats_ref = db_firestore.collection('boats')
        
        for boat_doc in boats_ref.stream():
            boat_data = boat_doc.to_dict()
            
            if boat_data.get('in_restricted_zone', False):
                alert = {
                    'boat_id': boat_doc.id,
                    'boat_name': boat_data.get('name'),
                    'location': {
                        'latitude': boat_data.get('latitude'),
                        'longitude': boat_data.get('longitude')
                    },
                    'status': boat_data.get('status'),
                    'speed': boat_data.get('speed'),
                    'updated_at': boat_data.get('updated_at'),
                    'severity': 'high' if boat_data.get('status') == 'Active' else 'medium'
                }
                alerts.append(alert)
        
        return jsonify({
            'status': 'success',
            'alerts': alerts,
            'alert_count': len(alerts)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/api/alerts/<boat_id>', methods=['GET'])
def get_boat_alerts(boat_id):
    """Get alerts for a specific boat"""
    try:
        boat_ref = db_firestore.collection('boats').document(boat_id)
        boat_doc = boat_ref.get()
        
        if not boat_doc.exists:
            return jsonify({
                'status': 'error',
                'message': f'Boat with ID {boat_id} not found'
            }), 404
        
        boat_data = boat_doc.to_dict()
        
        if not boat_data.get('in_restricted_zone', False):
            return jsonify({
                'status': 'success',
                'boat_id': boat_id,
                'boat_name': boat_data.get('name'),
                'has_alerts': False,
                'alerts': []
            }), 200
        
        # Get geofences this boat is violating
        boat_point = Point(boat_data['longitude'], boat_data['latitude'])
        geofences_ref = db_firestore.collection('geofences')
        violations = []
        
        for doc in geofences_ref.stream():
            geofence_data = doc.to_dict()
            
            if not geofence_data.get('is_active', True):
                continue
            
            if geofence_data.get('type') != 'restricted':
                continue
            
            coordinates = geofence_data.get('coordinates', [])
            polygon_coords = [(coord[0], coord[1]) for coord in coordinates]
            
            if len(polygon_coords) >= 3:
                polygon = Polygon(polygon_coords)
                
                if boat_point.within(polygon) or polygon.contains(boat_point):
                    violations.append({
                        'geofence_id': doc.id,
                        'geofence_name': geofence_data.get('name'),
                        'geofence_description': geofence_data.get('description'),
                        'alert_type': 'GEOFENCE_VIOLATION'
                    })
        
        return jsonify({
            'status': 'success',
            'boat_id': boat_id,
            'boat_name': boat_data.get('name'),
            'has_alerts': len(violations) > 0,
            'alerts': violations,
            'alert_count': len(violations)
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


# =============================================
# HEALTH AND INFO ENDPOINTS
# =============================================

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Samudra Boat Tracking Server',
        'timestamp': datetime.now().isoformat(),
        'firebase_connected': db_firestore is not None
    }), 200


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get statistics about boats and geofences"""
    try:
        boats_ref = db_firestore.collection('boats')
        geofences_ref = db_firestore.collection('geofences')
        
        boats = list(boats_ref.stream())
        geofences = list(geofences_ref.stream())
        
        boats_in_violation = sum(1 for boat in boats if boat.to_dict().get('in_restricted_zone', False))
        active_boats = sum(1 for boat in boats if boat.to_dict().get('status') == 'Active')
        
        return jsonify({
            'status': 'success',
            'statistics': {
                'total_boats': len(boats),
                'active_boats': active_boats,
                'boats_in_violation': boats_in_violation,
                'total_geofences': len(geofences),
                'timestamp': datetime.now().isoformat()
            }
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('DEBUG', 'True') == 'True'
    )
