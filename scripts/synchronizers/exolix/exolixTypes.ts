import {
  asArray,
  asBoolean,
  asEither,
  asNull,
  asNumber,
  asObject,
  asString
} from 'cleaners'

export const asExolixNetwork = asObject({
  network: asString,
  name: asString,
  shortName: asEither(asString, asNull),
  notes: asEither(asString, asNull),
  addressRegex: asEither(asString, asNull),
  isDefault: asBoolean,
  blockExplorer: asEither(asString, asNull),
  memoNeeded: asBoolean,
  memoName: asEither(asString, asNull),
  memoRegex: asEither(asString, asNull),
  precision: asNumber,
  contract: asEither(asString, asNull),
  decimal: asEither(asNumber, asNull),
  icon: asEither(asString, asNull)
})

export const asExolixNetworksResponse = asObject({
  data: asArray(asExolixNetwork),
  count: asNumber
})
