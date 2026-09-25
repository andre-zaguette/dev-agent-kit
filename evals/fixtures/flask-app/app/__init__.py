from flask import Flask

from .extensions import db
from .notes import bp as notes_bp


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(SQLALCHEMY_DATABASE_URI="sqlite:///app.db")
    app.config.update(config or {})
    db.init_app(app)
    app.register_blueprint(notes_bp)
    return app
