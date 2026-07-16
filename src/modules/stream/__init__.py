"""Stream Blueprint — iPad single-camera live preview polling."""
from flask import Blueprint

bp = Blueprint('stream', __name__)

from . import routes  # noqa: E402,F401
