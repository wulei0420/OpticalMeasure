"""Flask application factories for main (5002) and calibration (5003) servers."""
from flask import Flask, send_from_directory

from src.base.config import app_path
from src.base.errors import register_error_handlers


def create_main_app():
    app = Flask(__name__, static_folder=None)
    register_error_handlers(app)

    @app.route('/')
    def index():
        return send_from_directory(app_path('static', 'v2'), 'index.html')

    @app.route('/static/<path:filename>')
    def static_files(filename):
        return send_from_directory(app_path('static'), filename)

    from src.modules.camera_config import bp as cam_bp
    from src.modules.capture import bp as capture_bp
    from src.modules.matching import bp as matching_bp
    from src.modules.measurement import bp as measurement_bp
    from src.modules.customer import bp as customer_bp
    from src.modules.stream import bp as stream_bp
    from src.modules.serve import bp as serve_bp

    app.register_blueprint(cam_bp)
    app.register_blueprint(capture_bp)
    app.register_blueprint(matching_bp)
    app.register_blueprint(measurement_bp)
    app.register_blueprint(customer_bp)
    app.register_blueprint(stream_bp)
    app.register_blueprint(serve_bp)

    return app


def create_calib_app():
    app = Flask(__name__, static_folder=None)
    register_error_handlers(app)

    @app.route('/')
    def index():
        return send_from_directory(app_path('.'), 'calib_app.html')

    @app.route('/static/<path:filename>')
    def static_files(filename):
        return send_from_directory(app_path('static'), filename)

    from src.modules.camera_config import bp as cam_bp
    from src.modules.calibration import bp as cal_bp
    from src.modules.serve import bp as serve_bp

    app.register_blueprint(cam_bp)
    app.register_blueprint(cal_bp)
    app.register_blueprint(serve_bp)

    return app
