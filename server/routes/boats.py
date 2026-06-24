import traceback
from datetime import datetime
from flask import Blueprint, request, jsonify
from firebase_init import get_rtdb_ref, rtdb_boat_to_api

boats_bp = Blueprint('boats', __name__, url_prefix='/api/boats')

@boats_bp.route('', methods=['GET'])
def get_boats():
    """
    GET /api/boats
    Reads the boats_live node from Firebase Realtime Database.
    Returns ALL boats (including those without GPS fix) so the frontend
    can decide what to show.
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


@boats_bp.route('/intrusions', methods=['GET'])
def get_intrusions():
    """
    GET /api/boats/intrusions
    Reads all historical vessel intrusion records from Firebase.
    """
    try:
        ref = get_rtdb_ref('intrusion_history')
        data = ref.get()

        if not data:
            return jsonify({'status': 'success', 'data': []}), 200

        intrusions = []
        for push_key, entry in sorted(data.items(), reverse=True): # Newest first
            if not isinstance(entry, dict):
                continue
            entry['id'] = push_key
            intrusions.append(entry)

        return jsonify({
            'status': 'success',
            'data': intrusions
        }), 200

    except Exception as e:
        print(f"[ERROR] get_intrusions: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@boats_bp.route('/intrusions', methods=['POST'])
def add_intrusion():
    """
    POST /api/boats/intrusions
    Saves a new vessel intrusion entry to Firebase.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400

        required_fields = ['boatId', 'entryTime', 'exitTime', 'duration']
        for f in required_fields:
            if f not in data:
                return jsonify({'status': 'error', 'message': f'Missing required field: {f}'}), 400

        ref = get_rtdb_ref('intrusion_history')
        new_ref = ref.push(data)
        
        return jsonify({
            'status': 'success',
            'message': 'Intrusion logged successfully',
            'id': new_ref.key
        }), 201

    except Exception as e:
        print(f"[ERROR] add_intrusion: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@boats_bp.route('/intrusions', methods=['DELETE'])
def clear_intrusions():
    """
    DELETE /api/boats/intrusions
    Clears all vessel intrusion history from Firebase.
    """
    try:
        ref = get_rtdb_ref('intrusion_history')
        ref.delete()
        return jsonify({'status': 'success', 'message': 'Intrusion history cleared successfully'}), 200

    except Exception as e:
        print(f"[ERROR] clear_intrusions: {e}")
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


@boats_bp.route('/<boat_id>/path', methods=['GET'])
def get_boat_path(boat_id):
    """
    GET /api/boats/<boat_id>/path?date=YYYY-MM-DD

    Returns the ordered list of GPS coordinates recorded for a boat
    on a given date (defaults to today UTC).
    Reads from boat_history/<date>/<boat_id> in Realtime Database.

    Response shape:
    {
      "status": "success",
      "boat_id": "123456",
      "date": "2026-06-23",
      "count": 42,
      "path": [
        { "lat": 13.639937, "lng": 74.671308, "timestamp": "...", "speed_kmh": 12.3 },
        ...
      ]
    }
    """
    try:
        from datetime import date as date_cls
        date_str = request.args.get('date', date_cls.today().isoformat())

        ref = get_rtdb_ref(f'boat_history/{date_str}/{boat_id}')
        raw = ref.get()

        if not raw:
            return jsonify({
                'status': 'success',
                'boat_id': boat_id,
                'date': date_str,
                'count': 0,
                'path': []
            }), 200

        # Firebase push() keys are lexicographically ordered by time,
        # so sorting by key gives chronological order.
        path = []
        for push_key in sorted(raw.keys()):
            entry = raw[push_key]
            if not isinstance(entry, dict):
                continue
            gps = entry.get('gps', {})
            lat = gps.get('latitude')
            lng = gps.get('longitude')
            if lat is None or lng is None:
                continue
            path.append({
                'lat':        float(lat),
                'lng':        float(lng),
                'altitude':   float(gps.get('altitude', 0)),
                'speed_kmh':  float(gps.get('speed_kmh', 0)),
                'satellites': int(gps.get('satellites', 0)),
                'fix':        bool(gps.get('fix', False)),
                'timestamp':  entry.get('timestamp', ''),
            })

        return jsonify({
            'status': 'success',
            'boat_id': boat_id,
            'date': date_str,
            'count': len(path),
            'path': path
        }), 200

    except Exception as e:
        print(f"[ERROR] get_boat_path: {e}")
        traceback.print_exc()
        return jsonify({'status': 'error', 'message': str(e)}), 500
