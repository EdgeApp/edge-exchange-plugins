import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

export const thorchain = new Map<string, EdgeCurrencyPluginId | null>()
// Display Name: AVAX
thorchain.set('AVAX', 'avalanche')

// Display Name: BASE
thorchain.set('BASE', 'base')

// Display Name: BCH
thorchain.set('BCH', 'bitcoincash')

// Display Name: BSC
thorchain.set('BSC', 'binancesmartchain')

// Display Name: BTC
thorchain.set('BTC', 'bitcoin')

// Display Name: DOGE
thorchain.set('DOGE', 'dogecoin')

// Display Name: ETH
thorchain.set('ETH', 'ethereum')

// Display Name: GAIA
thorchain.set('GAIA', null)

// Display Name: LTC
thorchain.set('LTC', 'litecoin')

// Display Name: THOR
thorchain.set('THOR', 'thorchainrune')

// Display Name: TRON
thorchain.set('TRON', 'tron')

// Display Name: XRP
thorchain.set('XRP', 'ripple')
