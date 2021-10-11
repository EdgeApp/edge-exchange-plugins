import { makeConfig } from 'cleaner-config'
import {
  asBoolean,
  asEither,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

const {
  COUCH_FULL_PATH = 'http://username:password@localhost:5984',
  COUCH_DB_NAME = 'swap_info',
  HTTP_HOSTNAME = '127.0.0.1',
  HTTP_PORT = '8008',
  TIME_BETWEEN_CYCLES_IN_MINUTES = '10',
  EDGE_API_KEY = 'test',
  EDGE_APP_ID = '',
  EDGE_USERNAME = '',
  EDGE_PASSWORD = '',
  EDGE_RATES_SERVER = 'https://rates1.edge.app',
  CURRENCY_PAIR_PREFIX = 'iso:USD_'
} = process.env

export const asSwapPlugin = asObject({
  apiKey: asOptional(asString),
  secret: asOptional(asString),
  affiliateId: asOptional(asString),
  affiliateMargin: asOptional(asNumber),
  partnerContract: asOptional(asString)
})

const asPlugin = asObject(asEither(asBoolean, asSwapPlugin))

export const asConfig = asObject({
  dbFullpath: asOptional(asString, COUCH_FULL_PATH),
  dbName: asOptional(asString, COUCH_DB_NAME),
  httpHost: asOptional(asString, HTTP_HOSTNAME),
  httpPort: asOptional(asNumber, parseInt(HTTP_PORT)),
  timeBetweenCyclesInMinutes: asOptional(
    asNumber,
    parseInt(TIME_BETWEEN_CYCLES_IN_MINUTES)
  ),
  apiKey: asOptional(asString, EDGE_API_KEY),
  appId: asOptional(asString, EDGE_APP_ID),
  username: asOptional(asString, EDGE_USERNAME),
  password: asOptional(asString, EDGE_PASSWORD),
  ratesServerAddress: asOptional(asString, EDGE_RATES_SERVER),
  currencyPairPrefix: asOptional(asString, CURRENCY_PAIR_PREFIX),
  plugins: asOptional(asPlugin, {})
})

export const config = makeConfig(asConfig, 'swapConfig.json')
