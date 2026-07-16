"""
Print individual LC 160mm horizontal results to diagnose distribution
"""
import cv2, numpy as np, json, glob, os

os.chdir(r'E:\OPENCODE项目文件\镜架参数测量')

with open('calib_params.json') as f:
    calib = json.load(f)

K = [np.array(c['K'], np.float64) for c in calib['cameras']]
R_lc = np.array(calib['stereo'][0]['R']); T_lc = np.array(calib['stereo'][0]['T']).reshape(3, 1)
R_cr = np.array(calib['stereo'][1]['R']); T_cr = np.array(calib['stereo'][1]['T']).reshape(3, 1)

P_center = K[1] @ np.hstack([np.eye(3), np.zeros((3, 1))])
P_left   = K[0] @ np.hstack([R_lc.T, -R_lc.T @ T_lc])

files = sorted(glob.glob('calib_frames/*.png'))
groups = {}
for f in files:
    name = os.path.basename(f)
    parts = name.split('_', 1)
    if len(parts) < 2: continue
    side = parts[0]; ts = parts[1]
    if side in ('left', 'center', 'right'):
        groups.setdefault(ts, {})[side] = f

for idx, ts in enumerate(sorted(groups.keys())):
    g = groups[ts]
    if 'center' not in g or 'left' not in g: continue

    img_c = cv2.imread(g['center'])
    img_l = cv2.imread(g['left'])
    if img_c is None or img_l is None: continue

    gc = cv2.cvtColor(img_c, cv2.COLOR_BGR2GRAY)
    gl = cv2.cvtColor(img_l, cv2.COLOR_BGR2GRAY)

    rc, cc = cv2.findChessboardCorners(gc, (17, 17))
    rl, cl = cv2.findChessboardCorners(gl, (17, 17))
    if not (rc and rl): continue

    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    cv2.cornerSubPix(gc, cc, (11, 11), (-1, -1), crit)
    cv2.cornerSubPix(gl, cl, (11, 11), (-1, -1), crit)

    p_c0 = cc[0, 0]; p_c16 = cc[16, 0]
    p_l0 = cl[0, 0]; p_l16 = cl[16, 0]

    pt_a = cv2.triangulatePoints(P_center.astype(np.float64), P_left.astype(np.float64),
                                  p_c0.reshape(2, 1).astype(np.float64),
                                  p_l0.reshape(2, 1).astype(np.float64))
    pt_a = pt_a[:3, 0] / pt_a[3]

    pt_b = cv2.triangulatePoints(P_center.astype(np.float64), P_left.astype(np.float64),
                                  p_c16.reshape(2, 1).astype(np.float64),
                                  p_l16.reshape(2, 1).astype(np.float64))
    pt_b = pt_b[:3, 0] / pt_b[3]

    dist = np.linalg.norm(pt_a - pt_b)
    err = dist - 160

    # Check corner orientation
    dx_c = p_c16[0] - p_c0[0]
    dx_l = p_l16[0] - p_l0[0]

    marker = ''
    if abs(err) > 20:
        marker = ' *** BAD'
    print(f'  [{idx:2d}] dist={dist:8.1f}mm err={err:+8.1f}mm  Z_a={pt_a[2]:.0f} Z_b={pt_b[2]:.0f}  '
          f'dx_c={dx_c:+.0f} dx_l={dx_l:+.0f}{marker}')

    if idx >= 19:
        break
