import { IbkrBroker } from '../../../services/uta/src/domain/trading/brokers/ibkr/IbkrBroker.js'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'ibkr'
export const configSchema = IbkrBroker.configSchema

export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(IbkrBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
