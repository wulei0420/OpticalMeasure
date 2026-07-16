"""
摄像头位置配置工具
识别每个摄像头的物理位置（左/中/右）并保存到 camera_config.json
"""
import cv2, json, numpy as np

mapping = {'left': None, 'center': None, 'right': None}
assigned = set()

for idx in range(3):
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print(f'Idx {idx}: cannot open'); continue
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    
    print(f'\nCamera index {idx} - live preview')
    print('Stand BEHIND the cameras (same direction they face).')
    print('L=LEFT  C=CENTER  R=RIGHT  S=Skip')
    
    while True:
        ret, frm = cap.read()
        if not ret: continue
        s = cv2.resize(frm, (960, 540))
        cv2.putText(s, f'Idx {idx}: L=Left C=Center R=Right S=Skip', (20, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.imshow(f'Camera {idx} Setup', s)
        k = cv2.waitKey(30) & 0xFF
        if k == ord('l') and 0 not in assigned:
            mapping['left'] = idx; assigned.add(0)
            print(f'  -> LEFT')
            break
        elif k == ord('c') and 1 not in assigned:
            mapping['center'] = idx; assigned.add(1)
            print(f'  -> CENTER')
            break
        elif k == ord('r') and 2 not in assigned:
            mapping['right'] = idx; assigned.add(2)
            print(f'  -> RIGHT')
            break
        elif k == ord('s'):
            print('  -> Skipped')
            break
    cap.release()
    cv2.destroyAllWindows()
    if len(assigned) == 3: break

if len(assigned) < 3:
    print('Not all cameras assigned. Please re-run.')
else:
    with open('camera_config.json', 'w') as f:
        json.dump(mapping, f, indent=2)
    print(f'\nSaved: left=Idx{mapping["left"]} center=Idx{mapping["center"]} right=Idx{mapping["right"]}')
    print('File: camera_config.json')
