import { EdgeFetchFunction } from 'edge-core-js'
const INFO_SERVERS = ['https://info1.edge.app', 'https://info2.edge.app']
const RATES_SERVERS = ['https://rates1.edge.app', 'https://rates2.edge.app']

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
): Promise<any> {
  if (servers == null) return
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
): Promise<any> => {
  return await multiFetch(fetch, RATES_SERVERS, path, options, timeout)
}
