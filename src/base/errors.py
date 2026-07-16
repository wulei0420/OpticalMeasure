"""Error handlers registered on Flask apps."""
import sys
import traceback
from flask import jsonify


def register_error_handlers(app):
    @app.errorhandler(500)
    def handle_500(e):
        exc_type, exc_value, exc_tb = sys.exc_info()
        if exc_type and exc_value:
            tb = ''.join(traceback.format_exception(exc_type, exc_value, exc_tb))
            print(tb, flush=True)
            return jsonify({
                'error': str(exc_value),
                'type': str(exc_type.__name__),
                'trace': tb[-500:]
            }), 500
        return jsonify({'error': str(e)}), 500
