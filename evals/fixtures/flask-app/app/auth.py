from functools import wraps

from flask import jsonify, request


def current_user_id() -> int | None:
    value = request.headers.get("X-User-Id", "")
    return int(value) if value.isdigit() else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user_id() is None:
            return jsonify(code="UNAUTHENTICATED"), 401
        return view(*args, **kwargs)

    return wrapper
