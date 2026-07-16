"""
三摄标定采集 - 跳过识别，直接用已知映射
左=Idx0  中=Idx1  右=Idx2
空格=拍照 | Q=退出
"""
import cv2, numpy as np, os
from datetime import datetime

SQUARE_SIZE = 19.614
PATTERN = (9, 6)
FRAME_DIR = 'calib_frames'
os.makedirs(FRAME_DIR, exist_ok=True)

mapping = {'left': 0, 'center': 1, 'right': 2}
print(f'Left=Idx0  Center=Idx1  Right=Idx2')
print(f'{SQUARE_SIZE:.2f}mm squares, {PATTERN[0]}x{PATTERN[1]} corners')
print('SPACE=capture | Q=quit\n')

preview = cv2.VideoCapture(mapping['center'], cv2.CAP_DSHOW)
preview.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
preview.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

cv2.namedWindow('Capture Center', cv2.WINDOW_NORMAL)
cv2.resizeWindow('Capture Center', 1280, 720)

count = 0

while True:
    ret, frm = preview.read()
    if not ret: continue

    frm_small = cv2.resize(frm, (1280, 720))
    gray_small = cv2.cvtColor(frm_small, cv2.COLOR_BGR2GRAY)
    ok, corners = cv2.findChessboardCorners(gray_small, PATTERN, None)
    if ok:
        cv2.drawChessboardCorners(frm_small, PATTERN, corners, ok)
        cv2.putText(frm_small, 'OK - SPACE!', (450, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.8, (0, 255, 0), 3)

    info = f'Captured: {count} | Q=Quit  SPACE=Capture'
    cv2.putText(frm_small, info, (20, 700), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    cv2.imshow('Capture Center', frm_small)

    key = cv2.waitKey(5) & 0xFF
    if key == ord('q'):
        break
    elif key == 32:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        print(f'Capturing... {ts}')
        all_ok = True
        for pos in ['left', 'center', 'right']:
            idx = mapping[pos]
            cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            for _ in range(8): cap.read()
            ret, frm = cap.read()
            if ret and frm is not None:
                fname = os.path.join(FRAME_DIR, f'{pos}_{ts}_{count:03d}.png')
                cv2.imwrite(fname, frm)
                g = cv2.cvtColor(frm, cv2.COLOR_BGR2GRAY)
                cb_found, _ = cv2.findChessboardCorners(g, PATTERN, None)
                status = 'OK' if cb_found else 'NO_CB'
                if not cb_found: all_ok = False
                print(f'  {pos}: {status}')
            else:
                print(f'  {pos}: FAIL')
                all_ok = False
            cap.release()
        if all_ok:
            count += 1
            print(f'  -> {count} groups\n')
        else:
            print('  -> retry\n')

preview.release()
cv2.destroyAllWindows()
print(f'\nDone: {count} groups -> {FRAME_DIR}/')
print('Next: python calib_run.py')
