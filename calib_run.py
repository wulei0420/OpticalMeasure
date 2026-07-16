import cv2, numpy as np, json, os, glob

SQUARE_SIZE = 19.614
PATTERN = (9, 6)
FRAME_DIR = 'calib_frames'
OUTPUT_FILE = 'calib_params.json'
POS_MAP = {'left': 0, 'center': 1, 'right': 2}

def read_img(path):
    with open(path, 'rb') as f: data = f.read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)

files = sorted(glob.glob(os.path.join(FRAME_DIR, '*.png')))
groups = {}
for f in files:
    parts = os.path.basename(f).split('_', 1)
    if parts[0] not in POS_MAP: continue
    groups.setdefault(parts[1], {})[POS_MAP[parts[0]]] = f
valid = {k: v for k, v in groups.items() if len(v) == 3}
print(f'{len(files)} files, {len(valid)} groups')

objp = np.zeros((54, 3), np.float32)
objp[:, :2] = np.mgrid[0:9, 0:6].T.reshape(-1, 2) * SQUARE_SIZE
objpts = [[], [], []]; imgpts = [[], [], []]; img_size = None

for key in sorted(valid.keys()):
    g = valid[key]; ok = True; cl = []
    for ci in [0, 1, 2]:
        if ci not in g: ok = False; break
        img = read_img(g[ci])
        if img is None: ok = False; break
        if img_size is None: img_size = (img.shape[1], img.shape[0])
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        ret, corners = cv2.findChessboardCorners(gray, PATTERN, None)
        if ret:
            cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1),
                             (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001))
            cl.append(corners)
        else: ok = False; break
    if not ok: continue
    for i in range(3):
        objpts[i].append(objp.copy())
        imgpts[i].append(cl[i].copy())

total = len(objpts[0])
# Subsample if too many frames
if total > 40:
    step = total // 25
    for i in range(3):
        objpts[i] = objpts[i][::step]
        imgpts[i] = imgpts[i][::step]
    total = len(objpts[0])
print(f'Valid frames: {total}')

# Individual calibration
K = []; D = []
for i in range(3):
    ret, mtx, dist, _, _ = cv2.calibrateCamera(objpts[i], imgpts[i], img_size, None, None)
    K.append(mtx.copy()); D.append(dist.copy())
    print(f'  Cam{i}: RMS={ret:.4f}px  fx={mtx[0,0]:.1f}')

# Per-frame PnP with outlier rejection
print('\n--- Stereo (per-frame PnP + filtering) ---')
def compute_stereo_pnp(op0, ip0, op1, ip1, Kcam0, Dcam0, Kcam1, Dcam1, name):
    rvecs = []; tvecs = []; errors = []
    for j in range(len(op0)):
        ret0, rv0, tv0 = cv2.solvePnP(op0[j], ip0[j], Kcam0, Dcam0)
        ret1, rv1, tv1 = cv2.solvePnP(op1[j], ip1[j], Kcam1, Dcam1)
        if not ret0 or not ret1: continue
        
        R0, _ = cv2.Rodrigues(rv0); R1, _ = cv2.Rodrigues(rv1)
        # Camera positions in world coords: C = -R^T * t
        C0 = -R0.T @ tv0
        C1 = -R1.T @ tv1
        # Relative pose from cam0 to cam1 in world coords
        R_rel = R1 @ R0.T
        T_rel = C1 - C0
        
        # Reprojection error
        proj0, _ = cv2.projectPoints(op0[j], rv0, tv0, Kcam0, Dcam0)
        proj1, _ = cv2.projectPoints(op1[j], rv1, tv1, Kcam1, Dcam1)
        err = np.mean(np.linalg.norm(ip0[j] - proj0, axis=2)) + np.mean(np.linalg.norm(ip1[j] - proj1, axis=2))
        
        rvecs.append(cv2.Rodrigues(R_rel)[0])
        tvecs.append(T_rel.flatten())
        errors.append(err)
    
    # Keep only the best 15 frames (most stable)
    idx_sorted = np.argsort(errors)
    keep = min(15, max(len(errors) // 3, 5))
    best_idx = idx_sorted[:keep]
    
    rvec_med = np.median([rvecs[i] for i in best_idx], axis=0)
    tvec_med = np.median([tvecs[i] for i in best_idx], axis=0)
    Rmat, _ = cv2.Rodrigues(rvec_med)
    bl = np.linalg.norm(tvec_med)
    
    print(f'  {name}: {keep}/{len(errors)} frames used (filtered by reproj error)')
    print(f'  {name}: Baseline={bl:.2f}mm  T={[round(t,2) for t in tvec_med]}')
    return Rmat, tvec_med, bl

R_lc, T_lc, bl_lc = compute_stereo_pnp(
    objpts[0], imgpts[0], objpts[1], imgpts[1],
    K[0], D[0], K[1], D[1], 'Left-Center')

R_cr, T_cr, bl_cr = compute_stereo_pnp(
    objpts[1], imgpts[1], objpts[2], imgpts[2],
    K[1], D[1], K[2], D[2], 'Center-Right')

result = {
    'version': '1.0', 'method': 'pnp_stereo_filtered',
    'image_size': list(img_size), 'square_size_mm': SQUARE_SIZE, 'num_frames': total,
    'cameras': [
        {'id': 'left',   'K': K[0].tolist(), 'D': D[0].ravel().tolist()},
        {'id': 'center', 'K': K[1].tolist(), 'D': D[1].ravel().tolist()},
        {'id': 'right',  'K': K[2].tolist(), 'D': D[2].ravel().tolist()},
    ],
    'stereo': [
        {'pair': 'left_center',  'R': R_lc.tolist(), 'T': T_lc.tolist(), 'baseline_mm': round(bl_lc, 2)},
        {'pair': 'center_right', 'R': R_cr.tolist(), 'T': T_cr.tolist(), 'baseline_mm': round(bl_cr, 2)},
    ],
}

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2, ensure_ascii=False)

print(f'\nDone -> {OUTPUT_FILE}')
