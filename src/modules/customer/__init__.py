"""Customer management Blueprint — SQLite CRUD for customers and records."""
from flask import Blueprint

bp = Blueprint('customer', __name__)

from . import routes  # noqa: E402,F401
