"""Serve Blueprint — status, feedback, and cross-cutting routes."""
from flask import Blueprint

bp = Blueprint('serve', __name__)

from . import routes  # noqa: E402,F401
