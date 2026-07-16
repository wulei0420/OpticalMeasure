"""Stereo matching and triangulation routes."""
import cv2
import numpy as np
from flask import jsonify, request

from src.base.config import get_calib_params
from src.base import get_state
from src.modules.matching import bp


def _load_matching_state():
    calib = get_calib_params()
    if not calib:
        return None
    K_vals = [np.array(c['K'], np.float64) for c in calib['cameras']]
    R_lc = np.array(calib['stereo'][0]['R'])
    T_lc = np.array(calib['stereo'][0]['T']).reshape(3, 1)
    R_cr = np.array(calib['stereo'][1]['R'])
    T_cr = np.array(calib['stereo'][1]['T']).reshape(3, 1)
    BL_LC = float(np.linalg.norm(T_lc))
    BL_CR = float(np.linalg.norm(T_cr))
    FX = float((K_vals[0][0, 0] + K_vals[1][0, 0] + K_vals[2][0, 0]) / 3)
    P_center = K_vals[1] @ np.hstack([np.eye(3), np.zeros((3, 1))])
    P_right = K_vals[2] @ np.hstack([R_cr, T_cr])
    P_left = K_vals[0] @ np.hstack([R_lc.T, -R_lc.T @ T_lc])
    captured = get_state('captured_front', {})
    size = get_state('capture_size', (0, 0))
    cw, ch = size
    return {
        'K': K_vals, 'R_lc': R_lc, 'R_cr': R_cr,
        'T_lc': T_lc, 'T_cr': T_cr,
        'BL_LC': BL_LC, 'BL_CR': BL_CR, 'FX': FX,
        'P_center': P_center, 'P_right': P_right, 'P_left': P_left,
        'captured': captured, 'cw': cw, 'ch': ch
    }


def match_side(cx, cy, side, state, ref_disp=None):
    K_arr = state['K']
    captured = state['captured']
    cw = state['cw']
    ch = state['ch']

    if side == 'left':
        img = captured.get('left')
        tgtK = K_arr[0]
        R_use = state['R_lc'].T.copy()
        t_use = (-state['R_lc'].T @ state['T_lc']).copy()
        base_disp, margin = 731, 100
    else:
        img = captured.get('right')
        tgtK = K_arr[2]
        R_use = state['R_cr'].copy()
        t_use = -state['T_cr'].copy()
        base_disp, margin = 731, 100

    if img is None:
        return None

    h_img, w_img = img.shape[:2]
    cxi, cyi = int(cx), int(cy)

    Tx = np.array([
        [0, -t_use[2, 0], t_use[1, 0]],
        [t_use[2, 0], 0, -t_use[0, 0]],
        [-t_use[1, 0], t_use[0, 0], 0]
    ])
    F = np.linalg.inv(tgtK).T @ Tx @ R_use @ np.linalg.inv(K_arr[1])
    a, b, c_line = [float(x) for x in F @ np.array([cx, cy, 1.0])]

    half = 70
    y1, y2 = max(0, cyi - half), min(ch - 1, cyi + half)
    x1, x2 = max(0, cxi - half), min(cw - 1, cxi + half)
    tpl = cv2.cvtColor(captured['center'][y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    th, tw = tpl.shape
    tpl_m = tpl.astype(np.float64) - tpl.mean()
    tpl_n = np.sqrt((tpl_m * tpl_m).sum())

    s_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    center_disp = ref_disp if ref_disp is not None else base_disp
    use_margin = 60 if ref_disp is not None else margin

    if side == 'left':
        xs = max(tw, cxi + center_disp - use_margin)
        xe = min(w_img - tw, cxi + center_disp + use_margin)
    else:
        xs = max(tw, cxi - center_disp - use_margin)
        xe = min(w_img - tw, cxi - center_disp + use_margin)

    best = -2
    bx, by = cxi, cyi
    for sx in range(int(xs), int(xe), 1):
        y_epi = int(-(c_line + a * sx) / b) if abs(b) > 1e-6 else cyi
        for dy in range(-2, 3):
            sy = y_epi + dy
            if sy < th or sy >= h_img - th:
                continue
            roi = s_gray[sy - th // 2:sy + th // 2, sx - tw // 2:sx + tw // 2]
            if roi.shape != tpl.shape:
                continue
            rm = roi.astype(np.float64) - roi.mean()
            rn = np.sqrt((rm * rm).sum())
            corr = float((rm * tpl_m).sum() / (rn * tpl_n)) if rn > 0 and tpl_n > 0 else 0
            if corr > best:
                best = corr
                bx, by = sx, sy

    if best > 0.3 and (bx, by) != (cxi, cyi):
        def _ncc(x, y):
            r = s_gray[y - th // 2:y + th // 2, x - tw // 2:x + tw // 2]
            if r.shape != tpl.shape:
                return -1.0
            rm_ = r.astype(np.float64) - r.mean()
            rn_ = np.sqrt((rm_ * rm_).sum())
            return float((rm_ * tpl_m).sum() / (rn_ * tpl_n)) if rn_ > 0 and tpl_n > 0 else 0

        fx_v, fy_v = float(bx), float(by)
        if 0 <= bx - 1 and bx + 1 < w_img:
            sl = _ncc(bx - 1, by)
            sr = _ncc(bx + 1, by)
            dn = sl + sr - 2 * best
            dx = 0.5 * (sl - sr) / dn if abs(dn) > 1e-9 else 0
            fx_v += max(-0.5, min(0.5, dx))
        if 0 <= by - 1 and by + 1 < h_img:
            sb = _ncc(bx, by - 1)
            st = _ncc(bx, by + 1)
            dn = sb + st - 2 * best
            dy = 0.5 * (sb - st) / dn if abs(dn) > 1e-9 else 0
            fy_v += max(-0.5, min(0.5, dy))
        bx, by = fx_v, fy_v

    return {'x': round(float(bx), 1), 'y': round(float(by), 1), 'score': round(best, 3)}


def match_and_tri(cx, cy, state):
    right = match_side(cx, cy, 'right', state)
    left = None
    pt3d = [0, 0, 0]
    if right:
        Xh = cv2.triangulatePoints(
            state['P_center'].astype(np.float64),
            state['P_right'].astype(np.float64),
            np.array([[cx], [cy]], np.float64),
            np.array([[right['x']], [right['y']]], np.float64))
        Xh = Xh / Xh[3]
        X, Y, Z = float(Xh[0, 0]), float(Xh[1, 0]), float(Xh[2, 0])
        if Z > 0:
            pt3d = [round(X, 1), round(Y, 1), round(Z, 1)]
            ld = int(state['FX'] * state['BL_LC'] / Z) if Z > 0 else 365
            left = match_side(cx, cy, 'left', state, ld)
        else:
            left = match_side(cx, cy, 'left', state)
    return left, right, pt3d, 0


@bp.route('/api/match', methods=['POST'])
def match():
    state = _load_matching_state()
    if not state or state['captured'].get('center') is None:
        return jsonify({'error': 'Capture first'}), 400
    d = request.json
    left, right, pt3d, cons = match_and_tri(d['cx'], d['cy'], state)
    return jsonify({'left': left, 'right': right, '3d': pt3d, 'consistency': cons})


@bp.route('/api/tri', methods=['POST'])
def tri():
    state = _load_matching_state()
    if not state or state['captured'].get('center') is None:
        return jsonify({'error': 'Capture first'}), 400
    d = request.json
    p_ctr = np.array([[d['cx']], [d['cy']]], np.float64)
    p_rgt = np.array([[d['rx']], [d.get('ry', d['cy'])]], np.float64)
    Xh = cv2.triangulatePoints(
        state['P_center'].astype(np.float64),
        state['P_right'].astype(np.float64),
        p_ctr, p_rgt)
    Xh = Xh / Xh[3]
    return jsonify({'3d': [round(float(Xh[0, 0]), 1),
                           round(float(Xh[1, 0]), 1),
                           round(float(Xh[2, 0]), 1)]})
