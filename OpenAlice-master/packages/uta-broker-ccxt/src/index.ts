import { CcxtBroker } from '../../../services/uta/src/domain/trading/brokers/ccxt/CcxtBroker.js'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'ccxt'
export const configSchema = CcxtBroker.configSchema

export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(CcxtBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
