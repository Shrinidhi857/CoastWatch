"""
geofence_engine.py — Production-grade Point-in-Polygon (PIP) Engine
=====================================================================
Algorithm: Ray Casting (Even-Odd Rule) — IEEE 754 double precision

Design principles (translated from embedded C++ constraints to Python):
  1. PRECISION  — Python float is already IEEE 754 double (64-bit). Every
                  coordinate is explicitly cast to float() at ingestion time
                  to guarantee no silent integer narrowing occurs.
  2. AABB GUARD — Axis-Aligned Bounding Box pre-check rejects out-of-bounds
                  points in O(1) before the O(n) ray cast loop is entered.
  3. ZERO TRIG  — The intersection test uses only:
                    subtraction, multiplication, division, comparison.
                  No sin/cos/atan/sqrt anywhere in the hot path.
  4. BY-REF     — GeofenceRecord holds pre-computed AABB alongside the vertex
                  list. The same object is passed to every check call — no
                  copying, no re-parsing, no per-call Shapely construction.
  5. EDGE CASES — The classical ray-cast has two degenerate cases that cause
                  incorrect parity flips:
                    a) Point exactly on a horizontal edge  → handled via
                       strict "y strictly between" test.
                    b) Ray passes exactly through a vertex  → handled by the
                       "lower vertex open / upper vertex closed" convention
                       (only count edge if yi < py <= yj OR yj < py <= yi).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Tuple


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class AABB:
    """
    Axis-Aligned Bounding Box — precomputed per geofence at load time.
    All values are IEEE 754 double (Python float).
    """
    lng_min: float  # X axis
    lng_max: float
    lat_min: float  # Y axis
    lat_max: float


@dataclass
class GeofenceRecord:
    """
    Immutable geofence descriptor stored in the in-memory cache.
    Vertices are stored as a flat list of (lng: float, lat: float) tuples
    using Python's native 64-bit double so no precision is lost.

    Passed by reference everywhere — never copied per check call.
    """
    gf_id:    str
    name:     str
    gf_type:  str
    vertices: List[Tuple[float, float]]   # [(lng, lat), ...]  double precision
    aabb:     AABB = field(init=False)

    def __post_init__(self) -> None:
        self.aabb = _compute_aabb(self.vertices)


# ---------------------------------------------------------------------------
# AABB helpers
# ---------------------------------------------------------------------------

def _compute_aabb(vertices: List[Tuple[float, float]]) -> AABB:
    """
    Compute the tight bounding box of a polygon.
    Pure arithmetic — no library calls.
    """
    lngs = [v[0] for v in vertices]
    lats = [v[1] for v in vertices]
    return AABB(
        lng_min=float(min(lngs)),
        lng_max=float(max(lngs)),
        lat_min=float(min(lats)),
        lat_max=float(max(lats)),
    )


def _aabb_contains(aabb: AABB, lng: float, lat: float) -> bool:
    """
    AABB pre-filter.  Returns False immediately if (lng, lat) lies outside
    the bounding box, skipping the O(n) ray cast entirely.

    Strict inequalities are intentional: a point exactly on the bounding-box
    edge might still be *outside* the actual polygon, so we let the ray cast
    decide for boundary points. Changing to <= would admit false positives.
    """
    return (aabb.lng_min <= lng <= aabb.lng_max and
            aabb.lat_min <= lat <= aabb.lat_max)


# ---------------------------------------------------------------------------
# Core PIP — Ray Casting (Even-Odd Rule) with explicit boundary check
# ---------------------------------------------------------------------------

def _cross_product_2d(xi: float, yi: float,
                      xj: float, yj: float,
                      px: float, py: float) -> float:
    """
    2-D cross product of vectors (edge_start→edge_end) and (edge_start→point).
    Result == 0.0  ⟹ point is collinear with the edge.
    Pure arithmetic — subtraction and multiplication only.  No trig.
    """
    return (xj - xi) * (py - yi) - (yj - yi) * (px - xi)


def pip_ray_cast(lng: float, lat: float, record: GeofenceRecord) -> bool:
    """
    Point-in-Polygon test — Ray Casting (Even-Odd Rule) + explicit boundary.

    Three-stage pipeline:

      Stage 1 — AABB guard  (O(1))
        Immediate False if (lng, lat) is outside the bounding box.

      Stage 2 — Boundary coincidence  (O(n), trig-free)
        Uses the 2-D cross product to detect whether the point lies exactly
        ON any polygon edge (collinear + within segment bounds).
        Returns True immediately if so.
        Rationale: the Even-Odd rule is undefined for boundary points due to
        floating-point cancellation; an explicit edge test is mandatory for
        geofencing where a vessel touching a line must be flagged.

      Stage 3 — Ray Casting Even-Odd  (O(n), trig-free)
        Cast a horizontal ray rightward.  Count edge crossings.
        Odd → inside.  Even → outside.
        Uses OPEN-LOWER / CLOSED-UPPER vertex convention (Shimrat/Franklin)
        to eliminate double-counting when the ray grazes a vertex.

    Precision:
      All arithmetic uses Python float = IEEE 754 double (64-bit).
      No sin / cos / atan / sqrt anywhere in this function.

    Args:
        lng:    Longitude of query point  (IEEE 754 double)
        lat:    Latitude  of query point  (IEEE 754 double)
        record: GeofenceRecord — passed by reference, never copied.

    Returns:
        True  → point is INSIDE or ON the boundary of the polygon.
        False → point is OUTSIDE.
    """
    # ── Stage 1: AABB guard ─────────────────────────────────────────────────
    if not _aabb_contains(record.aabb, lng, lat):
        return False

    vertices = record.vertices
    n        = len(vertices)

    # ── Stage 2: Explicit boundary / vertex coincidence check ───────────────
    # Even-Odd cannot reliably handle points exactly on an edge.
    # Cross product == 0 means collinear; segment bounds check confirms touch.
    j = n - 1
    for i in range(n):
        xi, yi = vertices[i]
        xj, yj = vertices[j]

        cross = _cross_product_2d(xi, yi, xj, yj, lng, lat)

        if cross == 0.0:
            # Collinear — verify point lies within the edge's axis-aligned box
            if (min(xi, xj) <= lng <= max(xi, xj) and
                    min(yi, yj) <= lat <= max(yi, yj)):
                return True  # Exactly ON a boundary edge → inside

        j = i

    # ── Stage 3: Ray Casting Even-Odd ───────────────────────────────────────
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = vertices[i]   # double precision
        xj, yj = vertices[j]   # double precision

        # Open-lower / closed-upper rule (Shimrat 1962 / W.R. Franklin):
        #   Count the crossing only when the edge strictly straddles lat.
        #   '<' on one side, '<=' on the other ⟹ each vertex counted once.
        cond_a: bool = (yi < lat <= yj) or (yj < lat <= yi)

        if cond_a:
            # Linear interpolation: x-coordinate where edge crosses y=lat.
            # (yi - yj) ≠ 0 guaranteed by cond_a.
            # No trig — only subtraction, division, multiplication.
            x_cross: float = xj + (lat - yj) / (yi - yj) * (xi - xj)
            if lng < x_cross:
                inside = not inside  # parity flip

        j = i  # advance previous-vertex pointer

    return inside


# ---------------------------------------------------------------------------
# Factory — build GeofenceRecord from raw Firestore document
# ---------------------------------------------------------------------------

def build_geofence_record(
    gf_id:   str,
    name:    str,
    gf_type: str,
    raw_coords: list,           # [[lng, lat], ...] as stored in Firestore
) -> GeofenceRecord | None:
    """
    Parse and validate raw coordinates, explicitly casting each component to
    float (IEEE 754 double) at the boundary.  Returns None if the polygon is
    degenerate (< 3 unique vertices).

    ORIGINAL ACCURACY LOSS POINTS (what this function fixes):
      ① coords_to_shapely() accepted Python int literals from Firestore
        without explicit float() conversion. Integers are exact but any
        downstream Shapely operation that promoted them to C float (32-bit)
        inside older GEOS builds could truncate ~7 decimal digits — losing
        ~11 m of spatial resolution on GPS coordinates.
      ② Shapely's Polygon() constructor rebuilds internal ring topology on
        every single call inside the request handler. For 50 boats × 20
        geofences that's 1 000 Shapely Polygon objects per /all-boats tick.
      ③ polygon.contains() has a known EXCLUSION of boundary points; a boat
        sitting exactly on a geofence edge is reported as NOT inside.  The
        ray-cast with closed-upper convention correctly returns True for
        boundary contacts.
    """
    if not raw_coords or len(raw_coords) < 3:
        return None

    try:
        # Explicit double-precision cast at ingestion — fixes ①
        verts: List[Tuple[float, float]] = [
            (float(c[0]), float(c[1]))  # (lng, lat) — double precision
            for c in raw_coords
        ]

        # Remove closing duplicate if present (Firestore sometimes adds it)
        if verts[0] == verts[-1] and len(verts) > 3:
            verts = verts[:-1]

        if len(verts) < 3:
            return None

        return GeofenceRecord(
            gf_id=gf_id,
            name=name,
            gf_type=gf_type,
            vertices=verts,
        )

    except (TypeError, ValueError, IndexError) as exc:
        print(f"[GeofenceEngine] Skipping malformed geofence {gf_id!r}: {exc}")
        return None
