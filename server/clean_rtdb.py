"""
clean_rtdb.py
─────────────
Deletes all data inside the Realtime Database nodes:
  • boat_history
  • boats_live

Uses the same Firebase initialisation pattern as firebase_init.py.
Run from the same directory that contains your .env / firebase-credentials.json.

Usage:
    python clean_rtdb.py                     # deletes BOTH nodes
    python clean_rtdb.py --node boat_history # deletes only boat_history
    python clean_rtdb.py --node boats_live   # deletes only boats_live
"""

import os
import sys
import argparse
import traceback

import firebase_admin
from firebase_admin import credentials, db as rtdb
from dotenv import load_dotenv

# ── 1. Load env vars ──────────────────────────────────────────────────────────
load_dotenv()

# ── 2. Initialise Firebase (mirrors firebase_init.py) ────────────────────────
def init_firebase():
    if firebase_admin._apps:
        print("[Firebase] Already initialised – reusing existing app.")
        return

    try:
        if os.path.exists('firebase-credentials.json'):
            cred = credentials.Certificate('firebase-credentials.json')
        else:
            raw_private_key = os.getenv("FIREBASE_PRIVATE_KEY", "")
            private_key = raw_private_key.replace('\\n', '\n')
            client_id = os.getenv("FIREBASE_CLIENT_ID", "").lstrip('<').strip()

            firebase_config = {
                "type": "service_account",
                "project_id": os.getenv("FIREBASE_PROJECT_ID"),
                "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
                "private_key": private_key,
                "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
                "client_id": client_id,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": os.getenv("FIREBASE_CERT_URL")
            }

            print(f"[Firebase] project_id   = {firebase_config['project_id']}")
            print(f"[Firebase] client_email = {firebase_config['client_email']}")
            print(f"[Firebase] db_url       = {os.getenv('FIREBASE_DATABASE_URL')}")

            cred = credentials.Certificate(firebase_config)

        firebase_admin.initialize_app(cred, {
            'databaseURL': os.getenv('FIREBASE_DATABASE_URL', ''),
        })
        print("[Firebase] Initialised successfully.")

    except Exception as e:
        print(f"[Firebase] Initialisation error: {e}")
        traceback.print_exc()
        sys.exit(1)


# ── 3. Delete helper ──────────────────────────────────────────────────────────
def delete_node(node_name: str):
    """
    Sets the node to None, which removes all its children from the RTDB.
    This is equivalent to clicking 'Delete' on the node in the Firebase console.
    """
    try:
        ref = rtdb.reference(node_name)
        snapshot = ref.get()

        if snapshot is None:
            print(f"[{node_name}] Already empty – nothing to delete.")
            return

        ref.set(None)          # set(None)  ≡  DELETE in Firebase RTDB
        print(f"[{node_name}] ✓ Deleted all contents successfully.")

    except Exception as e:
        print(f"[{node_name}] ✗ Error during deletion: {e}")
        traceback.print_exc()


# ── 4. Main ───────────────────────────────────────────────────────────────────
NODES = ["boat_history", "boats_live"]

def main():
    parser = argparse.ArgumentParser(
        description="Clean Firebase Realtime Database nodes."
    )
    parser.add_argument(
        "--node",
        choices=NODES,
        default=None,
        help="Name of the specific node to delete. Omit to delete both."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt."
    )
    args = parser.parse_args()

    targets = [args.node] if args.node else NODES

    # Safety confirmation
    if not args.yes:
        print("\n⚠️  WARNING: This will PERMANENTLY delete data from:")
        for t in targets:
            print(f"   • {t}")
        confirm = input("\nType 'yes' to continue, anything else to abort: ").strip().lower()
        if confirm != "yes":
            print("Aborted.")
            sys.exit(0)

    init_firebase()

    print()
    for node in targets:
        delete_node(node)

    print("\nDone.")


if __name__ == "__main__":
    main()