"""Calibration Blueprint — capture, stereo calibration, and verification."""
from flask import Blueprint

bp = Blueprint('calibration', __name__)

from . import routes   # noqa: E402,F401
from . import verify   # noqa: E402,F401
