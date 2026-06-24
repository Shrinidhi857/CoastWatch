"""
alerts.py — Alert routes including restricted-zone intrusion lifecycle tracking
===============================================================================
Endpoints:
  GET  /api/alerts                  — live alerts (boats currently in violation)
  GET  /api/alerts/<boat_id>        — alerts for a specific boat
  GET  /api/alerts/intrusion-log    — enriched per-boat intrusion records
  POST /api/alerts/zone-entry       — record a boat entering a restricted zone
  POST /api/alerts/zone-exit        — finalise record, classify legal/illegal
"""

import math
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from firebase_init import get_rtdb_ref
from routes.geofence_check import _get_cached_records
from geofence_engine import pip_ray_cast

alerts_bp = Blueprint('alerts', __name__, url_prefix='/api/alerts')


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Estimated zone diameter (km) — used when we can't compute from polygon.
# Tunable per deployment. Represents typical geofence width a vessel crosses.
ZONE_DIAMETER_KM = 2.0

# Speed deviation tolerance for "legal transit" classification (fraction)
LEGAL_SPEED_TOLERANCE = 0.25  # ±25 %

# If actual_duration > this × estimated_duration → suspicious/illegal
ILLEGAL_DURATION_MULTIPLIER = 3.0
SUSPICIOUS_DURATION_MULTIPLIER = 2.0

# Minimum speed (km/h) — below this the vessel is considered stopped/loitering
LOITERING_SPEED_KMH = 2.0


# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------

def _estimate_transit_minutes(speed_kmh: float,
                               zone_diameter_km: float = ZONE_DIAMETER_KM) -> float:
    """
    Estimate how long (in minutes) a vessel should take to cross the zone
    based on its current average speed.

    Returns a large sentinel (999) if speed is effectively zero to avoid /0.
    """
    if speed_kmh < 0.1:
        return 999.0
    # zone_diameter_km / speed_km_per_min = minutes
    return round((zone_diameter_km / speed_kmh) * 60.0, 2)


def _classify_activity(actual_duration_sec: float,
                        speed_kmh: float,
                        expected_speed_kmh: float | None = None) -> dict:
    """
    Three-tier activity classification:
      - LEGAL      🟢  Speed within ±25 % AND duration ≤ 2× estimated transit
      - SUSPICIOUS 🟡  Speed deviation 25–50 % OR duration 2–3× estimated
      - ILLEGAL    🔴  Speed deviation >50 % OR duration >3× estimated OR stopped

    Returns:
        { is_legal: bool, category: 'legal'|'suspicious'|'illegal',
          label: str, reason: str, est_duration_min: float }
    """
    est_min = _estimate_transit_minutes(speed_kmh)
    est_sec = est_min * 60.0

    # Loitering / anchored
    if speed_kmh < LOITERING_SPEED_KMH:
        return {
            'is_legal': False,
            'category': 'illegal',
            'label': '🔴 Illegal — Loitering',
            'reason': f'Vessel speed {speed_kmh:.1f} km/h — effectively stopped inside zone',
            'est_duration_min': est_min,
        }

    # Speed deviation check
    speed_deviation = 0.0
    if expected_speed_kmh and expected_speed_kmh > 0:
        speed_deviation = abs(speed_kmh - expected_speed_kmh) / expected_speed_kmh

    # Duration ratio
    duration_ratio = actual_duration_sec / est_sec if est_sec > 0 else 0

    if speed_deviation > 0.50 or duration_ratio > ILLEGAL_DURATION_MULTIPLIER:
        category = 'illegal'
        label = '🔴 Illegal Activity'
        reason = (f'Duration {actual_duration_sec:.0f}s is {duration_ratio:.1f}× estimated transit'
                  if duration_ratio > ILLEGAL_DURATION_MULTIPLIER
                  else f'Speed deviation {speed_deviation * 100:.0f}% exceeds threshold')
    elif speed_deviation > LEGAL_SPEED_TOLERANCE or duration_ratio > SUSPICIOUS_DURATION_MULTIPLIER:
        category = 'suspicious'
        label = '🟡 Suspicious'
        reason = (f'Duration {actual_duration_sec:.0f}s is {duration_ratio:.1f}× estimated'
                  if duration_ratio > SUSPICIOUS_DURATION_MULTIPLIER
                  else f'Speed deviation {speed_deviation * 100:.0f}% above normal')
    else:
        category = 'legal'
        label = '🟢 Legal Transit'
        reason = 'Speed and duration within normal transit parameters'

    return {
        'is_legal': category == 'legal',
        'category': category,
        'label': label,
        'reason': reason,
        'est_duration_min': est_min,
    }


# ---------------------------------------------------------------------------
# Existing alerts endpoints
# ---------------------------------------------------------------------------

@alerts_bp.route('', methods=['GET'])
def get_alerts():
    """
    Returns boats that are currently in a restricted zone.
    Enriched with entry time, estimated duration, and live duration.
    """
    try:
        boats_data = get_rtdb_ref('boats_live').get() or {}
        geofences = _get_cached_records()
        zone_entries = get_rtdb_ref('zone_entry').get() or {}
        alerts = []

        for boat_id, boat_raw in boats_data.items():
            if not isinstance(boat_raw, dict):
                continue

            gps = boat_raw.get('gps', {})
            lat = float(gps.get('latitude', 0))
            lng = float(gps.get('longitude', 0))

            if not gps.get('fix', False):
                continue

            violated_zones = [
                rec
                for rec in geofences.values()
                if rec.gf_type == 'restricted' and pip_ray_cast(lng, lat, rec)
            ]

            if not violated_zones:
                continue

            meta = boat_raw.get('boat_metadata', {})
            speed_kmh = float(gps.get('speed_kmh', 0))
            boat_name = meta.get('boat_name', boat_id)

            # Look up zone_entry record for live duration
            entry_rec = zone_entries.get(boat_id, {})
            entry_time_str = entry_rec.get('entry_time', '')
            actual_duration_sec = 0.0
            if entry_time_str:
                try:
                    entry_dt = datetime.fromisoformat(entry_time_str)
                    if entry_dt.tzinfo is None:
                        entry_dt = entry_dt.replace(tzinfo=timezone.utc)
                    now_utc = datetime.now(timezone.utc)
                    actual_duration_sec = (now_utc - entry_dt).total_seconds()
                except Exception:
                    pass

            est_min = _estimate_transit_minutes(speed_kmh)
            classification = _classify_activity(actual_duration_sec, speed_kmh)

            alerts.append({
                'boat_id': boat_id,
                'boat_name': boat_name,
                'location': {'latitude': lat, 'longitude': lng},
                'status': 'Active',
                'speed': speed_kmh,
                'updated_at': boat_raw.get('timestamp', ''),
                'severity': 'high',
                'entry_time': entry_time_str,
                'actual_duration_sec': round(actual_duration_sec, 1),
                'est_duration_min': est_min,
                'classification': classification,
                'geofence_name': violated_zones[0].name if violated_zones else '',
            })

        return jsonify({
            'status': 'success',
            'alerts': alerts,
            'alert_count': len(alerts)
        }), 200

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

        geofences = _get_cached_records()
        violations = [
            {
                'geofence_id': gf_id,
                'geofence_name': rec.name,
                'alert_type': 'GEOFENCE_VIOLATION'
            }
            for gf_id, rec in geofences.items()
            if rec.gf_type == 'restricted' and pip_ray_cast(lng, lat, rec)
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


# ---------------------------------------------------------------------------
# New intrusion lifecycle endpoints
# ---------------------------------------------------------------------------

@alerts_bp.route('/intrusion-log', methods=['GET'])
def get_intrusion_log():
    """
    GET /api/alerts/intrusion-log

    Returns enriched per-boat intrusion records combining:
      - Active zone entries (boats currently inside) from zone_entry/<boat_id>
      - Historical records from intrusion_history

    Each record includes:
      entry_time, exit_time, avg_speed, est_duration_min,
      actual_duration_sec, classification (legal/suspicious/illegal)
    """
    try:
        zone_entries = get_rtdb_ref('zone_entry').get() or {}
        intrusion_history = get_rtdb_ref('intrusion_history').get() or {}
        boats_data = get_rtdb_ref('boats_live').get() or {}

        log = []
        now_utc = datetime.now(timezone.utc)

        # ── Active (boats currently inside zone) ───────────────────────────
        for boat_id, entry_rec in zone_entries.items():
            if not isinstance(entry_rec, dict):
                continue

            entry_time_str = entry_rec.get('entry_time', '')
            actual_duration_sec = 0.0
            if entry_time_str:
                try:
                    entry_dt = datetime.fromisoformat(entry_time_str)
                    if entry_dt.tzinfo is None:
                        entry_dt = entry_dt.replace(tzinfo=timezone.utc)
                    actual_duration_sec = (now_utc - entry_dt).total_seconds()
                except Exception:
                    pass

            speed_kmh = float(entry_rec.get('speed_kmh', 0))
            est_min = _estimate_transit_minutes(speed_kmh)
            classification = _classify_activity(actual_duration_sec, speed_kmh)

            # Try to get boat name from live data
            boat_name = entry_rec.get('boat_name', boat_id)
            if boat_id in boats_data:
                boat_name = boats_data[boat_id].get('boat_metadata', {}).get('boat_name', boat_name)

            log.append({
                'id': f'active-{boat_id}',
                'boat_id': boat_id,
                'boat_name': boat_name,
                'entry_time': entry_time_str,
                'exit_time': None,
                'is_active': True,
                'avg_speed_kmh': speed_kmh,
                'est_duration_min': est_min,
                'actual_duration_sec': round(actual_duration_sec, 1),
                'geofence_id': entry_rec.get('geofence_id', ''),
                'geofence_name': entry_rec.get('geofence_name', ''),
                'classification': classification,
                'entryLat': entry_rec.get('lat') or entry_rec.get('entryLat'),
                'entryLng': entry_rec.get('lng') or entry_rec.get('entryLng'),
                'exitLat': None,
                'exitLng': None,
            })

        # ── Historical (completed intrusion records) ───────────────────────
        for push_key, entry in sorted(intrusion_history.items(), reverse=True):
            if not isinstance(entry, dict):
                continue

            speed_kmh = float(entry.get('avgSpeed', entry.get('speed_kmh', 0)))
            actual_duration_sec = float(entry.get('actualDurationSec',
                                                   float(entry.get('duration', 0))))
            est_min = _estimate_transit_minutes(speed_kmh)

            expected_speed = entry.get('expectedSpeed')
            classification = _classify_activity(actual_duration_sec, speed_kmh,
                                                float(expected_speed) if expected_speed else None)

            # Override with stored isSuspicious if classification data is incomplete
            if entry.get('isSuspicious') and classification['category'] == 'legal':
                classification = {
                    'is_legal': False,
                    'category': 'suspicious',
                    'label': '🟡 Suspicious',
                    'reason': 'Speed deviation flagged by simulation',
                    'est_duration_min': est_min,
                }

            log.append({
                'id': push_key,
                'boat_id': entry.get('boatId', ''),
                'boat_name': entry.get('boatName', entry.get('boatId', '')),
                'entry_time': entry.get('entryTime', ''),
                'exit_time': entry.get('exitTime', ''),
                'is_active': False,
                'avg_speed_kmh': speed_kmh,
                'est_duration_min': est_min,
                'actual_duration_sec': actual_duration_sec,
                'geofence_id': entry.get('geofenceId', ''),
                'geofence_name': entry.get('geofenceName', entry.get('pathName', '')),
                'classification': classification,
                'entryLat': entry.get('entryLat') or entry.get('lat'),
                'entryLng': entry.get('entryLng') or entry.get('lng'),
                'exitLat': entry.get('exitLat'),
                'exitLng': entry.get('exitLng'),
            })

        return jsonify({
            'status': 'success',
            'total': len(log),
            'active_count': sum(1 for r in log if r['is_active']),
            'log': log
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@alerts_bp.route('/zone-entry', methods=['POST'])
def record_zone_entry():
    """
    POST /api/alerts/zone-entry

    Records the moment a boat enters a restricted zone.
    Body: {
      boat_id, boat_name, lat, lng,
      geofence_id, geofence_name, speed_kmh, timestamp (optional ISO str)
    }
    Stores under zone_entry/<boat_id> in RTDB.
    """
    try:
        data = request.get_json(force=True) or {}
        boat_id = data.get('boat_id')
        if not boat_id:
            return jsonify({'status': 'error', 'message': 'boat_id required'}), 400

        timestamp = data.get('timestamp') or datetime.now(timezone.utc).isoformat()

        entry_record = {
            'boat_id': boat_id,
            'boat_name': data.get('boat_name', boat_id),
            'entry_time': timestamp,
            'lat': float(data.get('lat', 0)),
            'lng': float(data.get('lng', 0)),
            'geofence_id': data.get('geofence_id', ''),
            'geofence_name': data.get('geofence_name', ''),
            'speed_kmh': float(data.get('speed_kmh', 0)),
        }

        get_rtdb_ref(f'zone_entry/{boat_id}').set(entry_record)

        return jsonify({
            'status': 'success',
            'message': f'Zone entry recorded for {boat_id}',
            'entry_time': timestamp,
        }), 201

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@alerts_bp.route('/zone-exit', methods=['POST'])
def record_zone_exit():
    """
    POST /api/alerts/zone-exit

    Finalises a zone-entry record, classifies the activity, and writes to
    intrusion_history.
    Body: { boat_id, timestamp (optional), expected_speed_kmh (optional) }
    """
    try:
        data = request.get_json(force=True) or {}
        boat_id = data.get('boat_id')
        if not boat_id:
            return jsonify({'status': 'error', 'message': 'boat_id required'}), 400

        entry_ref = get_rtdb_ref(f'zone_entry/{boat_id}')
        entry_rec = entry_ref.get()

        if not entry_rec:
            return jsonify({
                'status': 'error',
                'message': f'No active zone entry found for boat {boat_id}'
            }), 404

        exit_time_str = data.get('timestamp') or datetime.now(timezone.utc).isoformat()

        # Compute actual duration
        actual_duration_sec = 0.0
        try:
            entry_dt = datetime.fromisoformat(entry_rec['entry_time'])
            exit_dt = datetime.fromisoformat(exit_time_str)
            if entry_dt.tzinfo is None:
                entry_dt = entry_dt.replace(tzinfo=timezone.utc)
            if exit_dt.tzinfo is None:
                exit_dt = exit_dt.replace(tzinfo=timezone.utc)
            actual_duration_sec = (exit_dt - entry_dt).total_seconds()
        except Exception:
            pass

        speed_kmh = float(entry_rec.get('speed_kmh', 0))
        expected_speed = data.get('expected_speed_kmh')
        classification = _classify_activity(
            actual_duration_sec, speed_kmh,
            float(expected_speed) if expected_speed else None
        )

        exit_lat = data.get('lat') or data.get('exitLat') or data.get('exit_lat')
        exit_lng = data.get('lng') or data.get('exitLng') or data.get('exit_lng')

        # Write completed record to intrusion_history
        history_record = {
            'boatId': boat_id,
            'boatName': entry_rec.get('boat_name', boat_id),
            'entryTime': entry_rec['entry_time'],
            'exitTime': exit_time_str,
            'duration': str(round(actual_duration_sec, 1)),
            'actualDurationSec': actual_duration_sec,
            'avgSpeed': speed_kmh,
            'expectedSpeed': expected_speed,
            'geofenceId': entry_rec.get('geofence_id', ''),
            'geofenceName': entry_rec.get('geofence_name', ''),
            'isLegal': classification['is_legal'],
            'isSuspicious': not classification['is_legal'],
            'category': classification['category'],
            'classificationLabel': classification['label'],
            'classificationReason': classification['reason'],
            'estDurationMin': classification['est_duration_min'],
            'entryLat': entry_rec.get('lat') or entry_rec.get('entryLat'),
            'entryLng': entry_rec.get('lng') or entry_rec.get('entryLng'),
            'exitLat': float(exit_lat) if exit_lat is not None else None,
            'exitLng': float(exit_lng) if exit_lng is not None else None,
        }

        hist_ref = get_rtdb_ref('intrusion_history')
        new_ref = hist_ref.push(history_record)

        # Remove the active zone_entry record
        entry_ref.delete()

        return jsonify({
            'status': 'success',
            'message': f'Zone exit recorded for {boat_id}',
            'id': new_ref.key,
            'actual_duration_sec': actual_duration_sec,
            'classification': classification,
        }), 201

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
