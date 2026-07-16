"""OpticalMeasure V2.30 Calibration Server — entry point (port 5003).

Run: python calib.py
Compatible replacement for: python calib_server.py
"""
from src.base.router import create_calib_app
from src.base.config import init_defaults

init_defaults()

app = create_calib_app()

if __name__ == '__main__':
    print('Calibration Server on port 5003')
    app.run(host='0.0.0.0', port=5003, debug=False, threaded=True)
