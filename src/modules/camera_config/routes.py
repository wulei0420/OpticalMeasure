"""Camera setup routes — Tab 1 of calibration server (5003)."""
import cv2
from flask import jsonify

from src.base.config import get_camera_config, save_camera_config
from src.modules.camera_config import bp


def _open_cam(idx, w=1920, h=1080):
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
    for _ in range(5):
        cap.read()
    return cap


@bp.route('/api/cam_test/<int:idx>')
def cam_test(idx):
    cap = _open_cam(idx, 1920, 1080)
    if cap is None:
        return 'Cannot open', 500
    ret, frm = cap.read()
    cap.release()
    if not ret:
        return 'Read failed', 500
    _, buf = cv2.imencode('.jpg', frm, [cv2.IMWRITE_JPEG_QUALITY, 60])
    from flask import Response
    return Response(buf.tobytes(), mimetype='image/jpeg')


@bp.route('/api/set_cams', methods=['POST'])
def set_cams():
    from flask import request
    cfg = request.json
    save_camera_config(cfg)
    return jsonify({'ok': True})


@bp.route('/api/get_cams')
def get_cams():
    return jsonify(get_camera_config())
