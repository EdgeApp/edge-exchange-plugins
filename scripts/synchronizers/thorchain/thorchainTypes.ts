import { asArray, asObject, asString } from 'cleaners'

export const asThorchainPool = asObject({
  asset: asString
})

export const asThorchainPoolsResponse = asArray(asThorchainPool)
