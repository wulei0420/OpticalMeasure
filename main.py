"""OpticalMeasure V2.30 Main Server — entry point (port 5002).

Run: python main.py
Compatible replacement for: python v2_backend.py
"""
from src.base.router import create_main_app
from src.base.config import get_calib_params, init_defaults

init_defaults()

calib = get_calib_params()
if calib:
    bl_lc = float(sum(abs(x) for x in calib['stereo'][0]['T']))
    bl_cr = float(sum(abs(x) for x in calib['stereo'][1]['T']))
    print(f'V2 Backend v6 L-C={bl_lc:.1f}mm C-R={bl_cr:.1f}mm')

app = create_main_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=False, threaded=False)
