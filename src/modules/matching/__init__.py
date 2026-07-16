"""Stereo matching Blueprint — NCC template matching and triangulation."""
from flask import Blueprint

bp = Blueprint('matching', __name__)

from . import routes  # noqa: E402,F401
