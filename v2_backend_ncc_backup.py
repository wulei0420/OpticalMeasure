"""V2.0 Backend v6 - Left-prior + right-constrained matching"""
from flask import Flask, request, jsonify, Response, send_from_directory
import cv2, numpy as np, json, os, threading
from datetime import datetime

app = Flask(__name__)

with open('calib_params.json') as f: calib = json.load(f)
K = [np.array(c['K'], np.float64) for c in calib['cameras']]
R_lc = np.array(calib['stereo'][0]['R']); T_lc = np.array(calib['stereo'][0]['T']).reshape(3,1)
R_cr = np.array(calib['stereo'][1]['R']); T_cr = np.array(calib['stereo'][1]['T']).reshape(3,1)
BL_LC = float(np.linalg.norm(T_lc)); BL_CR = float(np.linalg.norm(T_cr))
FX = float((K[0][0,0] + K[1][0,0] + K[2][0,0]) / 3)

if os.path.exists('camera_config.json'):
    with open('camera_config.json') as f: CAM = json.load(f)
else: CAM = {'left':0,'center':1,'right':2}

captured = {'left':None,'center':None,'right':None}
cw = ch = 0
pcap, plock = None, threading.Lock()
cap_pool = {}; cap_plock = threading.Lock()

def grab_camera(idx):
    with cap_plock:
        if idx not in cap_pool or not cap_pool[idx].isOpened():
            cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            cap_pool[idx] = cap
        else:
            cap = cap_pool[idx]
        for _ in range(4): cap.read()
        ret, frm = cap.read()
    return frm if ret else None

def match_side(cx, cy, side, ref_disp=None):
    if side == 'left':
        img = captured['left']; tgtK = K[0]
        R_use = R_lc.T.copy(); t_use = (-R_lc.T @ T_lc).copy()
        base_disp, margin = 345, 40
    else:
        img = captured['right']; tgtK = K[2]
        R_use = R_cr.copy(); t_use = -T_cr.copy()
        base_disp, margin = 374, 40
    if img is None: return None

    h_img, w_img = img.shape[:2]
    cxi, cyi = int(cx), int(cy)

    Tx = np.array([[0,-t_use[2,0],t_use[1,0]],[t_use[2,0],0,-t_use[0,0]],[-t_use[1,0],t_use[0,0],0]])
    F = np.linalg.inv(tgtK).T @ Tx @ R_use @ np.linalg.inv(K[1])
    a, b, c_line = [float(x) for x in F @ np.array([cx, cy, 1.0])]

    half = 35  # Larger template for better discrimination
    y1, y2 = max(0, cyi-half), min(ch-1, cyi+half)
    x1, x2 = max(0, cxi-half), min(cw-1, cxi+half)
    tpl = cv2.cvtColor(captured['center'][y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    th, tw = tpl.shape
    tpl_m = tpl.astype(np.float64) - tpl.mean()
    tpl_n = np.sqrt((tpl_m * tpl_m).sum())

    s_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Use reference disparity if provided, else base
    center_disp = ref_disp if ref_disp is not None else base_disp
    use_margin = 30 if ref_disp is not None else margin

    if side == 'left':
        xs = max(tw, cxi + center_disp - use_margin)
        xe = min(w_img - tw, cxi + center_disp + use_margin)
    else:
        xs = max(tw, cxi - center_disp - use_margin)
        xe = min(w_img - tw, cxi - center_disp + use_margin)

    best = -2; bx, by = cxi, cyi
    for sx in range(int(xs), int(xe), 1):
        sy = int(-(c_line + a*sx) / b) if abs(b) > 1e-6 else cyi
        if sy < th or sy >= h_img - th: continue
        roi = s_gray[sy-th//2:sy+th//2, sx-tw//2:sx+tw//2]
        if roi.shape != tpl.shape: continue
        rm = roi.astype(np.float64) - roi.mean()
        rn = np.sqrt((rm * rm).sum())
        corr = float((rm * tpl_m).sum() / (rn * tpl_n)) if rn > 0 and tpl_n > 0 else 0
        if corr > best: best = corr; bx, by = sx, sy

    return {'x': int(bx), 'y': int(by), 'score': round(best, 3)}

def match_and_tri(cx, cy):
    left = match_side(cx, cy, 'left')
    right = None
    if left:
        dl = abs(left['x'] - cx)
        z_est = FX * BL_LC / dl if dl > 0 else 1000
        rd = int(FX * BL_CR / z_est)
        right = match_side(cx, cy, 'right', rd)

    if left and right:
        dl_raw = abs(left['x'] - cx)
        dr_raw = abs(cx - right['x'])
        
        dl = dl_raw * 1.13
        dr = dr_raw * 1.17
        
        Z_l = FX * BL_LC / dl if dl > 0 else 1000
        Z_r = FX * BL_CR / dr if dr > 0 else 1000
        cons = abs(Z_l - Z_r)
        
        if cons < 150:
            wl = 0.7 if left['score'] > right['score'] else 0.5
            Z = Z_l * wl + Z_r * (1 - wl)
        else:
            Z = Z_l
        
        X = (cx - cw/2) * Z / FX
        Y = (cy - ch/2) * Z / FX
        return left, right, [round(X,1), round(Y,1), round(Z,1)], round(cons,1)
    return left, right, [0,0,0], 0

def get_preview():
    global pcap
    with plock:
        if pcap is None or not pcap.isOpened():
            pcap = cv2.VideoCapture(CAM['center'], cv2.CAP_DSHOW)
            pcap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920); pcap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            for _ in range(10): pcap.read()
        ret, frm = pcap.read()
    return frm if ret else None

@app.route('/')
def index():
    return send_from_directory('.', 'v2_app.html')

@app.route('/api/status')
def status():
    return jsonify({'calib': True, 'captured': captured['center'] is not None})

@app.route('/api/preview')
def preview():
    cap = cv2.VideoCapture(CAM['center'], cv2.CAP_DSHOW)
    if not cap.isOpened(): return 'Camera error', 500
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    for _ in range(3): cap.read()
    ret, frm = cap.read(); cap.release()
    if not ret: return 'Read failed', 500
    _, buf = cv2.imencode('.jpg', frm, [cv2.IMWRITE_JPEG_QUALITY, 50])
    return Response(buf.tobytes(), mimetype='image/jpeg')

@app.route('/api/prepare', methods=['POST'])
def prepare():
    return jsonify({'ready': True})

@app.route('/api/close_cams', methods=['POST'])
def close_cams():
    global pcap, cap_pool
    with plock:
        if pcap is not None: pcap.release(); pcap = None
    with cap_plock:
        for k in list(cap_pool.keys()):
            if cap_pool[k].isOpened(): cap_pool[k].release()
        cap_pool.clear()
    return jsonify({'ok': True})

@app.route('/api/capture', methods=['POST'])
def capture():
    global captured, cw, ch, pcap
    # Release preview camera first
    with plock:
        if pcap is not None: pcap.release(); pcap = None
    # Open all 3 cameras sequentially (proven reliable)
    for pos, idx in CAM.items():
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
        for _ in range(5): cap.read()
        ret, frm = cap.read(); cap.release()
        if not ret: return jsonify({'error': f'{pos} failed'}), 500
        captured[pos] = frm
    ch, cw = captured['center'].shape[:2]
    return jsonify({'ok': True, 'w': cw, 'h': ch})

@app.route('/api/capture_v2', methods=['POST'])
def capture_v2():
    """Browser-based capture: receives base64 images from getUserMedia."""
    global captured, cw, ch
    import base64
    data = request.json
    for pos in ['left', 'center', 'right']:
        b64 = data.get(pos)
        if not b64: return jsonify({'error': f'{pos} missing'}), 400
        try:
            raw = base64.b64decode(b64)
            nparr = np.frombuffer(raw, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None: return jsonify({'error': f'{pos} decode failed'}), 400
        except: return jsonify({'error': f'{pos} decode error'}), 400
        captured[pos] = img
    ch, cw = captured['center'].shape[:2]
    print(f'[V2] {cw}x{ch}', flush=True)
    return jsonify({'ok': True, 'w': cw, 'h': ch})

@app.route('/api/match', methods=['POST'])
def match():
    if captured['center'] is None: return jsonify({'error': 'Capture first'}), 400
    d = request.json
    left, right, pt3d, cons = match_and_tri(d['cx'], d['cy'])
    return jsonify({'left': left, 'right': right, '3d': pt3d, 'consistency': cons})

@app.route('/api/feedback', methods=['POST'])
def feedback():
    data = request.json
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    os.makedirs('feedback', exist_ok=True)
    with open(os.path.join('feedback', f'feedback_{ts}.json'), 'w') as f:
        json.dump(data, f, indent=2)
    return jsonify({'ok': True})

@app.route('/api/image/<cam>')
def image(cam):
    if cam not in captured or captured[cam] is None: return 'Not captured', 404
    _, buf = cv2.imencode('.jpg', captured[cam], [cv2.IMWRITE_JPEG_QUALITY, 85])
    return Response(buf.tobytes(), mimetype='image/jpeg')

if __name__ == '__main__':
    print(f'V2 Backend v6 L-C={BL_LC:.1f}mm C-R={BL_CR:.1f}mm')
    app.run(host='0.0.0.0', port=5002, debug=False, threaded=False)
