import { LongbridgeBroker } from '../../../services/uta/src/domain/trading/brokers/longbridge/LongbridgeBroker.js'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'longbridge'
export const configSchema = LongbridgeBroker.configSchema

export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(LongbridgeBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
