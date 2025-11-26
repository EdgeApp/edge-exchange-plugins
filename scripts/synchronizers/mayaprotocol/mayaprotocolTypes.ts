import { asArray, asObject, asString } from 'cleaners'

export const asMayaProtocolPool = asObject({
  asset: asString
})

export const asMayaProtocolPoolsResponse = asArray(asMayaProtocolPool)
