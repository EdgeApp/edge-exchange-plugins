import { EdgeCurrencyPluginId } from '../../src/util/edgeCurrencyPluginIds'

export const mayaprotocol = new Map<string, EdgeCurrencyPluginId | null>()
// Display Name: ARB
mayaprotocol.set('ARB', 'arbitrum')

// Display Name: BTC
mayaprotocol.set('BTC', 'bitcoin')

// Display Name: DASH
mayaprotocol.set('DASH', 'dash')

// Display Name: ETH
mayaprotocol.set('ETH', 'ethereum')

// Display Name: KUJI
mayaprotocol.set('KUJI', null)

// Display Name: MAYA
mayaprotocol.set('MAYA', 'cacao')

// Display Name: THOR
mayaprotocol.set('THOR', 'thorchainrune')

// Display Name: XRD
mayaprotocol.set('XRD', null)

// Display Name: ZEC
mayaprotocol.set('ZEC', 'zcash')
