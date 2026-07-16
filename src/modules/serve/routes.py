"""Status, feedback, and cross-cutting routes."""
import json
import os
from datetime import datetime

from flask import jsonify, request

from src.base.config import app_path, ensure_dir, get_calib_params
from src.base import get_state
from src.modules.serve import bp


@bp.route('/api/status')
def status():
    captured = get_state('captured_front', {})
    return jsonify({
        'calib': get_calib_params() is not None,
        'captured': captured.get('center') is not None
    })


@bp.route('/api/feedback', methods=['POST'])
def feedback():
    data = request.json
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    ensure_dir('feedback')
    fpath = app_path('feedback', f'feedback_{ts}.json')
    with open(fpath, 'w') as f:
        json.dump(data, f, indent=2)
    return jsonify({'ok': True})


_BR_MAP_DEFAULT = {'0': 0, '1': 1, '2': 2}


@bp.route('/api/br_map', methods=['GET', 'POST'])
def br_map_api():
    fpath = app_path('br_map.json')
    if request.method == 'POST':
        data = request.json or {}
        tmp = fpath + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, fpath)
        return jsonify({'ok': True})
    if not os.path.exists(fpath):
        return jsonify(_BR_MAP_DEFAULT)
    with open(fpath, 'r', encoding='utf-8') as f:
        return jsonify(json.load(f))
