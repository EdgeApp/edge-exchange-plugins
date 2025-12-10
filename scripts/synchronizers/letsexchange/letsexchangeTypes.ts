import { asArray, asEither, asNull, asObject, asString } from 'cleaners'

export const asLetsExchangeNetwork = asObject({
  code: asString,
  contract_address: asEither(asString, asNull)
})

export const asLetsExchangeCurrency = asObject({
  code: asString,
  networks: asArray(asLetsExchangeNetwork)
})

export const asLetsExchangeCurrenciesResponse = asArray(asLetsExchangeCurrency)
