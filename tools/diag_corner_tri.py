"""
Verify improved calibration using projection-matrix triangulation (same as new v2_backend)
"""
import cv2, numpy as np, json, glob, os

os.chdir(r'E:\OPENCODE项目文件\镜架参数测量')

with open('calib_params.json') as f:
    calib = json.load(f)

K = [np.array(c['K'], np.float64) for c in calib['cameras']]
R_cr = np.array(calib['stereo'][1]['R'])
T_cr = np.array(calib['stereo'][1]['T']).reshape(3, 1)

P_center = K[1] @ np.hstack([np.eye(3), np.zeros((3, 1))])
P_right  = K[2] @ np.hstack([R_cr, T_cr])

files = sorted(glob.glob('calib_frames/*.png'))
groups = {}
for f in files:
    name = os.path.basename(f)
    parts = name.split('_', 1)
    if len(parts) < 2: continue
    side = parts[0]; ts = parts[1]
    if side in ('left', 'center', 'right'):
        groups.setdefault(ts, {})[side] = f

print("Projection-matrix triangulation (cv2.triangulatePoints)")
print(f"FX={K[1][0,0]:.1f}  BL={np.linalg.norm(T_cr):.1f}mm\n")

for expected_mm, idx1, idx2, desc in [
    (160, 0, 16, '160mm horizontal'),
    (50, 0, 5, '50mm'),
    (70, 0, 7, '70mm'),
    (20, 0, 2, '20mm'),
    (np.sqrt(2)*160, 0, 288, '226mm diagonal'),
]:
    dists = []
    for ts in sorted(groups.keys()):
        g = groups[ts]
        if 'center' not in g or 'right' not in g: continue
        img_c = cv2.imread(g['center'])
        img_r = cv2.imread(g['right'])
        if img_c is None or img_r is None: continue

        gc = cv2.cvtColor(img_c, cv2.COLOR_BGR2GRAY)
        gr = cv2.cvtColor(img_r, cv2.COLOR_BGR2GRAY)
        rc, cc = cv2.findChessboardCorners(gc, (17, 17))
        rr, cr = cv2.findChessboardCorners(gr, (17, 17))
        if not (rc and rr): continue

        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
        cv2.cornerSubPix(gc, cc, (11, 11), (-1, -1), crit)
        cv2.cornerSubPix(gr, cr, (11, 11), (-1, -1), crit)

        dx_c = cc[16, 0, 0] - cc[0, 0, 0]
        dx_r = cr[16, 0, 0] - cr[0, 0, 0]
        if dx_c < 0 or dx_r < 0: continue

        p1c = cc[idx1, 0].reshape(2, 1).astype(np.float64)
        p1r = cr[idx1, 0].reshape(2, 1).astype(np.float64)
        p2c = cc[idx2, 0].reshape(2, 1).astype(np.float64)
        p2r = cr[idx2, 0].reshape(2, 1).astype(np.float64)

        t1 = cv2.triangulatePoints(P_center, P_right, p1c, p1r)
        t1 = t1[:3, 0] / t1[3]
        t2 = cv2.triangulatePoints(P_center, P_right, p2c, p2r)
        t2 = t2[:3, 0] / t2[3]

        d = float(np.linalg.norm(t1 - t2))
        dists.append(d)

    if dists:
        d = np.array(dists)
        err = d - expected_mm
        valid = np.abs(err - err.mean()) < 3 * err.std()
        d_in = d[valid]
        e_in = err[valid]
        sign = '+' if e_in.mean() >= 0 else ''
        print(f'{desc:18s}: n={len(d_in):2d}/{len(d)}  '
              f'dist={d_in.mean():.2f}±{d_in.std():.3f}mm  '
              f'err={sign}{e_in.mean():.3f}mm ({sign}{e_in.mean()/expected_mm*100:.2f}%)')
