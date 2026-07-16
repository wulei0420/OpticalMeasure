"""Photo capture routes for main app (5002)."""
import base64
import os
import subprocess
import tempfile
import threading
import time

import cv2
import numpy as np
from flask import jsonify, Response, request

from src.base.config import get_camera_config, app_path, get_calib_params
from src.base import get_state, set_state
from src.modules.capture import bp

# Preview camera (shared, for /api/preview)
_preview_lock = threading.Lock()
_preview_cap = None

# Camera pool (shared, for Python fallback capture)
_cap_pool = {}
_cap_plock = threading.Lock()


def _grab_camera(idx):
    with _cap_plock:
        if idx not in _cap_pool or not _cap_pool[idx].isOpened():
            cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            _cap_pool[idx] = cap
        else:
            cap = _cap_pool[idx]
        for _ in range(4):
            cap.read()
        ret, frm = cap.read()
    return frm if ret else None


def _get_preview():
    global _preview_cap
    with _preview_lock:
        cfg = get_camera_config()
        if _preview_cap is None or not _preview_cap.isOpened():
            _preview_cap = cv2.VideoCapture(cfg['center'], cv2.CAP_DSHOW)
            _preview_cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            _preview_cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            for _ in range(10):
                _preview_cap.read()
        ret, frm = _preview_cap.read()
    return frm if ret else None


@bp.route('/api/preview')
def preview():
    cfg = get_camera_config()
    cap = cv2.VideoCapture(cfg['center'], cv2.CAP_DSHOW)
    if not cap.isOpened():
        return 'Camera error', 500
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    for _ in range(3):
        cap.read()
    ret, frm = cap.read()
    cap.release()
    if not ret:
        return 'Read failed', 500
    _, buf = cv2.imencode('.jpg', frm, [cv2.IMWRITE_JPEG_QUALITY, 50])
    return Response(buf.tobytes(), mimetype='image/jpeg')


@bp.route('/api/prepare', methods=['POST'])
def prepare():
    return jsonify({'ready': True})


@bp.route('/api/close_cams', methods=['POST'])
def close_cams():
    global _preview_cap, _cap_pool
    with _preview_lock:
        if _preview_cap is not None:
            _preview_cap.release()
            _preview_cap = None
    with _cap_plock:
        for k in list(_cap_pool.keys()):
            if _cap_pool[k].isOpened():
                _cap_pool[k].release()
        _cap_pool.clear()
    return jsonify({'ok': True})


@bp.route('/api/capture', methods=['POST'])
def capture():
    return _do_capture('front')


@bp.route('/api/capture_side', methods=['POST'])
def capture_side():
    return _do_capture('side')


def _do_capture(mode):
    global _preview_cap
    import subprocess as _sp
    import tempfile as _tmp

    target_key = 'captured_front' if mode == 'front' else 'captured_side'
    target = {}

    # Force-stop stream
    from src.modules.stream.routes import stop_stream
    stop_stream()

    with _preview_lock:
        if _preview_cap is not None:
            _preview_cap.release()
            _preview_cap = None

    exe = app_path('capture_three.exe')

    if os.path.exists(exe):
        with _tmp.TemporaryDirectory() as tmpd:
            t0 = time.time()
            cam_cfg = get_camera_config()
            result = _sp.run(
                [exe, '--left-idx', str(cam_cfg.get('left', 0)),
                 '--center-idx', str(cam_cfg.get('center', 1)),
                 '--right-idx', str(cam_cfg.get('right', 2)),
                 '--out', tmpd, '--mode', '4k'],
                capture_output=True, text=True, timeout=60)
            print(result.stdout, end='')
            if result.stderr:
                print(result.stderr, end='')
            if result.returncode != 0:
                return jsonify({'error': f'capture failed (code={result.returncode})'}), 500
            for pos in ['left', 'center', 'right']:
                fpath = os.path.join(tmpd, f'{pos}.jpg')
                if not os.path.exists(fpath):
                    return jsonify({'error': f'{pos} image missing'}), 500
                target[pos] = cv2.imread(fpath)
                if target[pos] is None:
                    return jsonify({'error': f'{pos} decode failed'}), 500
            print(f'[capture_{mode}] 3 cams: {time.time() - t0:.2f}s')
    else:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        results = {}
        cam_cfg = get_camera_config()

        def cap_one(pos_idx):
            pos, idx = pos_idx
            t0t = time.time()
            cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
            if not cap.isOpened():
                cap.release()
                cap = cv2.VideoCapture(idx, cv2.CAP_MSMF)
                if not cap.isOpened():
                    cap.release()
                    return pos, False, None, time.time() - t0t
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)
            for _ in range(2):
                cap.read()
            ret, frm = cap.read()
            cap.release()
            return pos, ret, frm, time.time() - t0t

        with ThreadPoolExecutor(max_workers=3) as ex:
            futs = {ex.submit(cap_one, (pos, idx)): pos for pos, idx in cam_cfg.items()}
            for fut in as_completed(futs):
                pos, ret, frm, dt = fut.result()
                if not ret or frm is None or np.mean(frm) < 5:
                    return jsonify({'error': f'{pos} blank'}), 500
                results[pos] = frm
                print(f'[capture_{mode}] {pos}: {dt:.2f}s')
        for pos in ['left', 'center', 'right']:
            target[pos] = results[pos]

    ch, cw = target['center'].shape[:2]
    set_state(target_key, target)
    set_state('capture_size', (cw, ch))
    return jsonify({'ok': True, 'w': cw, 'h': ch})


@bp.route('/api/capture_v2', methods=['POST'])
def capture_v2():
    data = request.json
    target = {}
    for pos in ['left', 'center', 'right']:
        b64 = data.get(pos)
        if not b64:
            return jsonify({'error': f'{pos} missing'}), 400
        try:
            raw = base64.b64decode(b64)
            nparr = np.frombuffer(raw, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return jsonify({'error': f'{pos} decode failed'}), 400
        except Exception:
            return jsonify({'error': f'{pos} decode error'}), 400
        target[pos] = img
    ch, cw = target['center'].shape[:2]
    set_state('captured_front', target)
    set_state('capture_size', (cw, ch))
    print(f'[V2] {cw}x{ch}', flush=True)
    return jsonify({'ok': True, 'w': cw, 'h': ch})


@bp.route('/api/image/<cam>')
def image(cam):
    captured = get_state('captured_front', {})
    if cam not in captured or captured[cam] is None:
        return 'Not captured', 404
    _, buf = cv2.imencode('.jpg', captured[cam], [cv2.IMWRITE_JPEG_QUALITY, 85])
    return Response(buf.tobytes(), mimetype='image/jpeg')


@bp.route('/api/image_side/<cam>')
def image_side(cam):
    captured = get_state('captured_side', {})
    if cam not in captured or captured[cam] is None:
        return 'Not captured', 404
    _, buf = cv2.imencode('.jpg', captured[cam], [cv2.IMWRITE_JPEG_QUALITY, 85])
    return Response(buf.tobytes(), mimetype='image/jpeg')
