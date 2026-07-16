"""Compatibility shim — stereo matching API for diagnostic tools like calibrate_chessboard.py.

Exposes match_side with the same signature as the old matching.py/v2_backend.py.
Uses the centralized matching logic from src.modules.matching.
"""
import numpy as np
from src.modules.matching.routes import _load_matching_state, match_side as _match_side


def _ensure_state():
    state = _load_matching_state()
    if not state:
        raise RuntimeError('calib_params.json not found')
    return state


def match_side(cx, cy, side, ref_disp=None):
    state = _ensure_state()
    return _match_side(cx, cy, side, state, ref_disp)
