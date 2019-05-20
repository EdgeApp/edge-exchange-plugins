// @flow

import {gt, lt} from 'biggystring'
import {
    type EdgeCorePluginOptions,
    type EdgeCurrencyWallet,
    type EdgeSwapPlugin,
    type EdgeSwapPluginQuote,
    type EdgeSwapRequest,
    SwapBelowLimitError
} from 'edge-core-js/types'
import {base16} from 'rfc4648'
import hashjs from 'hash.js'
import utf8Codec from 'utf8'


import {makeSwapPluginQuote} from '../swap-helpers.js'
import {getFetchJson} from "../react-native-io";


function hmacSha512(data: Uint8Array, key: Uint8Array): Uint8Array {
    const hmac = hashjs.hmac(hashjs.sha512, key)
    return hmac.update(data).digest()
}

const swapInfo = {
    pluginName: 'godex',
    displayName: 'godex',

    quoteUri: 'https://godex.io/exchange/status/#',
    supportEmail: 'support@godex.io'
}

const uri = 'https://api.godex.io/api/v1/'


const expirationMs = 1000 * 60 * 20


function parseUtf8(text: string): Uint8Array {
    const byteString: string = utf8Codec.encode(text)
    const out = new Uint8Array(byteString.length)

    for (let i = 0; i < byteString.length; ++i) {
        out[i] = byteString.charCodeAt(i)
    }

    return out
}

type QuoteInfo = {
    transaction_id: string,
    status: string,
    coin_from: string,
    coin_to: string,
    deposit_amount: string,
    withdrawal_amount: string,
    deposit: string,
    deposit_extra_id: string,
    withdrawal: string,
    withdrawal_extra_id: string,
    rate: string,
    fee: string,
    return: string,
    return_extra_id: string,
    final_amount: string,
    hash_in: string,
    hash_out: string
}

const dontUseLegacy = {
    DGB: true
}

async function getAddress(wallet: EdgeCurrencyWallet, currencyCode: string) {
    const addressInfo = await wallet.getReceiveAddress({currencyCode})
    return addressInfo.legacyAddress && !dontUseLegacy[currencyCode]
        ? addressInfo.legacyAddress
        : addressInfo.publicAddress
}


export function makeGodexPlugin(opts: EdgeCorePluginOptions): EdgeSwapPlugin {
    const {io, initOptions} = opts
    const fetchJson = getFetchJson(opts)


    async function call(url, data) {
        const body = JSON.stringify(data.params)

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        const reply = await fetchJson(url, {method: 'POST', body, headers})
        if (!reply.ok) {
            throw new Error(`godex returned error code ${reply.status}`)
        }
        const out = reply.json
        return out
    }

    const out: EdgeSwapPlugin = {
        swapInfo,

        async fetchSwapQuote(
            request: EdgeSwapRequest,
            userSettings: Object | void
        ): Promise<EdgeSwapPluginQuote> {

            // Grab addresses:
            const [fromAddress, toAddress] = await Promise.all([
                getAddress(request.fromWallet, request.fromCurrencyCode),
                getAddress(request.toWallet, request.toCurrencyCode)
            ]);

            // Convert the native amount to a denomination:
            const quoteAmount =
                request.quoteFor === 'from'
                    ? await request.fromWallet.nativeToDenomination(
                    request.nativeAmount,
                    request.fromCurrencyCode
                    )
                    : await request.toWallet.nativeToDenomination(
                    request.nativeAmount,
                    request.toCurrencyCode
                    )

            // Swap the currencies if we need a reverse quote:
            const quoteParams = {
                from: request.fromCurrencyCode,
                to: request.toCurrencyCode,
                amount: quoteAmount
            };

            io.console.info('quoteParams:', quoteParams);

            // Get the estimate from the server:
            const quoteReplies = await Promise.all([
                call(uri + 'info', {
                    params: quoteParams
                }),
                call(uri + 'info-revert', {
                    params: quoteParams
                })
            ])
            io.console.info('godex info api');
            io.console.info(quoteReplies);

            // Calculate the amounts:
            let fromAmount, fromNativeAmount, toNativeAmount
            if (request.quoteFor === 'from') {
                fromAmount = quoteAmount
                fromNativeAmount = request.nativeAmount
                toNativeAmount = await request.toWallet.denominationToNative(
                    quoteReplies[0].amount.toString(),
                    request.toCurrencyCode
                )
            } else {
                fromAmount = quoteReplies[1].amount
                fromNativeAmount = await request.fromWallet.denominationToNative(
                    fromAmount.toString(),
                    request.fromCurrencyCode
                )
                toNativeAmount = request.nativeAmount
            }
            io.console.info('fromNativeAmount' + fromNativeAmount);
            io.console.info('toNativeAmount' + toNativeAmount);


            // Check the minimum:
            const nativeMin = await request.fromWallet.denominationToNative(
                quoteReplies[0].min_amount,
                request.fromCurrencyCode
            )
            if (lt(fromNativeAmount, nativeMin)) {
                throw new SwapBelowLimitError(swapInfo, nativeMin)
            }


            const sendReply = await call(uri + 'transaction',
                {
                    params: {
                        deposit_amount: fromAmount,
                        coin_from: request.fromCurrencyCode,
                        coin_to: request.toCurrencyCode,
                        withdrawal: toAddress,
                        return: fromAddress,
                        // return_extra_id: 'empty',
                        // withdrawal_extra_id: 'empty',
                        return_extra_id: null,
                        withdrawal_extra_id: null,
                        affiliate_id: initOptions.affiliateId,
                        type: 'edge'
                    }
                })
            io.console.info('sendReply' + sendReply);
            const quoteInfo: QuoteInfo = sendReply;

            // Make the transaction:
            const spendInfo = {
                currencyCode: request.fromCurrencyCode,
                spendTargets: [
                    {
                        nativeAmount: fromNativeAmount,
                        publicAddress: quoteInfo.deposit,
                        otherParams: {
                            uniqueIdentifier: quoteInfo.deposit_extra_id
                        }
                    }
                ]
            }
            io.console.info('godex spendInfo', spendInfo)

            const tx = await request.fromWallet.makeSpend(spendInfo)
            tx.otherParams.payinAddress = spendInfo.spendTargets[0].publicAddress
            tx.otherParams.uniqueIdentifier =
                spendInfo.spendTargets[0].otherParams.uniqueIdentifier


            // Convert that to the output format:
            return makeSwapPluginQuote(
                request,
                fromNativeAmount,
                toNativeAmount,
                tx,
                toAddress,
                'godex',
                new Date(Date.now() + expirationMs),
                quoteInfo.transaction_id
            )
        }
    }

    return out
}
