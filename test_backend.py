import cv2

for backend_name, backend_id in [('DSHOW', cv2.CAP_DSHOW), ('MSMF', cv2.CAP_MSMF), ('ANY', cv2.CAP_ANY)]:
    print(f'=== {backend_name} ===')
    caps = []
    for i in range(3):
        cap = cv2.VideoCapture(i, backend_id)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)
            ret, f = cap.read()
            if ret:
                print(f'  Cam {i}: {f.shape[1]}x{f.shape[0]} OK')
            else:
                print(f'  Cam {i}: open OK but read failed')
            caps.append(cap)
        else:
            print(f'  Cam {i}: open failed')
    # 再读一次确认稳定
    for i, c in enumerate(caps):
        ret, f = c.read()
        if ret:
            print(f'  Cam {i} recheck: OK ({f.shape[1]}x{f.shape[0]})')
        else:
            print(f'  Cam {i} recheck: FAILED')
    for c in caps: c.release()
    print()
