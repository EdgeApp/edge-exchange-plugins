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
// Edge's `zcoin` currency plugin IS Firo (assetDisplayName 'Firo', code FIRO).
wizardswap.set('firo', 'zcoin')

// Display Name: Litecoin
wizardswap.set('ltc', 'litecoin')

// Display Name: Particl
// Edge has no Particl currency plugin.
wizardswap.set('part', null)

// Display Name: PIVX
wizardswap.set('pivx', 'pivx')

// Display Name: Monero
wizardswap.set('xmr', 'monero')

// Display Name: Zano
wizardswap.set('zano', 'zano')

// Display Name: Zcash *taddr only*
// WizardSwap only accepts transparent addresses; ../../src/swap/central/wizardswap.ts
// asks the Zcash wallet for `transparentAddress` rather than its default unified one.
wizardswap.set('zec', 'zcash')
