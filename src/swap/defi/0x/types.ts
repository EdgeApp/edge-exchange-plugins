import { asNumber, asObject, asOptional, asString } from 'cleaners'

export const asInitOptions = asObject({
  apiKey: asString,
  feePercentage: asOptional(asNumber, 0.0075),
  feeReceiveAddress: asOptional(
    asString,
    '0xd75eB391357b89C48eb64Ea621A785FF9B77e661'
  )
})
