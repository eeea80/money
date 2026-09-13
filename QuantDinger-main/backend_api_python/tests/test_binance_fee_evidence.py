from unittest.mock import patch

import pytest

from app.services.execution_streams.normalizers import parse_binance
from app.services.live_trading.binance import BinanceFuturesClient
from app.services.live_trading.binance_spot import BinanceSpotClient


@pytest.mark.parametrize('client_type,method', [
    (BinanceFuturesClient, 'get_user_trades'), (BinanceSpotClient, 'get_my_trades'),
])
@pytest.mark.parametrize('row', [
    {}, {'commission': None}, {'commission': ''}, {'commission': 'invalid'},
    {'commission': 'NaN'}, {'commission': '0.2'},
    {'commission': '0.2', 'commissionAsset': 'USDT', 'orderId': 999},
    {'commission': '0.2', 'commissionAsset': 'USDT', 'qty': '0.01'},
])
def test_missing_or_incomplete_fee_evidence_stays_pending(client_type, method, row):
    client = client_type(api_key='k', secret_key='s')
    with patch.object(client, method, return_value=[row]):
        fee, _, fees = client._fetch_commission_for_order(
            symbol='BTC/USDT', order_id='1', filled=0.1, avg_price=70000, max_attempts=1,
        )
    assert fee == 0
    assert fees == {}
    assert client._fee_status(fees) == 'pending'


@pytest.mark.parametrize('commission,status', [(None, 'pending'), ('', 'pending'), ('0', 'actual_zero'), ('0.1', 'actual')])
@pytest.mark.parametrize('market_type', ['spot', 'swap'])
def test_stream_requires_explicit_commission_for_confirmed_zero(commission, status, market_type):
    order = {'s': 'BTCUSDT', 'l': '0.1', 't': 1, 'i': 2, 'X': 'FILLED', 'L': '70000', 'n': commission, 'N': 'USDT'}
    payload = {'e': 'ORDER_TRADE_UPDATE', 'o': order} if market_type == 'swap' else dict(order, e='executionReport')
    assert parse_binance(payload, market_type=market_type)[0].fee_status == status


def test_old_futures_fee_query_uses_order_time_window():
    client = BinanceFuturesClient(api_key='k', secret_key='s')
    filled_at = 1788346800000
    order = {'status': 'FILLED', 'executedQty': '0.1', 'avgPrice': '70000', 'updateTime': filled_at}
    trades = [{'orderId': 1, 'qty': '0.1', 'commission': '0.35', 'commissionAsset': 'USDT'}]
    with patch.object(client, 'get_order', return_value=order), patch.object(client, '_signed_request', return_value=trades) as request:
        result = client.wait_for_fill(symbol='BTC/USDT', order_id='1', max_wait_sec=0)
    assert result['fee'] == pytest.approx(0.35)
    assert result['fee_status'] == 'actual'
    params = request.call_args.kwargs['params']
    assert params['startTime'] < filled_at < params['endTime']
    assert params['endTime'] - params['startTime'] < 7 * 86400000
    assert params['orderId'] == '1'
