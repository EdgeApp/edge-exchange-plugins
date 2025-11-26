import { asArray, asObject, asString } from 'cleaners'

export const asLifiChain = asObject({
  key: asString,
  name: asString
})

export const asLifiChainsResponse = asObject({
  chains: asArray(asLifiChain)
})
