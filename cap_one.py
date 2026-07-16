"""Single-camera capture utility called by capture_three.exe"""
import cv2, sys

idx = int(sys.argv[1])
w = int(sys.argv[2])
h = int(sys.argv[3])
out = sys.argv[4]

cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
if not cap.isOpened():
    cap = cv2.VideoCapture(idx, cv2.CAP_MSMF)
if not cap.isOpened():
    sys.exit(1)

cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
for _ in range(3):
    cap.read()
ret, frm = cap.read()
cap.release()

if ret:
    cv2.imwrite(out, frm, [cv2.IMWRITE_JPEG_QUALITY, 90])
    sys.exit(0)
else:
    sys.exit(2)
