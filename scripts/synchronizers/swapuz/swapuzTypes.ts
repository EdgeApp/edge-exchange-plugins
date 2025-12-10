import { asArray, asNumber, asObject, asOptional, asString } from 'cleaners'

const asSwapuzNetwork = asObject({
  shortName: asString,
  name: asString,
  fullName: asOptional(asString)
})

const asSwapuzCoin = asObject({
  name: asString,
  network: asArray(asSwapuzNetwork)
})

export const asSwapuzResponse = asObject({
  result: asArray(asSwapuzCoin),
  status: asOptional(asNumber),
  message: asOptional(asString)
})
