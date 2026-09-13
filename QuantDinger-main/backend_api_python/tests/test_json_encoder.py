"""Test global NaN/Inf JSON protection."""
import json
import math


def test_nan_becomes_null(app):
    """NaN values must be serialized as null (RFC 8259 compliance)."""
    with app.app_context():
        raw = app.json.dumps({"a": float("nan")})
        parsed = json.loads(raw)
        assert parsed["a"] is None


def test_inf_becomes_null(app):
    with app.app_context():
        raw = app.json.dumps({"b": float("inf"), "c": float("-inf")})
        parsed = json.loads(raw)
        assert parsed["b"] is None
        assert parsed["c"] is None


def test_normal_floats_preserved(app):
    with app.app_context():
        raw = app.json.dumps({"x": 42.5, "y": 0.0})
        parsed = json.loads(raw)
        assert parsed["x"] == 42.5
        assert parsed["y"] == 0.0


def test_nested_nan(app):
    with app.app_context():
        raw = app.json.dumps({"list": [1, float("nan"), 3], "nested": {"v": float("inf")}})
        parsed = json.loads(raw)
        assert parsed["list"] == [1, None, 3]
        assert parsed["nested"]["v"] is None
