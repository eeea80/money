"""Trading worker process entrypoint."""

from __future__ import annotations

import os
import signal


def main() -> None:
    os.environ["QD_PROCESS_ROLE"] = "trading"

    from app import create_app
    from app.startup import get_trading_executor
    from app.workers.trading import TradingWorker

    app = create_app(register_http_routes=False)
    worker = TradingWorker(get_trading_executor())

    def stop(_signum, _frame) -> None:
        worker.stop()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    with app.app_context():
        worker.run_forever()


if __name__ == "__main__":
    main()
