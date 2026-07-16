"""Side measurement and user config routes."""
import math
from flask import jsonify, request

from src.base.config import get_calib_params, get_user_config, save_user_config
from src.modules.measurement import bp


@bp.route('/api/side_measure', methods=['POST'])
def side_measure():
    calib = get_calib_params()
    if not calib:
        return jsonify({'error': 'No calibration'}), 400
    K_vals = [c['K'] for c in calib['cameras']]
    FX = float((K_vals[0][0][0] + K_vals[1][0][0] + K_vals[2][0][0]) / 3)

    d = request.json
    tx, ty = d['top_x'], d['top_y']
    bx, by = d['bottom_x'], d['bottom_y']
    cx, cy = d['cornea_x'], d['cornea_y']

    dx, dy_vec = bx - tx, by - ty
    angle = math.degrees(math.atan2(abs(dx), abs(dy_vec)))

    a, b_val = dy_vec, -dx
    c = dx * ty - dy_vec * tx
    dist_px = abs(a * cx + b_val * cy + c) / math.sqrt(a * a + b_val * b_val)

    mm_per_px = 1000.0 / FX
    dist_mm = dist_px * mm_per_px

    return jsonify({
        'tilt_angle': round(angle, 1),
        'vertex_distance_mm': round(dist_mm, 1),
        'frame_line_px': round(math.sqrt(dx * dx + dy_vec * dy_vec), 1)
    })


@bp.route('/api/user_config', methods=['GET', 'POST'])
def user_config_api():
    if request.method == 'POST':
        data = request.json
        cfg = get_user_config()
        if 'pd_correction' in data:
            cfg['pd_correction'] = float(data['pd_correction'])
            save_user_config(cfg)
        return jsonify(cfg)
    return jsonify(get_user_config())
