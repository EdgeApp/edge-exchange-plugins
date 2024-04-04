import {
  asArray,
  asBoolean,
  asEither,
  asObject,
  asOptional,
  asString,
  Cleaner
} from 'cleaners'

function asCorePluginInit<T>(cleaner: Cleaner<T>): Cleaner<T | false> {
  return function asCorePlugin(raw) {
    if (raw === false || raw == null) return false
    return cleaner(raw)
  }
}

const asEvmApiKeys = asObject({
  alethioApiKey: asOptional(asString, ''),
  amberdataApiKey: asOptional(asString, ''),
  blockchairApiKey: asOptional(asString, ''),
  evmScanApiKey: asOptional(asArray(asString), () => []),
  gasStationApiKey: asOptional(asString, ''),
  infuraProjectId: asOptional(asString, ''),
  poktPortalApiKey: asOptional(asString, ''),
  quiknodeApiKey: asOptional(asString, '')
}).withRest

export const asTestConfig = asObject({
  // API keys:
  AIRBITZ_API_KEY: asOptional(asString, ''),

  // Core plugin options:
  AVALANCHE_INIT: asCorePluginInit(asEvmApiKeys),
  BINANCE_SMART_CHAIN_INIT: asCorePluginInit(asEvmApiKeys),
  CHANGE_NOW_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  CHANGEHERO_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  ETHEREUM_INIT: asCorePluginInit(asEvmApiKeys),
  ETHEREUM_POW_INIT: asCorePluginInit(asEvmApiKeys),
  EXOLIX_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  FANTOM_INIT: asCorePluginInit(asEvmApiKeys),
  FIO_INIT: asEither(
    asOptional(asBoolean, true), // Defaults to true if missing.
    asObject({
      fioRegApiToken: asOptional(asString, ''),
      tpid: asOptional(asString, 'finance@edge'),
      freeRegApiToken: asOptional(asString, ''),
      freeRegRefCode: asOptional(asString, '')
    }).withRest
  ),
  GODEX_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  LIFI_INIT: asCorePluginInit(
    asObject({
      affiliateFeeBasis: asOptional(asString, '50'),
      appId: asOptional(asString, 'edge'),
      integrator: asOptional(asString, 'edgeapp')
    }).withRest
  ),
  KOVAN_INIT: asCorePluginInit(asEvmApiKeys),
  LETSEXCHANGE_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  MONERO_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  OPTIMISM_INIT: asCorePluginInit(asEvmApiKeys),
  PULSECHAIN_INIT: asCorePluginInit(asEvmApiKeys),

  POLYGON_INIT: asCorePluginInit(asEvmApiKeys),
  SIDESHIFT_INIT: asCorePluginInit(
    asObject({
      affiliateId: asOptional(asString, '')
    }).withRest
  ),
  SPOOKY_SWAP_INIT: asCorePluginInit(
    asObject({
      quiknodeApiKey: asOptional(asString, '')
    }).withRest
  ),
  SWAPUZ_INIT: asCorePluginInit(
    asObject({
      apiKey: asOptional(asString, '')
    }).withRest
  ),
  THORCHAIN_INIT: asCorePluginInit(
    asObject({
      affiliateFeeBasis: asOptional(asString, '50'),
      appId: asOptional(asString, 'edge'),
      ninerealmsClientId: asOptional(asString, ''),
      thorname: asOptional(asString, 'ej')
    }).withRest
  ),
  TOMB_SWAP_INIT: asCorePluginInit(
    asObject({
      quiknodeApiKey: asOptional(asString, '')
    }).withRest
  ),
  WALLET_CONNECT_INIT: asCorePluginInit(
    asObject({
      projectId: asOptional(asString, '')
    }).withRest
  ),
  XRPDEX_INIT: asCorePluginInit(
    asObject({
      appId: asOptional(asString, 'edge')
    }).withRest
  ),
  YOLO_PASSWORD: asOptional(asString, null),
  YOLO_USERNAME: asOptional(asString, null),
  YOLO_PIN: asOptional(asString, null),
  YOLO_OTPKEY: asOptional(asString),
  YOLO_KEY: asOptional(asString, null),
  YOLO_DUMP: asOptional(asBoolean, true)
}).withRest
