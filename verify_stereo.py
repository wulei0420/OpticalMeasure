"""
三摄精度验证 - 手动标点版
在左右中三个画面各标同一个棋盘格角点,三角测量算距离
"""
import cv2, numpy as np, json, os, glob

with open('calib_params.json', 'r') as f: calib = json.load(f)
K = [np.array(c['K'], np.float64) for c in calib['cameras']]
D = [np.array(c['D'], np.float64) for c in calib['cameras']]
R_lc = np.array(calib['stereo'][0]['R'], np.float64); T_lc = np.array(calib['stereo'][0]['T'], np.float64).reshape(3,1)
R_cr = np.array(calib['stereo'][1]['R'], np.float64); T_cr = np.array(calib['stereo'][1]['T'], np.float64).reshape(3,1)

SQUARE_MM = 19.614
d = 'calib_frames'
files = sorted(glob.glob(os.path.join(d, 'left_*.png')))
g = len(files) // 2

def read_img(path):
    with open(path, 'rb') as f: return cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)

imgs = [read_img(f) for f in [files[g], files[g].replace('left','center'), files[g].replace('left','right')]]
h, w = imgs[0].shape[:2]
names = ['LEFT', 'CENTER', 'RIGHT']

# 简单三角测量: R≈I, 用视差
def simple_tri(ptL, ptC, ptR):
    fx = (K[0][0,0] + K[1][0,0] + K[2][0,0]) / 3
    B_lc = np.linalg.norm(T_lc)
    B_cr = np.linalg.norm(T_cr)
    # 深度 = f * B / disparity
    disp_lc = abs(ptL[0] - ptC[0])
    disp_cr = abs(ptC[0] - ptR[0])
    Z_lc = fx * B_lc / disp_lc if disp_lc > 0 else 1000
    Z_cr = fx * B_cr / disp_cr if disp_cr > 0 else 1000
    Z = (Z_lc + Z_cr) / 2
    X = (ptC[0] - w/2) * Z / fx
    Y = (ptC[1] - h/2) * Z / fx
    return np.array([X, Y, Z])

pts = []

def mouse_cb(e, x, y, flags, param):
    global pts
    if e != cv2.EVENT_LBUTTONDOWN: return
    dw = 500
    scales_h = [int(imgs[i].shape[0]*dw/imgs[i].shape[1]) for i in range(3)]
    
    def is_valid(p):
        return p[0][0] > 0 and p[1][0] > 0 and p[2][0] > 0
    
    if x < dw:  # LEFT
        cx = int(x * w / dw); cy = int(y * h / scales_h[0])
        if pts: pts[-1][0] = (cx, cy)
        print(f'  LEFT  = ({cx}, {cy})')
    elif x < dw*2:  # CENTER
        cx = int((x-dw) * w / dw); cy = int(y * h / scales_h[1])
        pts.append([(0,0), (cx,cy), (0,0)])
        print(f'  CENTER= ({cx}, {cy})')
    else:  # RIGHT
        cx = int((x-dw*2) * w / dw); cy = int(y * h / scales_h[2])
        if pts: pts[-1][2] = (cx, cy)
        print(f'  RIGHT = ({cx}, {cy})')
    
    # 当最近两个点都完整（左右中都有），计算距离
    if len(pts) >= 2 and is_valid(pts[-2]) and is_valid(pts[-1]):
        p1 = simple_tri(*pts[-2])
        p2 = simple_tri(*pts[-1])
        d = np.linalg.norm(p2 - p1)
        print(f'  >>> DISTANCE: {d:.2f}mm (expected {SQUARE_MM}, err={abs(d-SQUARE_MM):.2f})')

cv2.namedWindow('Verify', cv2.WINDOW_NORMAL)
cv2.resizeWindow('Verify', 1500, 480)
cv2.setMouseCallback('Verify', mouse_cb)

print(f'Grid: {SQUARE_MM}mm | Baseline L-C: {np.linalg.norm(T_lc):.1f}mm C-R: {np.linalg.norm(T_cr):.1f}mm')
print('Click CENTER, LEFT, RIGHT for each corner. Q=quit\n')

while True:
    dw = 500
    panels = []
    for i in range(3):
        s = cv2.resize(imgs[i], (dw, int(imgs[i].shape[0]*dw/imgs[i].shape[1])))
        sh = s.shape[0]
        for p in pts:
            px, py = p[i]
            if px <= 0: continue
            sx = int(px * dw / w); sy = int(py * sh / h)
            cv2.circle(s, (sx, sy), 6, (0,255,0), 2)
            cv2.putText(s, f'{px},{py}', (sx+8, sy-8), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,0), 1)
        cv2.putText(s, names[i], (5,18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,255), 2)
        panels.append(s)
    cv2.imshow('Verify', np.hstack(panels))
    if cv2.waitKey(30) & 0xFF == ord('q'): break
cv2.destroyAllWindows()
