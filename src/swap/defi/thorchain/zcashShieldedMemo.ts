import { base64urlnopad, utf8 } from '@scure/base'
import { asBoolean, asMaybe, asObject, asOptional, asString } from 'cleaners'
import { SwapCurrencyError } from 'edge-core-js/types'

import { getAddress, nativeToDenomination } from '../../../util/utils'
import { SourceSpendStrategy } from './thorchainTypes'

/**
 * Mayanode's extension to an `inbound_addresses` entry: the unified address
 * that receives the shielded note carrying a Zcash swap memo.
 */
const asShieldedMemoInbound = asObject({
  shielded_memo_config: asOptional(
    asObject({
      enabled: asBoolean,
      uivk: asString,
      unified_address: asString
    })
  )
})

/** Maya's Zcash inbound vaults are transparent addresses. */
const isTransparentZcashAddress = (address: string): boolean =>
  address.startsWith('t1') || address.startsWith('t3')

/**
 * Append a transparent (t-address) refund address to a Maya swap memo for a
 * shielded Zcash source.
 *
 * Maya cannot refund a shielded Zcash source without a transparent refund
 * address, which it reads from the swap memo's destination field as
 * `DESTADDR/REFUNDADDR`. The address cannot be obtained from the quote/swap
 * endpoint: given a `refund_address`, Maya builds that same memo and then
 * rejects the quote because the result overflows Zcash's 80-char
 * transparent-memo limit (e.g. ZEC->DASH is 86/80, verified against the live
 * endpoint). The shielded Zcash send instead carries the memo in the encrypted
 * note (512 bytes), which is not bound by that limit, so the refund is appended
 * here after the quote is fetched without it.
 *
 * Maya reads the refund from the memo's destination field as
 * `DESTADDR/REFUNDADDR`, so the destination address in the memo is replaced
 * with `DESTADDR/REFUNDADDR`. A memo that does not contain the destination
 * address is returned unchanged.
 */
export const appendMayaRefundAddress = (
  memo: string,
  destinationAddress: string,
  refundAddress: string
): string =>
  memo.replace(destinationAddress, `${destinationAddress}/${refundAddress}`)

/**
 * Maya cannot read an OP_RETURN from Edge's shielded-pool Zcash spends, so
 * the swap memo rides in a zero-value shielded note to the vault's unified
 * address while the swap amount goes to the transparent vault. Both outputs
 * are handed to the Zcash engine as one ZIP-321 URI through
 * `otherParams.zip321Uri`; the engine ignores `memos` when it is present.
 */
export const makeZcashShieldedMemoSpend: SourceSpendStrategy = async ctx => {
  const {
    request,
    swapInfo,
    fromNativeAmount,
    toAddress,
    memo,
    inboundAddress,
    inboundEntry
  } = ctx
  const { fromWallet, fromTokenId } = request

  if (inboundAddress == null) {
    throw new Error('Invalid vault address')
  }

  // Inbound address must be transparent (t-address)
  if (!isTransparentZcashAddress(inboundAddress)) {
    throw new SwapCurrencyError(swapInfo, request)
  }

  // Shielded memo recipient must be available from inbound_addresses
  const shieldedMemoConfig = asMaybe(asShieldedMemoInbound)(inboundEntry)
    ?.shielded_memo_config
  const memoRecipient =
    shieldedMemoConfig?.enabled === true
      ? shieldedMemoConfig.unified_address
      : undefined
  if (memoRecipient == null || memoRecipient === '') {
    throw new SwapCurrencyError(swapInfo, request)
  }

  // Convert native to a decimal string per ZIP-321 spec
  const amountZec = nativeToDenomination(
    fromWallet,
    fromNativeAmount,
    fromTokenId
  )

  // Maya cannot refund a shielded Zcash source without a transparent refund
  // address, so it must be present.
  const refundAddress = await getAddress(fromWallet, 'transparentAddress')
  if (refundAddress === '') {
    throw new SwapCurrencyError(swapInfo, request)
  }

  // Inject the transparent refund address into the shielded ZEC swap memo,
  // which is fetched from the quote endpoint without it (see
  // `appendMayaRefundAddress`).
  const refundedMemo = appendMayaRefundAddress(memo, toAddress, refundAddress)

  // Encode memo per ZIP-321 as base64url (unpadded).
  const memoBase64Url = base64urlnopad.encode(utf8.decode(refundedMemo))

  // ZIP-321 requires grouping parameters by payment using paramindex.
  // Payment 0 (unindexed): transparent vault recipient & swap amount.
  // Payment 1 (indexed .1): shielded memo recipient with zero amount.
  const zip321Uri =
    `zcash:?address=${encodeURIComponent(inboundAddress)}` + // output 1: transparent vault
    `&amount=${encodeURIComponent(amountZec)}` +
    `&address.1=${encodeURIComponent(memoRecipient)}` + // output 2: shielded memo note
    `&amount.1=0` +
    `&memo.1=${memoBase64Url}`

  // The memo is already embedded in the ZIP-321 URI, so the spend itself
  // carries an empty one.
  return {
    memo: { type: 'text', value: '' },
    publicAddress: inboundAddress,
    otherParams: { zip321Uri }
  }
}
