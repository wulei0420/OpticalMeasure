"""Photo capture Blueprint — front and side capture via C++ exe or Python fallback."""
from flask import Blueprint

bp = Blueprint('capture', __name__)

from . import routes  # noqa: E402,F401
