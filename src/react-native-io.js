// @flow

import { type EdgeCorePluginOptions } from 'edge-core-js/types'

type FetchJson = (uri: string, opts?: Object) => Object

function makeFetchJson (io): FetchJson {
  return function fetchJson (uri, opts) {
    return io.fetch(uri, opts).then(reply => {
      if (!reply.ok) {
        throw new Error(`Error ${reply.status} while fetching ${uri}`)
      }
      return reply.json()
    })
  }
}

export function getFetchJson (opts: EdgeCorePluginOptions): FetchJson {
  const nativeIo = opts.nativeIo['edge-exchange-plugins']
  return nativeIo != null ? nativeIo.fetchJson : makeFetchJson(opts.io)
}

export default function makeExchangeIo () {
  return { fetchJson: makeFetchJson(window) }
}
