"""Runtime observability integration."""


def init_http_observability(app):
    from app.observability.http import init_http_observability as initialize

    return initialize(app)


__all__ = ["init_http_observability"]
