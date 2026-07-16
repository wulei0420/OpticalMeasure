import cv2, numpy as np, glob, os, struct
os.chdir(r'E:\OPENCODE项目文件\镜架参数测量')

# Check first group images in detail
files = sorted(glob.glob('calib_frames/*.png'))
groups = {}
for f in files:
    name = os.path.basename(f)
    parts = name.split('_', 1)
    if len(parts) < 2: continue
    side = parts[0]
    ts = parts[1]
    if side in ('left', 'center', 'right'):
        groups.setdefault(ts, {})[side] = f

# Get first complete group
first_ts = None
for ts in sorted(groups.keys()):
    if len(groups[ts]) == 3:
        first_ts = ts
        break

if first_ts:
    for side in ('left', 'center', 'right'):
        path = groups[first_ts][side]
        fsize = os.path.getsize(path)
        img = cv2.imread(path)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Check corners
        ret, corners = cv2.findChessboardCorners(gray, (17, 17))
        print(f'{side}: size={fsize//1024}KB shape={img.shape} mean={gray.mean():.0f} corners={ret}')
        if ret:
            c = corners.reshape(-1, 2)
            # Check board aspect ratio: should be square
            w = np.linalg.norm(c[16] - c[0])
            h = np.linalg.norm(c[-17] - c[0])
            print(f'  board w={w:.0f} h={h:.0f} ratio={w/h:.4f}')
            # Check if corners are monotonic
            dx0 = c[1,0] - c[0,0]
            dx1 = c[16,0] - c[15,0]
            print(f'  x-delta first row: {dx0:.2f}, last col: {dx1:.2f}')

# Also: try reading left frames with PILLOW to rule out cv2 decode issue
print('\n--- Checking left PNG integrity ---')
for side in ('left', 'center', 'right'):
    path = groups[first_ts][side]
    with open(path, 'rb') as ff:
        header = ff.read(8)
        sig = header.hex()
    print(f'{side}: PNG sig={sig}')
