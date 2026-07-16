"""
OpticalMeasure V2.0 MVP v3
三摄 -> 极线辅助标注 -> 三角测量 -> PD/PH
"""
import cv2, numpy as np, json, os

with open('calib_params.json') as f: calib = json.load(f)
K = [np.array(c['K'], np.float64) for c in calib['cameras']]
R_lc = np.array(calib['stereo'][0]['R']); T_lc = np.array(calib['stereo'][0]['T']).reshape(3,1)
R_cr = np.array(calib['stereo'][1]['R']); T_cr = np.array(calib['stereo'][1]['T']).reshape(3,1)

# ====== Identify cameras ======
print('\n=== Identify cameras ===')
print('Click LEFT/CENTER/RIGHT button on each camera window.')
CAM = {'left': None, 'center': None, 'right': None}
assigned = []

for idx in range(3):
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    if not cap.isOpened():
        print(f'Idx{idx}: cannot open'); continue
    
    # Mouse callback for this window
    choice = [None]
    def make_cb(i, ch):
        def cb(e, x, y, flags, p):
            if e == cv2.EVENT_LBUTTONDOWN:
                if y > 540 - 50:  # Button area
                    bw = 960 // 4
                    if x < bw: ch[0] = 'left'
                    elif x < bw*2: ch[0] = 'center'
                    elif x < bw*3: ch[0] = 'right'
                    else: ch[0] = 'skip'
        return cb

    cv2.namedWindow(f'Camera {idx}', cv2.WINDOW_NORMAL)
    cv2.resizeWindow(f'Camera {idx}', 960, 580)
    cv2.setMouseCallback(f'Camera {idx}', make_cb(idx, choice))
    
    print(f'\nCamera {idx}: Click button to assign')
    while choice[0] is None:
        ret, frm = cap.read()
        if not ret: continue
        s = cv2.resize(frm, (960, 540))
        # Button bar at bottom
        cv2.rectangle(s, (0, 510), (240, 540), (255, 0, 0), -1)
        cv2.putText(s, 'LEFT', (80, 532), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2)
        cv2.rectangle(s, (240, 510), (480, 540), (0, 255, 0), -1)
        cv2.putText(s, 'CENTER', (310, 532), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,0,0), 2)
        cv2.rectangle(s, (480, 510), (720, 540), (255, 0, 0), -1)
        cv2.putText(s, 'RIGHT', (550, 532), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2)
        cv2.rectangle(s, (720, 510), (960, 540), (100, 100, 100), -1)
        cv2.putText(s, 'SKIP', (780, 532), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2)
        cv2.putText(s, f'Camera {idx}', (400, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,255,255), 2)
        cv2.imshow(f'Camera {idx}', s)
        cv2.waitKey(30)
    
    pos = choice[0]
    if pos != 'skip' and pos not in assigned:
        CAM[pos] = idx; assigned.append(pos)
        print(f'  -> {pos.upper()}')
    else:
        print(f'  -> SKIP')
    cap.release(); cv2.destroyAllWindows()

# Fill gaps
for pos in ['left','center','right']:
    if CAM[pos] is None:
        for idx in range(3):
            if idx not in CAM.values():
                CAM[pos] = idx; break
print(f'\nL=Idx{CAM["left"]} C=Idx{CAM["center"]} R=Idx{CAM["right"]}')

# Save config
with open('camera_config.json', 'w') as f: json.dump(CAM, f, indent=2)

# ====== Preview & Capture ======
pv = cv2.VideoCapture(CAM['center'], cv2.CAP_DSHOW)
pv.set(cv2.CAP_PROP_FRAME_WIDTH, 1920); pv.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
cv2.namedWindow('Preview', cv2.WINDOW_NORMAL); cv2.resizeWindow('Preview', 1280, 720)
print('\nAdjust position. Press ENTER to capture...')
while True:
    ret, frm = pv.read()
    if ret:
        s = cv2.resize(frm, (1280, 720))
        cv2.putText(s, 'ENTER to capture', (450, 680), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 2)
        cv2.imshow('Preview', s)
    if cv2.waitKey(30) & 0xFF == 13: break
pv.release(); cv2.destroyAllWindows()

raw = {}
for pos, idx in CAM.items():
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    for _ in range(3): cap.read()
    ret, f = cap.read(); cap.release()
    if ret: raw[pos] = f
    else: print(f'{pos} FAIL'); exit(1)
h, w = raw['center'].shape[:2]
imgs = [raw['left'], raw['center'], raw['right']]

# Projection matrices (center at origin) — rebuild after camera ID
Pc = K[1] @ np.hstack([np.eye(3), np.zeros((3,1))])
Pl = K[0] @ np.hstack([R_lc.T, T_lc])
Pr = K[2] @ np.hstack([R_cr, -T_cr])

# Epipolar lines
def epiline(px, py, R, T, tgt_K):
    Tx = np.array([[0,-T[2,0],T[1,0]],[T[2,0],0,-T[0,0]],[-T[1,0],T[0,0],0]])
    F = np.linalg.inv(tgt_K).T @ Tx @ R @ np.linalg.inv(K[1])
    a, b, c = F @ np.array([px, py, 1.0])
    return a, b, c

def tri(ptL, ptC, ptR):
    p4 = cv2.triangulatePoints(Pl, Pc, np.float64(ptL[:2]), np.float64(ptC[:2]))
    p1 = (p4[:3]/p4[3]).flatten()
    p4 = cv2.triangulatePoints(Pc, Pr, np.float64(ptC[:2]), np.float64(ptR[:2]))
    p2 = (p4[:3]/p4[3]).flatten()
    return (p1*0.6 + p2*0.4)

# Annotation
groups = []
pt3d = []
dww = 420
ph_disp = int(h*dww/w)

def draw():
    sp = [cv2.resize(imgs[i], (dww, ph_disp)) for i in range(3)]
    # Draw points
    for grp in groups:
        for i in range(3):
            if grp[i][0] > 0:
                px = int(grp[i][0] * dww / w); py = int(grp[i][1] * ph_disp / h)
                cv2.circle(sp[i], (px, py), 5, (0, 255, 0), 2)
    # Labels and hints
    for i, nm in enumerate(['LEFT','CENTER','RIGHT']):
        cv2.putText(sp[i], nm, (5, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,255), 2)
    n = len([g for g in groups if g[0][0]>0 and g[1][0]>0 and g[2][0]>0])
    if groups and groups[-1][1][0] > 0:
        if groups[-1][0][0] <= 0: hint = f'Points done: {n} | Now click LEFT panel'
        elif groups[-1][2][0] <= 0: hint = f'Points done: {n} | Now click RIGHT panel'
        else: hint = f'Points done: {n} | Click CENTER for next point'
    else:
        hint = f'Points done: {n} | Click CENTER to start point #{n+1}'
    cv2.putText(sp[1], hint, (5, ph_disp-10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,255,255), 1)
    # Results
    if len(pt3d) >= 2:
        pd = np.linalg.norm(pt3d[1] - pt3d[0])
        cv2.putText(sp[1], f'PD:{pd:.1f}mm', (dww-120, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,0), 2)
    for ei, eye in enumerate(['right','left']):
        if len(pt3d) > 2+ei*4+1:
            phv = pt3d[2+ei*4+1][1] - pt3d[ei][1]
            cv2.putText(sp[1], f'{eye[:1]}PH:{phv:.1f}', (dww-120, 45+ei*20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,200,255), 2)
    return np.hstack(sp)

def mouse(e, x, y, flags, p):
    global groups, pt3d
    if e != cv2.EVENT_LBUTTONDOWN: return
    col = x // dww
    if col >= 3: return
    cx = int(x % dww * w / dww)
    cy = int(y * h / ph_disp)
    nm = ['LEFT','CENTER','RIGHT']
    print(f'  {nm[col]}: ({cx},{cy})')
    
    if col == 1:  # Center click: replace or start new
        if groups and groups[-1][0][0] <= 0 and groups[-1][2][0] <= 0:
            groups[-1][1] = (cx, cy)  # replace center of current incomplete group
        else:
            groups.append([(0,0), (cx,cy), (0,0)])  # start new group
    elif groups:
        groups[-1][col] = (cx, cy)
        grp = groups[-1]
        if grp[0][0] > 0 and grp[1][0] > 0 and grp[2][0] > 0:
            p3 = tri(grp[0], grp[1], grp[2])
            pt3d.append(p3)
            print(f'  -> 3D:[{p3[0]:.0f},{p3[1]:.0f},{p3[2]:.0f}]mm')
            if len(pt3d) >= 2:
                print(f'     PD={np.linalg.norm(pt3d[1]-pt3d[0]):.1f}mm')

cv2.namedWindow('Annotate', cv2.WINDOW_NORMAL)
cv2.resizeWindow('Annotate', dww*3, ph_disp+30)
cv2.setMouseCallback('Annotate', mouse)

print('\n1. Click CENTER panel for a feature (pupil/frame)')
print('2. Yellow dots = epipolar line. Click L/R ON that line.')
print('Q=quit BS=undo\n')

while True:
    cv2.imshow('Annotate', draw())
    k = cv2.waitKey(30) & 0xFF
    if k == ord('q'): break
    if k == 8:
        if groups: groups.pop()
        if pt3d: pt3d.pop()
cv2.destroyAllWindows()

print('\n=== RESULTS ===')
if len(pt3d) >= 2:
    rp, lp = pt3d[1], pt3d[0]
    print(f'PD: {np.linalg.norm(lp-rp):.1f}mm')
    if len(pt3d) >= 4:
        ri=pt3d[2]; li=pt3d[6] if len(pt3d)>=7 else None
        if ri is not None and li is not None:
            mx=(ri[0]+li[0])/2
            print(f'RPD:{mx-rp[0]:.1f} LPD:{lp[0]-mx:.1f}')
    for ei, eye in enumerate(['right','left']):
        if len(pt3d)>2+ei*4+1:
            print(f'{eye}PH:{pt3d[2+ei*4+1][1]-pt3d[ei][1]:.1f}')
