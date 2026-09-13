from app.routes.user import _ADMIN_ORDERS_CTE, _ADMIN_PLAN_TABLE, _admin_order_filters


def test_admin_orders_unify_crypto_and_stripe_sources():
    assert "FROM qd_usdt_orders" in _ADMIN_ORDERS_CTE
    assert "FROM qd_stripe_orders" in _ADMIN_ORDERS_CTE
    assert "AS payment_method" in _ADMIN_ORDERS_CTE
    assert "stripe_session_id" in _ADMIN_ORDERS_CTE
    assert "o.expires_at <= NOW()" in _ADMIN_ORDERS_CTE


def test_admin_orders_join_the_database_backed_billing_plan_table():
    assert _ADMIN_PLAN_TABLE == "qd_billing_plans"


def test_admin_order_filters_cover_method_plan_status_and_search():
    where_sql, params = _admin_order_filters(
        "paid", "usdc", "yearly", "STRIPE-42"
    )

    assert "o.status = ?" in where_sql
    assert "o.payment_method = ?" in where_sql
    assert "o.plan = ?" in where_sql
    assert "o.provider_reference ILIKE ?" in where_sql
    assert "o.tx_hash ILIKE ?" in where_sql
    assert params[:3] == ["paid", "usdc", "yearly"]
    assert params[3:] == ["%STRIPE-42%"] * 9


def test_admin_order_filters_ignore_all_sentinels():
    where_sql, params = _admin_order_filters("all", "all", "all", "")
    assert where_sql == ""
    assert params == []
