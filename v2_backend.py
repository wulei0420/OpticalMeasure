"""Compatibility wrapper — delegates to new base+module architecture.

Old entry: python v2_backend.py → port 5002
New entry: python main.py → port 5002 (same behavior)
"""
from main import app

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=False, threaded=False)
