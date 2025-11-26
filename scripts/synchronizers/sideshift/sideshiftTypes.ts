import {
  asArray,
  asEither,
  asMaybe,
  asObject,
  asString,
  asUnknown
} from 'cleaners'

export const asSideShiftMainnetAsset = asObject({
  coin: asString,
  networks: asArray(asString),
  mainnet: asString
})

export const asSideShiftTokenAsset = asObject({
  coin: asString,
  networks: asArray(asString),
  tokenDetails: asObject(
    asObject({
      contractAddress: asString
    })
  )
})

export const asSideShiftAsset = asMaybe(
  asEither(asSideShiftMainnetAsset, asSideShiftTokenAsset)
)

export const asSideShiftAssetsResponse = asArray(asUnknown)
