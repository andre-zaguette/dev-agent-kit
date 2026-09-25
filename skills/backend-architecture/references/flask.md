---
name: flask
description: Baseline conventions for Flask services: app factory, blueprints, configuration, validation, error handling and database sessions.
status: baseline
---

## Princípio

Build Flask apps from an application factory with blueprints, keep views thin, validate input explicitly, return one JSON error shape, and open and close the database session in one place per request.

## Quando aplicar

Projects that list `flask` as a dependency.

## Quando não aplicar

FastAPI or Django projects. Do not add Flask extensions (SQLAlchemy, Marshmallow, Migrate) the project does not already use; follow the ones it has.

## Exemplo

```python
from flask import Blueprint, jsonify, request

bp = Blueprint("notes", __name__, url_prefix="/notes")


@bp.post("/<int:note_id>/archive")
@login_required
def archive(note_id: int):
    note = db.session.execute(select(Note).where(Note.id == note_id, Note.owner_id == current_user.id)).scalar_one_or_none()
    if note is None:
        return jsonify(code="NOTE_NOT_FOUND"), 404
    if note.archived_at is None:
        note.archived_at = datetime.now(timezone.utc)
        db.session.commit()
    return jsonify(id=note.id, archived_at=note.archived_at.isoformat()), 200


@bp.errorhandler(ValueError)
def bad_input(error):
    return jsonify(code="INVALID_INPUT", detail=str(error)), 400
```

Create the app in `create_app(config)` and read configuration from the environment, never from committed secrets. Scope every lookup by the current user so a wrong id is a 404. Register error handlers once so every view returns the same error shape. Test with `app.test_client()` and a throwaway database, and run the migration tool the project uses (for example Flask-Migrate) instead of editing tables by hand.

## Fonte

Flask documentation (application factories, blueprints, error handling, testing); refined per project conventions.
