"""Camera setup Blueprint — scan, assign, and configure camera positions."""
from flask import Blueprint

bp = Blueprint('camera_config', __name__)

from . import routes  # noqa: E402,F401
