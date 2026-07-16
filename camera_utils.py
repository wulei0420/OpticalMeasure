"""Compatibility shim — delegates shared utilities to src.base.config.

Kept for backward compatibility with db.py, verify_calib.py, and other tools
that import from camera_utils. All functions now delegate to the central config.
"""
import json
import os

from src.base.config import (
    app_path as path,
    get_camera_config as load_camera_config,
    get_calib_params as load_calib,
    get_user_config as load_user_config,
    save_user_config,
    ensure_dir as ensure_dirs,
    init_defaults as ensure_defaults,
)

_BASEDIR = os.path.dirname(os.path.abspath(__file__))


def load_json(filename):
    with open(path(filename), 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(filename, data):
    import shutil
    tmp = path(filename + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    shutil.move(tmp, path(filename))
