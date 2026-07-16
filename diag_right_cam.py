"""右摄像头标定诊断"""
import cv2, numpy as np, os, glob

PATTERN = (9, 6)
SQUARE_SIZE = 19.614
FRAME_DIR = 'calib_frames'

# 检查每个摄像头有多少帧检测到棋盘格
for pos, label in [('left','左'), ('center','中'), ('right','右')]:
    files = sorted(glob.glob(os.path.join(FRAME_DIR, f'{pos}_*.png')))
    ok = 0
    fail = 0
    for f in files:
        img = cv2.imread(f)
        if img is None:
            fail += 1
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        ret, _ = cv2.findChessboardCorners(gray, PATTERN, None)
        if ret: ok += 1
        else: fail += 1
    print(f'{label}摄像头: {ok}/{ok+fail} 棋盘格检测通过 ({ok+fail}总帧)')

# 检查图像质量：亮度和清晰度
print('\n--- 图像质量对比 ---')
for pos, label in [('left','左'), ('center','中'), ('right','右')]:
    files = sorted(glob.glob(os.path.join(FRAME_DIR, f'{pos}_*.png')))
    if not files: continue
    # 取中间那帧
    img = cv2.imread(files[len(files)//2])
    if img is None: continue
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    brightness = np.mean(gray)
    lap = cv2.Laplacian(gray, cv2.CV_64F).var()
    print(f'{label}摄像头: 亮度={brightness:.1f}, 锐度={lap:.1f}')

# 对比同一组三摄帧的大小
print('\n--- 文件大小对比（随机一组）---')
files = sorted(glob.glob(os.path.join(FRAME_DIR, '*.png')))
# 找一组
seen = set()
for f in files:
    key = '_'.join(os.path.basename(f).split('_')[1:])
    if key not in seen:
        seen.add(key)
        matching = [x for x in files if key in x]
        if len(matching) >= 3:
            sizes = [(os.path.basename(x).split('_')[0], os.path.getsize(x)//1024) for x in matching[-3:]]
            print(f'组 {key[:15]}: ' + ', '.join([f'{p}={s}KB' for p,s in sizes]))
            break
