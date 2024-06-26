import { asObject, asString } from 'cleaners'

export const asInitOptions = asObject({
  apiKey: asString
})
