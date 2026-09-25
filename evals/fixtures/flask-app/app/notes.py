from flask import Blueprint, jsonify

from .auth import current_user_id, login_required
from .models import Note

bp = Blueprint("notes", __name__, url_prefix="/notes")


@bp.get("")
@login_required
def list_notes():
    notes = Note.query.filter_by(owner_id=current_user_id()).order_by(Note.id).all()
    return jsonify([{"id": n.id, "title": n.title} for n in notes])
