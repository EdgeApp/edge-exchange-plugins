import { asArray, asEither, asNull, asObject, asString } from 'cleaners'

export const asChangeheroCurrency = asObject({
  name: asString,
  blockchain: asString,
  contractAddress: asEither(asString, asNull)
})

export const asChangeheroResponse = asObject({
  result: asArray(asChangeheroCurrency)
})
