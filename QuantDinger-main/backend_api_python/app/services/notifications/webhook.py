from __future__ import annotations

import base64
import hmac
import hashlib
import json
import time
import urllib.parse
from typing import Any, Dict, List, Tuple


_WEBHOOK_DIALECT_PATTERNS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("feishu", (
        "open.feishu.cn/open-apis/bot/v2/hook/",
        "open.larksuite.com/open-apis/bot/v2/hook/",
        "open.larkoffice.com/open-apis/bot/v2/hook/",
        "www.larksuite.com/open-apis/bot/v2/hook/",
    )),
    ("dingtalk", ("oapi.dingtalk.com/robot/send",)),
    ("wecom", ("qyapi.weixin.qq.com/cgi-bin/webhook/send",)),
    ("slack", ("hooks.slack.com/services/",)),
)


def detect_webhook_dialect(url: str) -> str:
    """Return a vendor dialect name, or ``generic`` for self-hosted endpoints."""
    lowered = (url or "").lower()
    for dialect, prefixes in _WEBHOOK_DIALECT_PATTERNS:
        if any(prefix in lowered for prefix in prefixes):
            return dialect
    return "generic"


def shorten(value: str, limit: int = 4000) -> str:
    text = str(value or "")
    return text if len(text) <= limit else (text[:limit] + "...")


def format_float(value: Any, *, max_decimals: int = 10) -> str:
    try:
        number = float(value or 0.0)
    except Exception:
        number = 0.0
    text = f"{number:.{max_decimals}f}".rstrip("0").rstrip(".")
    return text or "0"


def build_webhook_text(payload: Dict[str, Any]) -> Tuple[str, str]:
    """Distill an internal signal payload into plain title/body text."""
    data = payload or {}
    explicit_title = str(data.get("title") or "").strip()
    explicit_msg = str(data.get("message") or "").strip()
    if explicit_title or explicit_msg:
        return (explicit_title or "QuantDinger"), (explicit_msg or "")

    strategy = data.get("strategy") or {}
    instrument = data.get("instrument") or {}
    signal = data.get("signal") or {}
    order = data.get("order") or {}

    strategy_name = str(strategy.get("name") or "").strip()
    symbol = str(instrument.get("symbol") or "").strip()
    signal_type = str(signal.get("type") or signal.get("action") or "").strip()
    side = str(signal.get("side") or "").strip()

    title_bits: List[str] = []
    if strategy_name:
        title_bits.append(strategy_name)
    if symbol:
        title_bits.append(symbol)
    if signal_type:
        title_bits.append(signal_type.upper())
    title = " · ".join(title_bits) if title_bits else "QuantDinger Signal"

    body_lines: List[str] = []
    if strategy_name:
        body_lines.append(f"Strategy: {strategy_name}")
    if symbol:
        body_lines.append(f"Symbol: {symbol}")
    if signal_type:
        body_lines.append(f"Signal: {signal_type}")
    if side:
        body_lines.append(f"Side: {side}")
    try:
        ref_price = float(order.get("ref_price") or 0)
        if ref_price > 0:
            body_lines.append(f"Price: {format_float(ref_price)}")
    except Exception:
        pass
    try:
        stake = float(order.get("stake_amount") or 0)
        if stake > 0:
            body_lines.append(f"Amount: {format_float(stake)}")
    except Exception:
        pass
    timestamp = str(data.get("timestamp_iso") or "").strip()
    if timestamp:
        body_lines.append(f"Time: {timestamp}")

    if not body_lines:
        body_lines.append(shorten(json.dumps(data, ensure_ascii=False), 800))
    return title, "\n".join(body_lines)


def adapt_payload_for_dialect(dialect: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Translate the internal payload to the vendor's required JSON schema."""
    title, body = build_webhook_text(payload)

    if dialect == "feishu":
        return {"msg_type": "text", "content": {"text": f"{title}\n{shorten(body)}"}}
    if dialect == "dingtalk":
        return {
            "msgtype": "markdown",
            "markdown": {"title": shorten(title, 64), "text": f"### {title}\n\n{shorten(body)}"},
        }
    if dialect == "wecom":
        return {"msgtype": "markdown", "markdown": {"content": f"### {title}\n\n{shorten(body, 4000)}"}}
    if dialect == "slack":
        return {"text": f"*{title}*\n{shorten(body)}"}
    return payload


def feishu_sign(secret: str, timestamp_str: str) -> str:
    """Return the Feishu/Lark custom-bot HMAC signature."""
    key = f"{timestamp_str}\n{secret}".encode("utf-8")
    digest = hmac.new(key, b"", hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def dingtalk_signed_url(url: str, secret: str) -> str:
    """Append DingTalk custom-bot signature query parameters to a webhook URL."""
    ts_ms = str(int(time.time() * 1000))
    string_to_sign = f"{ts_ms}\n{secret}"
    digest = hmac.new(secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest).decode("utf-8"))
    separator = "&" if ("?" in url) else "?"
    return f"{url}{separator}timestamp={ts_ms}&sign={sign}"


def check_vendor_response(dialect: str, status_code: int, text: str) -> Tuple[bool, str]:
    """Normalize vendor webhook response bodies into success/error results."""
    if status_code < 200 or status_code >= 300:
        return False, f"http_{status_code}:{shorten(text, 300)}"

    body = (text or "").strip()
    if dialect == "slack":
        ok = body.lower() == "ok" or body.startswith("{")
        return ok, "" if ok else f"slack_unexpected:{shorten(body, 300)}"

    if dialect in ("feishu", "dingtalk", "wecom"):
        if not body or not body.startswith("{"):
            return True, ""
        try:
            obj = json.loads(body)
        except Exception:
            return True, ""
        code = obj.get("code", obj.get("errcode", obj.get("StatusCode")))
        if code in (0, "0", None):
            return True, ""
        msg = obj.get("msg") or obj.get("errmsg") or ""
        return False, f"{dialect}_error:code={code}:{shorten(msg, 200)}"

    return True, ""
