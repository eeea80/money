import { LeverupBroker } from '../../../services/uta/src/domain/trading/brokers/others/leverup/LeverupBroker.js'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'leverup'
export const configSchema = LeverupBroker.configSchema

export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(LeverupBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
