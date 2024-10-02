import {
  asArray,
  asEither,
  asJSON,
  asNull,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
  asValue
} from 'cleaners'

export enum ChainId {
  Ethereum = 1,
  Polygon = 137,
  Arbitrum = 42161,
  Base = 8453,
  Optimism = 10
}

// -----------------------------------------------------------------------------
// Error Response
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Gasless API
// -----------------------------------------------------------------------------

//
// Gasless Swap Quote
//

export interface GaslessSwapQuoteRequest {
  /**
   * The contract address of the token being bought. Use
   * `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` for native token.
   */
  buyToken: string

  /**
   * The contract address of token being sold. On Ethereum mainnet, it is
   * restricted to the list of tokens [here](https://api.0x.org/tx-relay/v1/swap/supported-tokens)
   * (Set `0x-chain-id` to `1`).
   */
  sellToken: string

  /**
   * The amount of `buyToken` to buy. Can only be present if `sellAmount` is not
   * present.
   */
  buyAmount?: string

  /**
   * The amount of `sellToken` to sell. Can only be present if `buyAmount` is not
   * present.
   */
  sellAmount?: string

  /**
   * The address of the taker.
   */
  takerAddress: string

  /**
   * [optional] Comma delimited string of the types of order the caller is
   * willing to receive.
   *
   * Currently, `metatransaction_v2` and `otc` are supported and allowed. More
   * details about order types are covered in [/quote documentation](https://0x.org/docs/tx-relay-api/api-references/get-tx-relay-v1-swap-quote).
   *
   * This is useful if the caller only wants to receive types the caller
   * specifies. If not provided, it means the caller accepts any types whose
   * default value is currently set to `metatransaction_v2` and `otc`.
   */
  acceptedTypes?: 'metatransaction_v2' | 'otc'

  /**
   * [optional] The maximum amount of slippage acceptable to the user; any
   * slippage beyond that specified will cause the transaction to revert on
   * chain. Default is 1% and minimal value allowed is 0.1%. The value of the
   * field is on scale of 1. For example, setting `slippagePercentage` to set to
   * `0.01` means 1% slippage allowed.
   */
  slippagePercentage?: string

  /**
   * [optional] The maximum amount of price impact acceptable to the user; Any
   * price impact beyond that specified will cause the endpoint to return error
   * if the endpoint is able to calculate the price impact. The value of the
   * field is on scale of 1. For example, setting `priceImpactProtectionPercentage`
   * to set to `0.01` means 1% price impact allowed.
   *
   * This is an opt-in feature, the default value of `1.0` will disable the
   * feature. When it is set to 1.0 (100%) it means that every transaction is
   * allowed to pass.
   *
   * Price impact calculation includes fees and could be unavailable. Read more
   * about price impact at [0x documentation](https://docs.0x.org/0x-swap-api/advanced-topics/price-impact-protection).
   */
  priceImpactProtectionPercentage?: string

  /**
   * [optional] The type of integrator fee to charge. The allowed value is
   * `volume`.
   *
   * Currently, the endpoint does not support integrator fees if the order type
   * `otc` is chosen due to better pricing. Callers can opt-out of `otc` by
   * explicitly passing in `acceptedTypes` query param without `otc`. `otc` order
   * would, however, potentially improve the pricing the endpoint returned as
   * there are more sources for liquidity.
   */
  feeType?: 'volume'

  /**
   * [optional] The address the integrator fee would be transferred to. This is
   * the address you’d like to receive the fee. This must be present if `feeType`
   * is provided.
   */
  feeRecipient?: string

  /**
   * [optional] If `feeType` is `volume`, then `feeSellTokenPercentage` must be
   * provided. `feeSellTokenPercentage` is the percentage (on scale of 1) of
   * `sellToken` integrator charges as fee. For example, setting it to `0.01`
   * means 1% of the `sellToken` would be charged as fee for the integrator.
   */
  feeSellTokenPercentage?: number

  /**
   * [optional] A boolean that indicates whether or not to check for approval and
   * potentially utilizes gasless approval feature. Allowed values `true` /
   * `false`. Defaults to `false` if not provided. On a performance note, setting
   * it to `true` requires more processing and computation than setting it to
   * `false`.
   *
   * More details about gasless approval feature can be found [here](https://docs.0x.org/0x-swap-api/advanced-topics/gasless-approval).
   */
  checkApproval?: boolean
}

/**
 * GaslessSwapQuoteResponse interface represents the response object returned
 * by the API when making a gasless swap quote request.
 */
export type GaslessSwapQuoteResponse =
  | GaslessSwapQuoteResponseLiquidity
  | GaslessSwapQuoteResponseNoLiquidity

interface GaslessSwapQuoteResponseNoLiquidity {
  liquidityAvailable: false
}

interface GaslessSwapQuoteResponseLiquidity {
  /**
   * Used to validate that liquidity is available from a given source. This
   * would always be present.
   */
  liquidityAvailable: true

  // ---------------------------------------------------------------------------
  // The rest of the fields would only be present if `liquidityAvailable` is
  // `true`.
  // ---------------------------------------------------------------------------

  /**
   * If `buyAmount` was specified in the request, this parameter provides the
   * price of `buyToken`, denominated in `sellToken`, or vice-versa.
   *
   * Note: fees are baked in the price calculation.
   */
  price: string

  /**
   * Similar to `price` but with fees removed in the price calculation. This is
   * the price as if no fee is charged.
   */
  grossPrice: string

  /**
   * The estimated change in the price of the specified asset that would be
   * caused by the executed swap due to price impact.
   *
   * Note: If the API is not able to estimate price change, the field will be
   * `null`. For `otc` order type, price impact is not available currently.
   * More details about order types are covered in [/quote documentation](https://0x.org/docs/tx-relay-api/api-references/get-tx-relay-v1-swap-quote).
   */
  estimatedPriceImpact: string | null

  /**
   * Similar to `estimatedPriceImpact` but with fees removed. This is the
   * `estimatedPriceImpact` as if no fee is charged.
   */
  grossEstimatedPriceImpact: string | null

  /**
   * The ERC20 token address of the token you want to receive in the quote.
   */
  buyTokenAddress: string

  /**
   * The amount of `buyToken` to buy with fees baked in.
   */
  buyAmount: string

  /**
   * Similar to `buyAmount` but with fees removed. This is the `buyAmount` as if
   * no fee is charged.
   */
  grossBuyAmount: string

  /**
   * The ERC20 token address of the token you want to sell with the quote.
   */
  sellTokenAddress: string

  /**
   * The amount of `sellToken` to sell with fees baked in.
   */
  sellAmount: string

  /**
   * Similar to `sellAmount` but with fees removed. This is the `sellAmount` as
   * if no fee is charged.
   */
  grossSellAmount: string

  /**
   * The target contract address for which the user needs to have an allowance
   * in order to be able to complete the swap.
   */
  allowanceTarget: string

  /**
   * The underlying sources for the liquidity. The format will be:
   * [{ name: string; proportion: string }]
   *
   * An example: `[{"name": "Uniswap_V2", "proportion": "0.87"}, {"name": "Balancer", "proportion": "0.13"}]`
   */
  sources: Array<{ name: string; proportion: string }>

  /**
   * [optional] Fees that would be charged. It can optionally contain
   * `integratorFee`, `zeroExFee`, and `gasFee`. See details about each fee
   * type below.
   */
  fees: {
    /**
     * Related to `fees` param above.
     *
     * Integrator fee (in amount of `sellToken`) would be provided if `feeType`
     * and the corresponding query params are provided in the request.
     *
     * - `feeType`: The type of the `integrator` fee. This is always the same as
     *   the `feeType` in the request. It can only be `volume` currently.
     * - `feeToken`: The ERC20 token address to charge fee. This is always the
     *   same as `sellToken` in the request.
     * - `feeAmount`: The amount of `feeToken` to be charged as integrator fee.
     * - `billingType`: The method that integrator fee is transferred. It can
     *   only be `on-chain` which means integrator fee can only be transferred
     *   on-chain to `feeRecipient` query param provided.
     *
     * The endpoint currently does not support integrator fees if the order type
     * `otc` is chosen due to better pricing. Callers can opt-out of `otc` by
     * explicitly passing in `acceptedTypes` query param without `otc`. `otc`
     * order would, however, potentially improve the pricing the endpoint
     * returned as there are more sources for liquidity.
     */
    integratorFee?: {
      feeType: 'volume'
      feeToken: string
      feeAmount: string
      billingType: 'on-chain'
    }

    /**
     * Related to `fees` param above.
     *
     * Fee that 0x charges:
     *
     * - `feeType`: `volume` or `integrator_share` which varies per integrator.
     *   `volume` means 0x would charge a certain percentage of the trade
     *   independently. `integrator_share` means 0x would change a certain
     *   percentage of what the integrator charges.
     * - `feeToken`: The ERC20 token address to charge fee. The token could be
     *   either `sellToken` or `buyToken`.
     * - `feeAmount`: The amount of `feeToken` to be charged as 0x fee.
     * - `billingType`: The method that 0x fee is transferred. It can be either
     *   `on-chain`, `off-chain`, or `liquidity` which varies per integrator.
     *   `on-chain` means the fee would be charged on-chain. `off-chain` means
     *   the fee would be charged to the integrator via off-chain payment.
     *   `liquidity` means the fee would be charged off-chain but not to the
     *   integrator.
     *
     * Please reach out for more details on the `feeType` and `billingType`.
     */
    zeroExFee: {
      feeType: 'volume' | 'integrator_share'
      feeToken: string
      feeAmount: string
      billingType: 'on-chain' | 'off-chain' | 'liquidity'
    }

    /**
     * Related to `fees`. See param above.
     *
     * Gas fee to compensate for the transaction submission performed by our
     * relayers:
     *
     * - `feeType`: The value is always `gas`.
     * - `feeToken`: The ERC20 token address to charge gas fee. The token could
     *   be either `sellToken` or `buyToken`.
     * - `feeAmount`: The amount of `feeToken` to be charged as gas fee.
     * - `billingType`: The method that gas compensation is transferred. It can
     *   be either `on-chain`, `off-chain`, or `liquidity` which has the same
     *   meaning as described above in `zeroExFee` section.
     *
     * Please reach out for more details on the `billingType`.
     */
    gasFee: {
      feeType: 'gas'
      feeToken: string
      feeAmount: string
      billingType: 'on-chain' | 'off-chain' | 'liquidity'
    }
  }

  /**
   * This is the "trade" object which contains the necessary information to
   * process a trade.
   *
   * - `type`: `metatransaction_v2` or `otc`
   * - `hash`: The hash for the trade according to EIP-712. Note that if you
   *   compute the hash from `eip712` field, it should match the value of this
   *   field.
   * - `eip712`: Necessary data for EIP-712.
   *
   * Note: Please don't assume particular shapes of `trade.eip712.types`,
   * `trade.eip712.domain`, `trade.eip712.primaryType`, and
   * `trade.eip712.message` as they will change based on the `type` field and
   * we would add more types in the future.
   */
  trade: {
    type: string
    hash: string
    eip712: any
  }

  /**
   * This is the "approval" object which contains the necessary information to
   * process a gasless approval, if requested via `checkApproval` and is
   * available. You will only be able to initiate a gasless approval for the
   * sell token if the response has both `isRequired` and `isGaslessAvailable`
   * set to `true`.
   *
   * - `isRequired`: whether an approval is required for the trade
   * - `isGaslessAvailable`: whether gasless approval is available for the sell
   *   token
   * - `type`: `permit` or `executeMetaTransaction::approve`
   * - `hash`: The hash for the approval according to EIP-712. Note that if you
   *   compute the hash from `eip712` field, it should match the value of this
   *   field.
   * - `eip712`: Necessary data for EIP-712.
   *
   * Note: Please don't assume particular shapes of `approval.eip712.types`,
   * `approval.eip712.domain`, `approval.eip712.primaryType`, and
   * `approval.eip712.message` as they will change based on the `type` field.
   *
   * See [here](https://docs.0x.org/0x-swap-api/advanced-topics/gasless-approval)
   * for more information about gasless approvals.
   */
  approval?:
    | { isRequired: false }
    | { isRequired: true; isGaslessAvailable: false }
    | {
        isRequired: true
        isGaslessAvailable: true
        type: string
        hash: string
        eip712: any
      }
}

export const asGaslessSwapQuoteResponse = asJSON<GaslessSwapQuoteResponse>(
  asEither(
    asObject<GaslessSwapQuoteResponseNoLiquidity>({
      liquidityAvailable: asValue(false)
    }),
    asObject<GaslessSwapQuoteResponseLiquidity>({
      liquidityAvailable: asValue(true),
      price: asString,
      grossPrice: asString,
      estimatedPriceImpact: asEither(asString, asNull),
      grossEstimatedPriceImpact: asEither(asString, asNull),
      buyTokenAddress: asString,
      buyAmount: asString,
      grossBuyAmount: asString,
      sellTokenAddress: asString,
      sellAmount: asString,
      grossSellAmount: asString,
      allowanceTarget: asString,
      sources: asArray(asObject({ name: asString, proportion: asString })),

      fees: asObject({
        integratorFee: asOptional(
          asObject({
            feeType: asValue('volume'),
            feeToken: asString,
            feeAmount: asString,
            billingType: asValue('on-chain')
          })
        ),
        zeroExFee: asObject({
          feeType: asValue('volume', 'integrator_share'),
          feeToken: asString,
          feeAmount: asString,
          billingType: asValue('on-chain', 'off-chain', 'liquidity')
        }),
        gasFee: asObject({
          feeType: asValue('gas'),
          feeToken: asString,
          feeAmount: asString,
          billingType: asValue('on-chain', 'off-chain', 'liquidity')
        })
      }),

      trade: asObject({ type: asString, hash: asString, eip712: asUnknown }),
      approval: asOptional(
        asEither(
          asObject({
            isRequired: asValue(false)
          }),
          asObject({
            isRequired: asValue(true),
            isGaslessAvailable: asValue(false)
          }),
          asObject({
            isRequired: asValue(true),
            isGaslessAvailable: asValue(true),
            type: asString,
            hash: asString,
            eip712: asUnknown
          })
        )
      )
    })
  )
)

//
// Gasless Swap Submit
//

export enum SignatureType {
  Illegal = 0,
  Invalid = 1,
  EIP712 = 2,
  EthSign = 3
}

export interface SignatureStruct {
  v: number
  r: string
  s: string
  signatureType: SignatureType
}

export interface GaslessSwapSubmitRequest {
  approval?: {
    /** This is `approval.`type from the `/quote` endpoint */
    type: string
    /** This is `approval.eip712` from the `/quote` endpoint */
    eip712: any
    signature: SignatureStruct
  }
  trade: {
    /** This is `trade.`type from the `/quote` endpoint */
    type: string
    /** This is `trade.eip712` from the `/quote` endpoint */
    eip712: any
    signature: SignatureStruct
  }
}

export interface GaslessSwapSubmitResponse {
  type: 'metatransaction_v2' | 'otc'
  tradeHash: string
}

export const asGaslessSwapSubmitResponse = asJSON<GaslessSwapSubmitResponse>(
  asObject({
    type: asValue('metatransaction_v2', 'otc'),
    tradeHash: asString
  })
)

//
// Gasless Swap Status
//

export type GaslessSwapStatusResponse = {
  transactions: Array<{ hash: string; timestamp: number /* unix ms */ }>
  // For pending, expect no transactions.
  // For successful transactions (i.e. "succeeded"/"confirmed), expect just the mined transaction.
  // For failed transactions, there may be 0 (failed before submission) to multiple transactions (transaction reverted).
  // For submitted transactions, there may be multiple transactions, but only one will ultimately get mined
} & (
  | { status: 'pending' | 'submitted' | 'succeeded' | 'confirmed' }
  | { status: 'failed'; reason: string }
)

export const asGaslessSwapStatusResponse = asJSON<GaslessSwapStatusResponse>(
  asEither(
    asObject({
      status: asValue('pending', 'submitted', 'succeeded', 'confirmed'),
      transactions: asArray(
        asObject({
          hash: asString,
          timestamp: asNumber
        })
      )
    }),
    asObject({
      status: asValue('failed'),
      transactions: asArray(
        asObject({
          hash: asString,
          timestamp: asNumber
        })
      ),
      reason: asString
    })
  )
)

// -----------------------------------------------------------------------------
// Swap API
// -----------------------------------------------------------------------------

export interface SwapQuoteRequest {
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
export type SwapQuoteResponse = Readonly<{
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

export const asSwapQuoteResponse = asJSON(
  asObject<SwapQuoteResponse>({
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
