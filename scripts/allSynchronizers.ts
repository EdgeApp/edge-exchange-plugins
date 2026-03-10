/**
 * Central registry of all swap provider synchronizers.
 *
 * To add a new synchronizer:
 * 1. Import your synchronizer factory function
 * 2. Add it to the synchronizers array below
 */

import { config } from './mapctlConfig'
import { makeChangeHeroSynchronizer } from './synchronizers/changehero/changeheroSynchronizer'
import { makeChangeNowSynchronizer } from './synchronizers/changenow/changenowSynchronizer'
import { makeExolixSynchronizer } from './synchronizers/exolix/exolixSynchronizer'
import { makeGodexSynchronizer } from './synchronizers/godex/godexSynchronizer'
import { makeLetsExchangeSynchronizer } from './synchronizers/letsexchange/letsexchangeSynchronizer'
import { makeLifiSynchronizer } from './synchronizers/lifi/lifiSynchronizer'
import { makeMayaProtocolSynchronizer } from './synchronizers/mayaprotocol/mayaprotocolSynchronizer'
import { makeRangoSynchronizer } from './synchronizers/rango/rangoSynchronizer'
import { makeSideShiftSynchronizer } from './synchronizers/sideshift/sideshiftSynchronizer'
import { makeSwapKitSynchronizer } from './synchronizers/swapkit/swapkitSynchronizer'
import { makeSwapuzSynchronizer } from './synchronizers/swapuz/swapuzSynchronizer'
import { makeThorchainSynchronizer } from './synchronizers/thorchain/thorchainSynchronizer'
import { makeXgramSynchronizer } from './synchronizers/xgram/xgramSynchronizer'
import { SwapSynchronizer } from './types'

export const synchronizers: SwapSynchronizer[] = [
  makeChangeHeroSynchronizer(config),
  makeChangeNowSynchronizer(config),
  makeExolixSynchronizer(config),
  makeGodexSynchronizer(config),
  makeLetsExchangeSynchronizer(config),
  makeLifiSynchronizer(config),
  makeMayaProtocolSynchronizer(config),
  makeRangoSynchronizer(config),
  makeSideShiftSynchronizer(config),
  makeSwapKitSynchronizer(config),
  makeSwapuzSynchronizer(config),
  makeThorchainSynchronizer(config),
  makeXgramSynchronizer(config)
]
