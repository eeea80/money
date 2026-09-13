"""Native adapter request contracts for grid and pending-order cancellation."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services.grid.exchange_orders import cancel_grid_order
from app.services.grid.engine import GridEngine
from app.services.grid.resting_orders_repo import GridRestingOrder
from app.services.pending_orders.live_order_phases import cancel_live_limit_order
from app.services.live_trading.binance import BinanceFuturesClient
from app.services.live_trading.binance_spot import BinanceSpotClient
from app.services.live_trading.bitget import BitgetMixClient
from app.services.live_trading.bitget_spot import BitgetSpotClient
from app.services.live_trading.bybit import BybitClient
from app.services.live_trading.okx import OkxClient
from app.services.live_trading.htx import HtxClient
from app.services.live_trading.base import LiveTradingError


CASES = [
    (BinanceSpotClient, 'spot', 'DELETE', '/api/v3/order', {'symbol': 'BTCUSDT'}, 'orderId', 'origClientOrderId'),
    (BinanceFuturesClient, 'swap', 'DELETE', '/fapi/v1/order', {'symbol': 'BTCUSDT'}, 'orderId', 'origClientOrderId'),
    (BitgetSpotClient, 'spot', 'POST', '/api/v2/spot/trade/cancel-order', {'symbol': 'BTCUSDT'}, 'orderId', 'clientOid'),
    (BitgetMixClient, 'swap', 'POST', '/api/v2/mix/order/cancel-order',
     {'symbol': 'BTCUSDT', 'productType': 'USDT-FUTURES', 'marginCoin': 'USDT'}, 'orderId', 'clientOid'),
    (BybitClient, 'spot', 'POST', '/v5/order/cancel', {'symbol': 'BTCUSDT', 'category': 'spot'}, 'orderId', 'orderLinkId'),
    (BybitClient, 'swap', 'POST', '/v5/order/cancel', {'symbol': 'BTCUSDT', 'category': 'linear'}, 'orderId', 'orderLinkId'),
    (OkxClient, 'spot', 'POST', '/api/v5/trade/cancel-order', {'instId': 'BTC-USDT'}, 'ordId', 'clOrdId'),
    (OkxClient, 'swap', 'POST', '/api/v5/trade/cancel-order', {'instId': 'BTC-USDT-SWAP'}, 'ordId', 'clOrdId'),
]


@pytest.mark.parametrize('case', CASES, ids=lambda c: c[0].__name__ + '-' + c[1])
@pytest.mark.parametrize('use_exchange_id', [True, False])
@pytest.mark.parametrize('pathway', ['grid', 'pending'])
def test_cancel_dispatch_preserves_venue_request_contract(case, use_exchange_id, pathway):
    cls, market, method, endpoint, fields, oid_key, coid_key = case
    client = cls.__new__(cls)
    client.category = 'spot' if market == 'spot' else 'linear'
    client._signed_request = Mock(return_value={})
    oid = '12345' if use_exchange_id else ''
    common = dict(client=client, symbol='BTC/USDT', market_type=market, exchange_config={})
    if pathway == 'grid':
        cancel_grid_order(**common, exchange_order_id=oid, client_order_id='qd-test')
    else:
        cancel_live_limit_order(**common, order_id=oid, client_order_id='qd-test')
    expected = dict(fields)
    expected[oid_key if use_exchange_id else coid_key] = oid if use_exchange_id else 'qd-test'
    parameter = 'params' if method == 'DELETE' else 'json_body'
    client._signed_request.assert_called_once_with(method, endpoint, **{parameter: expected})


@pytest.mark.parametrize('use_exchange_id', [True, False])
def test_htx_spot_cancel_contract(use_exchange_id):
    client = HtxClient.__new__(HtxClient)
    client.market_type = 'spot'
    client._spot_private_request = Mock(return_value={})
    cancel_grid_order(client, symbol='BTC/USDT', market_type='spot',
                      exchange_order_id='12345' if use_exchange_id else '', client_order_id='qd-test')
    if use_exchange_id:
        client._spot_private_request.assert_called_once_with('POST', '/v1/order/orders/12345/submitcancel')
    else:
        client._spot_private_request.assert_called_once_with('POST', '/v1/order/orders/submitCancelClientOrder',
                                                            json_body={'client-order-id': 'qd-test'})


def test_bitget_spot_rejects_missing_identifiers_without_sending():
    client = BitgetSpotClient.__new__(BitgetSpotClient)
    client._signed_request = Mock()
    with pytest.raises(LiveTradingError):
        client.cancel_order(symbol='BTC/USDT')
    client._signed_request.assert_not_called()


@pytest.mark.parametrize('status,filled,processed,expected', [
    ('cancelled', 0, 0, True), ('cancelled', 0.1, 0, False),
    ('cancelled', 0.1, 0.1, True), ('open', 0, 0, False),
    ('unknown', 0, 0, False), ('filled', 0.1, 0, False),
])
def test_cancel_rejection_still_reconciles_terminal_state(monkeypatch, status, filled, processed, expected):
    monkeypatch.setattr('app.services.grid.engine.GridRestingOrderRepository', Mock())
    monkeypatch.setattr('app.services.grid.engine.GridCellRepository', Mock())
    engine = GridEngine(20, 'BTC/USDT', {}, {}, create_client_fn=Mock(), enqueue_market=Mock())
    engine._orders = SimpleNamespace(update_status=Mock(return_value=True))
    order = GridRestingOrder(id=42, exchange_order_id='12345', processed_fill_qty=processed)
    monkeypatch.setattr('app.services.grid.engine.cancel_grid_order', Mock(side_effect=LiveTradingError('already cancelled')))
    query = Mock(return_value=(filled, 65000, status))
    monkeypatch.setattr('app.services.grid.engine.query_grid_order_fill', query)
    assert engine._cancel_confirmed_order(object(), order) is expected
    query.assert_called_once()
    assert engine._orders.update_status.called is expected
