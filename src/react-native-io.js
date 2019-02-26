// @flow

import { type EdgeCorePluginOptions } from 'edge-core-js/types'

type FetchJsonReply = {
  json: Object,
  ok: boolean,
  status: number,
  url: string
}

export type FetchJson = (uri: string, opts?: Object) => Promise<FetchJsonReply>

/**
 * Wraps the `fetch` API for transport over the yaob bridge.
 * The reply object contains the status of the fetch,
 * as well as the returned JSON, but no methods.
 */
function makeFetchJson (io: { +fetch: typeof fetch }): FetchJson {
  return function fetchJson (url, opts) {
    return io.fetch(url, opts).then(response => {
      const { ok, status } = response
      return response.json().then(json => {
        return { json, ok, status, url }
      })
    })
  }
}

export function getFetchJson (opts: EdgeCorePluginOptions): FetchJson {
  const nativeIo = opts.nativeIo['edge-exchange-plugins']
  if (nativeIo != null) return nativeIo.fetchJson
  return makeFetchJson(opts.io)
}

export default function makeExchangeIo () {
  return { fetchJson: makeFetchJson(window) }
}
