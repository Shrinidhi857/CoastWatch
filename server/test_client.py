"""
Test client for Samudra Boat Tracking API
Run: python test_client.py
"""
import requests
import json
from datetime import datetime

BASE_URL = 'http://localhost:5000/api'

class BoatTrackingClient:
    def __init__(self, base_url=BASE_URL):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
    
    # ==================== BOAT OPERATIONS ====================
    
    def get_all_boats(self):
        """Get all boats"""
        response = self.session.get(f'{self.base_url}/boats')
        return response.json()
    
    def get_boat(self, boat_id):
        """Get a specific boat"""
        response = self.session.get(f'{self.base_url}/boats/{boat_id}')
        return response.json()
    
    def create_boat(self, name, latitude, longitude, status='Active', 
                   speed=0, heading=0, vessel_type='General', crew_count=0, destination=''):
        """Create a new boat"""
        data = {
            'name': name,
            'latitude': latitude,
            'longitude': longitude,
            'status': status,
            'speed': speed,
            'heading': heading,
            'vessel_type': vessel_type,
            'crew_count': crew_count,
            'destination': destination
        }
        response = self.session.post(f'{self.base_url}/boats', json=data)
        return response.json()
    
    def update_boat(self, boat_id, **kwargs):
        """Update a boat"""
        response = self.session.put(f'{self.base_url}/boats/{boat_id}', json=kwargs)
        return response.json()
    
    def update_boat_location(self, boat_id, latitude, longitude, speed=None, heading=None):
        """Update only boat location"""
        data = {
            'latitude': latitude,
            'longitude': longitude
        }
        if speed is not None:
            data['speed'] = speed
        if heading is not None:
            data['heading'] = heading
        
        response = self.session.put(f'{self.base_url}/boats/{boat_id}/location', json=data)
        return response.json()
    
    def delete_boat(self, boat_id):
        """Delete a boat"""
        response = self.session.delete(f'{self.base_url}/boats/{boat_id}')
        return response.json()
    
    # ==================== GEOFENCE OPERATIONS ====================
    
    def get_all_geofences(self):
        """Get all geofences"""
        response = self.session.get(f'{self.base_url}/geofences')
        return response.json()
    
    def get_geofence(self, geofence_id):
        """Get a specific geofence"""
        response = self.session.get(f'{self.base_url}/geofences/{geofence_id}')
        return response.json()
    
    def create_geofence(self, name, coordinates, description='', 
                       geofence_type='restricted', is_active=True, metadata=None):
        """Create a new geofence"""
        data = {
            'name': name,
            'coordinates': coordinates,
            'description': description,
            'type': geofence_type,
            'is_active': is_active,
            'metadata': metadata or {}
        }
        response = self.session.post(f'{self.base_url}/geofences', json=data)
        return response.json()
    
    def create_multiple_geofences(self, geofences_list):
        """Create multiple geofences"""
        data = {'geofences': geofences_list}
        response = self.session.post(f'{self.base_url}/geofences/batch/create', json=data)
        return response.json()
    
    def update_geofence(self, geofence_id, **kwargs):
        """Update a geofence"""
        response = self.session.put(f'{self.base_url}/geofences/{geofence_id}', json=kwargs)
        return response.json()
    
    def delete_geofence(self, geofence_id):
        """Delete a geofence"""
        response = self.session.delete(f'{self.base_url}/geofences/{geofence_id}')
        return response.json()
    
    # ==================== GEOFENCE CHECKING ====================
    
    def check_boat_in_geofence(self, boat_id):
        """Check if a boat is in any geofence"""
        response = self.session.get(f'{self.base_url}/geofence-check/boat/{boat_id}')
        return response.json()
    
    def check_all_boats_geofence(self):
        """Check all boats against geofences"""
        response = self.session.get(f'{self.base_url}/geofence-check/all-boats')
        return response.json()
    
    def check_location_in_geofence(self, latitude, longitude):
        """Check if a location is in any geofence"""
        data = {'latitude': latitude, 'longitude': longitude}
        response = self.session.post(f'{self.base_url}/geofence-check/location', json=data)
        return response.json()
    
    # ==================== ALERTS ====================
    
    def get_all_alerts(self):
        """Get all alerts"""
        response = self.session.get(f'{self.base_url}/alerts')
        return response.json()
    
    def get_boat_alerts(self, boat_id):
        """Get alerts for a specific boat"""
        response = self.session.get(f'{self.base_url}/alerts/{boat_id}')
        return response.json()
    
    # ==================== SYSTEM INFO ====================
    
    def health_check(self):
        """Health check"""
        response = self.session.get(f'{self.base_url}/health')
        return response.json()
    
    def get_statistics(self):
        """Get system statistics"""
        response = self.session.get(f'{self.base_url}/stats')
        return response.json()


def print_response(title, response):
    """Pretty print response"""
    print(f"\n{'='*60}")
    print(f"{title}")
    print(f"{'='*60}")
    print(json.dumps(response, indent=2))


def run_demo():
    """Run demonstration of API"""
    client = BoatTrackingClient()
    
    # Health check
    print_response("Health Check", client.health_check())
    
    # Create boats
    print("\n\nCreating boats...")
    boat1_response = client.create_boat(
        name='MV Samudra-1',
        latitude=13.0827,
        longitude=80.2707,
        status='Active',
        speed=12.5,
        heading=45,
        vessel_type='Container Ship',
        crew_count=20,
        destination='Port of Singapore'
    )
    print_response("Created Boat 1", boat1_response)
    boat1_id = boat1_response['data']['name'] if 'boat_id' not in boat1_response else boat1_response['boat_id']
    
    boat2_response = client.create_boat(
        name='MV Samudra-2',
        latitude=13.145,
        longitude=80.2835,
        status='Active',
        speed=10.2,
        heading=120,
        vessel_type='Tanker',
        crew_count=15,
        destination='Port of Chennai'
    )
    print_response("Created Boat 2", boat2_response)
    
    # Get all boats
    print_response("All Boats", client.get_all_boats())
    
    # Create geofences
    print("\n\nCreating geofences...")
    restricted_zone = {
        'name': 'Naval Restricted Zone',
        'description': 'Naval Exercise Area',
        'coordinates': [
            [80.2700, 13.0800],
            [80.2850, 13.0800],
            [80.2850, 13.0950],
            [80.2700, 13.0950]
        ],
        'type': 'restricted',
        'is_active': True,
        'metadata': {'authority': 'Ministry of Defence'}
    }
    
    safe_zone = {
        'name': 'Safe Harbor Zone',
        'description': 'Protected anchorage area',
        'coordinates': [
            [80.2500, 13.0600],
            [80.2650, 13.0600],
            [80.2650, 13.0750],
            [80.2500, 13.0750]
        ],
        'type': 'safe_zone',
        'is_active': True
    }
    
    response1 = client.create_geofence(**restricted_zone)
    print_response("Created Restricted Zone", response1)
    
    response2 = client.create_geofence(**safe_zone)
    print_response("Created Safe Zone", response2)
    
    # Get all geofences
    print_response("All Geofences", client.get_all_geofences())
    
    # Check boat location against geofences
    print("\n\nChecking boats against geofences...")
    print_response("Check All Boats", client.check_all_boats_geofence())
    
    # Check specific location
    print_response("Check Location (13.0827, 80.2707)", 
                   client.check_location_in_geofence(13.0827, 80.2707))
    
    # Get alerts
    print_response("All Alerts", client.get_all_alerts())
    
    # Get statistics
    print_response("Statistics", client.get_statistics())


if __name__ == '__main__':
    try:
        run_demo()
    except requests.exceptions.ConnectionError:
        print("Error: Cannot connect to server. Make sure the server is running on http://localhost:5000")
    except Exception as e:
        print(f"Error: {e}")
