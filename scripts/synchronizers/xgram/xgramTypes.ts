import { asBoolean, asNumber, asObject, asString } from 'cleaners'

export const asXgramCurrency = asObject({
  coinName: asString,
  contract: asString,
  minFrom: asNumber,
  maxFrom: asNumber,
  tagname: asString,
  network: asString,
  available: asBoolean
})
