"""
Utility functions for geofencing operations
"""
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union
from math import radians, cos, sin, asin, sqrt

class GeofenceUtils:
    """Utility class for geofencing calculations and operations"""
    
    @staticmethod
    def haversine_distance(lat1, lon1, lat2, lon2):
        """
        Calculate the great circle distance between two points 
        on the earth (specified in decimal degrees)
        Returns distance in kilometers
        """
        # convert decimal degrees to radians
        lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
        
        # haversine formula
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))
        r = 6371  # Radius of earth in kilometers
        return c * r
    
    @staticmethod
    def is_point_in_polygon(point_lat, point_lng, polygon_coords):
        """
        Check if a point is inside a polygon
        
        Args:
            point_lat: Latitude of the point
            point_lng: Longitude of the point
            polygon_coords: List of [lng, lat] coordinates forming a polygon
            
        Returns:
            Boolean indicating if point is inside polygon
        """
        try:
            point = Point(point_lng, point_lat)
            polygon_points = [(coord[0], coord[1]) for coord in polygon_coords]
            
            if len(polygon_points) < 3:
                return False
            
            polygon = Polygon(polygon_points)
            return point.within(polygon) or polygon.contains(point)
        except Exception as e:
            print(f"Error checking point in polygon: {e}")
            return False
    
    @staticmethod
    def is_point_near_polygon(point_lat, point_lng, polygon_coords, distance_km=1.0):
        """
        Check if a point is within a certain distance of a polygon
        
        Args:
            point_lat: Latitude of the point
            point_lng: Longitude of the point
            polygon_coords: List of [lng, lat] coordinates forming a polygon
            distance_km: Distance in kilometers (default 1.0)
            
        Returns:
            Boolean indicating if point is within distance_km of polygon
        """
        try:
            point = Point(point_lng, point_lat)
            polygon_points = [(coord[0], coord[1]) for coord in polygon_coords]
            
            if len(polygon_points) < 3:
                return False
            
            polygon = Polygon(polygon_points)
            # Check distance in decimal degrees (approximate)
            # 1 degree ≈ 111 km at equator
            buffer_degrees = distance_km / 111.0
            buffered_polygon = polygon.buffer(buffer_degrees)
            
            return point.within(buffered_polygon)
        except Exception as e:
            print(f"Error checking point near polygon: {e}")
            return False
    
    @staticmethod
    def is_line_intersecting_polygon(start_lat, start_lng, end_lat, end_lng, polygon_coords):
        """
        Check if a line (path) intersects with a polygon
        
        Args:
            start_lat, start_lng: Starting point coordinates
            end_lat, end_lng: Ending point coordinates
            polygon_coords: List of [lng, lat] coordinates forming a polygon
            
        Returns:
            Boolean indicating if line intersects polygon
        """
        try:
            line = LineString([(start_lng, start_lat), (end_lng, end_lat)])
            polygon_points = [(coord[0], coord[1]) for coord in polygon_coords]
            
            if len(polygon_points) < 3:
                return False
            
            polygon = Polygon(polygon_points)
            return line.intersects(polygon)
        except Exception as e:
            print(f"Error checking line intersection: {e}")
            return False
    
    @staticmethod
    def get_polygon_centroid(polygon_coords):
        """
        Get the centroid (center) of a polygon
        
        Args:
            polygon_coords: List of [lng, lat] coordinates
            
        Returns:
            Tuple of (latitude, longitude) of centroid
        """
        try:
            polygon_points = [(coord[0], coord[1]) for coord in polygon_coords]
            
            if len(polygon_points) < 3:
                return None
            
            polygon = Polygon(polygon_points)
            centroid = polygon.centroid
            return (centroid.y, centroid.x)  # Return as (lat, lng)
        except Exception as e:
            print(f"Error calculating centroid: {e}")
            return None
    
    @staticmethod
    def calculate_polygon_area(polygon_coords):
        """
        Calculate the area of a polygon in square kilometers
        
        Args:
            polygon_coords: List of [lng, lat] coordinates
            
        Returns:
            Area in square kilometers
        """
        try:
            polygon_points = [(coord[0], coord[1]) for coord in polygon_coords]
            
            if len(polygon_points) < 3:
                return 0
            
            polygon = Polygon(polygon_points)
            # Area is in square degrees, convert to approximate square kilometers
            # At equator: 1 degree ≈ 111 km
            area_sq_degrees = polygon.area
            area_sq_km = area_sq_degrees * (111.32 ** 2)
            return area_sq_km
        except Exception as e:
            print(f"Error calculating area: {e}")
            return 0
    
    @staticmethod
    def create_circle_polygon(center_lat, center_lng, radius_km, num_points=32):
        """
        Create a circular polygon around a center point
        
        Args:
            center_lat: Center latitude
            center_lng: Center longitude
            radius_km: Radius in kilometers
            num_points: Number of points to create circle (default 32)
            
        Returns:
            List of [lng, lat] coordinates forming a circle
        """
        import math
        
        # Convert radius to degrees (approximate, varies by latitude)
        radius_degrees = radius_km / 111.0
        
        coords = []
        for i in range(num_points):
            angle = 2 * math.pi * i / num_points
            lat = center_lat + radius_degrees * math.sin(angle)
            lng = center_lng + radius_degrees * math.cos(angle)
            coords.append([lng, lat])
        
        # Close the polygon
        coords.append(coords[0])
        
        return coords
    
    @staticmethod
    def simplify_polygon(polygon_coords, tolerance=0.0001):
        """
        Simplify a polygon by reducing the number of points while maintaining shape
        
        Args:
            polygon_coords: List of [lng, lat] coordinates
            tolerance: Simplification tolerance in degrees
            
        Returns:
            Simplified list of [lng, lat] coordinates
        """
        try:
            polygon_points = [(coord[0], coord[1]) for coord in polygon_coords]
            
            if len(polygon_points) < 3:
                return polygon_coords
            
            polygon = Polygon(polygon_points)
            simplified = polygon.simplify(tolerance)
            
            coords = []
            for x, y in simplified.exterior.coords[:-1]:  # Exclude closing point
                coords.append([x, y])
            
            return coords
        except Exception as e:
            print(f"Error simplifying polygon: {e}")
            return polygon_coords
    
    @staticmethod
    def merge_geofences(geofence_list):
        """
        Merge multiple geofences into a single union polygon
        
        Args:
            geofence_list: List of geofence coordinate lists
            
        Returns:
            Merged geometry (can be Polygon or MultiPolygon)
        """
        try:
            polygons = []
            for coords in geofence_list:
                polygon_points = [(coord[0], coord[1]) for coord in coords]
                if len(polygon_points) >= 3:
                    polygons.append(Polygon(polygon_points))
            
            if not polygons:
                return None
            
            merged = unary_union(polygons)
            return merged
        except Exception as e:
            print(f"Error merging geofences: {e}")
            return None
    
    @staticmethod
    def validate_polygon_coordinates(coords):
        """
        Validate if coordinates form a valid polygon
        
        Args:
            coords: List of [lng, lat] coordinates
            
        Returns:
            Tuple (is_valid, error_message)
        """
        if not isinstance(coords, list) or len(coords) < 3:
            return False, "Polygon must have at least 3 points"
        
        try:
            polygon_points = [(coord[0], coord[1]) for coord in coords]
            polygon = Polygon(polygon_points)
            
            if not polygon.is_valid:
                return False, "Invalid polygon geometry"
            
            if polygon.area == 0:
                return False, "Polygon has zero area"
            
            return True, "Valid polygon"
        except Exception as e:
            return False, f"Validation error: {str(e)}"

# Create a global instance
geofence_utils = GeofenceUtils()
