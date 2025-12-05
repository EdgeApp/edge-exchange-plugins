import {
  asArray,
  asEither,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

export const asGodexNetwork = asObject({
  code: asString,
  name: asString,
  icon: asEither(asString, asNull),
  is_active: asNumber,
  has_extra: asNumber,
  validation_address_regex: asEither(asString, asNull),
  validation_address_extra_regex: asEither(asString, asNull),
  extra_name: asEither(asString, asNull),
  explorer: asEither(asString, asNull),
  contract_address: asEither(asString, asNull),
  chain_id: asEither(asString, asNull)
})

export const asGodexCoin = asObject({
  code: asString,
  name: asString,
  disabled: asEither(asNumber, asNull),
  icon: asEither(asString, asNull),
  networks: asOptional(asArray(asGodexNetwork))
})

export const asGodexCoinsResponse = asArray(asGodexCoin)
