import {
  asArray,
  asEither,
  asJSON,
  asNull,
  asNumber,
  asObject,
  asString,
  asUnknown
} from 'cleaners'

export interface QuoteRequest extends Partial<Record<string, string>> {
  /**
   * The ERC20 token address of the token address you want to sell.
   *
   * Use address 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee for native token
   * (e.g. ETH).
   **/
  sellToken: string

  /**
   * The ERC20 token address of the token address you want to receive.
   *
   * Use address 0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee for native token
   * (e.g. ETH).
   */
  buyToken: string

  /**
   * The amount of sellToken (in sellToken base units) you want to send.
   *
   * Either sellAmount or buyAmount must be present in a request.
   */
  sellAmount?: string

  /**
   * The amount of buyToken(in buyToken base units) you want to receive.
   *
   * Either sellAmount or buyAmount must be present in a request.
   */
  buyAmount?: string

  /**
   * The maximum acceptable slippage of the buyToken amount if sellAmount is
   * provided; The maximum acceptable slippage of the sellAmount amount if
   * buyAmount is provided (e.g. 0.03 for 3% slippage allowed).
   *
   * The lowest possible value that can be set for this parameter is 0; in
   * other words, no amount of slippage would be allowed.
   *
   * Default: 0.01 (1%)
   */
  slippagePercentage?: string

  /**
   * The target gas price (in wei) for the swap transaction. If the price is
   * too low to achieve the quote, an error will be returned.
   *
   * Default: ethgasstation "fast"
   */
  gasPrice?: string

  /**
   * The address which will fill the quote. While optional, we highly recommend
   * providing this parameter if possible so that the API can more accurately
   * estimate the gas required for the swap transaction.
   *
   * This helps when validating the entire transaction for success, and catches
   * revert issues. If the validation fails, a Revert Error will be returned in
   * the response. The quote should be fillable if this address is provided.
   * Also, make sure this address has enough token balance. Additionally,
   * including the `takerAddress is required if you want to integrate RFQ
   * liquidity.
   */
  takerAddress?: string

  /**
   * Liquidity sources (Uniswap, SushiSwap, 0x, Curve, etc) that will not be
   * included in the provided quote. See here for a full list of sources.
   * This parameter cannot be combined with includedSources.
   *
   * Example: excludedSources=Uniswap,SushiSwap,Curve
   */
  excludedSources?: string

  /**
   * Typically used to filter for RFQ liquidity without any other DEX orders
   * which this is useful for testing your RFQ integration. To do so, set it
   * to 0x. This parameter cannot be combined with excludedSources.
   *
   * includedSources=0x
   */
  includedSources?: string

  /**
   * Normally, whenever a takerAddress is provided, the API will validate the
   * quote for the user.
   * For more details, see "How does takerAddress help with catching issues?"
   *
   * When this parameter is set to true, that validation will be skipped.
   * Also see Quote Validation here. For /quote , the default of
   * skipValidation=false but can be overridden to true.
   */
  skipValidation?: string

  /**
   * The ETH address that should receive affiliate fees specified with
   * buyTokenPercentageFee . Can be used combination with buyTokenPercentageFee
   * to set a commission/trading fee when using the API.
   * Learn more about how to setup a trading fee/commission fee/transaction
   * fee here in the FAQs.
   */
  feeRecipient?: string

  /**
   * The percentage (denoted as a decimal between 0 - 1.0 where 1.0 represents
   * 100%) of the buyAmount that should be attributed to feeRecipient as
   * affiliate fees. Note that this requires that the feeRecipient parameter
   * is also specified in the request. Learn more about how to setup a trading
   * fee/commission fee/transaction fee here in the FAQs.
   */
  buyTokenPercentageFee?: string

  /**
   * The percentage (between 0 - 1.0) of allowed price impact.
   * When priceImpactProtectionPercentage is set, estimatedPriceImpact is
   * returned which estimates the change in the price of the specified asset
   * that would be caused by the executed swap due to price impact.
   *
   * If the estimated price impact is above the percentage indicated, an error
   * will be returned. For example, if PriceImpactProtectionPercentage=.15
   * (15%), any quote with a price impact higher than 15% will return an error.
   *
   * This is an opt-in feature, the default value of 1.0 will disable the
   * feature. When it is set to 1.0 (100%) it means that every transaction is
   * allowed to pass.
   *
   * Note: When we fail to calculate Price Impact we will return null and
   * Price Impact Protection will be disabled See affects on
   * estimatedPriceImpact in the Response fields. Read more about price impact
   * protection and how to set it up here.
   *
   * Defaults: 100%
   */
  priceImpactProtectionPercentage?: string

  /**
   * The recipient address of any trade surplus fees. If specified, this
   * address will collect trade surplus when applicable. Otherwise, trade
   * surplus will not be collected.
   * Note: Trade surplus is only sent to this address for sells. It is a no-op
   * for buys. Read more about "Can I collect trade surplus?" here in the FAQs.
   */
  feeRecipientTradeSurplus?: string

  /**
   * A boolean field. If set to true, the 0x Swap API quote request should
   * sell the entirety of the caller's takerToken balance. A sellAmount is
   * still required, even if it is a best guess, because it is how a reasonable
   * minimum received amount is determined after slippage.
   * Note: This parameter is only required for special cases, such as when
   * setting up a multi-step transaction or composable operation, where the
   * entire balance is not known ahead of time. Read more about "Is there a
   * way to sell assets via Swap API if the exact sellToken amount is not known
   * before the transaction is executed?" here in the FAQs.
   */
  shouldSellEntireBalance?: string
}

/**
 * The response object from the 0x API /quote endpoint.
 */
export type QuoteResponse = Readonly<{
  /**
   * If buyAmount was specified in the request, it provides the price of buyToken
   * in sellToken and vice versa. This price does not include the slippage
   * provided in the request above, and therefore represents the best possible
   * price.
   *
   * If buyTokenPercentageFee and feeRecipient were set, the fee amount will be
   * part of this returned price.
   */
  price: string

  /**
   * Similar to price but with fees removed in the price calculation. This is
   * the price as if no fee is charged.
   */
  grossPrice: string

  /**
   * The price which must be met or else the entire transaction will revert. This
   * price is influenced by the slippagePercentage parameter. On-chain sources
   * may encounter price movements from quote to settlement.
   */
  guaranteedPrice: string

  /**
   * When priceImpactProtectionPercentage is set, this value returns the estimated
   * change in the price of the specified asset that would be caused by the
   * executed swap due to price impact.
   *
   * Note: If we fail to estimate price change we will return null.
   *
   * Read more about price impact protection
   * [here](https://0x.org/docs/0x-swap-api/advanced-topics/price-impact-protection).
   */
  estimatedPriceImpact: string | null

  /**
   * The address of the contract to send call data to.
   */
  to: string

  /**
   * The call data required to be sent to the to contract address.
   */
  data: string

  /**
   * The amount of ether (in wei) that should be sent with the transaction.
   * (Assuming protocolFee is paid in ether).
   */
  value: string

  /**
   * The gas price (in wei) that should be used to send the transaction. The
   * transaction needs to be sent with this gasPrice or lower for the transaction
   * to be successful.
   */
  gasPrice: string

  /**
   * The estimated gas limit that should be used to send the transaction to
   * guarantee settlement. While a computed estimate is returned in all
   * responses, an accurate estimate will only be returned if a takerAddress is
   * included in the request.
   */
  gas: string

  /**
   * The estimate for the amount of gas that will actually be used in the
   * transaction. Always less than gas.
   */
  estimatedGas: string

  /**
   * The maximum amount of ether that will be paid towards the protocol fee (in
   * wei), and what is used to compute the value field of the transaction.
   *
   * Note, as of [ZEIP-91](https://governance.0xprotocol.org/vote/zeip-91),
   * protocol fees have been removed for all order types.
   */
  protocolFee: string

  /**
   * The minimum amount of ether that will be paid towards the protocol fee (in
   * wei) during the transaction.
   */
  minimumProtocolFee: string

  /**
   * The amount of buyToken (in buyToken units) that would be bought in this swap.
   * Certain on-chain sources do not allow specifying buyAmount, when using
   * buyAmount these sources are excluded.
   */
  buyAmount: string

  /**
   * Similar to buyAmount but with fees removed. This is the buyAmount as if no
   * fee is charged.
   */
  grossBuyAmount: string

  /**
   * The amount of sellToken (in sellToken units) that would be sold in this swap.
   * Specifying sellAmount is the recommended way to interact with 0xAPI as it
   * covers all on-chain sources.
   */
  sellAmount: string

  /**
   * Similar to sellAmount but with fees removed. This is the sellAmount as if no
   * fee is charged. Note: Currently, this will be the same as sellAmount as fees
   * can only be configured to occur on the buyToken.
   */
  grossSellAmount: string

  /**
   * The percentage distribution of buyAmount or sellAmount split between each
   * liquidity source. Ex: [{ name: '0x', proportion: "0.8" }, { name: 'Kyber',
   * proportion: "0.2"}, ...]
   */
  sources: Array<{ name: string; proportion: string }>

  /**
   * The ERC20 token address of the token you want to receive in quote.
   */
  buyTokenAddress: string

  /**
   * The ERC20 token address of the token you want to sell with quote.
   */
  sellTokenAddress: string

  /**
   * The target contract address for which the user needs to have an allowance in
   * order to be able to complete the swap. Typically this is the [0x Exchange
   * Proxy contract address](https://0x.org/docs/introduction/0x-cheat-sheet#exchange-proxy-addresses)
   * for the specified chain. For swaps with "ETH" as `sellToken`, wrapping "ETH"
   * to "WETH" or unwrapping "WETH" to "ETH" no allowance is needed, a null
   * address of `0x0000000000000000000000000000000000000000` is then returned
   * instead.
   */
  allowanceTarget: string

  /**
   * The details used to fill orders, used by market makers. If orders is not
   * empty, there will be a type on each order. For wrap/unwrap, orders is empty.
   * otherwise, should be populated.
   */
  orders: unknown

  /**
   * The rate between ETH and sellToken.
   */
  sellTokenToEthRate: string

  /**
   * The rate between ETH and buyToken.
   */
  buyTokenToEthRate: string

  /**
   * 0x Swap API fees that would be charged. 0x takes an on-chain fee on swaps
   * involving a select few token pairs for the Free and Starter tiers. This fee
   * is charged on-chain to the users of your app during the transaction. If you
   * are on the Growth tier, we completely waive this fee for your customers.
   * Read more about it on our [pricing page](https://0x.org/pricing).
   *
   * This objects contains the zeroExFee object. See details about this fee type
   * below.
   */
  fees: {
    /**
     * Related to fees param above.
     *
     * Fee that 0x charges:
     *   - feeType: volume which means 0x would charge a certain percentage of the
     *     trade.
     *   - feeToken: The ERC20 token address to charge fee.
     *   - feeAmount: The amount of feeToken to be charged as the 0x fee.
     *   - billingType: The method that 0x fee is transferred. It can currently
     *     only be on-chain which means the fee would be charged on-chain.
     */
    zeroExFee: {
      feeType: string
      feeToken: string
      feeAmount: string
      billingType: string
    }
  }
}>

export const asQuoteResponse = asJSON(
  asObject<QuoteResponse>({
    price: asString,
    grossPrice: asString,
    guaranteedPrice: asString,
    estimatedPriceImpact: asEither(asString, asNull),
    to: asString,
    data: asString,
    value: asString,
    gasPrice: asString,
    gas: asString,
    estimatedGas: asString,
    protocolFee: asString,
    minimumProtocolFee: asString,
    buyAmount: asString,
    grossBuyAmount: asString,
    sellAmount: asString,
    grossSellAmount: asString,
    sources: asArray(asObject({ name: asString, proportion: asString })),
    buyTokenAddress: asString,
    sellTokenAddress: asString,
    allowanceTarget: asString,
    orders: asUnknown,
    sellTokenToEthRate: asString,
    buyTokenToEthRate: asString,
    fees: asObject({
      zeroExFee: asObject({
        feeType: asString,
        feeToken: asString,
        feeAmount: asString,
        billingType: asString
      })
    })
  })
)

export interface ErrorResponse {
  code: number
  reason: string
}

export const asErrorResponse = asJSON(
  asObject<ErrorResponse>({
    code: asNumber,
    reason: asString
  })
)
