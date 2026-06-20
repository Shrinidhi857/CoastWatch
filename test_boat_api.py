#!/usr/bin/env python3
"""
Boat Tracking API Test Script
Tests the boat marker and geofencing API endpoints
"""

import requests
import json
from datetime import datetime

# Configuration
API_BASE_URL = "http://localhost:5000/api"
BOATS_ENDPOINT = f"{API_BASE_URL}/boats"

def print_header(text):
    print(f"\n{'='*60}")
    print(f"  {text}")
    print(f"{'='*60}\n")

def print_response(response, title="Response"):
    print(f"Status Code: {response.status_code}")
    try:
        data = response.json()
        print(json.dumps(data, indent=2))
    except:
        print(response.text)

def test_get_all_boats():
    """Test: Get all boats"""
    print_header("TEST 1: Get All Boats")
    response = requests.get(BOATS_ENDPOINT)
    print_response(response)
    return response.json().get('data', [])

def test_create_boat(name, lat, lng, vessel_type="General"):
    """Test: Create a new boat"""
    print_header(f"TEST 2: Create New Boat - {name}")
    
    boat_data = {
        "name": name,
        "latitude": lat,
        "longitude": lng,
        "status": "Active",
        "speed": 10.5,
        "heading": 45.0,
        "vessel_type": vessel_type,
        "crew_count": 5,
        "destination": "Harbor A"
    }
    
    print("Request Payload:")
    print(json.dumps(boat_data, indent=2))
    print()
    
    response = requests.post(BOATS_ENDPOINT, json=boat_data)
    print_response(response)
    
    if response.status_code == 201:
        boat_id = response.json().get('data', {}).get('id')
        return boat_id
    return None

def test_get_boat(boat_id):
    """Test: Get specific boat"""
    print_header(f"TEST 3: Get Specific Boat - {boat_id}")
    
    response = requests.get(f"{BOATS_ENDPOINT}/{boat_id}")
    print_response(response)
    return response.json().get('data')

def test_update_boat(boat_id, updates):
    """Test: Update boat"""
    print_header(f"TEST 4: Update Boat - {boat_id}")
    
    print("Update Payload:")
    print(json.dumps(updates, indent=2))
    print()
    
    response = requests.put(f"{BOATS_ENDPOINT}/{boat_id}", json=updates)
    print_response(response)

def test_update_boat_location(boat_id, lat, lng, speed=None, heading=None):
    """Test: Update boat location only"""
    print_header(f"TEST 5: Update Boat Location - {boat_id}")
    
    location_data = {
        "latitude": lat,
        "longitude": lng
    }
    
    if speed is not None:
        location_data["speed"] = speed
    if heading is not None:
        location_data["heading"] = heading
    
    print("Location Update Payload:")
    print(json.dumps(location_data, indent=2))
    print()
    
    response = requests.put(f"{BOATS_ENDPOINT}/{boat_id}/location", json=location_data)
    print_response(response)

def test_delete_boat(boat_id):
    """Test: Delete boat"""
    print_header(f"TEST 6: Delete Boat - {boat_id}")
    
    response = requests.delete(f"{BOATS_ENDPOINT}/{boat_id}")
    print_response(response)

def run_comprehensive_test():
    """Run complete test suite"""
    print_header("BOAT TRACKING API TEST SUITE")
    print("This script tests all boat API endpoints\n")
    
    try:
        # Test 1: Get all boats
        print("\n[1/7] Fetching all boats...")
        boats = test_get_all_boats()
        
        # Test 2: Create multiple test boats
        print("\n[2/7] Creating test boats...")
        boat_ids = []
        
        test_boats = [
            ("Fishing Vessel Alpha", 8.7400, 77.7400, "Fishing"),
            ("Cargo Ship Beta", 8.7450, 77.7450, "Cargo"),
            ("Patrol Boat Gamma", 8.7300, 77.7300, "Patrol"),
        ]
        
        for name, lat, lng, vessel_type in test_boats:
            boat_id = test_create_boat(name, lat, lng, vessel_type)
            if boat_id:
                boat_ids.append(boat_id)
        
        if not boat_ids:
            print("\n❌ Failed to create any boats. Exiting.")
            return
        
        # Test 3: Get specific boat
        print(f"\n[3/7] Fetching specific boat {boat_ids[0]}...")
        test_get_boat(boat_ids[0])
        
        # Test 4: Update boat details
        print(f"\n[4/7] Updating boat {boat_ids[0]}...")
        test_update_boat(boat_ids[0], {
            "speed": 15.5,
            "heading": 90.0,
            "destination": "Harbor B"
        })
        
        # Test 5: Update boat location
        print(f"\n[5/7] Updating boat location {boat_ids[0]}...")
        test_update_boat_location(boat_ids[0], 8.7500, 77.7500, speed=12.0, heading=135.0)
        
        # Test 6: Get all boats after updates
        print("\n[6/7] Fetching all boats after updates...")
        test_get_all_boats()
        
        # Test 7: Delete test boats
        print("\n[7/7] Deleting test boats...")
        for i, boat_id in enumerate(boat_ids):
            print(f"\nDeleting boat {i+1}/{len(boat_ids)}: {boat_id}")
            test_delete_boat(boat_id)
        
        print_header("TEST SUITE COMPLETED SUCCESSFULLY ✓")
        
    except Exception as e:
        print(f"\n❌ Error during testing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    import sys
    
    print("Boat Tracking API Test Script")
    print(f"API Base URL: {API_BASE_URL}")
    print(f"Timestamp: {datetime.now().isoformat()}\n")
    
    if len(sys.argv) > 1 and sys.argv[1] == "--quick":
        print("Running quick test (get all boats)...")
        test_get_all_boats()
    else:
        run_comprehensive_test()
