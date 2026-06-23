#!/usr/bin/env python3
"""
send_dummy_data.py

A script to send dummy/simulated boat telemetry data to Firebase Realtime Database.
This script mirrors the ESP32 (esp32_lora_firebase.ino) behavior exactly,
updating the /boats_live/<boat_id> node and pushing to /boat_history/<date>/<boat_id>.

Usage:
  python send_dummy_data.py [--loop] [--interval SECONDS] [--boat-id ID]
"""

import sys
import time
import argparse
import random
from datetime import datetime, timezone
import traceback

# Import the initialized firebase reference utility from the server application
try:
    from firebase_init import get_rtdb_ref
except ImportError:
    print("[Error] Could not import 'get_rtdb_ref' from firebase_init.")
    print("Please run this script from the 'server' directory where firebase_init.py is located.")
    sys.exit(1)

# Default boat configuration (matching the ESP32 code)
DEFAULT_BOAT_ID = "123456"
DEFAULT_BOAT_NAME = "Test Boat"
DEFAULT_BOAT_OWNER = "Test User"
DEFAULT_BOAT_TYPE = "Fishing"

# Initial coordinate near Chennai (same as test_client.py)
START_LAT = 13.0827
START_LON = 80.2707
path =[
  [
    13.639937627304244,
    74.67130838482626
  ],
  [
    13.639353516563265,
    74.67126548733418
  ],
  [
    13.639019738348217,
    74.67130838482626
  ],
  [
    13.638978016038184,
    74.67130838482626
  ],
  [
    13.638769404377335,
    74.67130838482626
  ],
  [
    13.63851907014104,
    74.67130838482626
  ],
  [
    13.63772634330866,
    74.67126548733418
  ],
  [
    13.637517730542058,
    74.67126548733418
  ],
  [
    13.637100504456036,
    74.67126548733418
  ],
  [
    13.636975336486467,
    74.67126548733418
  ],
  [
    13.636599832179796,
    74.67126548733418
  ],
  [
    13.63630777286183,
    74.67126548733418
  ],
  [
    13.636057436016108,
    74.67117969235007
  ],
  [
    13.635765376027427,
    74.67105099987391
  ],
  [
    13.635556761528683,
    74.67092230739775
  ],
  [
    13.63476402475301,
    74.67027884501697
  ],
  [
    13.634722301691133,
    74.67006435755671
  ],
  [
    13.634471963164994,
    74.66993566508054
  ],
  [
    13.634221624373561,
    74.66959248514412
  ],
  [
    13.634054731698555,
    74.66924930520769
  ],
  [
    13.63397128531683,
    74.66912061273153
  ],
  [
    13.633887838905615,
    74.66894902276334
  ],
  [
    13.633762669233533,
    74.66877743279511
  ],
  [
    13.63363749949513,
    74.66830556038252
  ],
  [
    13.633512329690406,
    74.66791948295405
  ],
  [
    13.633410370726384,
    74.66779872577423
  ],
  [
    13.633347785772136,
    74.66758423831396
  ],
  [
    13.633243477478205,
    74.66732685336166
  ],
  [
    13.633139169138246,
    74.66704801966333
  ],
  [
    13.633034860752181,
    74.66676918596495
  ],
  [
    13.632951414010188,
    74.66653324975867
  ],
  [
    13.632867967238731,
    74.66625441606033
  ],
  [
    13.632784520437783,
    74.665975582362
  ],
  [
    13.632721935317738,
    74.66567529991761
  ],
  [
    13.632659350181102,
    74.66546081245734
  ],
  [
    13.632596765027891,
    74.66513908126697
  ],
  [
    13.632575903306469,
    74.66490314506068
  ],
  [
    13.632534179858089,
    74.66475300383846
  ],
  [
    13.632450732939256,
    74.66453851637823
  ],
  [
    13.632409009468766,
    74.6644312726481
  ],
  [
    13.632409009468766,
    74.6641309902037
  ],
  [
    13.632367285990934,
    74.66393795148949
  ],
  [
    13.63226297726408,
    74.66342318158483
  ],
  [
    13.632158668491172,
    74.66316579663253
  ],
  [
    13.632054359672221,
    74.66292986042623
  ],
  [
    13.6320334979029,
    74.66265102672789
  ],
  [
    13.631970912583892,
    74.66247943675967
  ],
  [
    13.631929189028671,
    74.66232929553749
  ],
  [
    13.63186660368203,
    74.66205046183916
  ],
  [
    13.63180435270442,
    74.66187603337347
  ],
  [
    13.631658320125966,
    74.66166154591322
  ],
  [
    13.631658320125966,
    74.66166154591322
  ],
  [
    13.631597115121153,
    74.66161201666159
  ],
  [
    13.631555391499942,
    74.6616012922886
  ],
  [
    13.63140935876759,
    74.6615369460505
  ],
  [
    13.63132591145148,
    74.66152622167752
  ],
  [
    13.63123203318558,
    74.66149404855847
  ],
  [
    13.63115901673078,
    74.66148332418544
  ],
  [
    13.631075569326216,
    74.66145115106643
  ],
  [
    13.630981690960864,
    74.66141897794738
  ],
  [
    13.630908674428676,
    74.66140825357435
  ],
  [
    13.630741779413265,
    74.6613760804553
  ],
  [
    13.630647900915287,
    74.66135463170927
  ],
  [
    13.630564453330205,
    74.66135463170927
  ],
  [
    13.630522729526634,
    74.66136535608231
  ],
  [
    13.630501867622074,
    74.66136535608231
  ],
  [
    13.630471502901402,
    74.6613780642794
  ],
  [
    13.630403701690165,
    74.66139415083893
  ],
  [
    13.630361977858199,
    74.66141023739846
  ],
  [
    13.630325469499162,
    74.66142632395797
  ],
  [
    13.63027853017214,
    74.6614424105175
  ],
  [
    13.630184651490096,
    74.66148530800953
  ],
  [
    13.630122065681345,
    74.6615174811286
  ],
  [
    13.630059479856032,
    74.66156037862062
  ],
  [
    13.629965562503696,
    74.66160863383612
  ],
  [
    13.629918623105189,
    74.66163544476869
  ],
  [
    13.629819528788781,
    74.66166761788773
  ],
  [
    13.629751727390476,
    74.66169442882024
  ],
  [
    13.629715218937156,
    74.66171587756627
  ],
  [
    13.629625365875016,
    74.66179417033318
  ],
  [
    13.629594072898646,
    74.66178344596014
  ],
  [
    13.629541917928828,
    74.66179417033318
  ],
  [
    13.629479331949842,
    74.66181561907919
  ],
  [
    13.629416745954291,
    74.66185851657123
  ],
  [
    13.629322866929854,
    74.66187996531725
  ],
  [
    13.629260280892854,
    74.66192286280933
  ],
  [
    13.629155970794367,
    74.66196576030137
  ],
  [
    13.628989074540995,
    74.66205155528549
  ],
  [
    13.628843040222602,
    74.66211590152355
  ],
  [
    13.6288027372719,
    74.66213957286666
  ],
  [
    13.62873493558185,
    74.66217710817222
  ],
  [
    13.62871407351946,
    74.66218247035872
  ],
  [
    13.628630625251448,
    74.66221464347777
  ],
  [
    13.62856282351201,
    74.66223609222378
  ],
  [
    13.628521099354977,
    74.6622521787833
  ],
  [
    13.628479375190592,
    74.66227898971582
  ],
  [
    13.628369849224034,
    74.66234333595392
  ],
  [
    13.628312478459375,
    74.66237014688643
  ],
  [
    13.62823424557604,
    74.66240768219197
  ],
  [
    13.62821338346944,
    74.66241304437851
  ],
  [
    13.628171659250743,
    74.66244521749752
  ],
  [
    13.628062840506905,
    74.66250999218805
  ],
  [
    13.627927236682758,
    74.66257970061264
  ],
  [
    13.62789594348151,
    74.66259042498568
  ],
  [
    13.627775986171725,
    74.66265477122373
  ],
  [
    13.62772383080065,
    74.66269230652927
  ],
  [
    13.627645597722449,
    74.66273520402136
  ],
  [
    13.627572580159429,
    74.66279955025941
  ],
  [
    13.627489131488353,
    74.66285853431101
  ],
  [
    13.627041737520349,
    74.66310901906643
  ],
  [
    13.626457594892095,
    74.66336640401873
  ],
  [
    13.62641587036341,
    74.66340930151077
  ],
  [
    13.626129294515831,
    74.66346217837443
  ],
  [
    13.625899809198119,
    74.6635265246125
  ],
  [
    13.625691185988662,
    74.66359087085058
  ],
  [
    13.625482562595089,
    74.66361231959661
  ],
  [
    13.625253076649473,
    74.66367666583466
  ],
  [
    13.62508617764001,
    74.66371956332674
  ],
  [
    13.624919278512703,
    74.66382680705686
  ],
  [
    13.624794104089878,
    74.66391260204095
  ],
  [
    13.624606342331369,
    74.6640412945171
  ],
  [
    13.624355993088022,
    74.66412708950122
  ],
  [
    13.624189093445171,
    74.66412708950122
  ],
  [
    13.623897018786641,
    74.66421288448534
  ],
  [
    13.623542356216149,
    74.66432012821548
  ],
  [
    13.62322941821209,
    74.6644273719456
  ],
  [
    13.623125105451999,
    74.66459896191381
  ],
  [
    13.622999930079168,
    74.66459896191381
  ],
  [
    13.62270785395146,
    74.66477055188204
  ],
  [
    13.622666128760889,
    74.66477055188204
  ],
  [
    13.62245750269766,
    74.66470620564395
  ],
  [
    13.622228013815462,
    74.66459896191381
  ],
  [
    13.622123700613555,
    74.66455606442176
  ],
  [
    13.622023027174967,
    74.66453984190296
  ],
  [
    13.621981301863533,
    74.66451839315694
  ],
  [
    13.621783106533742,
    74.66442187379984
  ],
  [
    13.621689224477446,
    74.6644111494268
  ],
  [
    13.621491028902831,
    74.66437897630776
  ],
  [
    13.621268047667705,
    74.66442749691089
  ],
  [
    13.621268047667705,
    74.66455618938704
  ],
  [
    13.621226322223057,
    74.66470633060926
  ],
  [
    13.621226322223057,
    74.66500661305362
  ],
  [
    13.621226322223057,
    74.66509240803774
  ],
  [
    13.621142871311662,
    74.66513530552977
  ],
  [
    13.620829930131654,
    74.66502806179963
  ],
  [
    13.620683890772577,
    74.66479212559334
  ],
  [
    13.620579576889458,
    74.6646848818632
  ],
  [
    13.6205378513233,
    74.6646848818632
  ],
  [
    13.620496125749813,
    74.66472777935529
  ],
  [
    13.62043764451441,
    74.66489384439943
  ],
  [
    13.62043764451441,
    74.66494746626451
  ],
  [
    13.620406350321707,
    74.66500108812957
  ],
  [
    13.620333330522657,
    74.66519412684379
  ],
  [
    13.620302036316136,
    74.66524774870885
  ],
  [
    13.620291604913051,
    74.66524774870885
  ],
  [
    13.62019460300426,
    74.66525581550145
  ],
  [
    13.62017374018814,
    74.66524509112841
  ],
  [
    13.62015287737019,
    74.6652182801959
  ],
  [
    13.620121583139804,
    74.6651592961443
  ],
  [
    13.620069426079953,
    74.66508958771975
  ],
  [
    13.62000220494539,
    74.66502041709225
  ],
  [
    13.61997612640374,
    74.66495607085413
  ],
  [
    13.619950047859216,
    74.66488100024306
  ],
  [
    13.619726027665155,
    74.66488029491809
  ],
  [
    13.619726027665155,
    74.66488029491809
  ],
  [
    13.619698085980032,
    74.66504520403326
  ],
  [
    13.619698085980032,
    74.66518462088241
  ],
  [
    13.619645928826762,
    74.6653454864776
  ],
  [
    13.619593771662029,
    74.66560287142993
  ],
  [
    13.619593771662029,
    74.66560287142993
  ],
  [
    13.619548534372752,
    74.66560504270197
  ],
  [
    13.619491161467261,
    74.6655514208369
  ],
  [
    13.61946508286924,
    74.66550316115837
  ],
  [
    13.61940770994352,
    74.66542809054728
  ],
  [
    13.619376415614523,
    74.6653851930552
  ],
  [
    13.619345121281393,
    74.66530476025761
  ],
  [
    13.619319042667264,
    74.66526186276553
  ],
  [
    13.61927731687871,
    74.66520824090047
  ],
  [
    13.619230375357793,
    74.6651492568489
  ],
  [
    13.619167786648708,
    74.66511172154337
  ],
  [
    13.619094766467201,
    74.6651492568489
  ],
  [
    13.619063472096794,
    74.66518142996796
  ],
  [
    13.619047824910039,
    74.66526722495207
  ],
  [
    13.619037393451613,
    74.66532084681714
  ],
  [
    13.61900609907361,
    74.66541200398775
  ],
  [
    13.618995667613364,
    74.66547098803932
  ],
  [
    13.6189695889607,
    74.6655460586504
  ],
  [
    13.618943510305188,
    74.66562649144798
  ],
  [
    13.618917431646802,
    74.66572837299162
  ],
  [
    13.618880921520203,
    74.66577127048366
  ],
  [
    13.618860058588197,
    74.66577127048366
  ],
  [
    13.618823548452733,
    74.66573909736466
  ],
  [
    13.618776606841742,
    74.6657122864321
  ],
  [
    13.618734880957478,
    74.66564794019405
  ],
  [
    13.618646213428967,
    74.66542272836075
  ],
  [
    13.618682723591785,
    74.6655460586504
  ],
  [
    13.6186044875217,
    74.66535301993615
  ],
  [
    13.618562761607055,
    74.66526186276553
  ]
]

def generate_telemetry(boat_id, name, owner, boat_type, lat, lon):
    """
    Generates a telemetry payload that matches the structure 
    expected by the server and matching what the ESP32 pushes.
    """
    # Timestamp formatting matching C++'s UTC ISO 8601 formatting
    utc_now = datetime.now(timezone.utc)
    timestamp = utc_now.strftime("%Y-%m-%dT%H:%M:%SZ")
    
    # Generate some random, realistic-looking variations in IMU
    ax = round(random.uniform(-0.5, 0.5), 3)
    ay = round(random.uniform(-0.5, 0.5), 3)
    az = round(random.uniform(9.6, 10.0), 3) # Gravity-ish
    
    gx = round(random.uniform(-0.1, 0.1), 3)
    gy = round(random.uniform(-0.1, 0.1), 3)
    gz = round(random.uniform(-0.1, 0.1), 3)
    
    roll = round(random.uniform(-10.0, 10.0), 2)
    pitch = round(random.uniform(-10.0, 10.0), 2)
    temperature = round(random.uniform(25.0, 32.0), 1)
    
    # Generate some random speed and satellites count
    speed = round(random.uniform(5.0, 25.0), 2) # in km/h
    satellites = random.randint(6, 12)
    altitude = round(random.uniform(2.0, 15.0), 1)
    
    payload = {
        "timestamp": timestamp,
        "boat_metadata": {
            "owner": owner,
            "boat_name": name,
            "boat_id": boat_id,
            "boat_type": boat_type
        },
        "gps": {
            "latitude": float(lat),
            "longitude": float(lon),
            "altitude": float(altitude),
            "speed_kmh": float(speed),
            "satellites": int(satellites),
            "fix": True
        },
        "imu": {
            "accelerometer": {
                "x": float(ax),
                "y": float(ay),
                "z": float(az)
            },
            "gyroscope": {
                "x": float(gx),
                "y": float(gy),
                "z": float(gz)
            },
            "roll": float(roll),
            "pitch": float(pitch),
            "temperature": float(temperature)
        }
    }
    return payload, utc_now.strftime("%Y-%m-%d")

def upload_to_firebase(boat_id, payload, date_key):
    """
    Pushes data to Firebase Realtime Database matching the C++ code's paths.
    """
    live_path = f"boats_live/{boat_id}"
    history_path = f"boat_history/{date_key}/{boat_id}"
    
    # 1. Update boats_live/<boat_id> (overwrites, always latest)
    live_ref = get_rtdb_ref(live_path)
    live_ref.set(payload)
    print(f"[Firebase] boats_live/{boat_id} updated [OK]")
    
    # 2. Push to boat_history/<date>/<boat_id> (appends new entry)
    history_ref = get_rtdb_ref(history_path)
    new_entry_ref = history_ref.push(payload)
    print(f"[Firebase] boat_history/{date_key}/{boat_id} pushed (Key: {new_entry_ref.key}) [OK]")

def main():
    parser = argparse.ArgumentParser(description="Send simulated boat telemetry data to Firebase RTDB")
    parser.add_argument("--loop", action="store_true", help="Continuously send data every N seconds")
    parser.add_argument("--interval", type=float, default=1.0, help="Interval in seconds between updates (default: 1.0)")
    parser.add_argument("--boat-id", type=str, default=DEFAULT_BOAT_ID, help="Boat ID to use")
    parser.add_argument("--boat-name", type=str, default=DEFAULT_BOAT_NAME, help="Boat Name to use")
    parser.add_argument("--boat-owner", type=str, default=DEFAULT_BOAT_OWNER, help="Boat Owner to use")
    parser.add_argument("--boat-type", type=str, default=DEFAULT_BOAT_TYPE, help="Boat Type to use")
    parser.add_argument("--lat", type=float, default=START_LAT, help="Start Latitude")
    parser.add_argument("--lon", type=float, default=START_LON, help="Start Longitude")
    
    args = parser.parse_args()
    
    current_lat = args.lat
    current_lon = args.lon
    
    # If path exists and default coordinates are used, start from the first point in the path list
    if 'path' in globals() and path:
        if args.lat == START_LAT and args.lon == START_LON:
            current_lat, current_lon = path[0]
    
    print("\n=================================================")
    print("  IDP Firebase Dummy Telemetry Simulator         ")
    print("=================================================")
    print(f"Targeting Boat ID   : {args.boat_id}")
    print(f"Boat Name          : {args.boat_name}")
    print(f"Boat Owner         : {args.boat_owner}")
    print(f"Boat Type          : {args.boat_type}")
    print(f"Starting Location  : {current_lat}, {current_lon}")
    print(f"Mode                : {'Continuous loop' if args.loop else 'Single transmission'}")
    if args.loop:
        print(f"Interval            : {args.interval}s")
    print("-------------------------------------------------\n")
    
    try:
        if args.loop:
            packet_num = 1
            path_idx = 0
            while True:
                # If path exists, iterate through the path coordinates
                if 'path' in globals() and path:
                    current_lat, current_lon = path[path_idx]
                    print(f"[Packet #{packet_num}] Simulating path coords (index {path_idx + 1}/{len(path)}): {current_lat:.6f}, {current_lon:.6f}")
                    path_idx = (path_idx + 1) % len(path)
                else:
                    # Fallback to random walk
                    current_lat += random.uniform(-0.0005, 0.0005)
                    current_lon += random.uniform(-0.0005, 0.0005)
                    print(f"[Packet #{packet_num}] Simulating random walk coords: {current_lat:.6f}, {current_lon:.6f}")
                
                payload, date_key = generate_telemetry(
                    args.boat_id, args.boat_name, args.boat_owner, args.boat_type,
                    current_lat, current_lon
                )
                
                upload_to_firebase(args.boat_id, payload, date_key)
                
                packet_num += 1
                time.sleep(args.interval)
        else:
            if 'path' in globals() and path:
                current_lat, current_lon = path[0]
            payload, date_key = generate_telemetry(
                args.boat_id, args.boat_name, args.boat_owner, args.boat_type,
                current_lat, current_lon
            )
            print(f"[Single Packet] Simulating coords: {current_lat:.6f}, {current_lon:.6f}")
            upload_to_firebase(args.boat_id, payload, date_key)
            print("\nSuccessfully finished transmission.")
            
    except KeyboardInterrupt:
        print("\nExiting simulator.")
    except Exception as e:
        print(f"\n[Error] Failure during runtime: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main()
