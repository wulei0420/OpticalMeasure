"""OpticalMeasure V2.20 — Calibration verification script.
Run after calibration to verify accuracy: python verify_calib.py
"""
import cv2, numpy as np, json, glob, os, sys

# Allow running from project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from camera_utils import load_calib, path

calib = load_calib()
if not calib:
    print('ERROR: calib_params.json not found. Run calibration first.')
    sys.exit(1)

K = [np.array(c['K'], np.float64) for c in calib['cameras']]
R_cr = np.array(calib['stereo'][1]['R'])
T_cr = np.array(calib['stereo'][1]['T']).reshape(3, 1)
BL = float(np.linalg.norm(T_cr))
FX = K[1][0, 0]
P_center = K[1] @ np.hstack([np.eye(3), np.zeros((3, 1))])
P_right  = K[2] @ np.hstack([R_cr, T_cr])

frame_dir = path('calib_frames')
files = sorted(glob.glob(os.path.join(frame_dir, '*.png')))
if not files:
    print('ERROR: No calibration frames in calib_frames/')
    sys.exit(1)

groups = {}
for f in files:
    name = os.path.basename(f)
    parts = name.split('_', 1)
    if len(parts) < 2: continue
    side, ts = parts[0], parts[1]
    if side in ('left', 'center', 'right'):
        groups.setdefault(ts, {})[side] = f

if not groups:
    print('ERROR: No frame groups found')
    sys.exit(1)

print(f'Verifying {len(groups)} frame groups using CR pair...')
print(f'  FX={FX:.1f}  BL={BL:.1f}mm\n')

# Test 160mm (16 gaps) and 50mm (5 gaps)
tests = [(0, 16, 160.0, '160mm horz'), (0, 5, 50.0, '50mm horz')]
passed = 0
failed = 0

for idx1, idx2, expected, desc in tests:
    dists = []
    for ts in sorted(groups.keys()):
        g = groups[ts]
        if 'center' not in g or 'right' not in g: continue
        c_img = cv2.imread(g['center'])
        r_img = cv2.imread(g['right'])
        if c_img is None or r_img is None: continue

        gc = cv2.cvtColor(c_img, cv2.COLOR_BGR2GRAY)
        gr = cv2.cvtColor(r_img, cv2.COLOR_BGR2GRAY)
        rc, cc = cv2.findChessboardCorners(gc, (17, 17))
        rr, cr = cv2.findChessboardCorners(gr, (17, 17))
        if not (rc and rr): continue

        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
        cv2.cornerSubPix(gc, cc, (11, 11), (-1, -1), criteria)
        cv2.cornerSubPix(gr, cr, (11, 11), (-1, -1), criteria)

        dx_c = cc[16, 0, 0] - cc[0, 0, 0]
        dx_r = cr[16, 0, 0] - cr[0, 0, 0]
        if dx_c < 0 or dx_r < 0: continue

        p1c = cc[idx1, 0].reshape(2, 1).astype(np.float64)
        p1r = cr[idx1, 0].reshape(2, 1).astype(np.float64)
        p2c = cc[idx2, 0].reshape(2, 1).astype(np.float64)
        p2r = cr[idx2, 0].reshape(2, 1).astype(np.float64)

        t1 = cv2.triangulatePoints(P_center.astype(np.float64), P_right.astype(np.float64), p1c, p1r)
        t1 = t1[:3, 0] / t1[3]
        t2 = cv2.triangulatePoints(P_center.astype(np.float64), P_right.astype(np.float64), p2c, p2r)
        t2 = t2[:3, 0] / t2[3]
        dists.append(float(np.linalg.norm(t1 - t2)))

    if dists:
        d = np.array(dists)
        err = d - expected
        valid = np.abs(err - err.mean()) < 3 * err.std()
        d_in = d[valid]
        e_in = err[valid]
        pct = e_in.mean() / expected * 100
        status = 'PASS' if abs(pct) < 2.0 else 'FAIL'
        print(f'  {desc:15s}  {len(d_in):2d}/{len(d)} valid  err={e_in.mean():+.3f}mm ({pct:+.2f}%)  [{status}]')
        if status == 'FAIL':
            failed += 1
        else:
            passed += 1

print(f'\nResult: {passed} pass, {failed} fail')
if failed > 0:
    print('WARNING: calibration may need re-run')
    sys.exit(1)
else:
    print('Calibration verified OK')
