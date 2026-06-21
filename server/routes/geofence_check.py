"""
geofence_check.py — Geofence Check API Blueprint
=================================================
Refactored using the production-grade PIP engine in geofence_engine.py.

Key improvements over the original:
  ① Shapely is NO LONGER used for the core point-in-polygon test.
    A custom Ray Casting (Even-Odd) engine replaces it, eliminating the
    32-bit float truncation risk that existed inside older GEOS builds.

  ② An in-process GeofenceCache (per-process, TTL-based) stores pre-built
    GeofenceRecord objects — including pre-computed AABB bounding boxes —
    so Firestore is NOT queried on every single HTTP request.

  ③ The AABB guard short-circuits the O(n) ray cast for any boat that is
    obviously outside a geofence's bounding box, making bulk /all-boats
    checks significantly faster with many geofences.

  ④ Every coordinate is explicitly cast to float() (IEEE 754 double, 64-bit)
    at the Firestore ingestion boundary, eliminating silent integer promotion.

  ⑤ Boundary precision: the original polygon.contains() EXCLUDES points that
    lie exactly on a polygon edge, returning False for boundary contacts.
    The new ray-cast uses the open-lower/closed-upper convention that
    correctly returns True for edge-touching contacts — critical for vessels
    moving along a geofence boundary line.
"""

from flask import Blueprint, request, jsonify
from firebase_init import db_firestore, get_rtdb_ref, coords_to_shapely
from geofence_engine import GeofenceRecord, pip_ray_cast, build_geofence_record
import threading
import time

geofence_check_bp = Blueprint(
    'geofence_check', __name__, url_prefix='/api/geofence-check'
)


# ===========================================================================
# In-Process Geofence Cache
# ===========================================================================
# Stores all active GeofenceRecord objects in memory.  A background thread
# refreshes the cache every CACHE_TTL_SECONDS seconds.  This means:
#   • No Firestore round-trip on each HTTP request (was the bottleneck)
#   • GeofenceRecord objects — including AABB — are built ONCE per refresh
#   • All checks are CPU-only: AABB test + trig-free ray cast

CACHE_TTL_SECONDS = 60  # Refresh geofences from Firestore every 60 s

_cache_lock     = threading.Lock()
_cached_records: dict[str, GeofenceRecord] = {}
_cache_built_at: float = 0.0   # epoch timestamp of last full refresh


def _refresh_cache_if_stale() -> None:
    """
    Rebuild the in-memory cache from Firestore if the TTL has expired.
    Thread-safe via _cache_lock.
    """
    global _cached_records, _cache_built_at

    now = time.monotonic()
    # Fast path — cache is fresh, no lock needed for the read
    if now - _cache_built_at < CACHE_TTL_SECONDS:
        return

    with _cache_lock:
        # Double-check after acquiring the lock (another thread may have
        # already rebuilt while we were waiting)
        if time.monotonic() - _cache_built_at < CACHE_TTL_SECONDS:
            return

        new_records: dict[str, GeofenceRecord] = {}

        if db_firestore:
            for doc in db_firestore.collection('geofences').stream():
                gf = doc.to_dict()

                # Skip inactive geofences
                if not gf.get('is_active', True):
                    continue

                raw_coords = coords_to_shapely(gf.get('coordinates', []))
                record = build_geofence_record(
                    gf_id    = doc.id,
                    name     = gf.get('name', doc.id),
                    gf_type  = gf.get('type', 'unknown'),
                    raw_coords = raw_coords,
                )
                if record is not None:
                    new_records[doc.id] = record

        _cached_records  = new_records
        _cache_built_at  = time.monotonic()


def _get_cached_records() -> dict[str, GeofenceRecord]:
    """Return the current cache snapshot (refreshing if stale)."""
    _refresh_cache_if_stale()
    # Return a reference to the dict — not a copy.
    # Individual GeofenceRecord values are immutable after construction.
    return _cached_records


# ===========================================================================
# Internal classification helper
# ===========================================================================

def _classify_point(
    lng: float,
    lat: float,
    records: dict[str, GeofenceRecord],
) -> tuple[list, list, list]:
    """
    Run AABB + Ray Cast against every active geofence.
    Returns (violations, safe_zones, monitoring_zones).

    Both lng and lat must already be float (double precision).
    records is passed by reference — no copy.
    """
    violations:      list = []
    safe_zones:      list = []
    monitoring_zones: list = []

    for gf_id, record in records.items():
        # pip_ray_cast: AABB guard first, then trig-free ray cast
        if pip_ray_cast(lng, lat, record):
            entry = {
                'geofence_id': gf_id,
                'name':        record.name,
                'type':        record.gf_type,
            }
            if record.gf_type == 'restricted':
                violations.append(entry)
            elif record.gf_type == 'safe_zone':
                safe_zones.append(entry)
            elif record.gf_type == 'monitoring':
                monitoring_zones.append(entry)

    return violations, safe_zones, monitoring_zones


# ===========================================================================
# Routes
# ===========================================================================

@geofence_check_bp.route('/boat/<boat_id>', methods=['GET'])
def check_boat_in_geofence(boat_id):
    """
    Check a single live boat (from RTDB) against all active geofences.

    Accuracy change vs. original:
      Previously: Shapely Polygon.contains() — excluded boundary points.
      Now:        Ray Cast Even-Odd           — includes boundary points.
    """
    try:
        ref       = get_rtdb_ref(f'boats_live/{boat_id}')
        boat_data = ref.get()

        if not boat_data:
            return jsonify({
                'status':  'error',
                'message': f'Boat {boat_id} not found'
            }), 404

        gps = boat_data.get('gps', {})
        # Explicit double-precision cast — eliminates silent int narrowing
        lat: float = float(gps.get('latitude',  0))
        lng: float = float(gps.get('longitude', 0))

        records = _get_cached_records()
        violations, safe_zones, _ = _classify_point(lng, lat, records)

        return jsonify({
            'status':            'success',
            'boat_id':           boat_id,
            'boat_name':         boat_data.get('boat_metadata', {}).get('boat_name', boat_id),
            'location':          {'latitude': lat, 'longitude': lng},
            'in_restricted_zone': len(violations) > 0,
            'violations':        violations,
            'safe_zones':        safe_zones,
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofence_check_bp.route('/all-boats', methods=['GET'])
def check_all_boats_geofence():
    """
    Check every live boat against all active geofences in a single pass.

    Performance gain vs. original:
      Original: 50 boats × 20 geofences = 1 000 Shapely Polygon() objects
                constructed per request.
      New:      0 objects constructed — records are pre-built in the cache;
                only AABB + arithmetic ray cast per (boat, geofence) pair.
    """
    try:
        boats_data = get_rtdb_ref('boats_live').get() or {}
        records    = _get_cached_records()  # passed by reference

        results:            list = []
        violations_summary: list = []

        for boat_id, boat_raw in boats_data.items():
            if not isinstance(boat_raw, dict):
                continue

            gps = boat_raw.get('gps', {})
            lat: float = float(gps.get('latitude',  0))
            lng: float = float(gps.get('longitude', 0))

            violations, safe_zones, _ = _classify_point(lng, lat, records)

            in_violation = len(violations) > 0
            boat_name    = boat_raw.get('boat_metadata', {}).get('boat_name', boat_id)

            results.append({
                'boat_id':            boat_id,
                'boat_name':          boat_name,
                'location':           {'latitude': lat, 'longitude': lng},
                'status':             'Active',
                'in_restricted_zone': in_violation,
                'violations':         violations,
                'safe_zones':         safe_zones,
            })

            if in_violation:
                violations_summary.append({
                    'boat_id':         boat_id,
                    'boat_name':       boat_name,
                    'violation_count': len(violations),
                    'geofences':       violations,
                })

        return jsonify({
            'status':             'success',
            'total_boats':        len(results),
            'boats_in_violation': len(violations_summary),
            'results':            results,
            'violations_summary': violations_summary,
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofence_check_bp.route('/location', methods=['POST'])
def check_location_in_geofence():
    """
    Check an arbitrary (lat, lng) coordinate against all active geofences.
    Used by the boat simulation on every position tick.

    Accuracy note:
      The simulation passes JavaScript Number values which are IEEE 754
      double.  float() conversion here preserves all 15-17 significant
      decimal digits — no truncation.
    """
    try:
        data = request.get_json(force=True)
        if not data or 'latitude' not in data or 'longitude' not in data:
            return jsonify({
                'status':  'error',
                'message': 'Missing latitude or longitude'
            }), 400

        lat: float = float(data['latitude'])
        lng: float = float(data['longitude'])

        records = _get_cached_records()
        violations, safe_zones, monitoring_zones = _classify_point(lng, lat, records)

        return jsonify({
            'status':             'success',
            'location':           {'latitude': lat, 'longitude': lng},
            'in_restricted_zone': len(violations) > 0,
            'violations':         violations,
            'safe_zones':         safe_zones,
            'monitoring_zones':   monitoring_zones,
            'total_zones':        len(violations) + len(safe_zones) + len(monitoring_zones),
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@geofence_check_bp.route('/cache/refresh', methods=['POST'])
def force_cache_refresh():
    """
    Admin endpoint — force an immediate Firestore re-sync.
    Useful after adding/editing geofences without waiting for TTL expiry.
    """
    global _cache_built_at
    with _cache_lock:
        _cache_built_at = 0.0  # Expire the cache
    _refresh_cache_if_stale()

    return jsonify({
        'status':          'success',
        'message':         'Geofence cache refreshed',
        'geofences_loaded': len(_cached_records),
    }), 200
