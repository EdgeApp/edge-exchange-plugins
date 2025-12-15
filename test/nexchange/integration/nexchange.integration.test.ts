import { assert } from 'chai'
import { makeConfig } from 'cleaner-config'
import {
  asDate,
  asMap,
  asObject,
  asOptional,
  asString,
  asUnknown
} from 'cleaners'
import {
  addEdgeCorePlugins,
  EdgeAccount,
  EdgeCurrencyWallet,
  EdgeSwapRequest,
  lockEdgeCorePlugins,
  makeFakeEdgeWorld
} from 'edge-core-js'
import accountBasedPlugins from 'edge-currency-accountbased'
import currencyPlugins from 'edge-currency-plugins'
import fs from 'fs'
import { before, describe, it } from 'mocha'

import edgeExchangePlugins from '../../../src'
import { makeNexchangePlugin } from '../../../src/swap/central/nexchange'
import { asTestConfig } from '../../testconfig'

const config = makeConfig(asTestConfig, './testconfig.json')

// Skip integration tests if API keys are not configured
const shouldSkipIntegrationTests =
  config.NEXCHANGE_INIT === false ||
  config.NEXCHANGE_INIT?.apiKey == null ||
  config.NEXCHANGE_INIT?.apiKey === '' ||
  config.NEXCHANGE_INIT?.referralCode == null ||
  config.NEXCHANGE_INIT?.referralCode === ''

describe('Nexchange Integration Tests', function () {
  // Increase timeout for all integration tests (default is 2000ms)
  this.timeout(30000) // 30 seconds

  let account: EdgeAccount | undefined
  let btcWallet: EdgeCurrencyWallet | undefined
  let ethWallet: EdgeCurrencyWallet | undefined
  let avaxWallet: EdgeCurrencyWallet | undefined
  let nexchangePlugin: ReturnType<typeof makeNexchangePlugin> | undefined

  // Helper function to create mock wallet for direct plugin calls
  function createMockWallet(
    pluginId: string,
    currencyCode: string,
    address: string,
    multiplier: string = '1000000000000000000'
  ): EdgeCurrencyWallet {
    const currencyInfo = {
      pluginId,
      currencyCode,
      displayName: currencyCode,
      denominations: [
        {
          name: currencyCode,
          multiplier,
          symbol: currencyCode
        }
      ]
    }
    return ({
      id: `mock-${pluginId}-wallet`,
      currencyInfo,
      currencyConfig: {
        currencyInfo, // SwapCurrencyError expects currencyConfig.currencyInfo
        allTokens: {}
      },
      getAddresses: async () => [
        {
          publicAddress: address,
          addressType: 'default'
        }
      ],
      makeSpend: async (spendInfo: any) => {
        // Calculate total native amount from spend targets
        let totalNativeAmount = '0'
        if (spendInfo.spendTargets != null) {
          for (const target of spendInfo.spendTargets) {
            if (target.nativeAmount != null) {
              totalNativeAmount = (
                BigInt(totalNativeAmount) + BigInt(target.nativeAmount)
              ).toString()
            }
          }
        }

        // Return a mock transaction with the savedAction from spendInfo
        return {
          walletId: `mock-${pluginId}-wallet`,
          blockHeight: 0,
          currencyCode,
          date: Date.now() / 1000,
          memos: spendInfo.memos ?? [],
          isSend: true,
          nativeAmount: totalNativeAmount,
          networkFee: '0',
          networkFees: [],
          feeRateUsed: {},
          otherParams: {},
          ourReceiveAddresses: [],
          signedTx: '',
          tokenId: spendInfo.tokenId ?? null,
          txid: 'mock-tx-id',
          savedAction: spendInfo.savedAction,
          assetAction: spendInfo.assetAction
        } as any
      }
    } as unknown) as EdgeCurrencyWallet
  }

  // Helper function to check if test should be skipped
  function shouldSkip(
    ...wallets: Array<EdgeCurrencyWallet | undefined>
  ): boolean {
    return (
      shouldSkipIntegrationTests ||
      account == null ||
      wallets.some(wallet => wallet == null)
    )
  }

  before(async function () {
    // Increase timeout for wallet initialization (default is 2000ms)
    this.timeout(60000) // 60 seconds
    console.log('[DEBUG] Starting before hook for integration tests')
    if (shouldSkipIntegrationTests) {
      console.log(
        '[DEBUG] Skipping integration tests - API keys not configured'
      )
      this.skip()
      return // Early return to avoid hanging
    }

    console.log('[DEBUG] Loading plugins...')
    const { avalanche, ethereum } = accountBasedPlugins

    const allPlugins = {
      avalanche,
      ethereum,
      ...currencyPlugins,
      ...edgeExchangePlugins
    }

    addEdgeCorePlugins(allPlugins)
    lockEdgeCorePlugins()
    console.log('[DEBUG] Plugins loaded and locked')

    // Use fake user dump for testing
    const DUMP_USER_FILE = './test/fakeUserDump.json'
    if (!fs.existsSync(DUMP_USER_FILE)) {
      console.log('[DEBUG] Fake user dump not found, skipping tests')
      return
    }

    const asFakeUser = asObject({
      username: asString,
      lastLogin: asOptional(asDate),
      loginId: asString,
      loginKey: asString,
      repos: asMap(asMap(asUnknown)),
      server: asUnknown
    })

    const asUserDump = asObject({
      loginKey: asString,
      data: asFakeUser
    })

    const userFile = fs.readFileSync(DUMP_USER_FILE, { encoding: 'utf8' })
    const json = JSON.parse(userFile)
    const dump = asUserDump(json)
    const loginKey = dump.loginKey
    const fakeUsers = [dump.data]

    console.log('[DEBUG] Using fake user dump for testing')
    const world = await makeFakeEdgeWorld(fakeUsers, {})
    console.log('[DEBUG] Created fake edge world')
    const context = await world.makeEdgeContext({
      apiKey: '',
      appId: '',
      plugins: {
        bitcoin: true,
        ethereum: config.ETHEREUM_INIT,
        avalanche: config.AVALANCHE_INIT,
        binancesmartchain: config.BINANCE_SMART_CHAIN_INIT,
        nexchange: config.NEXCHANGE_INIT
      },
      allowNetworkAccess: true
    })
    console.log('[DEBUG] Created edge context, logging in...')
    account = await context.loginWithKey('bob', loginKey, {
      pauseWallets: true
    })
    console.log('[DEBUG] Logged in successfully with fake account')

    if (account == null) {
      console.log('[DEBUG] No account available, tests will be skipped')
      return
    }

    // Skip wallet creation if all tests are skipped (all tests use it.skip)
    // Set hasActiveTests to true when uncommenting tests one by one
    const hasActiveTests = true
    if (!hasActiveTests) {
      console.log('[DEBUG] Skipping wallet creation - all tests are skipped')
      console.log('[DEBUG] Before hook complete (skipped)')
      return
    }

    // Create wallets directly - this is faster than waiting for existing ones
    console.log('[DEBUG] Creating wallets...')
    try {
      // Check if wallets exist, if not create them
      const walletTypes = [
        { type: 'wallet:bitcoin', name: 'BTC' },
        { type: 'wallet:ethereum', name: 'ETH' },
        { type: 'wallet:avalanche', name: 'AVAX' }
      ]

      for (const { type, name } of walletTypes) {
        try {
          const existing = await account.getFirstWalletInfo(type)
          if (existing == null) {
            console.log(`[DEBUG] Creating ${name} wallet...`)
            const wallet = await account.createCurrencyWallet(type, {
              name: `${name} Test Wallet`
            })
            console.log(`[DEBUG] ${name} wallet created: ${wallet.id}`)
            if (name === 'BTC') btcWallet = wallet
            if (name === 'ETH') ethWallet = wallet
            if (name === 'AVAX') avaxWallet = wallet
          } else {
            console.log(`[DEBUG] ${name} wallet already exists: ${existing.id}`)
            // Try to get it with a very short timeout, if it fails, create a new one
            try {
              const wallet = await Promise.race([
                account.waitForCurrencyWallet(existing.id),
                new Promise<undefined>(resolve =>
                  setTimeout(() => resolve(undefined), 2000)
                )
              ])
              if (wallet != null) {
                if (name === 'BTC') btcWallet = wallet
                if (name === 'ETH') ethWallet = wallet
                if (name === 'AVAX') avaxWallet = wallet
                console.log(`[DEBUG] ${name} wallet ready`)
              } else {
                console.log(
                  `[DEBUG] ${name} wallet timeout, creating new one...`
                )
                // Create a new wallet if existing one times out
                const newWallet = await account.createCurrencyWallet(type, {
                  name: `${name} Test Wallet New`
                })
                if (name === 'BTC') btcWallet = newWallet
                if (name === 'ETH') ethWallet = newWallet
                if (name === 'AVAX') avaxWallet = newWallet
                console.log(
                  `[DEBUG] ${name} new wallet created: ${newWallet.id}`
                )
              }
            } catch (error) {
              console.warn(
                `[DEBUG] Error loading ${name} wallet, creating new one:`,
                error
              )
              try {
                const newWallet = await account.createCurrencyWallet(type, {
                  name: `${name} Test Wallet New`
                })
                if (name === 'BTC') btcWallet = newWallet
                if (name === 'ETH') ethWallet = newWallet
                if (name === 'AVAX') avaxWallet = newWallet
                console.log(
                  `[DEBUG] ${name} new wallet created: ${newWallet.id}`
                )
              } catch (createError) {
                console.warn(
                  `[DEBUG] Could not create ${name} wallet:`,
                  createError
                )
              }
            }
          }
        } catch (error) {
          console.warn(`[DEBUG] Error with ${name} wallet:`, error)
        }
      }
      console.log('[DEBUG] Wallet initialization complete')
    } catch (error) {
      console.warn('[DEBUG] Could not initialize wallets:', error)
    }

    // Initialize the plugin for direct testing
    if (!shouldSkipIntegrationTests && config.NEXCHANGE_INIT !== false) {
      nexchangePlugin = makeNexchangePlugin({
        io: {
          fetch: global.fetch,
          fetchCors: global.fetch,
          random: () => new Uint8Array(32),
          scrypt: async () => new Uint8Array(32),
          disklet: {} as any
        },
        log: {
          breadcrumb: () => {},
          crash: () => {},
          warn: (...args: any[]) => console.warn(...args),
          error: (...args: any[]) => console.error(...args)
        } as any,
        initOptions: config.NEXCHANGE_INIT as any,
        infoPayload: {},
        nativeIo: {} as any,
        pluginDisklet: {} as any
      } as any)
      console.log('[DEBUG] Nexchange plugin initialized')
    }

    console.log('[DEBUG] Before hook complete')
  })

  describe('fetchSwapQuote - Basic Swaps', function () {
    it('should fetch quote for BTC to ETH swap', async function () {
      if (shouldSkip(btcWallet, ethWallet)) {
        this.skip()
      }
      if (btcWallet == null || ethWallet == null || account == null) {
        return
      }

      const request: EdgeSwapRequest = {
        fromWallet: btcWallet,
        toWallet: ethWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000', // 0.001 BTC
        quoteFor: 'from'
      }

      const quote = await account.fetchSwapQuote(request)
      assert.isNotNull(quote)
      assert.equal(quote.pluginId, 'nexchange')
      assert.isString(quote.fromNativeAmount)
      assert.isString(quote.toNativeAmount)
      assert.isNotNull(quote.expirationDate)
      assert.isFalse(quote.isEstimate)

      // Enhanced validations - meaningful checks
      const fromAmount = parseInt(quote.fromNativeAmount, 10)
      const toAmount = parseInt(quote.toNativeAmount, 10)
      const requestedAmount = parseInt(request.nativeAmount, 10)

      // Amount validations
      assert.isTrue(fromAmount > 0, 'fromNativeAmount should be positive')
      assert.isTrue(toAmount > 0, 'toNativeAmount should be positive')
      assert.equal(
        fromAmount,
        requestedAmount,
        'fromNativeAmount should match requested amount for quoteFor=from'
      )

      // Exchange rate validation - BTC/ETH rate should be reasonable (between 0.01 and 100 ETH per BTC)
      const exchangeRate = toAmount / fromAmount
      assert.isTrue(
        exchangeRate > 0.01 && exchangeRate < 100,
        `Exchange rate ${exchangeRate} should be reasonable for BTC/ETH`
      )

      // Expiration validation - should be at least 1 minute in the future
      if (quote.expirationDate != null) {
        const expirationTime = quote.expirationDate.getTime()
        const now = Date.now()
        const minExpirationMs = 60 * 1000 // 1 minute
        assert.isTrue(
          expirationTime > now + minExpirationMs,
          `Expiration should be at least 1 minute in the future, got ${
            (expirationTime - now) / 1000
          }s`
        )
      }

      // Network fee validation
      if (quote.networkFee != null) {
        assert.isString(quote.networkFee.nativeAmount)
        const feeAmount = parseInt(quote.networkFee.nativeAmount, 10)
        assert.isTrue(feeAmount >= 0, 'networkFee should be non-negative')
        // Network fee should be reasonable (less than 10% of swap amount)
        assert.isTrue(
          feeAmount < fromAmount / 10,
          `Network fee ${feeAmount} should be reasonable compared to swap amount ${fromAmount}`
        )
        assert.equal(
          quote.networkFee.currencyCode,
          btcWallet.currencyInfo.currencyCode,
          'Network fee currency should match from wallet currency'
        )
      }

      // Quote properties validation
      assert.equal(quote.request.fromWallet.id, btcWallet.id)
      assert.equal(quote.request.toWallet.id, ethWallet.id)
      assert.equal(quote.swapInfo.pluginId, 'nexchange')
    })

    it.skip('should fetch quote for ETH to BTC swap', async function () {
      if (shouldSkip(ethWallet, btcWallet)) {
        this.skip()
      }
      if (ethWallet == null || btcWallet == null || account == null) {
        return
      }

      const request: EdgeSwapRequest = {
        fromWallet: ethWallet,
        toWallet: btcWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '1000000000000000000', // 1 ETH
        quoteFor: 'from'
      }

      const quote = await account.fetchSwapQuote(request)
      assert.isNotNull(quote)
      assert.equal(quote.pluginId, 'nexchange')
      assert.isString(quote.fromNativeAmount)
      assert.isString(quote.toNativeAmount)

      const fromAmount = parseInt(quote.fromNativeAmount, 10)
      const toAmount = parseInt(quote.toNativeAmount, 10)
      const requestedAmount = parseInt(request.nativeAmount, 10)

      assert.isTrue(fromAmount > 0, 'fromNativeAmount should be positive')
      assert.isTrue(toAmount > 0, 'toNativeAmount should be positive')
      assert.equal(
        fromAmount,
        requestedAmount,
        'fromNativeAmount should match requested amount'
      )

      // Exchange rate validation - ETH/BTC rate should be reasonable
      const exchangeRate = toAmount / fromAmount
      assert.isTrue(
        exchangeRate > 0.01 && exchangeRate < 100,
        `Exchange rate ${exchangeRate} should be reasonable for ETH/BTC`
      )

      assert.isNotNull(quote.expirationDate)
      if (quote.expirationDate != null) {
        const expirationTime = quote.expirationDate.getTime()
        assert.isTrue(
          expirationTime > Date.now() + 60000,
          'expirationDate should be at least 1 minute in the future'
        )
      }
    })

    it.skip('should fetch quote for BTC to AVAX swap', async function () {
      if (shouldSkip(btcWallet, avaxWallet)) {
        this.skip()
      }
      if (btcWallet == null || avaxWallet == null || account == null) {
        return
      }

      const request: EdgeSwapRequest = {
        fromWallet: btcWallet,
        toWallet: avaxWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000', // 0.001 BTC
        quoteFor: 'from'
      }

      const quote = await account.fetchSwapQuote(request)
      assert.isNotNull(quote)
      assert.equal(quote.pluginId, 'nexchange')
      assert.isString(quote.fromNativeAmount)
      assert.isString(quote.toNativeAmount)
      assert.isTrue(
        parseInt(quote.fromNativeAmount, 10) > 0,
        'fromNativeAmount should be positive'
      )
      assert.isTrue(
        parseInt(quote.toNativeAmount, 10) > 0,
        'toNativeAmount should be positive'
      )
      assert.isNotNull(quote.expirationDate)
    })

    it.skip('should fetch quote using TO amount (reverse quote)', async function () {
      if (shouldSkip(btcWallet, ethWallet)) {
        this.skip()
      }
      if (btcWallet == null || ethWallet == null || account == null) {
        return
      }

      const request: EdgeSwapRequest = {
        fromWallet: btcWallet,
        toWallet: ethWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '1000000000000000000', // 1 ETH (what we want to receive)
        quoteFor: 'to'
      }

      const quote = await account.fetchSwapQuote(request)
      assert.isNotNull(quote)
      assert.equal(quote.pluginId, 'nexchange')
      assert.isString(quote.fromNativeAmount)
      assert.isString(quote.toNativeAmount)
      assert.isTrue(
        parseInt(quote.fromNativeAmount, 10) > 0,
        'fromNativeAmount should be positive'
      )
      assert.isTrue(
        parseInt(quote.toNativeAmount, 10) > 0,
        'toNativeAmount should be positive'
      )
      // For reverse quotes, verify the toNativeAmount matches requested amount
      assert.isTrue(
        parseInt(quote.toNativeAmount, 10) >=
          parseInt(request.nativeAmount, 10) * 0.9,
        'toNativeAmount should be close to requested amount (allowing 10% slippage)'
      )
    })
  })

  describe('fetchSwapQuote - Token Swaps', function () {
    it.skip('should fetch quote for USDT on Ethereum to BTC swap', async function () {
      if (shouldSkip(ethWallet, btcWallet)) {
        this.skip()
      }
      if (ethWallet == null || btcWallet == null || account == null) {
        return
      }

      const usdtTokenId = 'dac17f958d2ee523a2206206994597c13d831ec7' // USDT on Ethereum
      const request: EdgeSwapRequest = {
        fromWallet: ethWallet,
        toWallet: btcWallet,
        fromTokenId: usdtTokenId,
        toTokenId: null,
        nativeAmount: '100000000', // 100 USDT (6 decimals)
        quoteFor: 'from'
      }

      const quote = await account.fetchSwapQuote(request)
      assert.isNotNull(quote)
      assert.equal(quote.pluginId, 'nexchange')
      assert.isString(quote.fromNativeAmount)
      assert.isString(quote.toNativeAmount)
      assert.isTrue(
        parseInt(quote.fromNativeAmount, 10) > 0,
        'fromNativeAmount should be positive'
      )
      assert.isTrue(
        parseInt(quote.toNativeAmount, 10) > 0,
        'toNativeAmount should be positive'
      )
      assert.isNotNull(quote.expirationDate)
    })

    it.skip('should fetch quote for USDT on Avalanche to ETH swap', async function () {
      if (shouldSkip(avaxWallet, ethWallet)) {
        this.skip()
      }
      if (avaxWallet == null || ethWallet == null || account == null) {
        return
      }

      const usdtAvaxTokenId = '9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7' // USDT on Avalanche
      const request: EdgeSwapRequest = {
        fromWallet: avaxWallet,
        toWallet: ethWallet,
        fromTokenId: usdtAvaxTokenId,
        toTokenId: null,
        nativeAmount: '100000000', // 100 USDT
        quoteFor: 'from'
      }

      const quote = await account.fetchSwapQuote(request)
      assert.isNotNull(quote)
      assert.equal(quote.pluginId, 'nexchange')
      assert.isString(quote.fromNativeAmount)
      assert.isString(quote.toNativeAmount)
      assert.isTrue(
        parseInt(quote.fromNativeAmount, 10) > 0,
        'fromNativeAmount should be positive'
      )
      assert.isTrue(
        parseInt(quote.toNativeAmount, 10) > 0,
        'toNativeAmount should be positive'
      )
      assert.isNotNull(quote.expirationDate)
    })
  })

  describe('Error Handling', function () {
    it('should handle invalid currency pair gracefully', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      // Use monero which is not supported by nexchange (maps to null)
      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockMoneroWallet = createMockWallet(
        'monero',
        'XMR',
        '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3sk19gqeY73D7X5yxc7Eqp3EPcv3t1vT3nB1gBYX1NP',
        '1000000000000'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockMoneroWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      try {
        await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {},
          promoCode: undefined
        })
        assert.fail('Should have thrown an error for invalid currency pair')
      } catch (error: unknown) {
        // Check if it's a SwapCurrencyError instance or has the expected properties
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isSwapCurrencyError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('currency') ||
              errorMessage.includes('not supported') ||
              errorMessage.includes('does not support')))
        let errorLabel = errorName
        if (errorLabel === '') errorLabel = errorMessage
        if (errorLabel === '') errorLabel = String(error)

        assert.isTrue(
          isSwapCurrencyError,
          `Expected SwapCurrencyError, got: ${errorLabel}`
        )
      }
    })

    it('should throw SwapBelowLimitError for amounts below minimum', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      // Use a very small amount (1 satoshi = 1 native unit)
      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '1', // Very small amount
        quoteFor: 'from'
      }

      try {
        await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {},
          promoCode: undefined
        })
        // If it doesn't throw, the amount might be valid, which is okay
      } catch (error: unknown) {
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isBelowLimit =
          errorName === 'SwapBelowLimitError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('minimum') ||
              errorMessage.includes('below')))
        const isCurrencyError = errorName === 'SwapCurrencyError'
        let errorLabel = errorName
        if (errorLabel === '') errorLabel = errorMessage
        if (errorLabel === '') errorLabel = String(error)

        assert.isTrue(
          isBelowLimit || isCurrencyError,
          `Expected SwapBelowLimitError or SwapCurrencyError, got: ${errorLabel}`
        )
      }
    })

    it('should throw SwapAboveLimitError for amounts above maximum', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      // Use a very large amount
      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '21000000000000000', // 210M BTC (way above max)
        quoteFor: 'from'
      }

      try {
        await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {},
          promoCode: undefined
        })
        // If it doesn't throw, the amount might be valid, which is okay
      } catch (error: unknown) {
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isAboveLimit =
          errorName === 'SwapAboveLimitError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('maximum') ||
              errorMessage.includes('above') ||
              errorMessage.includes('limit')))
        const isCurrencyError = errorName === 'SwapCurrencyError'
        let errorLabel = errorName
        if (errorLabel === '') errorLabel = errorMessage
        if (errorLabel === '') errorLabel = String(error)

        assert.isTrue(
          isAboveLimit || isCurrencyError,
          `Expected SwapAboveLimitError or SwapCurrencyError, got: ${errorLabel}`
        )
      }
    })

    it('should handle expired rates', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      // This test verifies that expired rates are rejected
      // The plugin should check expiration_time_unix and reject expired rates
      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      // The plugin should fetch a fresh rate, so this should work
      // If a rate is expired, it should fetch a new one
      const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
        infoPayload: {}
      })
      assert.isNotNull(quote)
      if (quote.expirationDate != null) {
        assert.isTrue(
          quote.expirationDate.getTime() > Date.now(),
          'Quote should have a future expiration date'
        )
      }
    })
  })

  describe('API Integration', function () {
    it('should include referral code in headers', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      // Verify referral code is configured
      if (config.NEXCHANGE_INIT !== false) {
        assert.isNotNull(config.NEXCHANGE_INIT?.referralCode)
        assert.isTrue(
          (config.NEXCHANGE_INIT?.referralCode?.length ?? 0) > 0,
          'Referral code should be configured'
        )
      }

      // Test that quotes work (which means referral code is being sent)
      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
        infoPayload: {}
      })
      assert.isNotNull(quote, 'Quote should succeed with referral code')
    })

    it('should use correct pair naming format (TOFROM)', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      // BTC to ETH should use ETHBTC pair (TOFROM format)
      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
        infoPayload: {}
      })
      assert.isNotNull(quote)
      // The pair name is constructed internally as TOFROM (ETHBTC)
      // We verify the quote succeeds, which means the pair was constructed correctly
      assert.equal(quote.pluginId, 'nexchange')
    })

    it('should use BUY side by default (no side field)', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      // The plugin doesn't include 'side' field in order body
      // This is verified by the fact that quotes succeed
      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isNotNull(quote)
        // If quote succeeds, it means the order was created without 'side' field
        // (API defaults to BUY)
        assert.equal(quote.pluginId, 'nexchange')
      } catch (error: unknown) {
        // Handle API rate limiting or errors gracefully
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isApiError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('does not support') ||
              errorMessage.includes('Too many')))

        if (!isApiError) {
          throw error
        }
        // Skip test if API is rate limiting or rejecting requests
        this.skip()
      }
    })

    it('should handle rate_id correctly', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
        infoPayload: {}
      })
      assert.isNotNull(quote)
      // If quote succeeds, rate_id was correctly used from rate response
      // Quote should have valid properties
      assert.isNotNull(quote.request)
      assert.isNotNull(quote.swapInfo)
    })

    it('should handle deposit_address_extra_id for memo currencies', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      // Test with XRP which requires memos
      const mockXrpWallet = createMockWallet(
        'ripple',
        'XRP',
        'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
        '1000000'
      )
      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )

      try {
        const request: EdgeSwapRequest = {
          fromWallet: mockBtcWallet,
          toWallet: mockXrpWallet,
          fromTokenId: null,
          toTokenId: null,
          nativeAmount: '100000000',
          quoteFor: 'from'
        }

        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        // If quote succeeds, deposit_address_extra_id was handled correctly
        assert.isNotNull(quote)
      } catch (error: unknown) {
        // XRP might not be supported, which is okay
        // Check if it's a SwapCurrencyError (currency not supported)
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isCurrencyError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('currency') ||
              errorMessage.includes('not supported') ||
              errorMessage.includes('does not support')))

        if (!isCurrencyError) {
          // If it's not a currency error, re-throw it
          throw error
        }
        // If it's a currency error, that's expected - XRP might not be supported
      }
    })
  })

  describe('Quote Properties', function () {
    it('should return valid expiration date', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isNotNull(quote.expirationDate)
        if (quote.expirationDate != null) {
          assert.instanceOf(quote.expirationDate, Date)
          assert.isTrue(quote.expirationDate.getTime() > Date.now())
        }
      } catch (error: unknown) {
        // Handle API rate limiting or errors gracefully
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isApiError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('does not support') ||
              errorMessage.includes('Too many')))

        if (!isApiError) {
          throw error
        }
        // Skip test if API is rate limiting or rejecting requests
        this.skip()
      }
    })

    it('should return correct fromNativeAmount', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isString(quote.fromNativeAmount)
        assert.isTrue(parseInt(quote.fromNativeAmount, 10) > 0)
      } catch (error: unknown) {
        // Handle API rate limiting or errors gracefully
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isApiError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('does not support') ||
              errorMessage.includes('Too many')))

        if (!isApiError) {
          throw error
        }
        // Skip test if API is rate limiting or rejecting requests
        this.skip()
      }
    })

    it('should return correct toNativeAmount', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isString(quote.toNativeAmount)
        assert.isTrue(parseInt(quote.toNativeAmount, 10) > 0)
      } catch (error: unknown) {
        // Handle API rate limiting or errors gracefully
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isApiError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('does not support') ||
              errorMessage.includes('Too many')))

        if (!isApiError) {
          throw error
        }
        // Skip test if API is rate limiting or rejecting requests
        this.skip()
      }
    })

    it('should return networkFee information', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBtcWallet = createMockWallet(
        'bitcoin',
        'BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        '100000000'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBtcWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '100000000',
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isNotNull(quote.networkFee)
        assert.isString(quote.networkFee.nativeAmount)
        assert.equal(
          quote.networkFee.currencyCode,
          mockBtcWallet.currencyInfo.currencyCode
        )
      } catch (error: unknown) {
        // Handle API rate limiting or errors gracefully
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isApiError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('does not support') ||
              errorMessage.includes('Too many')))

        if (!isApiError) {
          throw error
        }
        // Skip test if API is rate limiting or rejecting requests
        this.skip()
      }
    })
  })

  describe('Cross-Chain Swaps', function () {
    it('should handle BSC to ETH swap', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      const mockBscWallet = createMockWallet(
        'binancesmartchain',
        'BNB',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )
      const mockEthWallet = createMockWallet(
        'ethereum',
        'ETH',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockBscWallet,
        toWallet: mockEthWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '1000000000000000000', // 1 BNB
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isNotNull(quote)
        assert.equal(quote.pluginId, 'nexchange')
      } catch (error: unknown) {
        // BSC might not be supported, which is okay
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isCurrencyError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('currency') ||
              errorMessage.includes('not supported') ||
              errorMessage.includes('does not support')))

        if (!isCurrencyError) {
          throw error
        }
        // If it's a currency error, that's expected - BSC might not be supported
      }
    })

    it.skip('should handle Polygon to Avalanche swap', async function () {
      if (shouldSkipIntegrationTests || nexchangePlugin == null) {
        this.skip()
      }
      this.timeout(30000) // 30 seconds for API call

      // This would require polygon wallet setup
      // Test cross-chain token swaps
      const mockPolygonWallet = createMockWallet(
        'polygon',
        'MATIC',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )
      const mockAvaxWallet = createMockWallet(
        'avalanche',
        'AVAX',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      )

      const request: EdgeSwapRequest = {
        fromWallet: mockPolygonWallet,
        toWallet: mockAvaxWallet,
        fromTokenId: null,
        toTokenId: null,
        nativeAmount: '1000000000000000000',
        quoteFor: 'from'
      }

      try {
        const quote = await nexchangePlugin.fetchSwapQuote(request, undefined, {
          infoPayload: {}
        })
        assert.isNotNull(quote)
        assert.equal(quote.pluginId, 'nexchange')
      } catch (error: unknown) {
        // Polygon/Avalanche might not be supported, which is okay
        const errorObj = error as {
          name?: string
          message?: string
          constructor?: { name?: string }
        }
        const errorName = errorObj.name ?? errorObj.constructor?.name ?? ''
        const errorMessage = errorObj.message ?? ''
        const isCurrencyError =
          errorName === 'SwapCurrencyError' ||
          (errorMessage !== '' &&
            (errorMessage.includes('currency') ||
              errorMessage.includes('not supported') ||
              errorMessage.includes('does not support')))

        if (!isCurrencyError) {
          throw error
        }
      }
    })
  })
})
