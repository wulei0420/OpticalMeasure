"""Calibration verification routes (Tab 4 of 5003)."""
import cv2
import numpy as np
from flask import jsonify, request

from src.base import get_state
from src.modules.calibration import bp
from src.modules.calibration.routes import get_stereo_params, detect_corners


def _get_calib_size():
    size = get_state('calib_size', (3840, 2160))
    return size[0], size[1]


@bp.route('/api/epiline', methods=['POST'])
def epiline():
    cp = get_stereo_params()
    if not cp:
        return jsonify({'error': 'No calibration'}), 400
    K, R_lc, T_lc, R_cr, T_cr = cp

    def skew(t):
        return np.array([[0, -t[2, 0], t[1, 0]],
                         [t[2, 0], 0, -t[0, 0]],
                         [-t[1, 0], t[0, 0], 0]])

    F_lc = np.linalg.inv(K[0]).T @ skew(-R_lc.T @ T_lc) @ R_lc.T @ np.linalg.inv(K[1])
    F_cr = np.linalg.inv(K[2]).T @ skew(-T_cr) @ R_cr @ np.linalg.inv(K[1])

    data = request.json
    cx, cy = float(data['cx']), float(data['cy'])
    w_img, h_img = _get_calib_size()

    lines = {}
    for side, F in [('left', F_lc), ('right', F_cr)]:
        a, b, c = [float(x) for x in F @ np.array([cx, cy, 1.0])]
        pts = []
        for sx in [0, w_img - 1]:
            sy = int(-(c + a * sx) / b) if abs(b) > 1e-6 else int(cy)
            if 0 <= sy < h_img:
                pts.append([sx, sy])
        for sy2 in [0, h_img - 1]:
            sx2 = int(-(c + b * sy2) / a) if abs(a) > 1e-6 else int(cx)
            if 0 <= sx2 < w_img:
                pts.append([sx2, sy2])
        lines[side] = {'a': round(a, 6), 'b': round(b, 6), 'c': round(c, 1), 'pts': pts}
    return jsonify(lines)


@bp.route('/api/epi_error', methods=['POST'])
def epi_error():
    data = request.json
    a, b, c = float(data['a']), float(data['b']), float(data['c'])
    px, py = float(data['x']), float(data['y'])
    dist = abs(a * px + b * py + c) / np.sqrt(a * a + b * b) if a * a + b * b > 0 else 0
    return jsonify({'dist_px': round(dist, 2), 'dist_mm': round(dist * 0.115, 3)})


@bp.route('/api/epi_verify_auto', methods=['POST'])
def epi_verify_auto():
    captured = get_state('calib_captured', {})
    if captured.get('center') is None:
        return jsonify({'error': 'Capture or load existing frame first'}), 400

    corners_c = detect_corners(captured['center'])
    corners_l = detect_corners(captured['left'])
    corners_r = detect_corners(captured['right'])
    if corners_c is None or corners_l is None or corners_r is None:
        return jsonify({'error': 'Chessboard not detected in all views'}), 400

    cp = get_stereo_params()
    if not cp:
        return jsonify({'error': 'No calibration'}), 400
    K, R_lc, T_lc, R_cr, T_cr = cp

    def skew(t):
        return np.array([[0, -t[2, 0], t[1, 0]],
                         [t[2, 0], 0, -t[0, 0]],
                         [-t[1, 0], t[0, 0], 0]])

    F_lc = np.linalg.inv(K[0]).T @ skew(-R_lc.T @ T_lc) @ R_lc.T @ np.linalg.inv(K[1])
    F_cr = np.linalg.inv(K[2]).T @ skew(-T_cr) @ R_cr @ np.linalg.inv(K[1])

    n = len(corners_c)
    errors_l = []
    errors_r = []
    for i in range(n):
        cx, cy = float(corners_c[i][0]), float(corners_c[i][1])
        for side, F, tgt in [('l', F_lc, corners_l), ('r', F_cr, corners_r)]:
            a, b, c_line = [float(x) for x in F @ np.array([cx, cy, 1.0])]
            px, py = float(tgt[i][0]), float(tgt[i][1])
            d = abs(a * px + b * py + c_line) / np.sqrt(a * a + b * b) if a * a + b * b > 0 else 0
            (errors_l if side == 'l' else errors_r).append(d)

    mm_per_px = 0.115
    result = {}
    for side_name, errs in [('left', errors_l), ('right', errors_r)]:
        arr = np.array(errs)
        result[side_name] = {
            'avg': round(float(np.mean(arr)), 2),
            'max': round(float(np.max(arr)), 2),
            'min': round(float(np.min(arr)), 2),
            'std': round(float(np.std(arr)), 2),
            'mm_avg': round(float(np.mean(arr)) * mm_per_px, 3),
            'mm_max': round(float(np.max(arr)) * mm_per_px, 3),
            'pass': bool(float(np.max(arr)) < 3.0),
            'count': len(errs)
        }
    result['overall_avg_px'] = round(float(np.mean(errors_l + errors_r)), 2)
    result['overall_max_px'] = round(float(max(max(errors_l), max(errors_r))), 2)
    result['mm_per_px'] = mm_per_px
    return jsonify(result)


@bp.route('/api/dist_verify', methods=['POST'])
def dist_verify():
    captured = get_state('calib_captured', {})
    if captured.get('center') is None:
        return jsonify({'error': 'Capture or load existing frame first'}), 400

    corners_c = detect_corners(captured['center'])
    corners_l = detect_corners(captured['left'])
    corners_r = detect_corners(captured['right'])
    if corners_c is None or corners_l is None or corners_r is None:
        return jsonify({'error': 'Chessboard not detected in all views'}), 400

    cp = get_stereo_params()
    if not cp:
        return jsonify({'error': 'No calibration'}), 400
    K, R_lc, T_lc, R_cr, T_cr = cp

    Pc = K[1] @ np.hstack([np.eye(3), np.zeros((3, 1))])
    Pl = K[0] @ np.hstack([R_lc.T, -R_lc.T @ T_lc])
    Pr = K[2] @ np.hstack([R_cr, T_cr])

    PAT = (17, 17)
    SZ = 10
    errors = []
    for row in range(PAT[1]):
        for col in range(PAT[0] - 1):
            i1 = row * PAT[0] + col
            i2 = i1 + 1
            ptL1, ptC1, ptR1 = corners_l[i1], corners_c[i1], corners_r[i1]
            ptL2, ptC2, ptR2 = corners_l[i2], corners_c[i2], corners_r[i2]

            p4 = cv2.triangulatePoints(
                Pl, Pc,
                np.float64([[ptL1[0]], [ptL1[1]]]),
                np.float64([[ptC1[0]], [ptC1[1]]]))
            p1 = (p4[:3] / p4[3]).flatten()
            p4 = cv2.triangulatePoints(
                Pc, Pr,
                np.float64([[ptC1[0]], [ptC1[1]]]),
                np.float64([[ptR1[0]], [ptR1[1]]]))
            p1 += (p4[:3] / p4[3]).flatten()
            p1 /= 2

            p4 = cv2.triangulatePoints(
                Pl, Pc,
                np.float64([[ptL2[0]], [ptL2[1]]]),
                np.float64([[ptC2[0]], [ptC2[1]]]))
            p2 = (p4[:3] / p4[3]).flatten()
            p4 = cv2.triangulatePoints(
                Pc, Pr,
                np.float64([[ptC2[0]], [ptC2[1]]]),
                np.float64([[ptR2[0]], [ptR2[1]]]))
            p2 += (p4[:3] / p4[3]).flatten()
            p2 /= 2

            d = np.linalg.norm(p2 - p1)
            errors.append({
                'expected': SZ, 'measured': round(float(d), 2),
                'error_pct': round(float(abs(d - SZ) / SZ * 100), 1)
            })

    if not errors:
        return jsonify({'error': 'No corners'}), 400
    avg = np.mean([e['measured'] for e in errors])
    avg_err = np.mean([e['error_pct'] for e in errors])
    return jsonify({
        'samples': len(errors),
        'avg_measured': round(float(avg), 2),
        'expected': SZ,
        'avg_error_pct': round(float(avg_err), 1),
        'pass': bool(avg_err < 2.0),
        'detail': errors[:5]
    })
