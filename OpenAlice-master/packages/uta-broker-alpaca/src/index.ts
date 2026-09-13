import { AlpacaBroker } from '../../../services/uta/src/domain/trading/brokers/alpaca/AlpacaBroker.js'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'alpaca'
export const configSchema = AlpacaBroker.configSchema

export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(AlpacaBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
