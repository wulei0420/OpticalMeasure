import cv2
import sys

NUM_CAMS = 3
active = 0
zoom = 1.0
zoom_step = 0.2
pan_x, pan_y = 0, 0
dragging = False
drag_start = (0, 0)
pan_start = (0, 0)
caps = []

def open_cam(idx):
    for i, c in enumerate(caps):
        if c: c.release()
        caps[i] = None
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)
        caps[idx - 1] = cap
        return True
    return False

def get_frame():
    global caps, active
    if not caps[active]: return None
    ret, frame = caps[active].read()
    if not ret: return None
    return frame

def mouse_cb(event, x, y, flags, param):
    global zoom, pan_x, pan_y, dragging, drag_start, pan_start
    if event == cv2.EVENT_MOUSEWHEEL:
        old_z = zoom
        if flags > 0:
            zoom = min(5.0, zoom + zoom_step)
        else:
            zoom = max(1.0, zoom - zoom_step)
        if zoom != old_z:
            pan_x = int(pan_x * zoom / old_z)
            pan_y = int(pan_y * zoom / old_z)
    elif event == cv2.EVENT_LBUTTONDOWN:
        dragging = True
        drag_start = (x, y)
        pan_start = (pan_x, pan_y)
    elif event == cv2.EVENT_MOUSEMOVE and dragging:
        pan_x = pan_start[0] - (x - drag_start[0])
        pan_y = pan_start[1] - (y - drag_start[1])
    elif event == cv2.EVENT_LBUTTONUP:
        dragging = False

print('=== 三摄调焦工具 ===')
print('按键:  1/2/3=切换摄像头  Q=退出  F=全屏')
print('鼠标:  滚轮缩放  按住左键拖拽平移')

for i in range(NUM_CAMS):
    print(f'正在打开摄像头 #{i+1}...')
    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)
    caps.append(cap)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f'  摄像头 #{i+1}: {w}x{h}')

cv2.namedWindow('Focus - 三摄调焦', cv2.WINDOW_NORMAL)
cv2.resizeWindow('Focus - 三摄调焦', 1280, 720)
cv2.setMouseCallback('Focus - 三摄调焦', mouse_cb)

while True:
    frame = get_frame()
    if frame is None:
        cv2.waitKey(10)
        continue

    fh, fw = frame.shape[:2]
    # 计算裁剪区域
    crop_w = int(fw / zoom)
    crop_h = int(fh / zoom)
    cx = fw // 2 + pan_x
    cy = fh // 2 + pan_y
    x1 = max(0, cx - crop_w // 2)
    y1 = max(0, cy - crop_h // 2)
    x2 = min(fw, x1 + crop_w)
    y2 = min(fh, y1 + crop_h)
    if x2 - x1 < crop_w: x1 = max(0, x2 - crop_w)
    if y2 - y1 < crop_h: y1 = max(0, y2 - crop_h)

    roi = frame[y1:y2, x1:x2]
    display = cv2.resize(roi, (fw, fh))

    # 叠加信息
    info = f'CAM#{active+1} | ZOOM:{zoom:.1f}x | {fw}x{fh}'
    cv2.putText(display, info, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 2)
    cv2.putText(display, 'Q=Quit F=Full 1/2/3=Cam Wheel=Zoom Drag=Pan', (20, fh - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    cv2.imshow('Focus - 三摄调焦', display)
    key = cv2.waitKey(30) & 0xFF

    if key == ord('q') or key == 27:
        break
    elif key in [ord('1'), ord('2'), ord('3')]:
        active = ord(chr(key)) - 1
        pan_x, pan_y, zoom = 0, 0, 1.0
        print(f'切换到摄像头 #{active+1}')
    elif key == ord('f'):
        cv2.setWindowProperty('Focus - 三摄调焦', cv2.WND_PROP_FULLSCREEN,
                              cv2.WINDOW_FULLSCREEN)

for c in caps:
    if c: c.release()
cv2.destroyAllWindows()
print('退出。')
