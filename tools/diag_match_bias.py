"""
Diag v2: NCC matching bias at 4K resolution (matching actual v2_backend settings)
Uses 4K calib_frames, 4K K matrices, 4K matching params.
"""
import cv2, numpy as np, json, glob, os

os.chdir(r'E:\OPENCODE项目文件\镜架参数测量')

with open('calib_params.json') as f:
    calib = json.load(f)

K = [np.array(c['K'], np.float64) for c in calib['cameras']]
R_lc = np.array(calib['stereo'][0]['R'])
T_lc = np.array(calib['stereo'][0]['T']).reshape(3, 1)
R_cr = np.array(calib['stereo'][1]['R'])
T_cr = np.array(calib['stereo'][1]['T']).reshape(3, 1)
BL_LC = float(np.linalg.norm(T_lc))
BL_CR = float(np.linalg.norm(T_cr))
FX = float((K[0][0, 0] + K[1][0, 0] + K[2][0, 0]) / 3)

files = sorted(glob.glob('calib_frames/*.png'))
groups = {}
for f in files:
    name = os.path.basename(f)
    parts = name.split('_', 1)
    if len(parts) < 2: continue
    side = parts[0]
    ts = parts[1]
    if side in ('left', 'center', 'right'):
        groups.setdefault(ts, {})[side] = f


def match_4k(img_ctr, img_tgt, cx, cy, side, base_disp, margin):
    """4K-parameter replica of match_side"""
    h_img, w_img = img_tgt.shape[:2]
    ch_img, cw_img = img_ctr.shape[:2]
    cxi, cyi = int(round(cx)), int(round(cy))

    if side == 'left':
        tgtK = K[0]; R_use = R_lc.T.copy(); t_use = (-R_lc.T @ T_lc).copy()
    else:
        tgtK = K[2]; R_use = R_cr.copy(); t_use = -T_cr.copy()

    Tx = np.array([[0, -t_use[2, 0], t_use[1, 0]],
                   [t_use[2, 0], 0, -t_use[0, 0]],
                   [-t_use[1, 0], t_use[0, 0], 0]])
    F = np.linalg.inv(tgtK).T @ Tx @ R_use @ np.linalg.inv(K[1])
    a, b, c_line = [float(x) for x in F @ np.array([cx, cy, 1.0])]

    half = 70  # 4K template size
    y1, y2 = max(0, cyi - half), min(ch_img - 1, cyi + half)
    x1, x2 = max(0, cxi - half), min(cw_img - 1, cxi + half)
    tpl = cv2.cvtColor(img_ctr[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    th, tw = tpl.shape
    tpl_m = tpl.astype(np.float64) - tpl.mean()
    tpl_n = np.sqrt(np.square(tpl_m).sum())
    if tpl_n < 1e-9: return None

    s_gray = cv2.cvtColor(img_tgt, cv2.COLOR_BGR2GRAY)

    if side == 'left':
        xs = max(tw, cxi + base_disp - margin)
        xe = min(w_img - tw, cxi + base_disp + margin)
    else:
        xs = max(tw, cxi - base_disp - margin)
        xe = min(w_img - tw, cxi - base_disp + margin)

    best = -2; bx, by = cxi, cyi
    for sx in range(int(xs), int(xe), 1):
        y_epi = int(-(c_line + a * sx) / b) if abs(b) > 1e-6 else cyi
        for dy in range(-2, 3):
            sy = y_epi + dy
            if sy < th or sy >= h_img - th: continue
            roi = s_gray[sy - th // 2:sy + th // 2, sx - tw // 2:sx + tw // 2]
            if roi.shape != tpl.shape: continue
            rm = roi.astype(np.float64) - roi.mean()
            rn = np.sqrt(np.square(rm).sum())
            corr = float((rm * tpl_m).sum() / (rn * tpl_n)) if rn > 0 and tpl_n > 0 else 0
            if corr > best: best = corr; bx, by = sx, sy

    if best > 0.3 and (bx, by) != (cxi, cyi):
        def _ncc(x, y):
            r = s_gray[y - th // 2:y + th // 2, x - tw // 2:x + tw // 2]
            if r.shape != tpl.shape: return -1.0
            rm_ = r.astype(np.float64) - r.mean()
            rn_ = np.sqrt(np.square(rm_).sum())
            return float((rm_ * tpl_m).sum() / (rn_ * tpl_n)) if rn_ > 0 and tpl_n > 0 else 0
        fx_v, fy_v = float(bx), float(by)
        if 0 <= bx - 1 and bx + 1 < w_img:
            sl = _ncc(bx - 1, by); sr = _ncc(bx + 1, by)
            dn = sl + sr - 2 * best
            dx = 0.5 * (sl - sr) / dn if abs(dn) > 1e-9 else 0
            fx_v += max(-0.5, min(0.5, dx))
        if 0 <= by - 1 and by + 1 < h_img:
            sb = _ncc(bx, by - 1); st = _ncc(bx, by + 1)
            dn = sb + st - 2 * best
            dy = 0.5 * (sb - st) / dn if abs(dn) > 1e-9 else 0
            fy_v += max(-0.5, min(0.5, dy))
        bx, by = fx_v, fy_v

    return {'x': float(bx), 'y': float(by), 'score': round(best, 3)}


results_left, results_right = [], []
n_tested = 0

for ts in sorted(groups.keys()):
    g = groups[ts]
    if 'center' not in g or 'left' not in g or 'right' not in g: continue

    img_c = cv2.imread(g['center'])
    img_l = cv2.imread(g['left'])
    img_r = cv2.imread(g['right'])
    if img_c is None or img_l is None or img_r is None: continue

    gray_c = cv2.cvtColor(img_c, cv2.COLOR_BGR2GRAY)
    gray_l = cv2.cvtColor(img_l, cv2.COLOR_BGR2GRAY)
    gray_r = cv2.cvtColor(img_r, cv2.COLOR_BGR2GRAY)

    ret_c, crn_c = cv2.findChessboardCorners(gray_c, (17, 17))
    ret_l, crn_l = cv2.findChessboardCorners(gray_l, (17, 17))
    ret_r, crn_r = cv2.findChessboardCorners(gray_r, (17, 17))
    if not (ret_c and ret_l and ret_r): continue

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    cv2.cornerSubPix(gray_c, crn_c, (11, 11), (-1, -1), criteria)
    cv2.cornerSubPix(gray_l, crn_l, (11, 11), (-1, -1), criteria)
    cv2.cornerSubPix(gray_r, crn_r, (11, 11), (-1, -1), criteria)

    cx4k, cy4k = float(crn_c[144, 0, 0]), float(crn_c[144, 0, 1])
    lx4k, ly4k = float(crn_l[144, 0, 0]), float(crn_l[144, 0, 1])
    rx4k, ry4k = float(crn_r[144, 0, 0]), float(crn_r[144, 0, 1])

    disp_l_exp = lx4k - cx4k
    disp_r_exp = cx4k - rx4k

    ml = match_4k(img_c, img_l, cx4k, cy4k, 'left',
                  base_disp=abs(int(disp_l_exp)), margin=100)
    mr = match_4k(img_c, img_r, cx4k, cy4k, 'right',
                  base_disp=abs(int(disp_r_exp)), margin=100)

    if ml:
        results_left.append({'bx': ml['x'] - lx4k, 'by': ml['y'] - ly4k,
                             'score': ml['score'], 'gt_d': disp_l_exp})
    if mr:
        results_right.append({'bx': mr['x'] - rx4k, 'by': mr['y'] - ry4k,
                              'score': mr['score'], 'gt_d': disp_r_exp})
    n_tested += 1
    if n_tested >= 15: break

print(f'Tested {n_tested} groups at 4K\n')

for label, res in [('LEFT', results_left), ('RIGHT', results_right)]:
    if not res: continue
    bx = np.array([r['bx'] for r in res])
    by = np.array([r['by'] for r in res])
    sc = np.array([r['score'] for r in res])
    gd = np.array([r['gt_d'] for r in res])
    mm_px = 1000.0 / FX  # mm per px at Z=1000mm
    print(f'{label}: X bias {bx.mean():+.2f}±{bx.std():.2f}px ({bx.mean()*mm_px:+.3f}mm)  '
          f'Y bias {by.mean():+.2f}±{by.std():.2f}px  '
          f'score {sc.mean():.3f}  gt_disp {gd.mean():.0f}±{gd.std():.0f}px')
