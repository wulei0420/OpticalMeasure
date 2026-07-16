"""Central configuration management. Single source of truth for all modules.

Camera config uses a short-TTL cache to prevent stale reads while avoiding
excessive disk I/O in hot paths (stream loop runs at ~25fps). After a module
saves new settings, other modules pick them up within CAMERA_CONFIG_TTL seconds.
"""
import json
import os
import time

_BASEDIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CAMERA_CONFIG_TTL = 2

_cam_config_cache = None
_cam_config_ts = 0

def app_path(*parts):
    return os.path.join(_BASEDIR, *parts)

def ensure_dir(*parts):
    d = app_path(*parts)
    os.makedirs(d, exist_ok=True)
    return d

def get_camera_config():
    global _cam_config_cache, _cam_config_ts
    now = time.time()
    if _cam_config_cache is not None and (now - _cam_config_ts) < CAMERA_CONFIG_TTL:
        return _cam_config_cache

    cfg_path = app_path('camera_config.json')
    if os.path.exists(cfg_path):
        _cam_config_cache = _load_json_file(cfg_path)
    else:
        _cam_config_cache = {'left': 2, 'center': 0, 'right': 1}
    _cam_config_ts = now
    return _cam_config_cache

def save_camera_config(cfg):
    global _cam_config_cache, _cam_config_ts
    _cam_config_cache = dict(cfg)
    _cam_config_ts = time.time()
    _save_json_file(app_path('camera_config.json'), cfg)

def get_calib_params():
    p = app_path('calib_params.json')
    if not os.path.exists(p):
        return None
    return _load_json_file(p)

def get_user_config():
    p = app_path('user_config.json')
    if not os.path.exists(p):
        cfg = {'pd_correction': 1.0}
        _save_json_file(p, cfg)
        return cfg
    return _load_json_file(p)

def save_user_config(data):
    _save_json_file(app_path('user_config.json'), data)

def _load_json_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)

def _save_json_file(filepath, data):
    tmp = filepath + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, filepath)

def init_defaults():
    defaults_dir = app_path('defaults')
    if not os.path.isdir(defaults_dir):
        return
    for name in os.listdir(defaults_dir):
        src = app_path('defaults', name)
        dst = app_path(name)
        if not os.path.exists(dst):
            import shutil
            shutil.copy2(src, dst)
