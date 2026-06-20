from datetime import datetime
from flask import Blueprint, request, jsonify
from firebase_init import db_firestore, coords_to_db, coords_from_db

geofences_bp = Blueprint('geofences', __name__, url_prefix='/api/geofences')

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
