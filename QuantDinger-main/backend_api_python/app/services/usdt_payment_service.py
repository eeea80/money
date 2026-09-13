"""
Backward-compatibility shim.

The real implementation lives in :mod:`app.services.usdt_payment` since
v3.0.6. This module preserves the historical import path used by
``routes/billing.py``, ``app/__init__.py`` and any older agent transcripts
that referenced ``from app.services.usdt_payment_service import ...``.
"""

from app.services.usdt_payment.service import (
    UsdtOrderWorker,
    UsdtPaymentService,
    get_usdt_order_worker,
    get_usdt_payment_service,
)

__all__ = [
    "UsdtPaymentService",
    "UsdtOrderWorker",
    "get_usdt_payment_service",
    "get_usdt_order_worker",
]
