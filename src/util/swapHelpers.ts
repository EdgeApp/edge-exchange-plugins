import { add, sub } from 'biggystring'
import {
  EdgeAssetActionType,
  EdgeCurrencyWallet,
  EdgeSpendInfo,
  EdgeSwapApproveOptions,
  EdgeSwapInfo,
  EdgeSwapQuote,
  EdgeSwapRequest,
  EdgeSwapResult,
  EdgeToken,
  EdgeTokenId,
  EdgeTransaction,
  JsonObject,
  SwapCurrencyError
} from 'edge-core-js/types'

import { EdgeSwapRequestPlugin, MakeTxParams, StringMap } from '../swap/types'

const likeKindAssets = [
  ['BTC', 'WBTC', 'SBTC', 'RBTC'],
  ['ETH', 'WETH'],
  ['USDC', 'USDT', 'DAI']
]

/**
 * Ensures that a date is in the future by at least the given amount.
 */
export function ensureInFuture(
  date?: Date,
  marginSeconds: number = 30
): Date | undefined {
  if (date == null) return
  const target = Date.now() + marginSeconds * 1000
  return target < date.valueOf() ? date : new Date(target)
}

interface SwapOrderSpendInfo {
  spendInfo: EdgeSpendInfo
}

interface SwapOrderMakeTx {
  makeTxParams: MakeTxParams
}

type SwapOrderInner = SwapOrderMakeTx | SwapOrderSpendInfo

export type SwapOrder = SwapOrderInner & {
  addTxidToOrderUri?: boolean
  canBePartial?: boolean
  expirationDate?: Date
  fromNativeAmount: string
  maxFulfillmentSeconds?: number
  metadataNotes?: string
  minReceiveAmount?: string
  preTx?: EdgeTransaction
  request: EdgeSwapRequestPlugin
  swapInfo: EdgeSwapInfo
}

export async function makeSwapPluginQuote(
  order: SwapOrder
): Promise<EdgeSwapQuote> {
  const {
    addTxidToOrderUri = false,
    canBePartial,
    expirationDate,
    fromNativeAmount,
    maxFulfillmentSeconds,
    metadataNotes,
    minReceiveAmount,
    preTx,
    request,
    swapInfo
  } = order
  const { fromWallet, toWallet } = request

  let tx: EdgeTransaction
  if ('spendInfo' in order) {
    const { spendInfo } = order
    tx = await fromWallet.makeSpend(spendInfo)
  } else {
    const { makeTxParams } = order
    const { assetAction, savedAction } = makeTxParams
    tx = await fromWallet.otherMethods.makeTx(makeTxParams)
    if (tx.tokenId == null) {
      tx.tokenId = request.fromTokenId
    }
    if (tx.currencyCode == null) {
      tx.currencyCode = request.fromCurrencyCode
    }
    if (tx.savedAction == null) {
      tx.savedAction = savedAction
    }
    if (tx.assetAction == null) {
      tx.assetAction = assetAction
    }
  }
  const action = tx.savedAction

  if (action?.actionType !== 'swap') throw new Error(`Invalid swap action type`)

  const toNativeAmount = action?.toAsset.nativeAmount
  const destinationAddress = action?.payoutAddress
  const isEstimate = action?.isEstimate ?? false
  let quoteId = action?.orderId
  if (
    fromNativeAmount == null ||
    toNativeAmount == null ||
    destinationAddress == null
  ) {
    throw new Error(
      `Invalid makeSwapPluginQuote args from ${swapInfo.pluginId}`
    )
  }

  let nativeAmount =
    tx.parentNetworkFee != null ? tx.parentNetworkFee : tx.networkFee

  if (preTx != null)
    nativeAmount = add(
      nativeAmount,
      preTx.parentNetworkFee != null ? preTx.parentNetworkFee : preTx.networkFee
    )

  const out: EdgeSwapQuote = {
    canBePartial,
    expirationDate,
    fromNativeAmount,
    isEstimate,
    maxFulfillmentSeconds,
    minReceiveAmount,
    networkFee: {
      currencyCode: fromWallet.currencyInfo.currencyCode,
      nativeAmount,
      tokenId: null
    },
    pluginId: swapInfo.pluginId,
    request,
    swapInfo,
    toNativeAmount,
    async approve(opts?: EdgeSwapApproveOptions): Promise<EdgeSwapResult> {
      if (preTx != null) {
        const signedTransaction = await fromWallet.signTx(preTx)
        const broadcastedTransaction = await fromWallet.broadcastTx(
          signedTransaction
        )
        await fromWallet.saveTx(broadcastedTransaction)
      }
      tx.metadata = { ...(opts?.metadata ?? {}), ...tx.metadata }
      if (metadataNotes != null) {
        tx.metadata.notes =
          metadataNotes +
          (tx.metadata.notes != null ? `\n\n${tx.metadata.notes}` : '')
      }

      const signedTransaction = await fromWallet.signTx(tx)
      const broadcastedTransaction = await fromWallet.broadcastTx(
        signedTransaction
      )
      const savedAction = signedTransaction.savedAction
      if (
        addTxidToOrderUri &&
        savedAction != null &&
        'orderUri' in savedAction
      ) {
        if (savedAction.orderUri != null)
          savedAction.orderUri = `${savedAction.orderUri}${tx.txid}`
      }

      if (quoteId == null && swapInfo.isDex === true) {
        quoteId = tx.txid
      }

      await fromWallet.saveTx(signedTransaction)

      // For token transactions that spend the parent gas currency, add
      // a fee action
      if (
        signedTransaction.tokenId != null &&
        signedTransaction.parentNetworkFee != null &&
        signedTransaction.assetAction != null &&
        savedAction != null
      ) {
        // Only tag the network fee if any of the following is true:
        // 1. Not a DEX transaction
        // 2. Swapping across wallets
        // 3. Both assets are tokens
        if (
          !(swapInfo.isDex ?? false) ||
          fromWallet.id !== toWallet.id ||
          (request.fromTokenId != null && request.toTokenId != null)
        ) {
          const assetActionType: EdgeAssetActionType = signedTransaction.assetAction.assetActionType.startsWith(
            'swap'
          )
            ? 'swapNetworkFee'
            : 'transferNetworkFee'
          await fromWallet.saveTxAction({
            txid: signedTransaction.txid,
            tokenId: null,
            assetAction: { assetActionType },
            savedAction
          })
        }
      }

      return {
        transaction: broadcastedTransaction,
        orderId: quoteId,
        destinationAddress
      }
    },

    async close() {}
  }
  return out
}

export const getMaxSwappable = async <T extends any[]>(
  fetchSwap: (request: EdgeSwapRequestPlugin, ...args: T) => Promise<SwapOrder>,
  request: EdgeSwapRequestPlugin,
  ...args: T
): Promise<EdgeSwapRequestPlugin> => {
  if (request.quoteFor !== 'max') return request

  const requestCopy = { ...request }
  const { fromWallet, fromCurrencyCode, fromTokenId } = requestCopy

  // First attempt a swap that uses the entire balance
  const balance = fromWallet.balanceMap.get(fromTokenId) ?? '0'
  requestCopy.nativeAmount = balance
  requestCopy.quoteFor = 'from'
  const swapOrder = await fetchSwap(requestCopy, ...args)
  if (!('spendInfo' in swapOrder)) {
    return request
  }

  // Then use getMaxSpendable with the partner's address
  delete swapOrder.spendInfo.spendTargets[0].nativeAmount
  let maxAmount = await fromWallet.getMaxSpendable(swapOrder.spendInfo)

  // Subtract fee from pretx
  if (
    swapOrder.preTx != null &&
    fromCurrencyCode === fromWallet.currencyInfo.currencyCode
  ) {
    maxAmount = sub(maxAmount, swapOrder.preTx.networkFee)
  }

  // Update and return the request object
  requestCopy.nativeAmount = maxAmount
  return requestCopy
}

// Store custom fees so a request can use consistent fees when calling makeSpend multiple times
export const customFeeCacheMap: {
  [uid: string]: { customNetworkFee?: JsonObject; timestamp: number }
} = {}

let swapId = '0'
export const customFeeCache = {
  createUid: (): string => {
    swapId = add(swapId, '1')
    customFeeCacheMap[swapId] = { timestamp: Date.now() }
    return swapId
  },
  getFees: (uid: string): JsonObject | undefined => {
    return customFeeCacheMap?.[uid]?.customNetworkFee
  },
  setFees: (uid: string, customNetworkFee?: JsonObject): void => {
    for (const id of Object.keys(customFeeCacheMap)) {
      if (Date.now() > customFeeCacheMap[id].timestamp + 30000) {
        delete customFeeCacheMap[id] // eslint-disable-line
      }
    }
    customFeeCacheMap[uid] = { customNetworkFee, timestamp: Date.now() }
  }
}

interface AllCodes {
  fromMainnetCode: string
  toMainnetCode: string
  fromCurrencyCode: string
  toCurrencyCode: string
}

export const getCurrencyCode = (
  wallet: EdgeCurrencyWallet,
  tokenId: string | null
): string => {
  const { currencyCode } =
    tokenId == null
      ? wallet.currencyInfo
      : wallet.currencyConfig.allTokens[tokenId]

  return currencyCode
}

export const getCodes = (request: EdgeSwapRequest): AllCodes => {
  const { fromTokenId, fromWallet, toTokenId, toWallet } = request
  return {
    fromMainnetCode: fromWallet.currencyInfo.currencyCode,
    toMainnetCode: toWallet.currencyInfo.currencyCode,
    fromCurrencyCode: getCurrencyCode(fromWallet, fromTokenId),
    toCurrencyCode: getCurrencyCode(toWallet, toTokenId)
  }
}

const getPluginIds = (
  request: EdgeSwapRequest
): { fromPluginId: string; toPluginId: string } => ({
  fromPluginId: request.fromWallet.currencyInfo.pluginId,
  toPluginId: request.toWallet.currencyInfo.pluginId
})

export interface InvalidCurrencyCodes {
  from: { [pluginId: string]: 'allCodes' | 'allTokens' | string[] }
  to: { [pluginId: string]: 'allCodes' | 'allTokens' | string[] }
}

const defaultInvalidCodes: InvalidCurrencyCodes = {
  from: { ethereum: ['REP'] },
  to: { ethereum: ['REP'] }
}

/**
 * Throws if either currency code has been disabled by the plugin
 */
export function checkInvalidCodes(
  invalidCodes: InvalidCurrencyCodes,
  request: EdgeSwapRequestPlugin,
  swapInfo: EdgeSwapInfo
): void {
  const { fromPluginId, toPluginId } = getPluginIds(request)
  const {
    fromMainnetCode,
    toMainnetCode,
    fromCurrencyCode,
    toCurrencyCode
  } = getCodes(request)

  const isSameAsset = (request: EdgeSwapRequestPlugin): boolean =>
    request.fromWallet.currencyInfo.pluginId ===
      request.toWallet.currencyInfo.pluginId &&
    request.fromCurrencyCode === request.toCurrencyCode

  function check(
    codeMap: InvalidCurrencyCodes,
    direction: 'from' | 'to',
    pluginId: string,
    main: string,
    token: string
  ): boolean {
    const codes = codeMap[direction][pluginId]
    if (codes == null) return false
    if (codes === 'allCodes') return true
    if (codes === 'allTokens') return main !== token
    return codes.some(code => code === token)
  }

  if (
    check(
      invalidCodes,
      'from',
      fromPluginId,
      fromMainnetCode,
      fromCurrencyCode
    ) ||
    check(
      defaultInvalidCodes,
      'from',
      fromPluginId,
      fromMainnetCode,
      fromCurrencyCode
    ) ||
    check(invalidCodes, 'to', toPluginId, toMainnetCode, toCurrencyCode) ||
    check(
      defaultInvalidCodes,
      'to',
      toPluginId,
      toMainnetCode,
      toCurrencyCode
    ) ||
    isSameAsset(request)
  )
    throw new SwapCurrencyError(swapInfo, request)
}

export const checkWhitelistedMainnetCodes = (
  currencyPluginIdSwapNetworkMap: CurrencyPluginIdSwapChainCodeMap,
  request: EdgeSwapRequest,
  swapInfo: EdgeSwapInfo
): void => {
  const whitelist = toStringMap(currencyPluginIdSwapNetworkMap)
  if (
    whitelist[request.fromWallet.currencyInfo.pluginId] == null ||
    whitelist[request.toWallet.currencyInfo.pluginId] == null
  ) {
    throw new SwapCurrencyError(swapInfo, request)
  }
}

export interface CurrencyCodeTranscriptions {
  [code: string]: {
    [code: string]: string
  }
}

export interface MainnetPluginIdTranscriptionMap {
  [pluginId: string]: string
}

export interface CurrencyCodeTranscriptionMap {
  [pluginId: string]: {
    [currencyCode: string]: string
  }
}

const defaultCurrencyCodeTranscriptionMap: CurrencyCodeTranscriptionMap = {
  ethereum: {
    REPV2: 'REP'
  }
}

const defaultMainnetTranscriptionMap: MainnetPluginIdTranscriptionMap = {
  optimism: 'OP', // mainnet code is ETH
  zksync: 'ZKSYNC' // mainnet code is also ETH
}

/**
 * Returns all four codes with transcription
 */
export const getCodesWithTranscription = (
  request: EdgeSwapRequestPlugin,
  currencyPluginIdSwapNetworkMap: CurrencyPluginIdSwapChainCodeMap,
  currencyCodeTranscriptionMap: CurrencyCodeTranscriptionMap = {}
): AllCodes => {
  const mainnetTranscriptionMap = toStringMap(currencyPluginIdSwapNetworkMap)
  const {
    fromCurrencyCode,
    toCurrencyCode,
    fromMainnetCode,
    toMainnetCode
  } = getCodes(request)

  for (const pluginId of Object.keys(defaultCurrencyCodeTranscriptionMap)) {
    if (currencyCodeTranscriptionMap[pluginId] == null)
      currencyCodeTranscriptionMap[pluginId] =
        defaultCurrencyCodeTranscriptionMap[pluginId]
    else
      currencyCodeTranscriptionMap[pluginId] = {
        ...defaultCurrencyCodeTranscriptionMap[pluginId],
        ...currencyCodeTranscriptionMap[pluginId]
      }
  }

  for (const pluginId of Object.keys(defaultMainnetTranscriptionMap)) {
    if (mainnetTranscriptionMap[pluginId] == null)
      mainnetTranscriptionMap[pluginId] =
        defaultMainnetTranscriptionMap[pluginId]
  }

  return {
    fromMainnetCode:
      mainnetTranscriptionMap[request.fromWallet.currencyInfo.pluginId] ??
      fromMainnetCode,
    toMainnetCode:
      mainnetTranscriptionMap[request.toWallet.currencyInfo.pluginId] ??
      toMainnetCode,
    fromCurrencyCode:
      currencyCodeTranscriptionMap[request.fromWallet.currencyInfo.pluginId]?.[
        fromCurrencyCode
      ] ?? fromCurrencyCode,
    toCurrencyCode:
      currencyCodeTranscriptionMap[request.toWallet.currencyInfo.pluginId]?.[
        toCurrencyCode
      ] ?? toCurrencyCode
  }
}

export const isLikeKind = (
  fromCurrencyCode: string,
  toCurrencyCode: string
): boolean => {
  // Check if the swap is Like Kind
  for (const assetList of likeKindAssets) {
    const matchFrom = assetList.find(cc => cc === fromCurrencyCode)
    if (matchFrom != null) {
      const matchTo = assetList.find(cc => cc === toCurrencyCode)
      if (matchTo != null) {
        return true
      }
    }
  }
  return false
}

export const consify = (val: any): void =>
  console.log(JSON.stringify(val, null, 2))

export type EdgeCurrencyPluginId =
  | 'algorand'
  | 'arbitrum'
  | 'avalanche'
  | 'axelar'
  | 'base'
  | 'binance'
  | 'binancesmartchain'
  | 'bitcoin'
  | 'bitcoincash'
  | 'bitcoingold'
  | 'bitcoinsv'
  | 'bobevm'
  | 'cardano'
  | 'celo'
  | 'coreum'
  | 'cosmoshub'
  | 'dash'
  | 'digibyte'
  | 'dogecoin'
  | 'eboost'
  | 'eos'
  | 'ethereum'
  | 'ethereumclassic'
  | 'ethereumpow'
  | 'fantom'
  | 'feathercoin'
  | 'filecoin'
  | 'filecoinfevm'
  | 'fio'
  | 'groestlcoin'
  | 'hedera'
  | 'liberland'
  | 'litecoin'
  | 'monero'
  | 'optimism'
  | 'osmosis'
  | 'piratechain'
  | 'polkadot'
  | 'polygon'
  | 'pulsechain'
  | 'qtum'
  | 'ravencoin'
  | 'ripple'
  | 'rsk'
  | 'smartcash'
  | 'solana'
  | 'stellar'
  | 'sui'
  | 'telos'
  | 'tezos'
  | 'thorchainrune'
  | 'ton'
  | 'tron'
  | 'ufo'
  | 'vertcoin'
  | 'wax'
  | 'zcash'
  | 'zcoin'
  | 'zksync'

export const toStringMap = (
  map: CurrencyPluginIdSwapChainCodeMap
): StringMap => {
  const out: StringMap = {}
  for (const [key, value] of Object.entries(map)) {
    if (value === null) continue
    out[key] = value
  }
  return out
}

export type CurrencyPluginIdSwapChainCodeMap = Record<
  EdgeCurrencyPluginId,
  string | null
>

// Map of swap provider's chain codes and the tokens they support
export type ChainCodeTickerMap = Map<
  string,
  Array<{ tokenCode: string; contractAddress: string | null }>
>

// A map of EdgeTokenId to a swap provider's chain/token code pair
export type EdgeIdSwapIdMap = Map<
  EdgeCurrencyPluginId,
  Map<EdgeTokenId, { chainCode: string; tokenCode: string }>
>

const createEdgeIdToSwapIdMap = async (
  wallet: EdgeCurrencyWallet,
  chainCode: string | null,
  tickerSet: Array<{ tokenCode: string; contractAddress: string | null }>,
  defaultSwapChainCodeTokenCodeMap: EdgeIdSwapIdMap = new Map()
): Promise<EdgeIdSwapIdMap> => {
  const out: EdgeIdSwapIdMap = new Map(
    defaultSwapChainCodeTokenCodeMap.entries()
  )
  if (chainCode === null) return out

  const edgePluginId = wallet.currencyInfo.pluginId as EdgeCurrencyPluginId
  const tokenIdMap =
    out.get(edgePluginId) ??
    new Map([
      [null, { chainCode, tokenCode: wallet.currencyInfo.currencyCode }]
    ])
  for (const { tokenCode, contractAddress } of tickerSet) {
    if (contractAddress !== null) {
      const fakeToken: EdgeToken = {
        currencyCode: 'FAKE',
        denominations: [{ name: 'FAKE', multiplier: '1' }],
        displayName: 'FAKE',
        networkLocation: {
          contractAddress
        }
      }
      try {
        const tokenId = await wallet.currencyConfig.getTokenId(fakeToken)
        tokenIdMap.set(tokenId, { chainCode, tokenCode })
      } catch (e) {
        // ignore tokens that fail validation
      }
    }
  }
  out.set(edgePluginId, tokenIdMap)

  return out
}

export const getChainAndTokenCodes = async (
  request: EdgeSwapRequest,
  swapInfo: EdgeSwapInfo,
  chainCodeTickerMap: ChainCodeTickerMap,
  MAINNET_CODE_TRANSCRIPTION: CurrencyPluginIdSwapChainCodeMap,
  SPECIAL_MAINNET_CASES: EdgeIdSwapIdMap = new Map()
): Promise<{
  fromCurrencyCode: string
  toCurrencyCode: string
  fromMainnetCode: string
  toMainnetCode: string
}> => {
  let supportedAssetsMap = new Map(SPECIAL_MAINNET_CASES)

  const fromPluginId = request.fromWallet.currencyInfo
    .pluginId as EdgeCurrencyPluginId
  supportedAssetsMap = await createEdgeIdToSwapIdMap(
    request.fromWallet,
    MAINNET_CODE_TRANSCRIPTION[fromPluginId],
    chainCodeTickerMap.get(MAINNET_CODE_TRANSCRIPTION[fromPluginId] ?? '') ??
      [],
    supportedAssetsMap
  )

  const toPluginId = request.toWallet.currencyInfo
    .pluginId as EdgeCurrencyPluginId
  supportedAssetsMap = await createEdgeIdToSwapIdMap(
    request.toWallet,
    MAINNET_CODE_TRANSCRIPTION[toPluginId],
    chainCodeTickerMap.get(MAINNET_CODE_TRANSCRIPTION[toPluginId] ?? '') ?? [],
    supportedAssetsMap
  )

  const fromCodes = supportedAssetsMap
    .get(fromPluginId)
    ?.get(request.fromTokenId)

  const toCodes = supportedAssetsMap.get(toPluginId)?.get(request.toTokenId)

  if (fromCodes == null || toCodes == null) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  return {
    fromCurrencyCode: fromCodes.tokenCode,
    fromMainnetCode: fromCodes.chainCode,
    toCurrencyCode: toCodes.tokenCode,
    toMainnetCode: toCodes.chainCode
  }
}
