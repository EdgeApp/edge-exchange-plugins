import { asArray, asObject, asString } from 'cleaners'

export const asSimpleSwapCurrency = asObject({
  ticker: asString,
  network: asString
})

export const asSimpleSwapCurrenciesResponse = asObject({
  result: asArray(asSimpleSwapCurrency)
})
