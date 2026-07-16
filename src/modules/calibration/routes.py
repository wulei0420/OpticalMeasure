"""Calibration capture and stereo calibration routes (Tabs 2-3 of 5003)."""
import cv2
import numpy as np
import json
import os
import glob
import subprocess
import tempfile
import time
from datetime import datetime
from flask import jsonify, Response, request

from src.base.config import get_camera_config, app_path, ensure_dir
from src.base import get_state, set_state
from src.modules.calibration import bp


OS_FRAME_DIR = 'calib_frames'
ensure_dir(OS_FRAME_DIR)


def open_cam(idx, w=1920, h=1080):
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    for _ in range(5):
        cap.read()
    return cap


def read_img(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def jpeg_response(img, q=70):
    _, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return Response(buf.tobytes(), mimetype='image/jpeg')


def detect_corners(img):
    h, w = img.shape[:2]
    scale = 1.0
    if max(w, h) > 2000:
        scale = 1920.0 / max(w, h)
        small = cv2.resize(img, None, fx=scale, fy=scale)
    else:
        small = img
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    ret, corners = cv2.findChessboardCorners(gray, (17, 17), None)
    if not ret:
        return None
    cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1),
                     (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001))
    if scale != 1.0:
        corners = corners / scale
    corners_flat = corners.reshape(-1, 2)
    return _sort_corners_consistent(corners_flat)


def _sort_corners_consistent(corners):
    """Force consistent corner ordering across all camera views.

    cv2.findChessboardCorners may return corners starting from different
    corners depending on lighting/angle. This sorts by spatial position
    (top-to-bottom, left-to-right) to ensure corner[i] always refers to
    the same physical corner regardless of which view captured it.
    """
    n = len(corners)
    side = int(np.sqrt(n))
    if side * side != n:
        return corners
    idx_y = np.argsort(corners[:, 1])
    row_groups = [corners[idx_y[i * side:(i + 1) * side]] for i in range(side)]
    sorted_rows = [g[g[:, 0].argsort()] for g in row_groups]
    return np.vstack(sorted_rows)


def get_stereo_params():
    from src.base.config import get_calib_params
    cp = get_calib_params()
    if not cp:
        return None
    K_vals = [np.array(c['K'], np.float64) for c in cp['cameras']]
    R_lc = np.array(cp['stereo'][0]['R'])
    T_lc = np.array(cp['stereo'][0]['T']).reshape(3, 1)
    R_cr = np.array(cp['stereo'][1]['R'])
    T_cr = np.array(cp['stereo'][1]['T']).reshape(3, 1)
    return K_vals, R_lc, T_lc, R_cr, T_cr


# ---- Frame management ----
@bp.route('/api/frame_count')
def frame_count():
    files = sorted(glob.glob(app_path('calib_frames', '*.png')))
    groups = {}
    for f in files:
        base = os.path.basename(f)
        parts = base.split('_', 1)
        if len(parts) >= 2 and parts[0] in ('left', 'center', 'right'):
            groups.setdefault(parts[1], {})[parts[0]] = 1
    complete = sum(1 for v in groups.values() if len(v) >= 3)
    return jsonify({'total': len(files), 'groups': complete})


@bp.route('/api/clear_frames', methods=['POST'])
def clear_frames():
    files = sorted(glob.glob(app_path('calib_frames', '*.png')))
    for f in files:
        try:
            os.remove(f)
        except Exception:
            pass
    return jsonify({'ok': True, 'deleted': len(files)})


# ---- Preview (Tab 2) ----
@bp.route('/api/preview_cam/<int:idx>')
def preview_cam(idx):
    cap = open_cam(idx, 1280, 720)
    if cap is None:
        return 'Error', 500
    ret, frm = cap.read()
    cap.release()
    if not ret:
        return 'Error', 500
    return jpeg_response(frm, 50)


# ---- Capture chessboard (Tab 2) ----
@bp.route('/api/cap_cb', methods=['POST'])
def cap_cb():
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    ok_all = True
    detect = request.args.get('detect', '1') != '0'

    exe = app_path('capture_three.exe')
    captured = {'left': None, 'center': None, 'right': None}

    if os.path.exists(exe):
        with tempfile.TemporaryDirectory() as tmpd:
            cfg = get_camera_config()
            result = subprocess.run(
                [exe, '--left-idx', str(cfg.get('left', 0)),
                 '--center-idx', str(cfg.get('center', 1)),
                 '--right-idx', str(cfg.get('right', 2)),
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
                    return jsonify({'error': f'{pos} missing'}), 500
                frm = cv2.imread(fpath)
                if frm is None:
                    return jsonify({'error': f'{pos} decode failed'}), 500
                captured[pos] = frm
                # Always save latest capture to fixed path for diagnostics
                _diag_path = app_path(OS_FRAME_DIR, f'_diag_{pos}.png')
                _, _diag_buf = cv2.imencode('.png', frm)
                with open(_diag_path, 'wb') as _df:
                    _df.write(_diag_buf.tobytes())
                if detect:
                    cb = detect_corners(frm) is not None
                    if not cb:
                        ok_all = False
                    fname = app_path(OS_FRAME_DIR, f'{pos}_{ts}.png')
                    _, buf = cv2.imencode('.png', frm)
                    with open(fname, 'wb') as f:
                        f.write(buf.tobytes())
        ch, cw = captured['center'].shape[:2]
        set_state('calib_captured', captured)
        set_state('calib_size', (cw, ch))
        return jsonify({'ok': True, 'all_cb': ok_all, 'w': cw, 'h': ch, 'method': 'exe'})
    else:
        camera_config = get_camera_config()
        for pos in ['left', 'center', 'right']:
            idx = camera_config.get(pos, -1)
            if idx < 0:
                return jsonify({'error': f'{pos} not configured'}), 400
            cap = open_cam(idx, 3840, 2160)
            if cap is None:
                return jsonify({'error': f'{pos} fail'}), 500
            ret, frm = cap.read()
            cap.release()
            if not ret:
                return jsonify({'error': f'{pos} fail'}), 500
            captured[pos] = frm
            # Always save latest capture to fixed path for diagnostics
            _diag_path = app_path(OS_FRAME_DIR, f'_diag_{pos}.png')
            _, _diag_buf = cv2.imencode('.png', frm)
            with open(_diag_path, 'wb') as _df:
                _df.write(_diag_buf.tobytes())
            if detect:
                cb = detect_corners(frm) is not None
                if not cb:
                    ok_all = False
                fname = app_path(OS_FRAME_DIR, f'{pos}_{ts}.png')
                _, buf = cv2.imencode('.png', frm)
                with open(fname, 'wb') as f:
                    f.write(buf.tobytes())

    ch, cw = captured['center'].shape[:2]
    set_state('calib_captured', captured)
    set_state('calib_size', (cw, ch))
    return jsonify({'ok': True, 'all_cb': ok_all, 'w': cw, 'h': ch, 'method': 'python'})


# ---- Load existing frames (Tab 4) ----
@bp.route('/api/existing_capture', methods=['POST'])
def existing_capture():
    files = sorted(glob.glob(app_path('calib_frames', '*.png')))
    if not files:
        return jsonify({'error': 'No calib frames found'}), 400
    groups = {}
    for f in files:
        base = os.path.basename(f)
        parts = base.split('_', 1)
        if parts[0] in ['left', 'center', 'right']:
            groups.setdefault(parts[1], {})[parts[0]] = f
    cache_ts = set()
    cache_file = app_path('perframe_F.json')
    if os.path.exists(cache_file):
        with open(cache_file) as fcache:
            c = json.load(fcache)
            for k in c:
                cache_ts.add(k[:15])
    best_key = None
    for key in sorted(groups.keys(), reverse=True):
        if best_key is None:
            best_key = key
        if key[:15] in cache_ts:
            best_key = key
            break
    g = groups.get(best_key, {})
    cw = ch = 0
    captured = {}
    if len(g) >= 3:
        for pos in ['left', 'center', 'right']:
            if pos in g:
                img = read_img(g[pos])
                if img is not None:
                    captured[pos] = img
                    ch, cw = img.shape[:2]
        set_state('calib_captured', captured)
        set_state('calib_size', (cw, ch))
        return jsonify({'ok': True, 'w': cw, 'h': ch, 'group': best_key[:15]})
    return jsonify({'error': 'No complete group found'}), 400


# ---- Stereo calibration (Tab 3) ----
def _build_calib_dict(exe_data):
    return {
        'version': '1.0', 'method': 'cpp_stereoCalibrate',
        'image_size': [3840, 2160], 'square_size_mm': 10,
        'num_frames': exe_data['frames'],
        'cameras': [
            {'id': 'left', 'K': exe_data['cameras'][0]['K'], 'D': exe_data['cameras'][0]['D']},
            {'id': 'center', 'K': exe_data['cameras'][1]['K'], 'D': exe_data['cameras'][1]['D']},
            {'id': 'right', 'K': exe_data['cameras'][2]['K'], 'D': exe_data['cameras'][2]['D']}],
        'stereo': [
            {'pair': 'left_center', 'R': exe_data['stereo'][0]['R'],
             'T': exe_data['stereo'][0]['T'], 'baseline_mm': exe_data['stereo'][0]['baseline_mm']},
            {'pair': 'center_right', 'R': exe_data['stereo'][1]['R'],
             'T': exe_data['stereo'][1]['T'], 'baseline_mm': exe_data['stereo'][1]['baseline_mm']}]
    }


def _run_stereo_exe():
    exe = app_path('stereo_calibrate.exe')
    if not os.path.exists(exe):
        return None
    frames_dir = app_path('calib_frames')
    result = subprocess.run(
        [exe, '--frames', frames_dir, '--pattern', '17x17',
         '--square', '10', '--image-size', '3840x2160'],
        capture_output=True, text=True, timeout=600)
    if result.returncode == 0 and result.stdout.strip():
        return json.loads(result.stdout)
    return None


def _get_frame_groups():
    groups = {}
    frames_dir = app_path('calib_frames')
    for f in sorted(glob.glob(os.path.join(frames_dir, '*.png'))):
        base = os.path.basename(f)
        parts = base.split('_', 1)
        if parts[0] in ['left', 'center', 'right']:
            key = parts[1]
            groups.setdefault(key, {})[parts[0]] = f
    return groups


def save_json_file(filename, data):
    tmp = app_path(filename + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, app_path(filename))


@bp.route('/api/run_calib', methods=['POST'])
def run_calib():
    exe = app_path('stereo_calibrate.exe')
    if not os.path.exists(exe):
        return jsonify({'error': 'stereo_calibrate.exe not found. Rebuild via build.bat'}), 500

    try:
        exe_data = _run_stereo_exe()
    except Exception as e:
        return jsonify({'error': f'C++ calibration failed: {e}'}), 500

    if not exe_data or not exe_data.get('ok') or exe_data.get('frames', 0) < 10:
        return jsonify({'error': 'C++ calibration produced insufficient frames'}), 500

    calib_params = _build_calib_dict(exe_data)
    save_json_file('calib_params.json', calib_params)

    cp = get_stereo_params()
    filter_log = []
    removed_keys = []
    MAX_ITER = 5
    MIN_FRAMES = 20
    THRESHOLD_FACTOR = 2.5

    for iteration in range(MAX_ITER):
        groups = _get_frame_groups()
        if len(groups) < MIN_FRAMES:
            filter_log.append(f'iter{iteration}: only {len(groups)} groups, stop')
            break

        epi_results = []
        for key, g in sorted(groups.items()):
            if len(g) < 3:
                continue
            try:
                imgs = {}
                for pos in ['left', 'center', 'right']:
                    if pos in g:
                        imgs[pos] = read_img(g[pos])
                if len(imgs) < 3:
                    continue
                r = _epi_verify_group(imgs['left'], imgs['center'], imgs['right'], cp)
                if r is None:
                    continue
                epi_results.append((key, r[0], r[1], r[2], r[3]))
            except Exception:
                continue

        if not epi_results:
            filter_log.append(f'iter{iteration}: no groups verified, stop')
            break

        max_errs = [max(r[1], r[2]) for r in epi_results]
        median = float(np.median(max_errs))
        threshold = THRESHOLD_FACTOR * median

        bad = []
        for key, max_lc, max_cr, avg_lc, avg_cr in epi_results:
            if max(max_lc, max_cr) > threshold:
                bad.append(key)

        if not bad:
            filter_log.append(
                f'iter{iteration}: all {len(epi_results)} groups within '
                f'{THRESHOLD_FACTOR}x median ({median:.1f}px), converged')
            break

        if len(groups) - len(bad) < MIN_FRAMES:
            filter_log.append(
                f'iter{iteration}: removing {len(bad)} groups would leave <{MIN_FRAMES}, '
                f'keeping best {MIN_FRAMES}')
            epi_results.sort(key=lambda x: max(x[1], x[2]))
            to_remove = epi_results[MIN_FRAMES:]
            bad = [r[0] for r in to_remove]

        for key in bad:
            g = groups.get(key, {})
            for pos, fpath in g.items():
                try:
                    os.rename(fpath, fpath + '.skipped')
                except Exception:
                    pass
            removed_keys.append(key[:15])

        filter_log.append(
            f'iter{iteration}: removed {len(bad)} groups '
            f'(threshold {threshold:.1f}px, median {median:.1f}px), '
            f'{len(groups) - len(bad)} remaining')

        try:
            exe_data = _run_stereo_exe()
        except Exception as e:
            filter_log.append(f'iter{iteration}: re-run failed: {e}')
            break

        if not exe_data or not exe_data.get('ok') or exe_data.get('frames', 0) < 10:
            filter_log.append(f'iter{iteration}: re-run produced insufficient frames')
            break

        calib_params = _build_calib_dict(exe_data)
        save_json_file('calib_params.json', calib_params)
        cp = get_stereo_params()

    bl_lc = calib_params['stereo'][0]['baseline_mm']
    bl_cr = calib_params['stereo'][1]['baseline_mm']
    rms = [exe_data['stereo'][0].get('rms', 0),
           exe_data['stereo'][1].get('rms', 0)]

    return jsonify({
        'ok': True,
        'frames': exe_data['frames'],
        'bl_lc': round(bl_lc, 2),
        'bl_cr': round(bl_cr, 2),
        'rms': [round(r, 4) for r in rms],
        'method': 'cpp_stereoCalibrate',
        'filter_log': filter_log,
        'removed_groups': len(removed_keys),
        'iterations': len([l for l in filter_log if l.startswith('iter')])
    })


def _epi_verify_group(img_l, img_c, img_r, cp):
    corners_c = detect_corners(img_c)
    corners_l = detect_corners(img_l)
    corners_r = detect_corners(img_r)
    if corners_c is None or corners_l is None or corners_r is None:
        return None

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

    al = np.array(errors_l)
    ar = np.array(errors_r)
    return float(np.max(al)), float(np.max(ar)), float(np.mean(al)), float(np.mean(ar))


# ---- Image serving ----
@bp.route('/api/image/<cam>')
def image(cam):
    captured = get_state('calib_captured', {})
    if cam not in captured or captured[cam] is None:
        return 'Not captured', 404
    return jpeg_response(captured[cam], 85)
