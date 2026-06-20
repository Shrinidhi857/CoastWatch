import os
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize Firebase (runs the initialization code)
import firebase_init

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Import blueprints from segregated route files
from routes.boats import boats_bp
from routes.geofences import geofences_bp
from routes.geofence_check import geofence_check_bp
from routes.alerts import alerts_bp
from routes.system import system_bp

# Register Blueprints
app.register_blueprint(boats_bp)
app.register_blueprint(geofences_bp)
app.register_blueprint(geofence_check_bp)
app.register_blueprint(alerts_bp)
app.register_blueprint(system_bp)


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('DEBUG', 'True') == 'True'
    )