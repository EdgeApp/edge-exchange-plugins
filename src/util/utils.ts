import { add, div, gt, lt, max, mul, round, sub } from 'biggystring'
import {
  EdgeCurrencyWallet,
  EdgeFetchFunction,
  EdgeFetchResponse,
  EdgeMemoOption,
  EdgeSwapRequest
} from 'edge-core-js'

import { EdgeSwapRequestPlugin } from '../swap/types'
import { getCodes } from './swapHelpers'
const INFO_SERVERS = ['https://info1.edge.app', 'https://info2.edge.app']
const RATES_SERVERS = ['https://rates1.edge.app', 'https://rates2.edge.app']

export interface QueryParams {
  [key: string]: string | number | boolean | null
}

export const promiseWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number = 5000
): Promise<T> => {
  return await new Promise((resolve, reject) => {
    promise.then(v => resolve(v)).catch(e => reject(e))
    setTimeout(() => reject(new Error('PROMISE_TIMEOUT')), timeoutMs)
  })
}

//
// All routines below borrowed verbatim from edge-react-gui
//

type AsyncFunction = () => Promise<any>

export async function snooze(ms: number): Promise<void> {
  return await new Promise((resolve: any) => setTimeout(() => resolve(), ms))
}

export const shuffleArray = <T>(array: T[]): T[] => {
  let currentIndex = array.length
  let temporaryValue, randomIndex

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex -= 1

    // And swap it with the current element.
    temporaryValue = array[currentIndex]
    array[currentIndex] = array[randomIndex]
    array[randomIndex] = temporaryValue
  }

  return array
}

export async function asyncWaterfall(
  asyncFuncs: AsyncFunction[],
  timeoutMs: number = 5000
): Promise<any> {
  let pending = asyncFuncs.length
  const promises: Array<Promise<any>> = []
  for (const func of asyncFuncs) {
    const index = promises.length
    promises.push(
      func().catch(e => {
        e.index = index
        throw e
      })
    )
    if (pending > 1) {
      promises.push(
        new Promise((resolve, reject) => {
          snooze(timeoutMs)
            .then(() => {
              resolve('async_waterfall_timed_out')
            })
            .catch(e => reject(e))
        })
      )
    }
    try {
      const result = await Promise.race(promises)
      if (result === 'async_waterfall_timed_out') {
        const p = promises.pop()
        p?.then().catch()
        --pending
      } else {
        return result
      }
    } catch (e: any) {
      const i = e.index
      promises.splice(i, 1)
      const p = promises.pop()
      p?.then().catch()
      --pending
      if (pending === 0) {
        throw e
      }
    }
  }
}

export async function fetchWaterfall(
  fetch: EdgeFetchFunction,
  servers: string[],
  path: string,
  options?: any,
  timeout: number = 5000
): Promise<EdgeFetchResponse> {
  const funcs = servers.map(server => async () => {
    const result = await fetch(server + '/' + path, options)
    if (typeof result !== 'object') {
      const msg = `Invalid return value ${path} in ${server}`
      throw new Error(msg)
    }
    return result
  })
  return await asyncWaterfall(funcs, timeout)
}

async function multiFetch(
  fetch: EdgeFetchFunction,
  servers: string[],
  path: string,
  options?: any,
  timeout: number = 5000
): Promise<any> {
  if (servers == null) return
  return await fetchWaterfall(
    fetch,
    shuffleArray(servers),
    path,
    options,
    timeout
  )
}

export const fetchInfo = async (
  fetch: EdgeFetchFunction,
  path: string,
  options?: Object,
  timeout?: number
): Promise<any> => {
  return await multiFetch(fetch, INFO_SERVERS, path, options, timeout)
}
export const fetchRates = async (
  fetch: EdgeFetchFunction,
  path: string,
  options?: Object,
  timeout?: number
): Promise<EdgeFetchResponse> => {
  return await multiFetch(fetch, RATES_SERVERS, path, options, timeout)
}

export const prettyLogObject = (val: any): void =>
  console.log(JSON.stringify(val, null, 2))

export const makeQueryParams = (params: QueryParams): string => {
  // Sometimes we can round below 1 and pass a 0 amount.
  // Make sure we always request quotes with a nonzero amount, so that we can
  // grab the real minimum. The minimum will always be well above 1.
  params.amount = max(params.amount?.toString() ?? '1', '1')

  return Object.keys(params)
    .map(key => {
      const value = params[key]
      return value == null ? key : `${key}=${encodeURIComponent(value)}`
    })
    .join('&')
}

export const convertRequest = (
  request: EdgeSwapRequest
): EdgeSwapRequestPlugin => {
  const { fromCurrencyCode, toCurrencyCode } = getCodes(request)

  const out: EdgeSwapRequestPlugin = {
    ...request,
    fromCurrencyCode,
    toCurrencyCode
  }
  return out
}

export async function getAddress(
  wallet: EdgeCurrencyWallet,
  requiredAddressType?: string
): Promise<string> {
  const allAddresses = await wallet.getAddresses({
    tokenId: null
  })

  if (requiredAddressType != null) {
    const address = allAddresses.find(
      address => address.addressType === requiredAddressType
    )
    if (address != null) return address.publicAddress
    else throw new Error(`No address of type ${requiredAddressType}`)
  }

  const segwitAddress = allAddresses.find(
    address => address.addressType === 'segwitAddress'
  )

  return (segwitAddress ?? allAddresses[0]).publicAddress
}

export const hexToDecimal = (hex: string): string => {
  if (hex.startsWith('0x')) {
    return add(hex, '0')
  } else {
    return add(`0x${hex}`, '0')
  }
}

const pluginIdMemoTypes: { [pluginId: string]: EdgeMemoOption['type'] } = {
  ripple: 'number',
  stellar: 'number',
  zano: 'hex'
}
export const memoType = (pluginId: string): EdgeMemoOption['type'] => {
  return pluginIdMemoTypes[pluginId] ?? 'text'
}

/**
 * Binary search to find the minimum swap amount that succeeds
 * Starts with a USD amount and converts to native amount using exchange rates
 */
export async function findMinimumSwapAmount({
  wallet,
  tokenId,
  exchangeRate = '0',
  startingUsdAmount = '300',
  maxIterations = 5,
  log = console.log,
  quoteTester
}: {
  wallet: EdgeCurrencyWallet
  tokenId: string | null
  exchangeRate?: string
  startingUsdAmount?: string
  maxIterations?: number
  log?: Function
  /** Returns true if quote succeeds */
  quoteTester: (nativeAmount: string) => Promise<boolean>
}): Promise<string | undefined> {
  if (exchangeRate === '0') {
    log('Exchange rate is 0, cannot search for minimum')
    return undefined
  }

  // Get currency info and multiplier based on tokenId
  const { currencyInfo } = wallet
  let currencyCode: string
  let multiplier: string

  if (tokenId == null) {
    // Native currency case
    currencyCode = currencyInfo.currencyCode
    multiplier = currencyInfo.denominations[0].multiplier
  } else {
    // Token case
    const token = wallet.currencyConfig.allTokens[tokenId]
    if (token == null) {
      throw new Error(`Token with tokenId "${tokenId}" not found`)
    }
    currencyCode = token.currencyCode
    multiplier = token.denominations[0].multiplier
  }

  // Convert starting USD amount to exchange amount
  const startingExchangeAmount = div(startingUsdAmount, exchangeRate, 20)
  log(
    `Starting with ${startingUsdAmount} USD = ${startingExchangeAmount} ${currencyCode}`
  )

  // Convert denomination amount to native amount using multiplier
  const startingNativeAmount = round(mul(startingExchangeAmount, multiplier), 0)
  log(`Starting native amount: ${startingNativeAmount}`)

  // Test if the starting amount works
  if (!(await quoteTester(startingNativeAmount))) {
    log(
      `Starting amount ${startingUsdAmount} USD doesn't work, may need higher limit`
    )
    return undefined
  }

  // Binary search between 1 and startingNativeAmount
  let low = '1'
  let high = startingNativeAmount
  let lastWorkingAmount: string | undefined

  for (let i = 0; i < maxIterations && gt(high, low); i++) {
    const mid = round(div(mul(add(low, high), '1'), '2'), 0)
    log(`Iteration ${i + 1}: Testing ${mid}`)

    if (await quoteTester(mid).catch(() => false)) {
      log(`${mid} works`)
      lastWorkingAmount = mid
      high = mid
    } else {
      log(`${mid} doesn't work`)
      low = mid
    }

    // Stop if we're getting very close
    const diff = div(mul(sub(high, low), '100'), high) // percentage difference
    if (lt(diff, '1')) {
      // Less than 1% difference
      log(`Converged with ${diff}% difference`)
      break
    }
  }

  return lastWorkingAmount
}
