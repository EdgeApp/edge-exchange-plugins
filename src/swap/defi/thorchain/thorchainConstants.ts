import { InvalidTokenIds } from '../../../util/swapHelpers'

/**
 * Constants describing the THORChain-family node API, shared by the
 * Thorchain-based plugins and the SwapKit plugins.
 */

export const EXPIRATION_MS = 1000 * 60
export const EXCHANGE_INFO_UPDATE_FREQ_MS = 60000
export const EVM_SEND_GAS = '80000'
export const EVM_TOKEN_SEND_GAS = '80000'
export const THOR_LIMIT_UNITS = '100000000'
export const AFFILIATE_FEE_BASIS_DEFAULT = '50'

const NATIVE_IN_GWEI = '1000000000'

export const INVALID_TOKEN_IDS: InvalidTokenIds = {
  from: {
    optimism: ['9560e827af36c94d2ac33a39bce1fe78631088db' /* VELO */]
  },
  to: {}
}

export type ChainType = 'evm' | 'utxo' | 'cosmos' | 'other'

/** Chain type classification for THORChain/Maya supported chains */
export const CHAIN_TYPE_MAP: { [cc: string]: ChainType } = {
  // EVM chains
  ARB: 'evm',
  AVAX: 'evm',
  BASE: 'evm',
  BSC: 'evm',
  ETC: 'evm',
  ETH: 'evm',
  FTM: 'evm',
  OP: 'evm',
  POL: 'evm',

  // UTXO chains
  BCH: 'utxo',
  BTC: 'utxo',
  DASH: 'utxo',
  DOGE: 'utxo',
  LTC: 'utxo',
  ZEC: 'utxo',

  // Cosmos chains
  GAIA: 'cosmos',
  THOR: 'cosmos',
  MAYA: 'cosmos',
  KUJI: 'cosmos',

  // Other chain types
  DOT: 'other',
  SOL: 'other',
  SUI: 'other',
  TRON: 'other',
  XRP: 'other'
}

/** Thorchain has weird heuristics for some currencies */
export const NATIVE_TO_THOR_MULTIPLIER: { [cc: string]: string } = {
  ARB: NATIVE_IN_GWEI,
  AVAX: NATIVE_IN_GWEI,
  BASE: NATIVE_IN_GWEI,
  BCH: '1',
  BNB: '1',
  BSC: NATIVE_IN_GWEI,
  BTC: '1',
  DASH: '1',
  DOGE: '1',
  ETC: NATIVE_IN_GWEI,
  ETH: NATIVE_IN_GWEI,
  FTM: NATIVE_IN_GWEI,
  LTC: '1',
  THOR: '1',
  TRON: '1',
  XRP: '0.01'
}

export const getGasLimit = (
  chain: string,
  tokenId: string | null
): string | undefined => {
  if (CHAIN_TYPE_MAP[chain] === 'evm') {
    if (tokenId == null) {
      return EVM_SEND_GAS
    } else {
      return EVM_TOKEN_SEND_GAS
    }
  }
}
