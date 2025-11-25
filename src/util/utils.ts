import { add, div, gt, max, mul, round } from 'biggystring'
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
const RATES_SERVERS_V3 = ['https://rates3.edge.app', 'https://rates4.edge.app']

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

export const fetchRatesV3 = async (
  fetch: EdgeFetchFunction,
  path: string,
  options?: Object,
  timeout?: number
): Promise<EdgeFetchResponse> => {
  return await multiFetch(fetch, RATES_SERVERS_V3, path, options, timeout)
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
 * Find the minimum native swap amount that succeeds.
 *
 * Strategy:
 * 1) Exponential search upward from a starting native amount to find a
 *    successful upper bound.
 * 2) Binary search between the last failing amount and the first
 *    successful amount to find the minimum working native amount.
 */
export async function findMinimumSwapAmount({
  startingNativeAmount,
  expandIterations = 10,
  maxIterations = 20,
  quoteTester
}: {
  startingNativeAmount?: string
  /** Max doubling steps to find an upper bound */
  expandIterations?: number
  /** Max bisection steps between bounds */
  maxIterations?: number
  /** Returns true if quote succeeds */
  quoteTester: (nativeAmount: string) => Promise<boolean>
}): Promise<string | undefined> {
  // Ensure a sane starting point >= 1
  let amount = startingNativeAmount?.toString() ?? '1'

  // 1) Exponential search to find a successful upper bound
  let lowFail = '0'
  let highSuccess: string | undefined
  for (let i = 0; i < expandIterations; i++) {
    const ok = await quoteTester(amount).catch(() => false)
    if (ok) {
      highSuccess = amount
      break
    }
    lowFail = amount
    amount = mul(amount, '2')
  }

  if (highSuccess == null) {
    // Could not find any working amount in expansion phase
    return undefined
  }

  // 2) Binary search between (lowFail, highSuccess]
  let low = lowFail
  let high = highSuccess
  let lastWorkingAmount: string | undefined = highSuccess

  for (let i = 0; i < maxIterations && gt(high, low); i++) {
    const mid = round(div(add(low, high), '2'), 0)
    if (await quoteTester(mid).catch(() => false)) {
      lastWorkingAmount = mid
      high = mid
    } else {
      // Exclude failing mid to avoid infinite loops
      low = add(mid, '1')
    }
  }

  return lastWorkingAmount
}
