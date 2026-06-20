import os
import traceback
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, db as rtdb, firestore
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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

    # Initialize admin SDK
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


def get_rtdb_ref(path):
    """Return a Realtime Database reference."""
    return rtdb.reference(path)


def rtdb_boat_to_api(boat_id, boat_data):
    """
    Convert a boats_live record from Realtime Database into the API shape
    that the React frontend expects.
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
        'gps_fix': gps_fix,
        'satellites': int(gps.get('satellites', 0)),
        'altitude': float(gps.get('altitude', 0)),
        'speed': float(gps.get('speed_kmh', 0)),
        'heading': 0,
        'status': 'Active',
        'vessel_type': meta.get('boat_type', 'Unknown'),
        'owner': meta.get('owner', ''),
        'crew_count': 0,
        'destination': '',
        'in_restricted_zone': False,
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
