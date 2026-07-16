"""Compatibility wrapper — delegates to new base+module architecture.

Old entry: python calib_server.py → port 5003
New entry: python calib.py → port 5003 (same behavior)
"""
from calib import app

if __name__ == '__main__':
    print('Calibration Server on port 5003')
    app.run(host='0.0.0.0', port=5003, debug=False, threaded=True)
