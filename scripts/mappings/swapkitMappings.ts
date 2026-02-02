import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

export const swapkit = new Map<string, EdgeCurrencyPluginId | null>()
// Display Name: ARB
swapkit.set('ARB', 'arbitrum')

// Display Name: AVAX - THORCHAIN supported
swapkit.set('AVAX', 'avalanche')

// Display Name: BASE - THORCHAIN supported
swapkit.set('BASE', 'base')

// Display Name: BCH - THORCHAIN supported
swapkit.set('BCH', 'bitcoincash')

// Display Name: BERA
swapkit.set('BERA', null)

// Display Name: BSC - THORCHAIN supported
swapkit.set('BSC', 'binancesmartchain')

// Display Name: BTC - THORCHAIN & MAYACHAIN supported
swapkit.set('BTC', 'bitcoin')

// Display Name: DASH - MAYACHAIN supported
swapkit.set('DASH', 'dash')

// Display Name: DOGE - THORCHAIN supported
swapkit.set('DOGE', 'dogecoin')

// Display Name: DOT
swapkit.set('DOT', 'polkadot')

// Display Name: ETH - THORCHAIN & MAYACHAIN supported
swapkit.set('ETH', 'ethereum')

// Display Name: GAIA - THORCHAIN supported (Cosmos Hub)
// Disabled: swapkit plugin only supports EVM and UTXO chain types
swapkit.set('GAIA', null)

// Display Name: GNO
swapkit.set('GNO', null)

// Display Name: KUJI
swapkit.set('KUJI', null)

// Display Name: LTC - THORCHAIN supported
swapkit.set('LTC', 'litecoin')

// Display Name: MAYA
swapkit.set('MAYA', null)

// Display Name: MONAD
swapkit.set('MONAD', 'monad')

// Display Name: NEAR
swapkit.set('NEAR', null)

// Display Name: OP
swapkit.set('OP', 'optimism')

// Display Name: POL
swapkit.set('POL', 'polygon')

// Display Name: SOL
swapkit.set('SOL', 'solana')

// Display Name: SUI
swapkit.set('SUI', 'sui')

// Display Name: THOR - THORCHAIN native
// Disabled: swapkit plugin only supports EVM and UTXO chain types
swapkit.set('THOR', null)

// Display Name: TRON - THORCHAIN supported
// Disabled: swapkit plugin only supports EVM and UTXO chain types
swapkit.set('TRON', null)

// Display Name: XRD
swapkit.set('XRD', null)

// Display Name: XRP - THORCHAIN supported
// Disabled: swapkit plugin only supports EVM and UTXO chain types
swapkit.set('XRP', null)

// Display Name: ZEC - MAYACHAIN supported
// Disabled: requires ZIP-321 handling not implemented in swapkit plugin
swapkit.set('ZEC', null)
