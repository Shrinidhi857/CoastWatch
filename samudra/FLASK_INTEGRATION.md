# Samudra React Frontend - Configuration Guide

## Environment Variables

Create a `.env` file in the samudra directory with the following:

```
REACT_APP_API_URL=http://localhost:5000/api
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd c:\code-2026\idp\samudra-2\samudra
npm install
```

### 2. Configure API URL

```bash
cp .env.example .env
# Edit .env if your server is running on a different address
```

### 3. Start Development Server

```bash
npm start
```

The app will open at `http://localhost:3000`

## Integration with Flask Server

The React app is now fully integrated with the Flask server:

### Features Connected to Server

- ✅ **Boat Management**
  - Fetches boats from Flask server
  - Displays boats on the map
  - Can delete boats (syncs to server)
  - Real-time updates every 5 seconds

- ✅ **Geofence Management**
  - Fetches geofences from Flask server
  - Displays geofences on the map
  - Create new geofences (saved to server)
  - Delete geofences (removes from server)
  - Shows geofence type with appropriate colors

- ✅ **Real-time Alerts**
  - Fetches violation alerts from server
  - Shows boats in restricted zones
  - Updates every 3 seconds
  - Displays alert severity

- ✅ **Server Health Checking**
  - Checks server connectivity on startup
  - Shows connection status in UI
  - Graceful error handling

- ✅ **Automatic Data Refresh**
  - Boats update every 5 seconds
  - Alerts update every 3 seconds
  - Geofences update on creation/deletion

## Files Modified

### New Files Created

1. **src/services/apiService.js** (300+ lines)
   - All API calls to Flask server
   - Organized by feature (boats, geofences, alerts, system)
   - Error handling

2. **src/config/config.js**
   - Application configuration
   - API endpoints, map settings, geofence types
   - Colors and refresh intervals

3. **src/utils/helpers.js**
   - Data formatting utilities
   - Coordinate conversion
   - Geometry utilities

4. **.env.example**
   - Environment variable template

### Modified Files

1. **src/VesselMap.js** (Complete refactor)
   - Removed hardcoded vessel data
   - Integrated API service for all data
   - Added loading and error states
   - Server connection status display
   - Real-time data polling

## Data Flow

```
Flask Server (http://localhost:5000/api)
      ↓
API Service (src/services/apiService.js)
      ↓
VesselMap Component
      ↓
UI (Map, Alerts, Sidebar)
```

## API Service Structure

### Boats API

```javascript
boatsAPI.getAll(); // Get all boats
boatsAPI.getById(boatId); // Get specific boat
boatsAPI.create(boatData); // Create new boat
boatsAPI.update(boatId, data); // Update boat
boatsAPI.updateLocation(boatId, location); // Update location
boatsAPI.delete(boatId); // Delete boat
```

### Geofences API

```javascript
geofencesAPI.getAll(); // Get all geofences
geofencesAPI.getById(geofenceId); // Get specific geofence
geofencesAPI.create(geofenceData); // Create new geofence
geofencesAPI.createMultiple(geofences); // Create multiple
geofencesAPI.update(geofenceId, data); // Update geofence
geofencesAPI.delete(geofenceId); // Delete geofence
```

### Geofence Check API

```javascript
geofenceCheckAPI.checkBoat(boatId); // Check single boat
geofenceCheckAPI.checkAllBoats(); // Check all boats
geofenceCheckAPI.checkLocation(lat, lng); // Check location
```

### Alerts API

```javascript
alertsAPI.getAll(); // Get all alerts
alertsAPI.getByBoatId(boatId); // Get boat alerts
```

### System API

```javascript
systemAPI.health(); // Server health check
systemAPI.getStats(); // System statistics
```

## Usage Examples

### Create a Boat via Server

1. Open the Flask server and create a boat:

```bash
curl -X POST http://localhost:5000/api/boats \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Boat",
    "latitude": 13.0827,
    "longitude": 80.2707,
    "status": "Active"
  }'
```

2. The React app will fetch and display it automatically (5-second refresh)

### Create a Geofence via UI

1. Click "Add Geofence" button
2. Click on the map to add points (minimum 3)
3. Click "Complete Geofence"
4. The geofence is saved to the server
5. All users see it immediately

### Monitor Violations

- Boats in restricted zones appear with red icon
- Alerts section shows all violations
- Severity indicates how critical the alert is

## Troubleshooting

### Server Connection Error

- Make sure Flask server is running: `python app.py`
- Check server is on `http://localhost:5000`
- Verify `.env` has correct `REACT_APP_API_URL`

### Boats Not Showing

- Check Flask server is running
- Verify boats exist in Firestore
- Check browser console for errors
- Try refreshing the page

### Geofence Creation Failed

- Ensure at least 3 points are added
- Check Flask server is running
- Check browser console for error details

### Real-time Updates Not Working

- Check network tab in browser dev tools
- Verify API responses are coming through
- Check if polling intervals are set correctly

## Performance Tips

1. **Reduce Polling Frequency**
   - Edit REFRESH_INTERVALS in `src/config/config.js`
   - Longer intervals = less server load, slower updates

2. **Optimize Boat Count**
   - The app works best with < 100 boats
   - For more boats, consider pagination

3. **Geofence Optimization**
   - Simplify geofence polygons
   - Fewer points = faster checking

## Development

### Add New API Endpoint

1. Add method to appropriate API object in `src/services/apiService.js`
2. Use consistent error handling
3. Return data in expected format
4. Test with cURL first

### Add New Feature

1. Create new component if needed
2. Import API services
3. Use try-catch for error handling
4. Show loading/error states

## Building for Production

```bash
npm run build
```

This creates an optimized production build in the `build` folder.

## Next Steps

1. ✅ Frontend is now connected to Flask server
2. Test creating/updating boats via server
3. Test geofence management
4. Deploy both frontend and server
5. Configure production URLs

---

**Status:** ✅ Server Integration Complete

The React app is now fully integrated with the Flask server!
