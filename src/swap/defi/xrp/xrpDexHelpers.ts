/**
 * Routines copied from https://github.com/florent-uzio/xrpl.js-demo.git
 */

import {
  BookOfferCurrency,
  BookOffersRequest,
  Client,
  dropsToXrp,
  xrpToDrops
} from 'xrpl'
import { BookOffersResponse } from 'xrpl/dist/npm/models/methods/bookOffers'

import { shuffleArray } from '../../../util/utils'
import { MethodOptions } from './xrpDexTypes'

// https://xrpl.org/currency-formats.html#nonstandard-currency-codes
const NON_STANDARD_CODE_LENGTH = 40
const ONE_MILLION = 1000000

const validHexRegex = /^[0-9A-Fa-f]+$/g

interface ConvertAmountProps {
  amount: string | number
  decimals?: number
  to: 'drops' | 'xrp'
}

const convertAmount = ({
  amount,
  to,
  decimals = 4
}: ConvertAmountProps): string => {
  if (to === 'drops') {
    try {
      return xrpToDrops(amount)
    } catch {
      return (+amount * ONE_MILLION).toFixed(decimals).toString()
    }
  } else {
    try {
      return dropsToXrp(amount)
    } catch {
      return (+amount / ONE_MILLION).toFixed(decimals).toString()
    }
  }
}

/**
 * Convert an hexadecimal value to readable string.
 *
 * @param hex The hexadecimal to convert.
 * @returns A human readable string.
 */
export const hexToString = (hex: string): string => {
  let string = ''
  if (hex.match(validHexRegex) == null) return ''

  for (let i = 0; i < hex.length; i += 2) {
    const part = hex.substring(i, i + 2)
    const code = parseInt(part, 16)
    if (!isNaN(code) && code !== 0) {
      string += String.fromCharCode(code)
    }
  }
  return string
}

/**
 * Helper to correctly display the currency code if its length is more than 3.
 * Example: 5553444D00000000000000000000000000000000 will become USDM
 *
 * @param currencyCode The currency code to potentially format correctly.
 * @returns A {@link String} representing the currency code readable by a human.
 */
export const convertHexCurrencyCodeToString = (
  currencyCode: string
): string => {
  if (currencyCode.length === NON_STANDARD_CODE_LENGTH) {
    return hexToString(currencyCode)
  }
  return currencyCode
}

export const getBookOffers = async (
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { taker_gets, taker_pays, ...rest }: BookOffersRequest,
  { rippleServers, showLogs }: MethodOptions
): Promise<BookOffersResponse> => {
  if (rippleServers.length === 0) {
    throw new Error('No ripple servers')
  }

  let error
  const shuffled = shuffleArray(rippleServers)
  for (const server of shuffled) {
    const client = new Client(server)
    try {
      await client.connect()

      const response = await client.request({
        taker_gets,
        taker_pays,
        ...rest
      })

      if (showLogs === true) {
        console.log(JSON.stringify(response, undefined, 2))
      }

      client.disconnect().catch(() => {})
      return response
    } catch (e) {
      error = e
      // Harmless if one server fails
    }
  }
  throw error
}

export type GetBuyQuoteProps = Omit<
  BookOffersRequest,
  'taker_gets' | 'taker_pays' | 'command'
> & {
  /**
   * The currency we want to buy.
   * If the currency is an IOU, the issuer needs to be mentioned.
   */
  weWant: BookOfferCurrency
  /**
   * The amount of token we want to buy.
   */
  weWantAmountOfToken: number
  /**
   * The counter currency.
   */
  counterCurrency: BookOfferCurrency
}

/**
 * Function to get a quote of a token to buy.
 * This is an experimental function and must not be used in production without checking it does what you need.
 *
 * @param {Object} props The props to pass to the function.
 * @param {TakerAmount} props.weWant The token we want to acquire. Specify the currency and optionaly the issuer (if the currency is not XRP).
 * @param {number} props.weWantAmountOfToken The amount of token we want to acquire.
 * @param {string} props.taker (Optional) The Address of an account to use as a perspective. The response includes this account's Offers even if they are unfunded.
 * @param {TakerAmount} props.counterCurrency The counter currency.
 * @returns void, display a message regarding the result of the quote.
 */
export const getBuyQuote = async (
  { weWant, weWantAmountOfToken, counterCurrency, ...rest }: GetBuyQuoteProps,
  { rippleServers, showLogs }: MethodOptions
): Promise<number> => {
  const offers = await getBookOffers(
    {
      command: 'book_offers',
      taker_gets: weWant,
      taker_pays: counterCurrency,
      ...rest
    },
    { rippleServers, showLogs }
  )

  // Amount of remaining token we want to buy.
  let remaining = weWantAmountOfToken

  // Total amount of the opposite token we will sell.
  let total = 0

  for (const offer of offers.result.offers) {
    if (offer.quality == null) break

    // Get the price for this offer.
    const offerPrice = +offer.quality

    // Get the amount of currency this offer is selling.
    const available =
      typeof offer.TakerGets === 'string'
        ? +dropsToXrp(offer.TakerGets)
        : +offer.TakerGets.value

    // If the available amount is more than what we want to exchange, add the corresponding total to our total.
    if (available > remaining) {
      const amountOfTokens = remaining * offerPrice

      total += amountOfTokens
      break
    }
    // Otherwise, add the total amount for this offer to our total and decrease the remaining amount.
    else {
      const amountOfTokens = available * offerPrice

      total += amountOfTokens

      remaining -= available
    }
  }

  if (counterCurrency.currency.toUpperCase() === 'XRP') {
    total = +convertAmount({ amount: total, to: 'xrp' })
  }

  if (weWant.currency.toUpperCase() === 'XRP') {
    total = +convertAmount({ amount: total, to: 'drops' })
  }

  const currencyReadable = convertHexCurrencyCodeToString(weWant.currency)
  const counterCurrencyReadable = convertHexCurrencyCodeToString(
    counterCurrency.currency
  )

  if (showLogs === true) {
    console.log(
      `You need to sell at least ${total} ${counterCurrencyReadable} to buy ${weWantAmountOfToken} ${currencyReadable}`
    )
  }

  return total
}

type GetSellQuoteProps = Omit<
  BookOffersRequest,
  'taker_gets' | 'taker_pays' | 'command'
> & {
  /**
   * The currency we want to sell.
   * If the currency is an IOU, the issuer needs to be mentioned.
   */
  weSell: BookOfferCurrency
  /**
   * The amount of currency we want to sell.
   */
  weSellAmountOfTokens: number
  /**
   * The counter currency.
   */
  counterCurrency: BookOfferCurrency
}

/**
 * Function to get a quote of a token to sell.
 * The quote will give you the amount of the counter token that you can expect to get from that sell.
 * This is an experimental function and must not be used in production without checking it does what you need.
 *
 * @param {Object} props The props to pass to the function.
 * @param {TakerAmount} props.weSell The token we want to sell. Specify the currency and optionaly the issuer (if the currency is not XRP).
 * @param {number} props.weSellAmountOfTokens The amount of token we want to sell.
 * @param {string} props.taker (Optional) The Address of an account to use as a perspective. The response includes this account's Offers even if they are unfunded.
 * @param {TakerAmount} props.counterCurrency The counter currency.
 * @returns void, display a message regarding the result of the quote.
 */
export const getSellQuote = async (
  { weSell, weSellAmountOfTokens, counterCurrency, ...rest }: GetSellQuoteProps,
  { rippleServers, showLogs }: MethodOptions
): Promise<number> => {
  const offers = await getBookOffers(
    {
      command: 'book_offers',
      taker_gets: counterCurrency,
      taker_pays: weSell,
      ...rest
    },
    { rippleServers, showLogs }
  )

  /** Amount of remaining token we want to sell. */
  let remaining = weSellAmountOfTokens

  // Total amount of the opposite token we will get.
  let total = 0

  // Loop through the offers
  for (const offer of offers.result.offers) {
    if (offer.quality == null) break

    // Get the price for this offer.
    const offerPrice = +offer.quality

    /** The amount of currency this offer is buying. */
    const available =
      typeof offer.TakerPays === 'string'
        ? +convertAmount({ amount: offer.TakerPays, to: 'xrp' })
        : +offer.TakerPays.value

    // If the available amount is more than what we want to exchange, add the corresponding total to our total.
    if (available > remaining) {
      const amountOfTokens = remaining / offerPrice
      total += amountOfTokens

      break
    }
    // Otherwise, add the total amount for this offer to our total and decrease the remaining amount.
    else {
      // amount of tokens to acquire
      const amountOfTokens = available / offerPrice

      total += amountOfTokens

      remaining -= available
    }
  }

  // Convert the total from drops to XRP if the counter currency is XRP
  if (counterCurrency.currency.toUpperCase() === 'XRP') {
    total = +convertAmount({ amount: total, to: 'xrp' })
  }

  // Multiply the total by a million to get a correct value
  if (weSell.currency.toUpperCase() === 'XRP') {
    total = +convertAmount({ amount: total, to: 'drops' })
  }

  const currencyReadable = convertHexCurrencyCodeToString(weSell.currency)
  const counterCurrencyReadable = convertHexCurrencyCodeToString(
    counterCurrency.currency
  )

  if (showLogs === true) {
    console.log(
      `You will get ${total} ${counterCurrencyReadable} if you sell ${weSellAmountOfTokens} ${currencyReadable}`
    )
  }
  return total
}
