import { asArray, asObject, asOptional, asString } from 'cleaners'

export const asRangoBlockchain = asObject({
  name: asString,
  displayName: asOptional(asString)
})

export const asRangoMetaResponse = asObject({
  blockchains: asArray(asRangoBlockchain)
})
