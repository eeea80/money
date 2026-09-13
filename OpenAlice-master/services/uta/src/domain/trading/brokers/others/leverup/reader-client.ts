/**
 * Read-only data sources for LeverUp.
 *
 * Two surfaces:
 *  1. service.leverup.xyz REST — paginated user positions (mainnet only;
 *     testnet uses api-testnet.leverup.xyz, but the prod base swap is
 *     handled at the network-constants layer).
 *  2. Monad RPC via viem PublicClient — USDC.balanceOf, plus future on-chain
 *     reads if needed.
 *
 * REST is preferred for positions because it's already indexed/paginated;
 * chain reads are reserved for things REST doesn't expose (USDC balance).
 */

import { createPublicClient, http, parseAbi, type PublicClient } from 'viem'
import type { NetworkConstants } from './types.js'

// Minimal ERC-20 ABI fragment for balanceOf
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

// ---- REST: positions ----

/**
 * Position record as returned by service.leverup.xyz/v1/user/{addr}/positions.
 * Field names mirror LeverUp's response. Fees/funding are decimal strings;
 * prices are in wei strings (per LeverUp's protocol decimals).
 */
export interface RestPositionRecord {
  positionHash: `0x${string}`
  pairName: string
  pairBase: string
  tokenIn: string
  marginToken: string
  isLong: boolean
  /** Margin amount in collateral token's smallest unit (e.g., 6dp for USDC). */
  margin: string
  /** Position size; 10dp per LeverUp protocol. */
  qty: string
  /** Entry price; 18dp. */
  entryPrice: string
  stopLoss: string
  takeProfit: string
  openFee: string
  executionFee: string
  fundingFee: string
  holdingFee: string
  timestamp: number
  status: 'OPEN' | 'CLOSED'
  closeInfo?: {
    closePrice: string
    pnl: string
    closingFee?: string
  }
}

interface PaginatedPositions {
  content: RestPositionRecord[]
  pageNumber: number
  pageSize: number
  totalPages: number
  totalElements: number
}

export class ReaderClient {
  readonly publicClient: PublicClient
  private readonly net: NetworkConstants

  constructor(net: NetworkConstants) {
    this.net = net
    this.publicClient = createPublicClient({
      transport: http(net.rpcUrl),
    }) as PublicClient
  }

  // ---- REST ----

  /** Fetch up to `limit` open positions for `userAddress`. */
  async fetchOpenPositions(userAddress: `0x${string}`, limit = 100): Promise<RestPositionRecord[]> {
    const url = `${this.net.readerBase}/v1/user/${userAddress}/positions?size=${limit}&page=0`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Reader REST failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const page = (await res.json()) as PaginatedPositions
    return (page.content ?? []).filter(p => p.status === 'OPEN')
  }

  // ---- Chain reads ----

  async getUsdcBalance(address: `0x${string}`): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.net.usdc,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }) as Promise<bigint>
  }

  async getUsdcDecimals(): Promise<number> {
    const decimals = await this.publicClient.readContract({
      address: this.net.usdc,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }) as number
    return decimals
  }
}
