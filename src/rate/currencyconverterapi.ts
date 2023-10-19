import { asNumber, asObject, asOptional, asString } from 'cleaners'
import {
  EdgeCorePluginOptions,
  EdgeRatePair,
  EdgeRatePlugin
} from 'edge-core-js/types'

const asInitOptions = asObject({
  apiKey: asString
})

const asRates = asObject(asNumber)

const asCurrencyConverterResponse = asObject({
  status: asOptional(asNumber),
  error: asOptional(asString)
}).withRest

const checkAndPush = (isoCc: string, ccArray: string[]): void => {
  if (isoCc !== 'iso:USD' && isoCc.slice(0, 4) === 'iso:') {
    const cc = isoCc.slice(4).toUpperCase()
    if (!ccArray.includes(`USD_${cc}`)) {
      ccArray.push(`USD_${cc}`)
    }
  }
}

export function makeCurrencyconverterapiPlugin(
  opts: EdgeCorePluginOptions
): EdgeRatePlugin {
  const { io, log } = opts
  const { fetchCors = io.fetch } = io
  const { apiKey } = asInitOptions(opts.initOptions)

  return {
    rateInfo: {
      pluginId: 'currencyconverterapi',
      displayName: 'CurrencyConverterAPI'
    },

    async fetchRates(pairsHint): Promise<EdgeRatePair[]> {
      pairsHint = pairsHint.concat([
        { fromCurrency: 'iso:USD', toCurrency: 'iso:IMP' },
        { fromCurrency: 'iso:USD', toCurrency: 'iso:IRR' }
      ])
      const isoCodesWanted: string[] = []
      for (const pair of pairsHint) {
        checkAndPush(pair.fromCurrency, isoCodesWanted)
        checkAndPush(pair.toCurrency, isoCodesWanted)
      }

      const pairs = []
      const query = isoCodesWanted.join(',')
      try {
        const response = await fetchCors(
          `https://api.currconv.com/api/v7/convert?q=${query}&compact=ultra&apiKey=${apiKey}`
        )
        const { status, error, ...rest } = asCurrencyConverterResponse(
          await response.json()
        )
        const rates: { [cc: string]: number } = rest as {}
        if (
          (status != null && status !== 200) ||
          (error != null && error !== '') ||
          !response.ok
        ) {
          throw new Error(
            `CurrencyConvertor returned with status: ${JSON.stringify(
              status ?? response.status
            )} and error: ${JSON.stringify(error)}`
          )
        }
        for (const rate of Object.keys(asRates(rates))) {
          pairs.push({
            fromCurrency: 'iso:USD',
            toCurrency: `iso:${rate.split('_')[1]}`,
            rate: rates[rate]
          })
        }
      } catch (e: any) {
        log.warn(
          `Failed to get ${query} from currencyconverterapi.com`,
          e.message
        )
      }
      return pairs
    }
  }
}
