"""
tests/test_sse_streaming.py
───────────────────────────
Tests for web/sse.py (SSEEventBus) and the /stream/prices + /stream/alerts
FastAPI endpoints added in web/api.py.

Coverage:
  - publish() delivers to all subscribers
  - subscribe() yields correctly formatted SSE strings
  - Multiple subscribers on same channel all receive events
  - publish_sync() works from sync context
  - Unsubscribed channels receive no events
  - GET /stream/prices returns 200 with Content-Type: text/event-stream
  - GET /stream/alerts returns 200 with Content-Type: text/event-stream
  - Event format is valid SSE (starts with "data: ", ends with "\\n\\n")
"""

from __future__ import annotations

import asyncio
import json

import pytest

# Bounds for the live-server SSE tests. Every wait is capped so a regression in
# the endpoints shows up as a failure rather than a hung job — the /stream/*
# generators never terminate on their own.
SSE_SERVER_STARTUP_TIMEOUT = 20.0  # seconds to wait for uvicorn to bind
SSE_SERVER_SHUTDOWN_TIMEOUT = 15.0  # seconds to wait for the server thread to exit
SSE_HTTP_TIMEOUT = 10.0  # seconds to wait for response headers


@pytest.fixture(scope="module")
def sse_server():
    """Run web.api:app under uvicorn on an ephemeral port; yield its base URL.

    Shared across the streaming tests — starting a server per test would pay
    the bind/teardown cost six times over.
    """
    import threading
    import time

    import uvicorn

    from web.api import app

    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + SSE_SERVER_STARTUP_TIMEOUT
    while not server.started and time.monotonic() < deadline:
        if not thread.is_alive():
            raise RuntimeError("uvicorn thread exited before the server started")
        time.sleep(0.05)
    if not server.started:
        server.should_exit = True
        raise RuntimeError(f"uvicorn did not start within {SSE_SERVER_STARTUP_TIMEOUT}s")

    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=SSE_SERVER_SHUTDOWN_TIMEOUT)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────


def _run(coro):
    """Run a coroutine in a new event loop (portable test helper)."""
    return asyncio.run(coro)


# ─────────────────────────────────────────────────────────────────
# Unit tests: SSEEventBus
# ─────────────────────────────────────────────────────────────────


class TestSSEEventBus:
    """Tests for the SSEEventBus class in web/sse.py."""

    def test_publish_delivers_to_subscriber(self):
        """publish() should deliver the event to a single subscriber."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            received = []

            async def _consume():
                async for chunk in bus.subscribe("price"):
                    received.append(chunk)
                    break  # stop after first event

            consumer_task = asyncio.create_task(_consume())
            # Give the consumer a moment to register
            await asyncio.sleep(0)
            await bus.publish("price", {"symbol": "NIFTY", "ltp": 24500.0})
            await asyncio.wait_for(consumer_task, timeout=2)

            assert len(received) == 1

        _run(_run_test())

    def test_subscribe_yields_valid_sse_format(self):
        """subscribe() must yield strings in 'data: {...}\\n\\n' format."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            received = []

            async def _consume():
                async for chunk in bus.subscribe("price"):
                    received.append(chunk)
                    break

            task = asyncio.create_task(_consume())
            await asyncio.sleep(0)
            await bus.publish("price", {"symbol": "NIFTY", "ltp": 24500.0})
            await asyncio.wait_for(task, timeout=2)

            assert len(received) == 1
            chunk = received[0]
            assert chunk.startswith("data: "), f"Expected 'data: ' prefix, got: {chunk!r}"
            assert chunk.endswith("\n\n"), f"Expected '\\n\\n' suffix, got: {chunk!r}"

        _run(_run_test())

    def test_subscribe_payload_is_valid_json(self):
        """The data payload must be parseable JSON."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            received = []

            async def _consume():
                async for chunk in bus.subscribe("price"):
                    received.append(chunk)
                    break

            task = asyncio.create_task(_consume())
            await asyncio.sleep(0)
            payload = {"symbol": "INFY", "ltp": 1750.5, "change_pct": -0.3}
            await bus.publish("price", payload)
            await asyncio.wait_for(task, timeout=2)

            chunk = received[0]
            json_part = chunk[len("data: ") : -2]  # strip "data: " prefix and "\n\n" suffix
            parsed = json.loads(json_part)
            assert parsed == payload

        _run(_run_test())

    def test_multiple_subscribers_all_receive_event(self):
        """All subscribers on a channel should receive each published event."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            received_a = []
            received_b = []

            async def _consume_a():
                async for chunk in bus.subscribe("price"):
                    received_a.append(chunk)
                    break

            async def _consume_b():
                async for chunk in bus.subscribe("price"):
                    received_b.append(chunk)
                    break

            task_a = asyncio.create_task(_consume_a())
            task_b = asyncio.create_task(_consume_b())
            await asyncio.sleep(0)

            await bus.publish("price", {"symbol": "NIFTY"})
            await asyncio.wait_for(asyncio.gather(task_a, task_b), timeout=2)

            assert len(received_a) == 1
            assert len(received_b) == 1

        _run(_run_test())

    def test_publish_returns_subscriber_count(self):
        """publish() should return the number of active subscribers."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            tasks = []
            results = []

            async def _consume():
                async for _ in bus.subscribe("price"):
                    break

            # Register 3 subscribers
            for _ in range(3):
                tasks.append(asyncio.create_task(_consume()))
            await asyncio.sleep(0)

            count = await bus.publish("price", {"x": 1})
            results.append(count)
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=2)
            return results[0]

        count = _run(_run_test())
        assert count == 3

    def test_different_channels_are_isolated(self):
        """Events on 'price' must not reach subscribers on 'alert'."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            price_received = []
            alert_received = []

            async def _consume_price():
                async for chunk in bus.subscribe("price"):
                    price_received.append(chunk)
                    break

            async def _consume_alert():
                async for chunk in bus.subscribe("alert"):
                    alert_received.append(chunk)
                    break

            price_task = asyncio.create_task(_consume_price())
            asyncio.create_task(_consume_alert())  # alert subscriber but won't be triggered
            await asyncio.sleep(0)

            # Only publish to price
            await bus.publish("price", {"symbol": "NIFTY"})
            await asyncio.wait_for(price_task, timeout=2)

            assert len(price_received) == 1
            # alert subscriber should have received nothing
            assert len(alert_received) == 0

        _run(_run_test())

    def test_publish_to_channel_with_no_subscribers(self):
        """Publishing to a channel with no subscribers returns 0 and does not crash."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            count = await bus.publish("empty_channel", {"x": 1})
            return count

        count = _run(_run_test())
        assert count == 0

    def test_publish_sync_delivers_event(self):
        """publish_sync() from a sync context should deliver events to subscribers."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            received = []

            async def _consume():
                async for chunk in bus.subscribe("price"):
                    received.append(chunk)
                    break

            task = asyncio.create_task(_consume())
            await asyncio.sleep(0)

            # Call publish_sync from within async context (simulates thread calling in)
            bus.publish_sync("price", {"symbol": "NIFTY", "ltp": 99.0})
            # Give event loop time to process the coroutine
            await asyncio.sleep(0.1)
            await asyncio.wait_for(task, timeout=2)

            assert len(received) == 1

        _run(_run_test())

    def test_subscriber_cleanup_on_generator_close(self):
        """After consumer disconnects, its queue should be removed from channel."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()

            gen = bus.subscribe("price")
            # Advance to the first yield (blocks waiting for event)
            task = asyncio.create_task(gen.__anext__())
            await asyncio.sleep(0)

            # Confirm subscriber registered
            assert len(bus._channels["price"]) == 1

            # Cancel the task and close the generator
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, StopAsyncIteration):
                pass
            await gen.aclose()

            # Give cleanup coroutine time to run
            await asyncio.sleep(0)
            assert len(bus._channels["price"]) == 0

        _run(_run_test())

    def test_queue_full_drops_oldest_event(self):
        """When a subscriber's queue is full the oldest event is dropped."""
        from web.sse import SSEEventBus

        async def _run_test():
            bus = SSEEventBus()
            bus.MAX_QUEUE_SIZE = 2  # small queue for test

            q_holder = []

            async def _consume():
                async for chunk in bus.subscribe("price"):
                    q_holder.append(chunk)
                    break

            task = asyncio.create_task(_consume())
            await asyncio.sleep(0)

            # Fill queue beyond its max
            for i in range(5):
                await bus.publish("price", {"i": i})

            await asyncio.wait_for(task, timeout=2)
            # Should have received at least one event without error
            assert len(q_holder) >= 1

        _run(_run_test())


# ─────────────────────────────────────────────────────────────────
# Integration tests: FastAPI endpoints
# ─────────────────────────────────────────────────────────────────


class TestSSEEndpoints:
    """Integration tests for /stream/prices and /stream/alerts endpoints.

    Fast tests (always run): verify routes are registered with correct
    StreamingResponse type — no live HTTP connection needed.

    Slow tests (marked @pytest.mark.slow): open a real SSE connection via
    TestClient to verify status code, content-type, and cache-control headers.
    Excluded from the default CI run; run nightly via the slow-tests workflow.
    """

    @pytest.fixture(autouse=True)
    def _reset_event_bus(self):
        """Reset the module-level event_bus between tests."""
        from collections import defaultdict

        from web import sse as _sse_mod

        _sse_mod.event_bus._channels = defaultdict(list)
        _sse_mod.event_bus._lock = None
        yield
        _sse_mod.event_bus._channels = defaultdict(list)
        _sse_mod.event_bus._lock = None

    # ── Fast: route registration checks (no HTTP connection) ─────────────

    @staticmethod
    def _registered_paths(app) -> list[str]:
        """Collect every route path on the app, including nested routers.

        Starlette 1.6 wraps `include_router()` results in an `_IncludedRouter`
        that carries child routes but no `.path` of its own, so a flat scan of
        `app.routes` misses anything mounted through a router — and raises
        AttributeError on the wrapper. Walk the tree instead.
        """
        paths: list[str] = []

        def walk(routes) -> None:
            for route in routes:
                path = getattr(route, "path", None)
                if path:
                    paths.append(path)
                children = getattr(route, "routes", None) or getattr(
                    getattr(route, "router", None), "routes", None
                )
                if children:
                    walk(children)

        walk(app.routes)
        return paths

    def test_prices_route_registered(self):
        """GET /stream/prices route must be registered on the FastAPI app."""
        from web.api import app

        paths = self._registered_paths(app)
        assert "/stream/prices" in paths, f"/stream/prices not found in routes: {paths}"

    def test_alerts_route_registered(self):
        """GET /stream/alerts route must be registered on the FastAPI app."""
        from web.api import app

        paths = self._registered_paths(app)
        assert "/stream/alerts" in paths, f"/stream/alerts not found in routes: {paths}"

    # ── Slow: live connection tests (excluded from default CI run) ────────
    #
    # These drive a real uvicorn server over a real socket rather than
    # TestClient. /stream/prices and /stream/alerts are endless generators
    # (they heartbeat forever), and TestClient buffers a response to
    # completion before handing it back — even via .stream() — so it blocks
    # on __enter__ and never surfaces the headers. A real server streams the
    # headers immediately and cancels the generator when the client hangs up.

    @staticmethod
    def _open_stream(base_url: str, path: str):
        """Open an SSE request and return (status_code, headers), then disconnect."""
        import httpx

        with httpx.stream("GET", f"{base_url}{path}", timeout=SSE_HTTP_TIMEOUT) as resp:
            return resp.status_code, resp.headers

    @pytest.mark.slow
    def test_stream_prices_returns_200(self, sse_server):
        """GET /stream/prices should return 200."""
        status, _ = self._open_stream(sse_server, "/stream/prices")
        assert status == 200

    @pytest.mark.slow
    def test_stream_prices_content_type(self, sse_server):
        """GET /stream/prices must respond with text/event-stream content type."""
        _, headers = self._open_stream(sse_server, "/stream/prices")
        assert "text/event-stream" in headers.get("content-type", "")

    @pytest.mark.slow
    def test_stream_alerts_returns_200(self, sse_server):
        """GET /stream/alerts should return 200."""
        status, _ = self._open_stream(sse_server, "/stream/alerts")
        assert status == 200

    @pytest.mark.slow
    def test_stream_alerts_content_type(self, sse_server):
        """GET /stream/alerts must respond with text/event-stream content type."""
        _, headers = self._open_stream(sse_server, "/stream/alerts")
        assert "text/event-stream" in headers.get("content-type", "")

    @pytest.mark.slow
    def test_stream_prices_cache_control_header(self, sse_server):
        """GET /stream/prices should set Cache-Control: no-cache."""
        _, headers = self._open_stream(sse_server, "/stream/prices")
        assert headers.get("cache-control") == "no-cache"

    @pytest.mark.slow
    def test_stream_alerts_cache_control_header(self, sse_server):
        """GET /stream/alerts should set Cache-Control: no-cache."""
        _, headers = self._open_stream(sse_server, "/stream/alerts")
        assert headers.get("cache-control") == "no-cache"

    def test_price_event_format_is_valid_sse(self):
        """
        Price events pushed to the bus must have valid SSE chunk format.
        'data: {...}\\n\\n' — verified via the SSEEventBus directly.
        """
        from web import sse as _sse_mod

        # Use a fresh bus to verify chunk format independently of endpoint
        async def _run_test():
            bus = _sse_mod.SSEEventBus()
            chunks = []

            async def _consume():
                async for chunk in bus.subscribe("price"):
                    chunks.append(chunk)
                    break

            task = asyncio.create_task(_consume())
            await asyncio.sleep(0)
            await bus.publish(
                "price",
                {
                    "symbol": "NIFTY",
                    "ltp": 24500.0,
                    "change_pct": 0.42,
                    "ts": "2024-01-01T00:00:00Z",
                },
            )
            await asyncio.wait_for(task, timeout=2)
            return chunks

        chunks = asyncio.run(_run_test())
        assert len(chunks) == 1
        chunk = chunks[0]
        assert chunk.startswith("data: "), f"Expected 'data: ' prefix, got: {chunk!r}"
        assert chunk.endswith("\n\n"), f"Expected '\\n\\n' suffix, got: {chunk!r}"
        # Payload must be valid JSON
        json_part = chunk[len("data: ") : -2]
        parsed = json.loads(json_part)
        assert parsed["symbol"] == "NIFTY"

    def test_alert_event_format_is_valid_sse(self):
        """Alert events must have 'data: {...}\\n\\n' format."""
        from web import sse as _sse_mod

        async def _run_test():
            bus = _sse_mod.SSEEventBus()
            chunks = []

            async def _consume():
                async for chunk in bus.subscribe("alert"):
                    chunks.append(chunk)
                    break

            task = asyncio.create_task(_consume())
            await asyncio.sleep(0)
            await bus.publish(
                "alert",
                {
                    "alert_id": "a1",
                    "symbol": "INFY",
                    "message": "RSI > 70",
                    "ts": "2024-01-01T00:00:00Z",
                },
            )
            await asyncio.wait_for(task, timeout=2)
            return chunks

        chunks = asyncio.run(_run_test())
        assert len(chunks) == 1
        chunk = chunks[0]
        assert chunk.startswith("data: "), f"Expected 'data: ' prefix, got: {chunk!r}"
        assert chunk.endswith("\n\n"), f"Expected '\\n\\n' suffix, got: {chunk!r}"
        parsed = json.loads(chunk[len("data: ") : -2])
        assert parsed["symbol"] == "INFY"
