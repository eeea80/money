"""Strategy grid route facade."""
from datetime import datetime, timezone
import traceback

from flask import g, jsonify, request

from app.routes.strategy_blueprint import strategy_blp
from app.routes.strategy_services import get_strategy_service
from app.utils.auth import login_required
from app.utils.logger import get_logger


logger = get_logger(__name__)


@strategy_blp.route('/strategies/grid-resting-orders', methods=['GET'])
@login_required
def get_grid_resting_orders():
    """List resting grid limit orders tracked for a live grid bot."""
    try:
        user_id = g.user_id
        strategy_id = request.args.get('id', type=int)
        if not strategy_id:
            return jsonify({'code': 0, 'msg': 'Missing strategy id parameter', 'data': {'orders': [], 'items': []}}), 400

        st = get_strategy_service().get_strategy(strategy_id, user_id=user_id)
        if not st:
            return jsonify({'code': 0, 'msg': 'Strategy not found', 'data': {'orders': [], 'items': []}}), 404

        from app.services.strategy_runtime.bot_type import resolve_bot_type

        bot_type = resolve_bot_type(st, st.get('trading_config') or {})
        if bot_type != 'grid':
            return jsonify({'code': 0, 'msg': 'Not a grid strategy', 'data': {'orders': [], 'items': []}}), 400

        status = request.args.get('status', '')
        limit = request.args.get('limit', default=200, type=int)
        sync = request.args.get('sync', '').lower() in ('1', 'true', 'yes')

        sync_error = ''
        synced_count = 0
        if sync:
            try:
                from app.services.grid.poller import sync_strategy_grid_orders

                synced_count = int(sync_strategy_grid_orders(int(strategy_id)) or 0)
            except Exception as sync_err:
                logger.debug("grid-resting sync sid=%s: %s", strategy_id, sync_err)
                sync_error = str(sync_err)

        from app.services.grid.resting_orders_repo import GridRestingOrderRepository
        from app.utils.trade_close_reason import label_for_reason

        lang = str(request.args.get("lang") or request.headers.get("Accept-Language") or "zh")
        if lang.lower().startswith("en"):
            lang = "en"
        else:
            lang = "zh"

        repo = GridRestingOrderRepository()
        rows = repo.list_for_strategy(strategy_id, status=status, limit=limit or 200)
        out = []
        for o in rows:
            purpose = o.purpose
            out.append({
                'id': o.id,
                'strategy_id': o.strategy_id,
                'symbol': o.symbol,
                'cell_index': o.cell_index,
                'purpose': purpose,
                'purpose_label': label_for_reason(purpose, lang=lang),
                'purpose_label_en': label_for_reason(purpose, lang="en"),
                'side': o.side,
                'pos_side': o.pos_side,
                'reduce_only': o.reduce_only,
                'price': o.price,
                'quantity': o.quantity,
                'quote_amount': o.quote_amount,
                'client_order_id': o.client_order_id,
                'exchange_order_id': o.exchange_order_id,
                'status': o.status,
                'filled_quantity': o.filled_quantity,
                'avg_fill_price': o.avg_fill_price,
                'extra': o.extra or {},
                'created_at': o.created_at.isoformat() if hasattr(o.created_at, 'isoformat') else o.created_at,
                'updated_at': o.updated_at.isoformat() if hasattr(o.updated_at, 'isoformat') else o.updated_at,
            })
        status_counts = {}
        for item in out:
            key = str(item.get('status') or 'unknown')
            status_counts[key] = int(status_counts.get(key, 0)) + 1
        verified = sum(1 for item in out if str(item.get('exchange_order_id') or '').strip())
        updated_values = [str(item.get('updated_at') or '') for item in out if item.get('updated_at')]
        summary = {
            'total': len(out),
            'verified_exchange_orders': verified,
            'unverified_orders': len(out) - verified,
            'status_counts': status_counts,
            'sync_requested': sync,
            'sync_ok': not bool(sync_error),
            'sync_error': sync_error,
            'synced_count': synced_count,
            'last_reconciled_at': max(updated_values) if updated_values else None,
            'generated_at': datetime.now(timezone.utc).isoformat(),
        }
        return jsonify({'code': 1, 'msg': 'success', 'data': {'orders': out, 'items': out, 'summary': summary}})
    except Exception as e:
        logger.error("get_grid_resting_orders failed: %s", e)
        logger.error(traceback.format_exc())
        return jsonify({'code': 0, 'msg': str(e), 'data': {'orders': [], 'items': []}}), 500
