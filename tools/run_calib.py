import subprocess, json, os

os.chdir(r'E:\OPENCODE项目文件\镜架参数测量')

r = subprocess.run(
    ['stereo_calibrate.exe', '--frames', 'calib_frames', '--pattern', '17x17',
     '--square', '10', '--image-size', '3840x2160'],
    capture_output=True, text=True, timeout=600)

print(r.stderr)

d = json.loads(r.stdout)

calib = {
    'version': '1.0',
    'method': 'cpp_stereoCalibrate',
    'image_size': [3840, 2160],
    'square_size_mm': 10,
    'num_frames': d['frames'],
    'lc_inliers': d['lc_inliers'],
    'cr_inliers': d['cr_inliers'],
    'cameras': [
        {'id': 'left', 'K': d['cameras'][0]['K'], 'D': d['cameras'][0]['D']},
        {'id': 'center', 'K': d['cameras'][1]['K'], 'D': d['cameras'][1]['D']},
        {'id': 'right', 'K': d['cameras'][2]['K'], 'D': d['cameras'][2]['D']},
    ],
    'stereo': [
        {
            'pair': 'left_center',
            'R': d['stereo'][0]['R'],
            'T': d['stereo'][0]['T'],
            'baseline_mm': d['stereo'][0]['baseline_mm'],
        },
        {
            'pair': 'center_right',
            'R': d['stereo'][1]['R'],
            'T': d['stereo'][1]['T'],
            'baseline_mm': d['stereo'][1]['baseline_mm'],
        },
    ],
}

with open('calib_params.json', 'w') as f:
    json.dump(calib, f, indent=2)

print(f"SAVED: {d['lc_inliers']} LC inliers, {d['cr_inliers']} CR inliers of {d['frames']} groups")
