import { assert } from 'chai'
import { describe, it } from 'mocha'

import { makeSpendParams, PLUGIN_ID_UNIZEN_MAP } from '../src/swap/defi/unizen'

const log: any = {
  warn: () => {}
}

const BTC_WALLET = {
  currencyInfo: { pluginId: 'bitcoin' }
}
const BNB_WALLET = {
  currencyInfo: { pluginId: 'binancesmartchain' }
}
const ATOM_WALLET = {
  currencyInfo: { pluginId: 'cosmoshub' }
}
const FTM_WALLET = {
  currencyInfo: { pluginId: 'fantom' },
  currencyConfig: { currencyInfo: { pluginId: 'fantom' } }
}

describe(`unizen makeSpendParams`, function () {
  it('cross chain bitcoin to binance smart chain', function () {
    const request: any = {
      fromWallet: BTC_WALLET
    }
    const spendParams = makeSpendParams(
      request,
      log,
      PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId].unizenId,
      BTC_TO_BNB
    )

    assert.deepEqual(spendParams, {
      customNetworkFee: { satPerByte: '6' },
      networkFeeOption: 'custom',
      destinationAddress: 'bc1q3hwz3r7xa8eaj9ae9m64va4gaj3gktxqpwkp6q',
      expirationDate: new Date('2024-12-19T22:47:17.000Z'),
      memos: [
        {
          type: 'text',
          value:
            '=:BSC.BNB:0x547206fD7cD322bdaF75C1414c81ab2a090586e7::unizen-utxo:25'
        }
      ],
      metadataNotes: 'DEX Provider: Thorchain',
      minReceiveAmount: '14622237'
    })
  })
  it('cross chain atom to bitcoin', function () {
    const request: any = {
      fromWallet: ATOM_WALLET
    }
    const spendParams = makeSpendParams(
      request,
      log,
      PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId].unizenId,
      ATOM_TO_BTC
    )

    assert.deepEqual(spendParams, {
      networkFeeOption: 'standard',
      destinationAddress: 'cosmos13hwz3r7xa8eaj9ae9m64va4gaj3gktxqh5g27d',
      expirationDate: new Date('2024-12-19T22:48:52.000Z'),
      memos: [
        {
          type: 'text',
          value:
            '=:BTC.BTC:bc1qnw0zk4zxfgfrqyfmv2n8zw75dyy056fgg86w9w::unizen-utxo:25'
        }
      ],
      metadataNotes: 'DEX Provider: Thorchain',
      minReceiveAmount: '18277'
    })
  })
  it('single chain binance smart chain to token', function () {
    const request: any = {
      fromWallet: BNB_WALLET
    }
    const spendParams = makeSpendParams(
      request,
      log,
      PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId].unizenId,
      BNB_TO_TOKEN
    )

    assert.deepEqual(spendParams, {
      customNetworkFee: { gasPrice: '1' },
      networkFeeOption: 'custom',
      destinationAddress: '0x880E0cE34F48c0cbC68BF3E745F17175BA8c650e',
      expirationDate: new Date('2024-12-20T22:36:28.000Z'),
      memos: [
        {
          type: 'hex',
          value:
            'BFAA0506000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001E0000000000000000000000000547206FD7CD322BDAF75C1414C81AB2A090586E70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000F8A0BF9CF54BB92F17374D9E9A321E6A111A51BD0000000000000000000000000000000000000000000000000069DEF12E4E80000000000000000000000000000000000000000000000000000BF4A1A493947D160000000000000000000000000000000000000000000000000C138C00BE71C95700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000465646765000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000013F4EA83D0BD40E75C8222255BC855A974568DD40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000F8A0BF9CF54BB92F17374D9E9A321E6A111A51BD0000000000000000000000000000000000000000000000000069DEF12E4E800000000000000000000000000000000000000000000000000000000000000000A00000000000000000000000000000000000000000000000000000000000000104B858183F00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880E0CE34F48C0CBC68BF3E745F17175BA8C650E0000000000000000000000000000000000000000000000000069DEF12E4E80000000000000000000000000000000000000000000000000000BF4A1A493947D16000000000000000000000000000000000000000000000000000000000000002BBB4CDB9CBD36B01BD1CBAEBF2DE08D9173BC095C0009C4F8A0BF9CF54BB92F17374D9E9A321E6A111A51BD00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
        }
      ],
      metadataNotes: 'DEX Provider: PancakeSwap V3',
      minReceiveAmount: '861491156957297942'
    })
  })
  it('single chain fantom token to fantom', function () {
    const request: any = {
      fromWallet: FTM_WALLET
    }
    const spendParams = makeSpendParams(
      request,
      log,
      PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId].unizenId,
      FANTOM_TOKEN_TO_FTM
    )

    assert.deepEqual(spendParams, {
      customNetworkFee: { gasPrice: '7' },
      networkFeeOption: 'custom',
      destinationAddress: '0xBE2A77399Cde40EfbBc4e89207332c4a4079c83D',
      expirationDate: new Date('2024-12-20T22:38:57.000Z'),
      memos: [
        {
          type: 'hex',
          value:
            'BFAA0506000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001E00000000000000000000000008345E0529743A0238BC56301F1063F46E6EF01BE0000000000000000000000006C021AE822BEA943B2E66552BDE1D2696A53FBB700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000528D1863DC1CD80000000000000000000000000000000000000000000000000000A160374DD382704E000000000000000000000000000000000000000000000000A30182DA3FAA8B4C000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000082000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000004656467650000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000F491E7B69E4244AD4002BC14E878A34207E38C290000000000000000000000006C021AE822BEA943B2E66552BDE1D2696A53FBB700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000528D1863DC1CD8000000000000000000000000000000000000000000000000000000000000000000A0000000000000000000000000000000000000000000000000000000000000010418CBAFE50000000000000000000000000000000000000000000000528D1863DC1CD80000000000000000000000000000000000000000000000000000A160374DD382704E00000000000000000000000000000000000000000000000000000000000000A0000000000000000000000000BE2A77399CDE40EFBBC4E89207332C4A4079C83D000000000000000000000000000000000000000000000000000000006765F20100000000000000000000000000000000000000000000000000000000000000020000000000000000000000006C021AE822BEA943B2E66552BDE1D2696A53FBB700000000000000000000000021BE370D5312F44CB42CE377BC9B8A0CEF1A4C8300000000000000000000000000000000000000000000000000000000'
        }
      ],
      metadataNotes: 'DEX Provider: SpookySwap',
      minReceiveAmount: '11628355045271171150'
    })
  })
  it('single chain fantom token to fantom missing contract', function () {
    const request: any = {
      fromWallet: FTM_WALLET,
      fromTokenId: '6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
      toWallet: FTM_WALLET,
      toTokenId: null
    }
    let loggedMessage = ''
    const log: any = {
      warn: (text: string) => {
        loggedMessage = text
      }
    }

    assert.throws(() =>
      makeSpendParams(
        request,
        log,
        PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId].unizenId,
        FANTOM_TOKEN_TO_FTM_MISSING_CONTRACT
      )
    )
    assert.strictEqual(
      loggedMessage,
      'Contract address not found, try updating @unizen-io/unizen-contract-addresses broekn_lol'
    )
  })
  it('cross chain binance smart chain to atom', function () {
    const request: any = {
      fromWallet: BNB_WALLET
    }
    const spendParams = makeSpendParams(
      request,
      log,
      PLUGIN_ID_UNIZEN_MAP[request.fromWallet.currencyInfo.pluginId].unizenId,
      BNB_TO_ATOM
    )

    assert.deepEqual(spendParams, {
      customNetworkFee: { gasPrice: '1' },
      networkFeeOption: 'custom',
      destinationAddress: '0xf12f7b4238e85322b1b2362122d333c96851c223',
      expirationDate: new Date('2024-12-20T02:06:13.000Z'),
      memos: [
        {
          type: 'hex',
          value:
            '3d3a474149412e41544f4d3a636f736d6f733175636e616d683633386c70677172616574646d6361786b30677a373974346b32616b797476663a3a756e697a656e2d7574786f3a3235'
        }
      ],
      metadataNotes: 'DEX Provider: Thorchain',
      minReceiveAmount: '145396466'
    })
  })
})

const BTC_TO_BNB = [
  {
    srcTradeList: [],
    dstTradeList: [],
    srcTrade: {
      tokenFrom: {
        name: 'BTC',
        symbol: 'BTC',
        decimals: 8,
        contractAddress: '0x0000000000000000000000000000000000000000',
        chainId: -3980891822,
        priceInUsd: 97812.32377204912,
        buyTax: 0,
        sellTax: 0
      }
    },
    dstTrade: {
      toTokenAmount: '146222370000000000',
      deltaAmount: '146222370000000000',
      tokenTo: {
        name: 'BNB',
        symbol: 'BNB',
        decimals: 18,
        contractAddress: '0x0000000000000000000000000000000000000000',
        chainId: 56,
        priceInUsd: 673.186864722848,
        buyTax: 0,
        sellTax: 0
      }
    },
    transactionData: {
      inbound_address: 'bc1q3hwz3r7xa8eaj9ae9m64va4gaj3gktxqpwkp6q',
      inbound_confirmation_blocks: 1,
      inbound_confirmation_seconds: 600,
      outbound_delay_blocks: 720,
      outbound_delay_seconds: 4320,
      fees: {
        asset: 'BSC.BNB',
        affiliate: '37020',
        outbound: '148824',
        liquidity: '23721',
        total: '209565',
        slippage_bps: 15,
        total_bps: 139
      },
      expiry: 1734648437,
      warning:
        'Do not cache this response. Do not send funds after the expiry.',
      notes:
        'First output should be to inbound_address, second output should be change back to self, third output should be OP_RETURN, limited to 80 bytes. Do not send below the dust threshold. Do not use exotic spend scripts, locks or address formats.',
      dust_threshold: '10000',
      recommended_min_amount_in: '86186',
      recommended_gas_rate: '6',
      gas_rate_units: 'satsperbyte',
      memo:
        '=:BSC.BNB:0x547206fD7cD322bdaF75C1414c81ab2a090586e7::unizen-utxo:25',
      expected_amount_out: '14622237',
      max_streaming_quantity: 0,
      streaming_swap_blocks: 0,
      total_swap_seconds: 4920,
      amount: '102237',
      tradeProtocol: 'CROSS_CHAIN_THORCHAIN',
      version: 'v1'
    },
    nativeValue: '102237',
    nativeFee: '0',
    tradeProtocol: 'CROSS_CHAIN_THORCHAIN',
    sourceChainId: -3980891822,
    destinationChainId: 56,
    providerInfo: {
      name: 'Thorchain',
      logo: 'https://thorchain.org/images/logos/full-dark.png',
      website: 'https://thorchain.org/',
      docsLink: 'https://thorchain.org/integrate',
      description:
        'THORChain is a network that facilitates native asset settlement between Bitcoin, Ethereum, BNB Chain, Avalanche, Cosmos Hub, Dogecoin, Bitcoin Cash & Litecoin'
    },
    tradeParams: {
      sender: 'bc1qnw0zk4zxfgfrqyfmv2n8zw75dyy056fgg86w9w',
      receiver: '0x547206fD7cD322bdaF75C1414c81ab2a090586e7',
      tokenIn: '0x0000000000000000000000000000000000000000',
      tokenOut: '0x0000000000000000000000000000000000000000',
      amount: '102237',
      srcChainId: -3980891822,
      dstChainId: 56,
      inNative: true,
      outNative: true,
      deadline: 1734648437,
      tokenInfo: [
        {
          name: 'BTC',
          symbol: 'BTC',
          decimals: 8,
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: -3980891822,
          priceInUsd: 97812.32377204912,
          buyTax: 0,
          sellTax: 0
        },
        {
          name: 'BNB',
          symbol: 'BNB',
          decimals: 18,
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          priceInUsd: 673.186864722848,
          buyTax: 0,
          sellTax: 0
        }
      ]
    }
  }
]
const ATOM_TO_BTC = [
  {
    srcTradeList: [],
    dstTradeList: [],
    srcTrade: {
      tokenFrom: {
        name: 'ATOM',
        symbol: 'ATOM',
        decimals: 6,
        contractAddress: '0x0000000000000000000000000000000000000000',
        chainId: -978111860,
        priceInUsd: 6.939516723180921,
        buyTax: 0,
        sellTax: 0
      }
    },
    dstTrade: {
      toTokenAmount: '18277',
      deltaAmount: '18277',
      tokenTo: {
        name: 'BTC',
        symbol: 'BTC',
        decimals: 8,
        contractAddress: '0x0000000000000000000000000000000000000000',
        chainId: -3980891822,
        priceInUsd: 97648.24690753526,
        buyTax: 0,
        sellTax: 0
      }
    },
    transactionData: {
      inbound_address: 'cosmos13hwz3r7xa8eaj9ae9m64va4gaj3gktxqh5g27d',
      outbound_delay_blocks: 720,
      outbound_delay_seconds: 4320,
      fees: {
        asset: 'BTC.BTC',
        affiliate: '51',
        outbound: '2054',
        liquidity: '32',
        total: '2137',
        slippage_bps: 15,
        total_bps: 948
      },
      expiry: 1734648532,
      warning:
        'Do not cache this response. Do not send funds after the expiry.',
      notes:
        'Transfer the inbound_address the asset with the memo. Do not use multi-in, multi-out transactions.',
      recommended_min_amount_in: '1214762200',
      recommended_gas_rate: '750000',
      gas_rate_units: 'uatom',
      memo:
        '=:BTC.BTC:bc1qnw0zk4zxfgfrqyfmv2n8zw75dyy056fgg86w9w::unizen-utxo:25',
      expected_amount_out: '18277',
      max_streaming_quantity: 0,
      streaming_swap_blocks: 0,
      total_swap_seconds: 4320,
      amount: '2877700',
      tradeProtocol: 'CROSS_CHAIN_THORCHAIN',
      version: 'v1'
    },
    nativeValue: '2877700',
    nativeFee: '0',
    tradeProtocol: 'CROSS_CHAIN_THORCHAIN',
    sourceChainId: -978111860,
    destinationChainId: -3980891822,
    providerInfo: {
      name: 'Thorchain',
      logo: 'https://thorchain.org/images/logos/full-dark.png',
      website: 'https://thorchain.org/',
      docsLink: 'https://thorchain.org/integrate',
      description:
        'THORChain is a network that facilitates native asset settlement between Bitcoin, Ethereum, BNB Chain, Avalanche, Cosmos Hub, Dogecoin, Bitcoin Cash & Litecoin'
    },
    tradeParams: {
      sender: 'cosmos1ucnamh638lpgqraetdmcaxk0gz79t4k2akytvf',
      receiver: 'bc1qnw0zk4zxfgfrqyfmv2n8zw75dyy056fgg86w9w',
      tokenIn: '0x0000000000000000000000000000000000000000',
      tokenOut: '0x0000000000000000000000000000000000000000',
      amount: '2877700',
      srcChainId: -978111860,
      dstChainId: -3980891822,
      inNative: true,
      outNative: true,
      deadline: 1734648532,
      tokenInfo: [
        {
          name: 'ATOM',
          symbol: 'ATOM',
          decimals: 6,
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: -978111860,
          priceInUsd: 6.939516723180921,
          buyTax: 0,
          sellTax: 0
        },
        {
          name: 'BTC',
          symbol: 'BTC',
          decimals: 8,
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: -3980891822,
          priceInUsd: 97648.24690753526,
          buyTax: 0,
          sellTax: 0
        }
      ]
    }
  }
]
const BNB_TO_TOKEN = [
  {
    fee: '0',
    toTokenAmountWithoutFee: '872783874790690084',
    fromTokenAmount: '29800000000000000',
    toTokenAmount: '872783874790690084',
    deltaAmount: '864056036042783138',
    tokenFrom: {
      symbol: 'BNB',
      name: 'Binance',
      contractAddress: '0x0000000000000000000000000000000000000000',
      chainId: 56,
      decimals: 18,
      buyTax: 0,
      sellTax: 0
    },
    tokenTo: {
      name: 'Chainlink',
      symbol: 'LINK',
      decimals: 18,
      contractAddress: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
      priceInUsd: 22.92602172900165,
      chainId: 56,
      buyTax: 0,
      sellTax: 0
    },
    tradeType: 0,
    protocol: [
      {
        name: 'PancakeSwap V3',
        logo: 'https://icons.llamao.fi/icons/protocols/pancakeswap?w=48&h=48',
        route: [
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd'
        ],
        percentage: 100
      }
    ],
    transactionData: {
      info: {
        feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
        feePercent: 0,
        sharePercent: 0,
        srcToken: '0x0000000000000000000000000000000000000000',
        dstToken: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
        deadline: 1734734188,
        slippage: 0.01,
        tokenHasTaxes: false,
        path: [
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd'
        ],
        v3Path:
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c0009c4f8a0bf9cf54bb92f17374d9e9a321e6a111a51bd',
        tradeType: 0,
        amountIn: '29800000000000000',
        amountOutMin: '861491156957297942',
        actualQuote: '870193087835654487',
        uuid: 'edge',
        requestId: '275a6ea5-e38c-4bcc-9a9b-8c91c794e5e0',
        apiId: '130',
        userPSFee: 0
      },
      call: [
        {
          targetExchange: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
          targetExchangeID: 'pancakev3',
          sellToken: '0x0000000000000000000000000000000000000000',
          buyToken: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD',
          amountDelta: '861491156957297942',
          amount: '29800000000000000',
          data:
            '0xb858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000069def12e4e80000000000000000000000000000000000000000000000000000bf4a1a493947d16000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c0009c4f8a0bf9cf54bb92f17374d9e9a321e6a111a51bd000000000000000000000000000000000000000000'
        }
      ],
      version: 'v1'
    },
    nativeValue: '29800000000000000',
    recommendedSlippage: 1,
    contractVersion: 'v1',
    gasPrice: '1000000000',
    slippage: 1.0000000000000009,
    priceImpact: 0.08023271195016779,
    isULDM: false,
    data:
      '0xbfaa0506000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000547206fd7cd322bdaf75c1414c81ab2a090586e70000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f8a0bf9cf54bb92f17374d9e9a321e6a111a51bd0000000000000000000000000000000000000000000000000069def12e4e80000000000000000000000000000000000000000000000000000bf4a1a493947d160000000000000000000000000000000000000000000000000c138c00be71c95700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000465646765000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000013f4ea83d0bd40e75c8222255bc855a974568dd40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f8a0bf9cf54bb92f17374d9e9a321e6a111a51bd0000000000000000000000000000000000000000000000000069def12e4e800000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000104b858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000069def12e4e80000000000000000000000000000000000000000000000000000bf4a1a493947d16000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c0009c4f8a0bf9cf54bb92f17374d9e9a321e6a111a51bd00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
  }
]
const FANTOM_TOKEN_TO_FTM = [
  {
    fee: '0',
    toTokenAmountWithoutFee: '11811656805436168582',
    fromTokenAmount: '1522800000000000000000',
    toTokenAmount: '11811656805436168582',
    deltaAmount: '11693540237381807145',
    tokenFrom: {
      name: 'Tomb',
      symbol: 'TOMB',
      decimals: 18,
      contractAddress: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
      priceInUsd: 0.007791760100925897,
      chainId: 250,
      buyTax: 0,
      sellTax: 0
    },
    tokenTo: {
      symbol: 'FTM',
      name: 'Fantom',
      contractAddress: '0x0000000000000000000000000000000000000000',
      chainId: 250,
      decimals: 18,
      buyTax: 0,
      sellTax: 0
    },
    tradeType: 0,
    protocol: [
      {
        name: 'SpookySwap',
        logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/9608.png',
        route: [
          '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
          '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
        ],
        percentage: 100
      }
    ],
    transactionData: {
      info: {
        feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
        feePercent: 0,
        sharePercent: 0,
        srcToken: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
        dstToken: '0x0000000000000000000000000000000000000000',
        deadline: 1734734337,
        slippage: 0.01,
        tokenHasTaxes: false,
        path: [
          '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
          '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
        ],
        tradeType: 0,
        amountIn: '1522800000000000000000',
        amountOutMin: '11628355045271171150',
        actualQuote: '11745813177041587020',
        uuid: 'edge',
        requestId: '873b6a72-ae53-4ca8-ad48-fb63820617d0',
        apiId: '130',
        userPSFee: 0
      },
      call: [
        {
          targetExchange: '0xF491e7B69E4244ad4002BC14e878a34207E38c29',
          targetExchangeID: 'spookyswap',
          sellToken: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
          buyToken: '0x0000000000000000000000000000000000000000',
          amountDelta: '11628355045271171150',
          amount: '1522800000000000000000',
          data:
            '0x18cbafe50000000000000000000000000000000000000000000000528d1863dc1cd80000000000000000000000000000000000000000000000000000a160374dd382704e00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000be2a77399cde40efbbc4e89207332c4a4079c83d000000000000000000000000000000000000000000000000000000006765f20100000000000000000000000000000000000000000000000000000000000000020000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000021be370d5312f44cb42ce377bc9b8a0cef1a4c83'
        }
      ],
      version: 'v1'
    },
    nativeValue: '0',
    recommendedSlippage: 1,
    contractVersion: 'v1',
    gasPrice: '7832997367',
    slippage: 1.0000000000000009,
    priceImpact: 0,
    isULDM: false,
    data:
      '0xbfaa0506000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000008345e0529743a0238bc56301f1063f46e6ef01be0000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000528d1863dc1cd80000000000000000000000000000000000000000000000000000a160374dd382704e000000000000000000000000000000000000000000000000a30182da3faa8b4c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000082000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000004656467650000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000f491e7b69e4244ad4002bc14e878a34207e38c290000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000528d1863dc1cd8000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000010418cbafe50000000000000000000000000000000000000000000000528d1863dc1cd80000000000000000000000000000000000000000000000000000a160374dd382704e00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000be2a77399cde40efbbc4e89207332c4a4079c83d000000000000000000000000000000000000000000000000000000006765f20100000000000000000000000000000000000000000000000000000000000000020000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000021be370d5312f44cb42ce377bc9b8a0cef1a4c8300000000000000000000000000000000000000000000000000000000'
  }
]
const FANTOM_TOKEN_TO_FTM_MISSING_CONTRACT = [
  {
    fee: '0',
    toTokenAmountWithoutFee: '11811656805436168582',
    fromTokenAmount: '1522800000000000000000',
    toTokenAmount: '11811656805436168582',
    deltaAmount: '11693540237381807145',
    tokenFrom: {
      name: 'Tomb',
      symbol: 'TOMB',
      decimals: 18,
      contractAddress: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
      priceInUsd: 0.007791760100925897,
      chainId: 250,
      buyTax: 0,
      sellTax: 0
    },
    tokenTo: {
      symbol: 'FTM',
      name: 'Fantom',
      contractAddress: '0x0000000000000000000000000000000000000000',
      chainId: 250,
      decimals: 18,
      buyTax: 0,
      sellTax: 0
    },
    tradeType: 0,
    protocol: [
      {
        name: 'SpookySwap',
        logo: 'https://s2.coinmarketcap.com/static/img/coins/64x64/9608.png',
        route: [
          '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
          '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
        ],
        percentage: 100
      }
    ],
    transactionData: {
      info: {
        feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
        feePercent: 0,
        sharePercent: 0,
        srcToken: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
        dstToken: '0x0000000000000000000000000000000000000000',
        deadline: 1734734337,
        slippage: 0.01,
        tokenHasTaxes: false,
        path: [
          '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
          '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83'
        ],
        tradeType: 0,
        amountIn: '1522800000000000000000',
        amountOutMin: '11628355045271171150',
        actualQuote: '11745813177041587020',
        uuid: 'edge',
        requestId: '873b6a72-ae53-4ca8-ad48-fb63820617d0',
        apiId: '130',
        userPSFee: 0
      },
      call: [
        {
          targetExchange: '0xF491e7B69E4244ad4002BC14e878a34207E38c29',
          targetExchangeID: 'spookyswap',
          sellToken: '0x6c021Ae822BEa943b2E66552bDe1D2696a53fbB7',
          buyToken: '0x0000000000000000000000000000000000000000',
          amountDelta: '11628355045271171150',
          amount: '1522800000000000000000',
          data:
            '0x18cbafe50000000000000000000000000000000000000000000000528d1863dc1cd80000000000000000000000000000000000000000000000000000a160374dd382704e00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000be2a77399cde40efbbc4e89207332c4a4079c83d000000000000000000000000000000000000000000000000000000006765f20100000000000000000000000000000000000000000000000000000000000000020000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000021be370d5312f44cb42ce377bc9b8a0cef1a4c83'
        }
      ],
      version: 'v1'
    },
    nativeValue: '0',
    recommendedSlippage: 1,
    contractVersion: 'broekn_lol', // no v3 contract for fantom
    gasPrice: '7832997367',
    slippage: 1.0000000000000009,
    priceImpact: 0,
    isULDM: false,
    data:
      '0xbfaa0506000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000008345e0529743a0238bc56301f1063f46e6ef01be0000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000528d1863dc1cd80000000000000000000000000000000000000000000000000000a160374dd382704e000000000000000000000000000000000000000000000000a30182da3faa8b4c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000082000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000004656467650000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000f491e7b69e4244ad4002bc14e878a34207e38c290000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000528d1863dc1cd8000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000010418cbafe50000000000000000000000000000000000000000000000528d1863dc1cd80000000000000000000000000000000000000000000000000000a160374dd382704e00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000be2a77399cde40efbbc4e89207332c4a4079c83d000000000000000000000000000000000000000000000000000000006765f20100000000000000000000000000000000000000000000000000000000000000020000000000000000000000006c021ae822bea943b2e66552bde1d2696a53fbb700000000000000000000000021be370d5312f44cb42ce377bc9b8a0cef1a4c8300000000000000000000000000000000000000000000000000000000'
  }
]
const BNB_TO_ATOM = [
  {
    srcTradeList: [
      {
        fee: '0',
        toTokenAmountWithoutFee: '11109469892121298429',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '11109469892121298429',
        deltaAmount: '10998375193200084610',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'PancakeSwap V3',
            logo:
              'https://icons.llamao.fi/icons/protocols/pancakeswap?w=48&h=48',
            route: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            v3Path:
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955',
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10912616057635609423',
            actualQuote: '11022844502662231740',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
              targetExchangeID: 'pancakev3',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10912616057635609423',
              amount: '16490000000000000',
              data:
                '0xb858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e000000000000000000000000000000000000000000000000003a95915058a0000000000000000000000000000000000000000000000000009771667ca5981b4f000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.000000000000012,
        priceImpact: 0,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '11022789792005616995',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '11022789792005616995',
        deltaAmount: '10912561894085560825',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Uniswap V3',
            logo:
              'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1348.png',
            route: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            v3Path:
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955',
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10912561894085560825',
            actualQuote: '11022789792005616995',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
              targetExchangeID: 'uniswapV3',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10912561894085560825',
              amount: '16490000000000000',
              data:
                '0xb858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e000000000000000000000000000000000000000000000000003a95915058a00000000000000000000000000000000000000000000000000097713539b66f09f9000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 0,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '11011967638807396781',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '11011967638807396781',
        deltaAmount: '10901847962419322814',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'WooFi 2.1',
            logo: 'https://icons.llamao.fi/icons/protocols/woofi?w=48&h=48',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10901847962419322814',
            actualQuote: '11011967638807396781',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x4c4AF8DBc524681930a27b2F1Af5bcC8062E6fB7',
              targetExchangeID: 'wooFi',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10901847962419322814',
              amount: '16490000000000000',
              data:
                '0x7dc20382000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000055d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000000000003a95915058a000000000000000000000000000000000000000000000000000974b24f61b51dfbe000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 0,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '11005920832424621400',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '11005920832424621400',
        deltaAmount: '10895861624100375186',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Thena Fusion',
            logo: 'https://icons.llamao.fi/icons/protocols/thena?w=48&h=48',
            route: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10895861624100375186',
            actualQuote: '11005920832424621400',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x327Dd3208f0bCF590A66110aCB6e5e6941A4EfA0',
              targetExchangeID: 'thenaFusion',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10895861624100375186',
              amount: '16490000000000000',
              data:
                '0xc04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f10000000000000000000000000000000000000000000000000003a95915058a0000000000000000000000000000000000000000000000000009735e06b1a504a920000000000000000000000000000000000000000000000000000000000000028bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c55d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000000000'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 0,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '11001901768693596809',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '11001901768693596809',
        deltaAmount: '10891882751006660841',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'NomiSwap',
            logo:
              'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1657.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10891882751006660841',
            actualQuote: '11001901768693596809',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xD654953D746f0b114d1F85332Dc43446ac79413d',
              targetExchangeID: 'nomiswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10891882751006660841',
              amount: '16490000000000000',
              data:
                '0x7ff36ab50000000000000000000000000000000000000000000000009727bda784f4d8e90000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 0.01059002121013286,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10984659316352316178',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10984659316352316178',
        deltaAmount: '10874812723188793016',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'PancakeSwap',
            logo: 'https://pancakeswap.finance/favicon.ico',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10874812723188793016',
            actualQuote: '10984659316352316178',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
              targetExchangeID: 'pancake',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10874812723188793016',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000096eb188df490feb80000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 0.1672958955616033,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10980684269684649447',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10980684269684649447',
        deltaAmount: '10870877426987802953',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'BiSwap',
            logo:
              'https://seeklogo.com/images/B/biswap-bsw-logo-86873328D3-seeklogo.com.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10870877426987802953',
            actualQuote: '10980684269684649447',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
              targetExchangeID: 'biswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10870877426987802953',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000096dd1d6c686ba1490000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 0.20342261067816114,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10979758071700267625',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10979758071700267625',
        deltaAmount: '10869960490983264949',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Thena V1',
            logo: 'https://icons.llamao.fi/icons/protocols/thena?w=48&h=48',
            route: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10869960490983264949',
            actualQuote: '10979758071700267625',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xd4ae6eca985340dd434d38f470accce4dc78d109',
              targetExchangeID: 'thenaV1',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10869960490983264949',
              amount: '16490000000000000',
              data:
                '0x67ffb66a00000000000000000000000000000000000000000000000096d9db799b9692b50000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000001000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b31979550000000000000000000000000000000000000000000000000000000000000000'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 0.21184024536796686,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10973166012245178845',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10973166012245178845',
        deltaAmount: '10863434352122727057',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'MDEXSwap',
            logo: 'https://avatars.githubusercontent.com/u/76643605?v=4',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10863434352122727057',
            actualQuote: '10973166012245178845',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x7DAe51BD3E3376B8c7c4900E9107f12Be3AF1bA8',
              targetExchangeID: 'mdexswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10863434352122727057',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000096c2abfc7f0d0a910000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 0.2717513543123329,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10972927900382858788',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10972927900382858788',
        deltaAmount: '10863198621379030200',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Babyswap',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/10334.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10863198621379030200',
            actualQuote: '10972927900382858788',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x325E343f1dE602396E256B67eFd1F61C3A6B38Bd',
              targetExchangeID: 'babyswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10863198621379030200',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000096c1d59727cf6cb80000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 0.273915404230507,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10969516060465399297',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10969516060465399297',
        deltaAmount: '10859820899860745304',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'SushiSwap',
            logo: 'https://app.sushi.com/images/logo.svg',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10859820899860745304',
            actualQuote: '10969516060465399297',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
              targetExchangeID: 'sushiswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10859820899860745304',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000096b5d59214900c580000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 0.304923485147901,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10966032486515079544',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10966032486515079544',
        deltaAmount: '10856372161649928749',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'BabyDoge Swap',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/10407.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10856372161649928749',
            actualQuote: '10966032486515079544',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xC9a0F685F39d05D835c369036251ee3aEaaF3c47',
              targetExchangeID: 'babydoge',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10856372161649928749',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000096a994f624956a2d0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 0.3365835118626648,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10957865828073327266',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10957865828073327266',
        deltaAmount: '10848287169792593993',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'ApeSwap',
            logo: 'https://asset.brandfetch.io/id6SRXuLY4/idErbQpvvC.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10848287169792593993',
            actualQuote: '10957865828073327266',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7',
              targetExchangeID: 'apeswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10848287169792593993',
              amount: '16490000000000000',
              data:
                '0x7ff36ab5000000000000000000000000000000000000000000000000968cdbb448ea50490000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 0.4108051670143831,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10890037550547379707',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10890037550547379707',
        deltaAmount: '10781137175041905910',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'KnightSwap',
            logo:
              'https://s2.coinmarketcap.com/static/img/exchanges/64x64/1584.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10781137175041905910',
            actualQuote: '10890037550547379707',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x05E61E0cDcD2170a76F9568a110CEe3AFdD6c46f',
              targetExchangeID: 'KnightSwap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10781137175041905910',
              amount: '16490000000000000',
              data:
                '0x7ff36ab5000000000000000000000000000000000000000000000000959e4b23c92194f60000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 1.0272539948884774,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10876006638453794935',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10876006638453794935',
        deltaAmount: '10767246572069256986',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Julswap',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/8164.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10767246572069256986',
            actualQuote: '10876006638453794935',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xbd67d157502A23309Db761c41965600c2Ec788b2',
              targetExchangeID: 'julswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10767246572069256986',
              amount: '16490000000000000',
              data:
                '0x9cf68911000000000000000000000000000000000000000000000000956cf1b5c13aff1a0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 1.1547721868517824,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10860031949885811775',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10860031949885811775',
        deltaAmount: '10751431630386953657',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Gravis Finance',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/19788.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10751431630386953657',
            actualQuote: '10860031949885811775',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x03a2F8F90B219732757472BB54801a82f33A8d0D',
              targetExchangeID: 'gravis',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10751431630386953657',
              amount: '16490000000000000',
              data:
                '0x7ff36ab50000000000000000000000000000000000000000000000009534c21ab41cfdb90000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 1.2999561485058209,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10857989479176262430',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10857989479176262430',
        deltaAmount: '10749409584384499806',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'AlitaSwap',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/11599.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10749409584384499806',
            actualQuote: '10857989479176262430',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x730aCC3bBf2443f2EaEaCFc7ac7b4d8DC9E32dB8',
              targetExchangeID: 'alitaswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10749409584384499806',
              amount: '16490000000000000',
              data:
                '0x7ff36ab5000000000000000000000000000000000000000000000000952d93106e6ae05e0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 1.3185188884248356,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10846374036337462599',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10846374036337462599',
        deltaAmount: '10737910295974087973',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Squadswap V3',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/30069.png',
            route: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
              '0x55d398326f99059ff775485246999027b3197955'
            ],
            v3Path:
              '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c0001f455d398326f99059ff775485246999027b3197955',
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10737910295974087973',
            actualQuote: '10846374036337462599',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x8b0C61843dC450637e88e524666F5fe18ccc727B',
              targetExchangeID: 'squadswapV3',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10737910295974087973',
              amount: '16490000000000000',
              data:
                '0xb858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e000000000000000000000000000000000000000000000000003a95915058a0000000000000000000000000000000000000000000000000009504b885b58b8d25000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c0001f455d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 1.4240843897819766,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10785698489944291847',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10785698489944291847',
        deltaAmount: '10677841505044848929',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Complus Network',
            logo:
              'https://icons.llamao.fi/icons/protocols/complus-network?w=24&h=24',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10677841505044848929',
            actualQuote: '10785698489944291847',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x07DC75E8bc57A21A183129Ec29bbCC232d79eE56',
              targetExchangeID: 'complus',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10677841505044848929',
              amount: '16490000000000000',
              data:
                '0x7ff36ab5000000000000000000000000000000000000000000000000942f5046741ee1210000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 1.9755265142024525,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10726881698025998611',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10726881698025998611',
        deltaAmount: '10619612881045738625',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Uniswap V2',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/7083.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10619612881045738625',
            actualQuote: '10726881698025998611',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
              targetExchangeID: 'uniswapV2',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10619612881045738625',
              amount: '16490000000000000',
              data:
                '0x7ff36ab5000000000000000000000000000000000000000000000000936071a672e4d4810000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.000000000000012,
        priceImpact: 2.510075580754756,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10690666338310734282',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10690666338310734282',
        deltaAmount: '10583759674927626939',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'JetSwap',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/10810.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10583759674927626939',
            actualQuote: '10690666338310734282',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0xBe65b8f75B9F20f4C522e0067a3887FADa714800',
              targetExchangeID: 'jetswap',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10583759674927626939',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000092e11159642a3abb0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 2.839214353871522,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10687232998358641381',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10687232998358641381',
        deltaAmount: '10580360668375054967',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Hyperjump',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/14658.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '10580360668375054967',
            actualQuote: '10687232998358641381',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x3bc677674df90A9e5D741f28f6CA303357D0E4Ec',
              targetExchangeID: 'hyperjump',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '10580360668375054967',
              amount: '16490000000000000',
              data:
                '0x9cf6891100000000000000000000000000000000000000000000000092d4fdf882027a770000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.0000000000000009,
        priceImpact: 2.8704178351681042,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '10034989302266986411',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '10034989302266986411',
        deltaAmount: '9934639409244316547',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'Impossible Finance',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/10932.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '9934639409244316547',
            actualQuote: '10034989302266986411',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x8f2A0d8865D995364DC6843D51Cf6989001f989e',
              targetExchangeID: 'impossibleFinance',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '9934639409244316547',
              amount: '16490000000000000',
              data:
                '0x7ff36ab500000000000000000000000000000000000000000000000089deede81f9aa3830000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 0.9999999999999898,
        priceImpact: 8.798253195429995,
        isULDM: false
      },
      {
        fee: '0',
        toTokenAmountWithoutFee: '9063171861438530053',
        fromTokenAmount: '16490000000000000',
        toTokenAmount: '9063171861438530053',
        deltaAmount: '8972540142824144752',
        tokenFrom: {
          symbol: 'BNB',
          name: 'Binance',
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: 56,
          decimals: 18,
          buyTax: 0,
          sellTax: 0
        },
        tokenTo: {
          name: 'Tether USDt',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          priceInUsd: 0.9989685576597374,
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        tradeType: 0,
        protocol: [
          {
            name: 'SwapFish',
            logo:
              'https://s2.coinmarketcap.com/static/img/coins/64x64/22852.png',
            route: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            percentage: 100
          }
        ],
        transactionData: {
          info: {
            feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
            feePercent: 0,
            sharePercent: 0,
            srcToken: '0x0000000000000000000000000000000000000000',
            dstToken: '0x55d398326f99059fF775485246999027B3197955',
            deadline: 1734745872,
            slippage: 0.01,
            tokenHasTaxes: false,
            path: [
              '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
              '0x55d398326f99059fF775485246999027B3197955'
            ],
            tradeType: 0,
            amountIn: '16490000000000000',
            amountOutMin: '8972540142824144752',
            actualQuote: '9063171861438530053',
            uuid: 'edge',
            requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
            apiId: '130',
            userPSFee: 0
          },
          call: [
            {
              targetExchange: '0x33141e87ad2DFae5FBd12Ed6e61Fa2374aAeD029',
              targetExchangeID: 'swapFish',
              sellToken: '0x0000000000000000000000000000000000000000',
              buyToken: '0x55d398326f99059fF775485246999027B3197955',
              amountDelta: '8972540142824144752',
              amount: '16490000000000000',
              data:
                '0x7ff36ab50000000000000000000000000000000000000000000000007c84ddb8a9f73f700000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e0000000000000000000000000000000000000000000000000000000067661f100000000000000000000000000000000000000000000000000000000000000003000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000e9e7cea3dedca5984780bafc599bd69add087d5600000000000000000000000055d398326f99059ff775485246999027b3197955'
            }
          ],
          version: 'v1'
        },
        nativeValue: '16490000000000000',
        recommendedSlippage: 1,
        contractVersion: 'v1',
        gasPrice: '1000000000',
        slippage: 1.000000000000012,
        priceImpact: 17.6304946168214,
        isULDM: false
      }
    ],
    dstTradeList: [],
    srcTrade: {
      fee: '0',
      toTokenAmountWithoutFee: '11109469892121298429',
      fromTokenAmount: '16490000000000000',
      toTokenAmount: '11109469892121298429',
      deltaAmount: '10998375193200084610',
      tokenFrom: {
        symbol: 'BNB',
        name: 'Binance',
        contractAddress: '0x0000000000000000000000000000000000000000',
        chainId: 56,
        decimals: 18,
        buyTax: 0,
        sellTax: 0
      },
      tokenTo: {
        name: 'Tether USDt',
        symbol: 'USDT',
        decimals: 18,
        contractAddress: '0x55d398326f99059fF775485246999027B3197955',
        priceInUsd: 0.9989685576597374,
        chainId: 56,
        buyTax: 0,
        sellTax: 0
      },
      tradeType: 0,
      protocol: [
        {
          name: 'PancakeSwap V3',
          logo: 'https://icons.llamao.fi/icons/protocols/pancakeswap?w=48&h=48',
          route: [
            '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            '0x55d398326f99059ff775485246999027b3197955'
          ],
          percentage: 100
        }
      ],
      transactionData: {
        info: {
          feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
          feePercent: 0,
          sharePercent: 0,
          srcToken: '0x0000000000000000000000000000000000000000',
          dstToken: '0x55d398326f99059fF775485246999027B3197955',
          deadline: 1734745872,
          slippage: 0.01,
          tokenHasTaxes: false,
          path: [
            '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            '0x55d398326f99059ff775485246999027b3197955'
          ],
          v3Path:
            '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955',
          tradeType: 0,
          amountIn: '16490000000000000',
          amountOutMin: '10912616057635609423',
          actualQuote: '11022844502662231740',
          uuid: 'edge',
          requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
          apiId: '130',
          userPSFee: 0
        },
        call: [
          {
            targetExchange: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
            targetExchangeID: 'pancakev3',
            sellToken: '0x0000000000000000000000000000000000000000',
            buyToken: '0x55d398326f99059fF775485246999027B3197955',
            amountDelta: '10912616057635609423',
            amount: '16490000000000000',
            data:
              '0xb858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e000000000000000000000000000000000000000000000000003a95915058a0000000000000000000000000000000000000000000000000009771667ca5981b4f000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000'
          }
        ],
        version: 'v1'
      },
      nativeValue: '16490000000000000',
      recommendedSlippage: 1,
      contractVersion: 'v1',
      gasPrice: '1000000000',
      slippage: 1.000000000000012,
      priceImpact: 0,
      isULDM: false
    },
    dstTrade: {
      toTokenAmount: '1453964',
      deltaAmount: '1453964',
      tokenTo: {
        name: 'ATOM',
        symbol: 'ATOM',
        decimals: 6,
        contractAddress: '0x0000000000000000000000000000000000000000',
        chainId: -978111860,
        priceInUsd: 6.903272357468867,
        buyTax: 0,
        sellTax: 0
      }
    },
    transactionData: {
      inbound_address: '0xf12f7b4238e85322b1b2362122d333c96851c223',
      outbound_delay_blocks: 0,
      outbound_delay_seconds: 0,
      fees: {
        asset: 'GAIA.ATOM',
        affiliate: '400634',
        outbound: '14456700',
        liquidity: '256700',
        total: '15114034',
        slippage_bps: 15,
        total_bps: 861
      },
      router: '0xb30ec53f98ff5947ede720d32ac2da7e52a5f56b',
      expiry: 1734660373,
      warning:
        'Do not cache this response. Do not send funds after the expiry.',
      notes:
        'Base Asset: Send the inbound_address the asset with the memo encoded in hex in the data field. Tokens: First approve router to spend tokens from user: asset.approve(router, amount). Then call router.depositWithExpiry(inbound_address, asset, amount, memo, expiry). Asset is the token contract address. Amount should be in native asset decimals (eg 1e18 for most tokens). Do not swap to smart contract addresses.',
      recommended_min_amount_in: '8429466836',
      recommended_gas_rate: '1',
      gas_rate_units: 'gwei',
      memo:
        '=:GAIA.ATOM:cosmos1ucnamh638lpgqraetdmcaxk0gz79t4k2akytvf::unizen-utxo:25',
      expected_amount_out: '145396466',
      max_streaming_quantity: 0,
      streaming_swap_blocks: 0,
      amount: '11109469892121298429',
      tradeProtocol: 'CROSS_CHAIN_THORCHAIN',
      version: 'v1',
      params: { uuidPercentage: 0, sharePercent: 0 },
      call: [
        {
          targetExchange: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
          targetExchangeID: 'pancakev3',
          sellToken: '0x0000000000000000000000000000000000000000',
          buyToken: '0x55d398326f99059fF775485246999027B3197955',
          amountDelta: '10912616057635609423',
          amount: '16490000000000000',
          data:
            '0xb858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000880e0ce34f48c0cbc68bf3e745f17175ba8c650e000000000000000000000000000000000000000000000000003a95915058a0000000000000000000000000000000000000000000000000009771667ca5981b4f000000000000000000000000000000000000000000000000000000000000002bbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955000000000000000000000000000000000000000000'
        }
      ],
      info: {
        feeReceiver: '0xD2060890571cBA0440E39126f8A7CC38d09A7ec0',
        feePercent: 0,
        sharePercent: 0,
        srcToken: '0x0000000000000000000000000000000000000000',
        dstToken: '0x55d398326f99059fF775485246999027B3197955',
        deadline: 1734745872,
        slippage: 0.01,
        tokenHasTaxes: false,
        path: [
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          '0x55d398326f99059ff775485246999027b3197955'
        ],
        v3Path:
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00006455d398326f99059ff775485246999027b3197955',
        tradeType: 0,
        amountIn: '16490000000000000',
        amountOutMin: '10912616057635609423',
        actualQuote: '11022844502662231740',
        uuid: 'edge',
        requestId: '97c42831-f799-4eab-96c4-6de2c3f606f4',
        apiId: '130',
        userPSFee: 0,
        memo:
          '=:GAIA.ATOM:cosmos1ucnamh638lpgqraetdmcaxk0gz79t4k2akytvf::unizen-utxo:25',
        vault: '0xf12f7b4238e85322b1b2362122d333c96851c223'
      }
    },
    nativeValue: '0',
    nativeFee: '0',
    tradeProtocol: 'CROSS_CHAIN_THORCHAIN',
    sourceChainId: 56,
    destinationChainId: -978111860,
    contractVersion: 'v1',
    providerInfo: {
      name: 'Thorchain',
      logo: 'https://thorchain.org/images/logos/full-dark.png',
      website: 'https://thorchain.org/',
      docsLink: 'https://thorchain.org/integrate',
      description:
        'THORChain is a network that facilitates native asset settlement between Bitcoin, Ethereum, BNB Chain, Avalanche, Cosmos Hub, Dogecoin, Bitcoin Cash & Litecoin'
    },
    tradeParams: {
      sender: '0x547206fD7cD322bdaF75C1414c81ab2a090586e7',
      receiver: 'cosmos1ucnamh638lpgqraetdmcaxk0gz79t4k2akytvf',
      tokenIn: '0x55d398326f99059ff775485246999027b3197955',
      tokenOut: '0x0000000000000000000000000000000000000000',
      amount: '11109469892121298429',
      srcChainId: 56,
      dstChainId: -978111860,
      inNative: true,
      outNative: true,
      deadline: 1734660373,
      tokenInfo: [
        {
          name: 'USDT',
          symbol: 'USDT',
          decimals: 18,
          contractAddress: '0x55d398326f99059ff775485246999027b3197955',
          chainId: 56,
          buyTax: 0,
          sellTax: 0
        },
        {
          name: 'ATOM',
          symbol: 'ATOM',
          decimals: 6,
          contractAddress: '0x0000000000000000000000000000000000000000',
          chainId: -978111860,
          priceInUsd: 6.903272357468867,
          buyTax: 0,
          sellTax: 0
        }
      ]
    }
  }
]
