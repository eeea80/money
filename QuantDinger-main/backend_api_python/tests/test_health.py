"""Test health endpoint."""


def test_health_endpoint(client):
    """GET /api/health should return 200."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data is not None
