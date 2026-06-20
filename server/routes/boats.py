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
