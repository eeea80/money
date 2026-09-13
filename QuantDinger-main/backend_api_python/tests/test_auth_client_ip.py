"""Tests for safe client IP resolution behind the shipped reverse proxy."""

from app.services.auth_session import get_client_ip


def test_untrusted_peer_cannot_spoof_forwarded_headers(app):
    with app.test_request_context(
        "/",
        headers={"X-Real-IP": "1.1.1.1", "X-Forwarded-For": "2.2.2.2"},
        environ_base={"REMOTE_ADDR": "8.8.8.8"},
    ):
        assert get_client_ip() == "8.8.8.8"


def test_internal_proxy_uses_overwritten_real_ip(app):
    with app.test_request_context(
        "/",
        headers={"X-Real-IP": "1.1.1.1", "X-Forwarded-For": "6.6.6.6, 2.2.2.2"},
        environ_base={"REMOTE_ADDR": "172.18.0.2"},
    ):
        assert get_client_ip() == "1.1.1.1"


def test_internal_proxy_uses_rightmost_forwarded_ip(app):
    with app.test_request_context(
        "/",
        headers={"X-Forwarded-For": "6.6.6.6, 2.2.2.2"},
        environ_base={"REMOTE_ADDR": "172.18.0.2"},
    ):
        assert get_client_ip() == "2.2.2.2"


def test_invalid_proxy_header_falls_back_to_peer(app):
    with app.test_request_context(
        "/",
        headers={"X-Real-IP": "not-an-ip"},
        environ_base={"REMOTE_ADDR": "172.18.0.2"},
    ):
        assert get_client_ip() == "172.18.0.2"
