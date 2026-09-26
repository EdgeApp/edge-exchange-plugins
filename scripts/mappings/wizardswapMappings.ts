import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

export const wizardswap = new Map<string, EdgeCurrencyPluginId | null>()
// Display Name: Bitcoin Cash
wizardswap.set('bch', 'bitcoincash')

// Display Name: Bitcoin
wizardswap.set('btc', 'bitcoin')

// Display Name: Dash
wizardswap.set('dash', 'dash')

// Display Name: Dogecoin
wizardswap.set('doge', 'dogecoin')

// Display Name: Ethereum
wizardswap.set('eth', 'ethereum')

// Display Name: Firo
wizardswap.set('firo', 'zcoin')

// Display Name: Litecoin
wizardswap.set('ltc', 'litecoin')

// Display Name: Particl
wizardswap.set('part', null)

// Display Name: PIVX
wizardswap.set('pivx', 'pivx')

// Display Name: Monero
wizardswap.set('xmr', 'monero')

// Display Name: Zano
wizardswap.set('zano', 'zano')

// Display Name: Zcash *taddr only*
wizardswap.set('zec', 'zcash')
