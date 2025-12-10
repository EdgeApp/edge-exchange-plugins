import { asArray, asEither, asNull, asObject, asString } from 'cleaners'

export const asChangeNowCurrency = asObject({
  ticker: asString,
  network: asString,
  tokenContract: asEither(asString, asNull)
})

export const asChangeNowCurrenciesResponse = asArray(asChangeNowCurrency)
