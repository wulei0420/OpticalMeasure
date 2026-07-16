"""
Chessboard calibration analysis — uses chessboard corners as ground truth
to verify NCC matching accuracy.
"""
import cv2
import numpy as np
import json
import os
import glob
from datetime import datetime

import matching

with open('calib_params.json') as f:
    calib = json.load(f)
K = [np.array(c['K'], np.float64) for c in calib['cameras']]
BL_LC = float(np.linalg.norm(np.array(calib['stereo'][0]['T'])))
BL_CR = float(np.linalg.norm(np.array(calib['stereo'][1]['T'])))
FX = float((K[0][0, 0] + K[1][0, 0] + K[2][0, 0]) / 3)

SQUARE_MM = 19.614
PATTERN = (9, 6)


def read_img(filepath):
    with open(filepath, 'rb') as f:
        return cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)


def get_corners(img, pat):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ret, corners = cv2.findChessboardCorners(gray, pat, None)
    if not ret:
        return None
    cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1),
                     (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001))
    return corners.reshape(-1, 2)


d = 'calib_frames'
files = sorted(glob.glob(os.path.join(d, 'left_*.png')))
if not files:
    files = sorted(glob.glob(os.path.join(d, '*.png')))

print(f'Found {len(files)} calibration frames')
if not files:
    print('No frames. Run calibration capture first.')
    exit(1)

g = len(files) // 2
base_left = files[g]
base_name = os.path.basename(base_left)
ts = '_'.join(base_name.split('_')[1:])
imgL = read_img(os.path.join(d, f'left_{ts}'))
imgC = read_img(os.path.join(d, f'center_{ts}'))
imgR = read_img(os.path.join(d, f'right_{ts}'))

h, w = imgC.shape[:2]
print(f'Using frame: {ts}, size: {w}x{h}')

cornersL = get_corners(imgL, PATTERN)
cornersC = get_corners(imgC, PATTERN)
cornersR = get_corners(imgR, PATTERN)

if cornersL is None or cornersC is None or cornersR is None:
    print('Chessboard not detected in all frames. Run verify_stereo.py instead.')
    exit(1)

print(f'Detected {len(cornersC)} corners in all 3 views')

# Set captured images in shared state for matching module
from src.base import set_state
set_state('captured_front', {'left': imgL, 'center': imgC, 'right': imgR})
set_state('capture_size', (w, h))

results_left = []
results_right = []

for i in range(min(54, len(cornersC))):
    cx, cy = cornersC[i]
    gx_l, gy_l = cornersL[i]
    gx_r, gy_r = cornersR[i]

    auto_left = matching.match_side(cx, cy, 'left')
    auto_right = matching.match_side(cx, cy, 'right')

    if auto_left:
        err_lx = auto_left['x'] - gx_l
        err_ly = auto_left['y'] - gy_l
        results_left.append({
            'cx': cx, 'cy': cy,
            'auto_x': auto_left['x'], 'auto_y': auto_left['y'],
            'true_x': gx_l, 'true_y': gy_l,
            'err_x': err_lx, 'err_y': err_ly,
            'disp_auto': abs(auto_left['x'] - cx),
            'disp_true': abs(gx_l - cx),
            'ratio': abs(gx_l - cx) / abs(auto_left['x'] - cx) if abs(auto_left['x'] - cx) > 0 else 1
        })

    if auto_right:
        err_rx = auto_right['x'] - gx_r
        err_ry = auto_right['y'] - gy_r
        results_right.append({
            'cx': cx, 'cy': cy,
            'auto_x': auto_right['x'], 'auto_y': auto_right['y'],
            'true_x': gx_r, 'true_y': gy_r,
            'err_x': err_rx, 'err_y': err_ry,
            'disp_auto': abs(auto_right['x'] - cx),
            'disp_true': abs(gx_r - cx),
            'ratio': abs(gx_r - cx) / abs(auto_right['x'] - cx) if abs(auto_right['x'] - cx) > 0 else 1
        })

print(f'\nLEFT: {len(results_left)} samples')
if results_left:
    ratios_l = [r['ratio'] for r in results_left if 0.5 < r['ratio'] < 2.0]
    errors_l = [r['err_x'] for r in results_left]
    disp_a_l = [r['disp_auto'] for r in results_left]
    disp_t_l = [r['disp_true'] for r in results_left]
    if ratios_l:
        print(f'  Median correction ratio: {np.median(ratios_l):.4f}')
        print(f'  Mean correction ratio: {np.mean(ratios_l):.4f} +/- {np.std(ratios_l):.4f}')
    print(f'  Mean X error: {np.mean(errors_l):.1f}px')
    print(f'  Mean auto disparity: {np.mean(disp_a_l):.1f}px')
    print(f'  Mean true disparity: {np.mean(disp_t_l):.1f}px')

print(f'\nRIGHT: {len(results_right)} samples')
if results_right:
    ratios_r = [r['ratio'] for r in results_right if 0.5 < r['ratio'] < 2.0]
    errors_r = [r['err_x'] for r in results_right]
    disp_a_r = [r['disp_auto'] for r in results_right]
    disp_t_r = [r['disp_true'] for r in results_right]
    if ratios_r:
        print(f'  Median correction ratio: {np.median(ratios_r):.4f}')
        print(f'  Mean correction ratio: {np.mean(ratios_r):.4f} +/- {np.std(ratios_r):.4f}')
    print(f'  Mean X error: {np.mean(errors_r):.1f}px')
    print(f'  Mean auto disparity: {np.mean(disp_a_r):.1f}px')
    print(f'  Mean true disparity: {np.mean(disp_t_r):.1f}px')

analysis = {
    'timestamp': datetime.now().isoformat(),
    'frame': ts,
    'left': {
        'samples': len(results_left),
        'median_ratio': float(np.median(ratios_l)) if results_left else 0,
        'mean_error_px': float(np.mean(errors_l)) if results_left else 0
    },
    'right': {
        'samples': len(results_right),
        'median_ratio': float(np.median(ratios_r)) if results_right else 0,
        'mean_error_px': float(np.mean(errors_r)) if results_right else 0
    }
}
os.makedirs('analysis', exist_ok=True)
fname = f'analysis/chessboard_calib_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
with open(fname, 'w') as f:
    json.dump(analysis, f, indent=2)
print(f'\nSaved: {fname}')
