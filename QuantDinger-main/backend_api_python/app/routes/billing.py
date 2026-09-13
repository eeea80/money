"""
Billing APIs — membership plans and USDT on-chain payments.

Plan amounts and credits are read from system settings (.env).
Membership activation is triggered only after USDT payment confirmation
(see usdt_payment_service).
"""

from flask import g, jsonify, request
from app.openapi.blueprint import HumanBlueprint as Blueprint
from app.openapi.schemas.high_risk import BillingOrderRequestSchema

from app.utils.auth import login_required, admin_required
from app.utils.logger import get_logger
from app.services.billing_service import get_billing_service
from app.services.usdt_payment_service import get_usdt_payment_service
from app.services.stripe_payment_service import get_stripe_payment_service

logger = get_logger(__name__)

billing_blp = Blueprint("billing", __name__)


@billing_blp.route("/plans", methods=["GET"])
@login_required
def get_membership_plans():
    """Get membership plan configuration + current user's billing snapshot."""
    try:
        user_id = getattr(g, "user_id", None)
        svc = get_billing_service()
        plans = svc.get_membership_plans()
        billing_info = svc.get_user_billing_info(user_id) if user_id else {}
        crypto = get_usdt_payment_service()
        methods = []
        if crypto.list_chains("USDT"):
            methods.append({"code": "USDT", "kind": "crypto"})
        if crypto.list_chains("USDC"):
            methods.append({"code": "USDC", "kind": "crypto"})
        stripe_enabled = get_stripe_payment_service().enabled()
        if stripe_enabled and any(float(plan.get("price_usd") or 0) > 0 for plan in plans.values()):
            methods.append({"code": "STRIPE", "kind": "card"})
        safe_plans = {}
        for code, plan in plans.items():
            public_plan = {k: v for k, v in plan.items() if k != "stripe_price_id"}
            public_plan["stripe_enabled"] = bool(stripe_enabled and float(plan.get("price_usd") or 0) > 0)
            safe_plans[code] = public_plan
        return jsonify({"code": 1, "msg": "success", "data": {"plans": safe_plans, "billing": billing_info, "payment_methods": methods}})
    except Exception as e:
        logger.error(f"get_membership_plans failed: {e}", exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


# =========================
# Stablecoin Pay
# =========================


@billing_blp.route("/crypto/chains", methods=["GET"])
@login_required
def crypto_list_chains():
    try:
        currency = str(request.args.get("currency") or "USDT").strip().upper()
        if currency not in ("USDT", "USDC"):
            return jsonify({"code": 0, "msg": "unsupported_currency", "data": None}), 400
        if not get_billing_service().is_billing_enabled():
            return jsonify({"code": 1, "msg": "success", "data": {"chains": [], "billing_enabled": False}})
        chains = get_usdt_payment_service().list_chains(currency)
        return jsonify({"code": 1, "msg": "success", "data": {"chains": chains, "currency": currency, "billing_enabled": True}})
    except Exception as e:
        logger.error("crypto_list_chains failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@billing_blp.route("/crypto/create", methods=["POST"])
@login_required
@billing_blp.arguments(BillingOrderRequestSchema, location="json")
def crypto_create_order(data):
    try:
        if not get_billing_service().is_billing_enabled():
            return jsonify({"code": 0, "msg": "billing_disabled", "data": None}), 403
        user_id = getattr(g, "user_id", None)
        ok, msg, out = get_usdt_payment_service().create_order(
            user_id,
            (data.get("plan") or "").strip().lower(),
            chain=(data.get("chain") or "").strip().upper() or None,
            currency=(data.get("currency") or "USDT").strip().upper(),
        )
        return (jsonify({"code": 1, "msg": "success", "data": out}) if ok else
                (jsonify({"code": 0, "msg": msg, "data": out}), 400))
    except Exception as e:
        logger.error("crypto_create_order failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@billing_blp.route("/crypto/order/<int:order_id>", methods=["GET"])
@login_required
def crypto_get_order(order_id: int):
    try:
        user_id = getattr(g, "user_id", None)
        refresh = str(request.args.get("refresh", "1")).lower() in ("1", "true", "yes")
        ok, msg, out = get_usdt_payment_service().get_order(user_id, order_id, refresh=refresh)
        return (jsonify({"code": 1, "msg": "success", "data": out}) if ok else
                (jsonify({"code": 0, "msg": msg, "data": out}), 404))
    except Exception as e:
        logger.error("crypto_get_order failed: %s", e, exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@billing_blp.route("/usdt/chains", methods=["GET"])
@login_required
def usdt_list_chains():
    """List USDT chains that are enabled AND have a receiving address
    configured. Chains without an address are auto-hidden by the backend
    so the frontend chain picker can render the response verbatim.
    """
    try:
        if not get_billing_service().is_billing_enabled():
            return jsonify({"code": 1, "msg": "success", "data": {"chains": [], "billing_enabled": False}})
        chains = get_usdt_payment_service().list_chains("USDT")
        return jsonify({"code": 1, "msg": "success", "data": {"chains": chains, "billing_enabled": True}})
    except Exception as e:
        logger.error(f"usdt_list_chains failed: {e}", exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@billing_blp.route("/usdt/create", methods=["POST"])
@login_required
@billing_blp.arguments(BillingOrderRequestSchema, location="json")
def usdt_create_order(data):
    """Create a USDT membership order.

    Body:
      {
        plan:  dynamic plan code returned by GET /plans,
        chain: "TRC20" | "BEP20" | "ERC20" | "SOL"   # optional; defaults to
                                                     # the first enabled chain
      }
    """
    try:
        user_id = getattr(g, "user_id", None)
        plan = (data.get("plan") or "").strip().lower()
        chain = (data.get("chain") or "").strip().upper() or None
        if not plan:
            return jsonify({"code": 0, "msg": "missing_plan", "data": None}), 400
        if not get_billing_service().is_billing_enabled():
            return jsonify({"code": 0, "msg": "billing_disabled", "data": None}), 403

        ok, msg, out = get_usdt_payment_service().create_order(user_id, plan, chain=chain, currency="USDT")
        if ok:
            return jsonify({"code": 1, "msg": "success", "data": out})
        return jsonify({"code": 0, "msg": msg, "data": out}), 400
    except Exception as e:
        logger.error(f"usdt_create_order failed: {e}", exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


@billing_blp.route("/usdt/order/<int:order_id>", methods=["GET"])
@login_required
def usdt_get_order(order_id: int):
    """Get my USDT order; refresh chain status by default."""
    try:
        user_id = getattr(g, "user_id", None)
        refresh = str(request.args.get("refresh", "1")).lower() in ("1", "true", "yes")
        ok, msg, out = get_usdt_payment_service().get_order(user_id, order_id, refresh=refresh)
        if ok:
            return jsonify({"code": 1, "msg": "success", "data": out})
        return jsonify({"code": 0, "msg": msg, "data": out}), 404
    except Exception as e:
        logger.error(f"usdt_get_order failed: {e}", exc_info=True)
        return jsonify({"code": 0, "msg": str(e), "data": None}), 500


# =========================
# Stripe Checkout
# =========================


@billing_blp.route("/stripe/create", methods=["POST"])
@login_required
def stripe_create_checkout():
    data = request.get_json(silent=True) or {}
    plan = str(data.get("plan") or "").strip().lower()
    if not get_billing_service().is_billing_enabled():
        return jsonify({"code": 0, "msg": "billing_disabled", "data": None}), 403
    client = str(data.get("client") or "pc").strip().lower()
    ok, msg, out = get_stripe_payment_service().create_checkout(getattr(g, "user_id", None), plan, client=client)
    return (jsonify({"code": 1, "msg": "success", "data": out}) if ok else
            (jsonify({"code": 0, "msg": msg, "data": out}), 400))


@billing_blp.route("/stripe/webhook", methods=["POST"])
def stripe_webhook():
    payload = request.get_data(cache=False)
    signature = request.headers.get("Stripe-Signature", "")
    ok, msg = get_stripe_payment_service().handle_webhook(payload, signature)
    return jsonify({"code": 1 if ok else 0, "msg": msg}), (200 if ok else 400)


# =========================
# Admin plan catalogue
# =========================


@billing_blp.route("/admin/plans", methods=["GET"])
@login_required
@admin_required
def admin_get_plans():
    return jsonify({"code": 1, "msg": "success", "data": get_billing_service().get_membership_plans(include_inactive=True)})


@billing_blp.route("/admin/plans", methods=["PUT"])
@login_required
@admin_required
def admin_save_plans():
    payload = request.get_json(silent=True) or {}
    ok, msg, out = get_billing_service().save_membership_plans(payload.get("plans"))
    return (jsonify({"code": 1, "msg": "success", "data": out}) if ok else
            (jsonify({"code": 0, "msg": msg, "data": out}), 400))


# openapi-compat: legacy import name
billing_bp = billing_blp
