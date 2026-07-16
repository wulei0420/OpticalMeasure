"""Live stream routes for iPad single-camera preview."""
import threading
import time

import cv2
from flask import jsonify, Response

from src.base.config import get_camera_config
from src.modules.stream import bp

_stream_cap = None
_stream_frame = None
_stream_running = False
_stream_thread = None
_stream_lock = threading.Lock()


def _stream_loop():
    global _stream_frame, _stream_running, _stream_cap
    cfg = get_camera_config()
    idx = cfg.get('center', 0)
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    _stream_cap = cap
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
    for _ in range(5):
        cap.read()
    while _stream_running:
        try:
            ret, frm = cap.read()
            if ret:
                _, buf = cv2.imencode('.jpg', frm, [cv2.IMWRITE_JPEG_QUALITY, 50])
                with _stream_lock:
                    _stream_frame = buf.tobytes()
        except Exception:
            pass
        time.sleep(0.04)
    cap.release()


def stop_stream():
    global _stream_running, _stream_thread, _stream_frame, _stream_cap
    _stream_running = False
    if _stream_cap is not None:
        try:
            _stream_cap.release()
        except Exception:
            pass
        _stream_cap = None
    with _stream_lock:
        _stream_frame = None


@bp.route('/api/stream/start')
def stream_start():
    global _stream_running, _stream_thread
    if not _stream_running:
        _stream_running = True
        _stream_thread = threading.Thread(target=_stream_loop, daemon=True)
        _stream_thread.start()
    return jsonify({'ok': True})


@bp.route('/api/stream/center_frame')
def stream_center_frame():
    global _stream_frame
    with _stream_lock:
        if _stream_frame is None:
            return 'No frame', 404
        return Response(_stream_frame, mimetype='image/jpeg')


@bp.route('/api/stream/stop')
def stream_stop():
    stop_stream()
    return jsonify({'ok': True})
