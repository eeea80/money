import unittest

from app.services.community_service import _marketplace_contract_payload


class MarketplaceStrategyContractTests(unittest.TestCase):
    def test_contract_separates_source_scope_from_backtest_evidence(self):
        manifest = {
            "apiVersion": 2,
            "strategyType": "cta",
            "primaryFrequency": "4h",
            "markets": ["Crypto"],
            "universe": {
                "kind": "static",
                "reference": "",
                "instruments": [{
                    "market": "Crypto",
                    "symbol": "BTC/USDT",
                    "market_type": "spot",
                }],
            },
            "subscriptions": [{
                "frequency": "4h",
                "fields": ["open", "high", "low", "close", "volume"],
            }],
            "factorDependencies": ["MACD", "STOCH"],
            "fundamentalDependencies": [],
            "warmupBars": 210,
            "leverageAllowed": False,
            "maxLeverage": 1,
        }
        schema = {
            "params": [{
                "name": "fast_period",
                "labelKey": "trading-assistant.templateParam.fast_period.label",
                "type": "integer",
                "default": 12,
                "min": 2,
                "max": 100,
                "step": 1,
            }],
        }

        contract = _marketplace_contract_payload(manifest, schema, source="published_code")

        self.assertEqual(contract["execution_frequency"], "4h")
        self.assertEqual(contract["confirmation_frequencies"], [])
        self.assertEqual(contract["instruments"][0]["symbol"], "BTC/USDT")
        self.assertEqual(contract["factor_dependencies"], ["MACD", "STOCH"])
        self.assertEqual(contract["data_fields"], ["open", "high", "low", "close", "volume"])
        self.assertEqual(contract["parameters"][0]["default"], 12)
        self.assertFalse(contract["leverage_allowed"])

    def test_missing_manifest_does_not_publish_an_empty_contract(self):
        self.assertIsNone(_marketplace_contract_payload({}, {}, source="published_code"))


if __name__ == "__main__":
    unittest.main()
