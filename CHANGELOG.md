# edge-exchange-plugins

## Unreleased

- added: Fantom/Sonic Upgrade: throw `SwapAddressError` when from/to wallet addresses differ so the GUI can auto-select or split a FTM wallet

## 2.31.0 (2025-08-04)

- changed: Configure ESBuild to assume es2015 support
- changed: Require the environment to support es2015 & `async` functions.

## 2.30.0 (2025-08-01)

- added: (Changenow/LetsExchange/Sideshift) Sonic support

## 2.29.1 (2025-07-28)

- fixed: Remove HyperEVM mapping to HYPE on HyperLiquid on Exolix.

## 2.29.0 (2025-07-21)

- added: Support for hyperevm to ChangeHero, Exolix, LetsExchange.
- added: Support for hyperevm to Li.FI.
- fixed: Fixed support for Metis on LI.FI.

## 2.28.0 (2025-07-17)

- changed: Remove Thorchain minimum amounts from the thrown `SwapBelowLimit` errors

## 2.27.0 (2025-07-04)

- changed: Enforce Thorchain dust thresholds
- fixed: Fix incorrect error messages (generic `Error` or `SwapCurrencyError`) for cases that should be `SwapBelowLimitError`

## 2.26.0 (2025-06-16)

- changed: Use `pendingTxs` in muli-tx swaps which require a `preTx` for approval transactions.

## 2.25.2 (2025-06-09)

- changed: (Thorchain/Maya) Ignore recommended EVM gas price

## 2.25.1 (2025-06-06)

- changed: Label Fantom/Sonic Upgrade plugin as a DEX

## 2.25.0 (2025-06-02)

- added: Add eCash (XEC) support to ChangeNow, ChangeHero, Exolix, Godex, LetsExchange, SideShift, and SwapUz centralized exchanges

## 2.24.0 (2025-05-26)

- added: Add Fantom to Sonic bridge plugin
- changed: Use high network fee setting if recommended fee isn't provided

## 2.23.1 (2025-05-21)

- changed: Thorchain - Add XRP support
- fixed: Thorchain - Support TCY swaps

## 2.23.0 (2025-05-13)

- added: `orderUri` for rango to display all orders for the wallet address

## 2.22.1 (2025-04-28)

- added: Add ZANO network code to available centralized exchanges

## 2.21.1 (2025-04-25)

- fixed: 0 amount in pending transactions from LI.FI swaps from tokens

## 2.21.0 (2025-04-16)

- added: Add PIVX support to ChangeNow, Exolix, Godex, and LetsExchange centralized exchanges
- changed: Upgrade to v2 API for 0x Gasless swaps

## 2.20.0 (2025-04-14)

- changed: Use recommended gas rate for thorchain/maya swaps

## 2.19.0 (2025-02-28)

- changed: Dex `orderUris` no longer include hard-coded `txIds`, and instead include a '{{TXID}}' tag to be replaced by the caller

## 2.18.2 (2025-02-28)

- fixed: (SwapKit) Fix EVM memo handling

## 2.18.1 (2025-02-24)

- fixed: (Thorchain) Use `depositWithExpiry` function for every EVM swap

## 2.18.0 (2025-02-14)

- added: Added Base network support to Thorchain plugin.
- added: Added orderUri to 0xGasless plugin EdgeTxAction metadata.
- changed: Use `depositWithExpiry` contract call for EVM swaps on Thorchain
- fixed: Fixed 0xGasless plugin orderId.

## 2.17.2 (2025-02-10)

- fixed: (SwapKit) UTXO swap memo handling

## 2.17.1 (2025-01-27)

- changed: (Exolix) Use S-address for Digibyte swaps

## 2.17.0 (2025-01-13)

- added: Add Unizen DEX
- added: Add SUI unique IDs
- changed: Upgrade Swapkit to v2 API

## 2.16.1 (2025-01-09)

- changed: (SwapKit) Use `data` provided by quote endpoint instead of encoding it locally
- fixed: Incorrect date timestamp for 0xGasless transactions.
- fixed: Rango amount metadata

## 2.16.0 (2024-12-16)

- added: (Rango) Add Solana support
- added: (Lifi) Add RSK
- added: (SwapKit) Add Binance Smart Chain

## 2.15.1 (2024-12-04)

- changed: Prevent Polygon USDC/USDC.e trading on CEX partners that don't support contract addresses

## 2.15.0 (2024-12-02)

- added: (Exolix) Support Zcash buys
- changed: Add dynamic whitelisting to changehero, changenow, letsexchange, and sideshift plugins
- changed: Upgrade edge-core-js

## 2.14.0 (2024-11-11)

- changed: Rename Thorchain DEX Aggregator to SwapKit

## 2.13.0 (2024-10-31)

- added: Add TON unique IDs to swap partners

## 2.12.0 (2024-10-09)

- changed: Use new info server variable for thornode server urls with chain name included
- fixed: Use unique info server cache for each Thorchain-based plugin

## 2.11.0 (2024-10-08)

- added: 0xGasless swap fee

## 2.10.0 (2024-10-04)

- added: (LI.FI) Added unique parent contract addresses
- fixed: Division precision for Thorchain `toExchangeAmount`

## 2.8.1 (2024-10-02)

- fixed: POL currency code transcriptions for `letsexchange` and `changenow`

## 2.9.1 (2024-09-30)

- fixed: POL currency code transcriptions for `letsexchange` and `changenow`

## 2.9.0 (2024-09-27)

- added: Add Maya Protocol
- changed: Separate thorchain and thorchainda initOptions and exchangeInfo cleaner

## 2.8.0 (2024-09-12)

- added: `minReceiveAmount` passed in `EdgeSwapQuotes` for lifi and rango

## 2.7.5 (2024-08-12)

- fixed: Implemented max quotes for 0xGasless swap plugin

## 2.7.4 (2024-08-01)

- fixed: Thorchain swap error caused by failing cleaner

## 2.7.3 (2024-07-23)

- changed: Cap Exolix to 70k USD swaps

## 2.7.2 (2024-07-21)

- fixed: Set avoidNativeFee on Rango to fix bridge failures

## 2.7.1 (2024-07-18)

- fixed: Rango failed transactions

## 2.7.0 (2024-07-08)

- added: 0x Gasless Swap plugin

## 2.6.1 (2024-07-18)

- fixed: Rango failed transactions

## 2.6.0 (2024-06-24)

- added: (Lifi) Add Solana
- added: Rango Exchange DEX aggregator
- changed: Return txid as orderId for DEX swaps when calling `approve()`

## 2.5.0

- changed: Standardize DEX quotes to 5% slippage and estimate quote

## 2.4.3 (2024-06-03)

- added: (Exolix) Add Piratechain

## 2.4.2 (2024-04-22)

- added: (Velodrome) Check both v1 and v2 routers for best swap

## 2.4.1 (2024-04-18)

- added: Special case Ripple and Stellar memo types

## 2.4.0 (2024-04-05)

- added: Login info to testconfig for testpartners.ts
- changed: Change Lifi and Thorchain DA to use variable quotes
- fixed: Memo handling by DEX plugins
- fixed: Letsexchange orderUri

## 2.3.1 (2024-03-29)

- fixed: Use proper `EdgeMemo` API on `EdgeSpendInfo`

## 2.3.0 (2023-03-25)

- added: Support Cardano (ADA)

## 2.2.2 (2023-03-01)

- changed: (Cosmos IBC) Limit swaps to like-kind assets

## 2.2.1 (2023-02-28)

- changed: (Cosmos IBC) Validate send/receive address

## 2.2.0 (2023-02-27)

- added: Cosmos IBC transfer plugin

## 2.1.1 (2023-02-27)

- added: (Swapuz) Above limit response handling
- added: (ChangeNow) AVAX special mainnet case
- fixed: (Exolix) Correctly handle below limit errors for 'from' quotes
- fixed: (Godex/Swapuz) Fix conversion to native units

## 2.1.0 (2024-02-09)

- added: Mainnet codes for Arbitrum, Axelar, Base, and Cosmos Hub
- changed: (CEX) Only allow quotes with known mainnet network codes

## 2.0.2 (2024-02-01)

- fixed: Do not crash at load time if `BigInt` is not present.

## 2.0.1 (2024-01-09)

- fixed: Error when swapping from tokens
- fixed: Fix parent asset Lifi swaps to use 0x000.. contract address
- fixed: Network fee transaction tagging
- fixed: Max swap of tokens with Lifi
- fixed: Properly set tokenId and currencyCode for makeTx transactions

## 2.0.0 (2024-01-04)

- changed: Use core 2.0 types. Requires edge-core-js >2.0.0

## 1.3.0 (2024-01-04)

- added: Support Pulsechain through ChangeNow

## 1.2.0 (2023-12-04)

- added: Support BSC for Thorchain swaps
- fixed: Max swap when sending RUNE on Thorchain

## 1.1.1 (2023-11-24)

- fixed: Return proper min amount error with Thorchain

## 1.1.0 (2023-11-20)

- added: RUNE support for Thorchain swaps

## 1.0.4 (2023-11-09)

- changed: Block Polygon USDC/USDC.e trading and fix codes, where necessary
- changed: (Godex) Block Zcash trading since they can't handle Unified Addresses

## 1.0.3 (2023-11-07)

- fixed: Use appropriate send amount in spend targets for Uniswap-based providers
- fixed: XRP DEX swap error due to excessive decimals

## 1.0.2 (2023-11-06)

- fixed: Check max spendable amount of source wallet in xrpdex quote
- fixed: Thorswap to use new server and apikey

## 1.0.1 (2023-10-30)

- fixed: Properly report Thorchain quotes as isEstimate

## 1.0.0 (2023-10-24)

- changed: Simplify our React Native integration.
- removed: Delete all rate plugins.

## 0.22.0 (2023-10-24)

- changed: Thorchain quotes to estimate rate

## 0.21.11 (2023-10-19)

- added: Enable Zcash receiving on Godex

## 0.21.10 (2023-10-09)

- changed: Restrict ChangeHero trading to whitelisted plugins
- changed: Replace deprecated currency codes in `SwapCurrencyError` with requests

## 0.21.9 (2023-10-02)

- changed: Throw `SwapCurrencyError` if Uniswap-based defi swap providers return zero for `amountToSwap` or `expectedAmountOut`

## 0.21.8 (2023-09-28)

- fixed: Fix incorrect wrapped mainnet address in defi swaps

## 0.21.7 (2023-09-27)

- changed: Update getInOutTokenAddresses to use EdgeTokens so it can be used for any token
- changed: Block VELO trading from providers that rely on `currencyCode`
- changed: Add `fantom` pluginId check to spookySwap and tombSwap

## 0.21.6 (2023-09-14)

- changed: Move EVM data from spendTarget `otherParams` to `memo`
- fixed: `gasLimit`` param typo

## 0.21.5 (2023-09-13)

- fixed: Fix 'to' quotes in Thorchain using incorrect denomination

## 0.21.4 (2023-09-08)

- fixed: Uniswap plugin uses backup gasLimit in case estimateGas fails

## 0.21.3 (2023-09-05)

- fixed: Thorchain failed quotes from ETH>BTC

## 0.21.2 (2023-09-04)

- changed: Use RPC gas estimates for Uniswap plugin

## 0.21.1 (2023-08-30)

- Fixed: Separate Thorchain volatility spreads between streaming and non-streaming

## 0.21.0 (2023-08-25)

- Added: Thorchain streaming swaps

## 0.20.2 (2023-08-24)

- Fixed: XRP DEX max swaps

## 0.20.1 (2023-08-15)

- Fixed: LI.FI on-chain transactions no longer revert due to missing bridge fees

## 0.20.0 (2023-08-14)

- added: XRP DEX support (Requires minimum of edge-currency-accountbased 1.5.0)

## 0.19.8 (2023-07-30)

- Use `EdgeIo.fetchCors` for all requests

## 0.19.7 (2023-07-18)

- Swapuz/LetsExchange: Disable MATH

## 0.19.6 (2023-07-12)

- Fixed: Increased gas limit by 40% for all chains for LI.FI

## 0.19.5 (2023-05-10)

- Fixed: Fix swapuz refund address
- Fixed: Prevent Thorchain swaps that would receive negative amount

## 0.19.4 (2023-05-09)

- Changed: Update exolix to v2 api

## 0.19.3 (2023-05-02)

- Lifi: Fix passing gasLimit as a float

## 0.19.2 (2023-05-01)

- Fixed: Fix zkSync mainnet code transcription for LetsExchange.
- Fixed: Disable zkSync explicitly for Swapuz.

## 0.19.1 (2023-04-27)

- Fixed: Lifi gasLimit calculation for ETH

## 0.19.0 (2023-04-19)

- Changed: Transcribe zkSync mainnet code to ZKSYNC

## 0.18.0 (2023-04-10)

- added: Add Velodrome DEX exchange

## 0.17.7 (2023-03-22)

- Lifi: Use built-in gas limit estimator for Ethereum transactions and not Lifi's

## 0.17.6 (2023-03-10)

- Lifi: Allow gas price lower than 1 gwei

## 0.17.5 (2023-03-07)

- LetsExchange: Audit and add special case mainnet codes

## 0.17.4 (2023-02-24)

- added: Add LI.FI DEX exchange.

## 0.17.3 (2023-02-21)

- added: Add Optimism support across swap plugins
- added: Add default mainnet transcription map

## 0.17.2 (2023-02-07)

- fixed: Send Ninerealms client-id when doing Thorchain queries
- fixed: Use Thornode servers instead of Midgard for inbound_addresses

## 0.17.1 (2023-02-01)

- Godex: Check min amount before supported networks

## 0.17.0 (2023-01-10)

- Add 'max' support across all swap plugins
- Remove legacy address fallback
- Godex: Add early exit for unsupported chains
- Remove Switchain
- Upgrade edge-core-js to v0.19.37

## 0.16.17 (2023-01-06)

- Add: isDex and swapPlugType to plugins and quotes

## 0.16.16 (2023-01-05)

- LetsExchange: Update asInfoReply cleaner to support numbers or strings
- Add BTC/ARRR tests

## 0.16.15 (2023-01-04)

- LetsExchange: Fix max amount logic

## 0.16.14 (2023-01-03)

- Fix: Transfer plugin throwing error
- Change: Allow per asset spreads to be specified by currency code

## 0.16.13 (2022-12-21)

- Fix: Remove extra slash in path to Thorswap API to prevent 301 redirects

## 0.16.12 (2022-12-16)

- Change: Limit Thorchain token approvals to amount needed for deposit
- Change: Add ability to tweak Thorchain volatility % based on asset pair via info server
- Upgrade edge-core-js -> 0.19.33

## 0.16.11 (2022-12-08)

- TombSwap: Restrict token allowances to only what is needed for each smart contract call.

## 0.16.10 (2022-12-06)

- ChangeHero: Re-enable 'to' quotes
- ChangeHero: Re-enable token swaps
- Thorchain DA: Update cleaners
- Deprecate FoxExchange

## 0.16.9 (2022-11-23)

- Add Thorchain DEX aggregator

## 0.16.8 (2022-11-22)

- ChangeHero: Prevent 'to' quotes due to over-precise amounts breaking data encoding.

## 0.16.7 (2022-11-15)

- Sideshift: Update to API v2
- Add testing framework to run plugins in Node

## 0.16.6 (2022-11-10)

- Exolix: Restrict all swaps on Polygon

## 0.16.5 (2022-11-07)

- Use Midgard API to calculate Thorchain network fees
- Turn on remaining linting rules and fix issues

## 0.16.4 (2022-11-03)

- Swapuz: Fix requestToExchangeAmount denomination
- Swapuz: Replace 'to' swap early exit with like kind asset check
- Block REPv1 trading across all partners
- Change helper function name and expand ability to accept currency code transcription map
- Fix missing 'to' identifiers on min/max errors
- Sideshift: Replace safeCurrencyCodes helper function with getCodesWithTranscription

## 0.16.3 (2022-11-02)

- Fix requesting multiple quotes simultaneously giving incorrect quotes when Swapuz is enabled.

## 0.16.2 (2022-11-02)

- Swapuz: Implement TO quotes for like-kind assets

## 0.16.1 (2022-10-31)

- Thorchain: Fix minimum quotes
- Thorchain: Remove minAmount support
- ChangeHero: Reimplement restricted currency codes
- Swapuz: Fix returned native amount from quote

## 0.16.0 (2022-10-24)

- Add Swapuz

## 0.15.4 (2022-10-19)

- fixed: Do not allow swaps to Tezos using Fox Exchange or Switchain, which rely on dummy addresses.

## 0.15.3 (2022-10-17)

- Fix Godex API by updating cleaners

## 0.15.2 (2022-10-14)

- Thorchain: Reject swap quotes between the same assets

## 0.15.1 (2022-10-07)

- Add AVAX support to Thorchain

## 0.15.0 (2022-09-24)

- Update Changehero plugin to support arbitrary chains and tokens with reverse quoting

## 0.14.0 (2022-09-20)

- Convert project to Typescript
- Upgrade edge-core-js to v0.19.29
- Plugins will receive metadata as part of their approve method in include in the tx object

## 0.13.10 (2022-09-14)

- Fix Thorchain token transactions using duplicate nonce

## 0.13.9 (2022-09-07)

- Fix Thorchain reverse quotes

## 0.13.8 (2022-09-06)

- Add Thorchain

## 0.13.7 (2022-08-22)

- Exolix: Disable reverse quotes

## 0.13.6 (2022-08-02)

- ChangeHero: Prevent swapping currency codes could represent both a token and a mainnet currency

## 0.13.5 (2022-07-20)

- Add ChangeHero

## 0.13.4 (2022-07-13)

- Godex: Fix min amount currency display
- Exolix: Fix min amount currency display

## 0.13.3 (2022-07-13)

- LetsExchange: Update apiKey config
- LetsExchange: Fix min amount currency display
- Upgrade edge-core-js to v0.19.23

## 0.13.2 (2022-06-21)

- Deprecate Changelly plugin

## 0.13.1 (2022-06-19)

- Changelly: Re-enable floating-rate swap support
- Changelly: Block KNC swaps

## 0.13.0 (2022-04-21)

- Add new swap partner TombSwap
- Add new swap partner LetsExchange
- Coingecko: Add miMATIC (MAI)

## 0.12.17 (2022-04-13)

- Transfer: Don't allow transfers if the currency code doesn't match

## 0.12.16 (2022-04-13)

- Add SpookySwap exchange plugin

## 0.12.15 (2022-03-29)

- Coingecko: Add TSHARE, TOMB, and MAI exchange rates

## 0.12.14 (2022-03-02)

- Fix calling denomination methods from wrong wallet

## 0.12.13 (2022-03-02)

- Re-enable BNB Beacon Chain

## 0.12.12 (2022-03-02)

- Changelly: Add BNB Smart Chain support
- Disable BNB Beacon Chain in all swap plugins
- Use pluginIds instead of currency codes in transfer plugin

## 0.12.11 (2022-02-23)

- Add Binance Smart Chain to swap partners
- Changenow: Fix corner case where standard flow was skipped
- Use pluginIds instead of currency code keys in transcription and invalid-code maps
- Add helper function and transcription maps for changing mainnet codes

## 0.12.10 (2022-02-16)

- Exolix: Update plugin to use mainchain:tokencode values in requests
- Coingecko: Add Celo and Aave unique IDs
- Godex: Disable DGB selling

## 0.12.9 (2022-02-10)

- Coingecko: Add BOO unique ID
- Nomics: Add BOO unique ID

## 0.12.8 (2022-01-28)

- Coingecko: Add new tokens
- Coingecko: Fix BNT unique ID
- Add constant rates for AVAX wrapped tokens

## 0.12.7 (2022-01-11)

- Godex: Restrict AVAX trading to the AVAXC network
- Godex: Re-enable FTM trading

## 0.12.6 (2022-01-10)

- ChangeNow: Restore MATIC trading
- Prevent AVAX token trading on partners without mainnet identification

## 0.12.5 (2022-01-06)

- ChangeNow: Upgrade to v2 API
- Coingecko: Add AVAX

## 0.12.4 (2021-12-31)

- Sideshift: Fix currency code transcription

## 0.12.3 (2021-12-29)

- Sideshift: Use lowercase currency codes in API requests

## 0.12.2 (2021-12-27)

- Prevent MATIC ERC20 trading

## 0.12.1 (2021-12-21)

- Move invalid code checking and currency code transcription into helper functions

## 0.12.0 (2021-12-03)

- Add new swap partner Exolix
- Changelly: Disable estimated swaps (temporarily)

## 0.11.40 (2021-11-30)

- Remove Totle

## 0.11.39 (2021-11-24)

- Use the correct "to" currency code for the shapeshift's tx metadata

## 0.11.38 (2021-11-16)

- Prevent ZEC purchases from partners who don't support sending to shielded addresses

## 0.11.37 (2021-10-01)

- Changenow: Add Fantom mainnet support
- Godex: Disable Fantom trading

## 0.11.36 (2021-09-28)

- Move edge-core-js to devDependencies

## 0.11.35 (2021-09-22)

- Remove inactive swap plugins Faast and Coinswitch

## 0.11.34 (2021-09-17)

- Coingecko: add HBAR
- Nomics: Fix error handling

## 0.11.33 (2021-09-08)

- Disable FTM trading on all plugins that do not identify the version of FTM is supported (ERC20 or mainnet). Plugins will be updated as mainnet identification is added.
- Godex: Add support for RBTC network name

## 0.11.32 (2021-08-02)

- Swap: Ensure all quotes expire in the future
- Currency Converter: Fix response cleaner

## 0.11.31 (2021-07-28)

- Bitmax: Update url to ascendex.com

## 0.11.30 (2021-07-12)

- Totle: Patch error response handling

## 0.11.29 (2021-07-01)

- Totle: Fix error response handling

## 0.11.28 (2021-05-25)

Godex: Add the mainnet currencycodes to the transaction request
Fox: Check mainnet matches user's wallet

## 0.11.27 (2021-05-13)

- ChangeNow: Add ERC20-only filter to prevent trading for mainnet tokens when only the ETH ERC20 token is available

## 0.11.26 (2021-05-11)

- Add constant rate for fUSDT to USDT

## 0.11.25 (2021-04-27)

- Convert Nomics, Coincap, and Currencyconverter API to use bulk requests
- Sideshift: Add refund address

## 0.11.24 (2021-04-12)

- Sideshift: Move permission check after currency check
- Upgrade eslint-config-standard-kit to v0.15.1
- Upgrade to edge-core-js v0.17.29
- Upgrade to Webpack 5

## 0.11.23 (2021-03-19)

- Move REPV2 to constantRate plugin

## 0.11.22 (2021-03-15)

- Convert Coingecko to handle bulk queries
- Fix Sideshift error handling

## 0.11.21 (2021-02-27)

- Coingecko: Add FIO
- Bitmax: Remove FIO fallback value
- Log issues with API responses as warnings

## 0.11.20 (2021-02-25)

- Sideshift: Add order status URL
- Sideshift: Throw appropriate error messages instead of relying on cleaners

## 0.11.19 (2021-02-11)

- Move aTokens to constantRate plugin
- Rename TBTC to TESTBTC
- Sideshift: add uniqueIdentifier to swaps

## 0.11.18 (2021-01-01)

- Coingecko: Initialize `rates` in for-loop

## 0.11.17 (2021-01-01)

- Add Aave tokens to Coingecko

## 0.11.16 (2020-12-31)

- Add rates1 as a fiat/fiat exchange rate provider
- Fix Sideshift cleaner throws and formatting

## 0.11.15 (2020-12-21)

- Update ChangeNow to save `amount` returned from order creation endpoints to metadata

## 0.11.14 (2020-12-15)

- Add new swap partner SideShift
- Add ANT token to Coingecko
- Reduce Nomics queries by ignoring fiat/fiat pairs

## 0.11.13 (2020-12-03)

- Add support for FIRO
- Fix CORS issue with Coincap

## 0.11.12 (2020-11-15)

- Add support for rate hints. The exchange rate plugins will only return specific rate pairs requested from the core.

## 0.11.11 (2020-10-09)

- Update Changelly to use getFixRateForAmount

## 0.11.10 (2020-10-06)

- Fix debugging comment blocking broadcast

## 0.11.9 (2020-10-01)

- Fix Fox Exchange parent fee display for token trades

## 0.11.8 (2020-09-25)

- Fix CORS issues with Nomics
- Remove unused xagau and herc plugins

## 0.11.7 (2020-09-17)

- Enable Changelly order status URL
- Pass last Totle tx as orderId

## 0.11.6 (2020-08-11)

- Display parent currency and fiat fee for token swaps
- Add CoinGecko

## 0.11.5 (2020-07-29)

- Copy REP exchange rate for REPV2

## 0.11.4 (2020-07-09)

- ChangeNow - Add fallback to floating-rate if trade is outside fixed-rate min and max
- Add FIO rate via BitMax API

## 0.11.3 (2020-07-03)

- Add Coinmonitor rate API support for BTC/ARS pair

## 0.11.2 (2020-06-30)

- Add promoCode support to Switchain

## 0.11.1 (2020-06-22)

- Force high fee when swapping from BTC

## 0.11.0 (2020-06-01)

This version requires edge-core-js v0.17.3 or greater.

- Save swap metadata using the new, official edge-core-js API.

## 0.10.4 (2020-05-14)

- Add WazirX exchange rate provider
- Fix Switchain metadata

## 0.10.3 (2020-04-29)

- Fix Switchain ERC20 token sending issue
- Fix swapInfo orderUri variable name across all swap partners

## 0.10.2 (2020-04-17)

- Changed FIO temporary fixed rate

## 0.10.1 (2020-04-16)

- Add a Switchain swap plugin.
- Pass promo codes to Changelly, ChangeNow, and Godex.
- Fix ChangeNow on Android & add better logging.

## 0.10.0 (2020-04-09)

- Upgrade to the new edge-core-js v0.17.0 API.

## 0.9.3 (2020-04-09)

- Add a temporary $0.001 FIO exchange rate.

## 0.9.2 (2020-04-01)

- Update Totle plugin to address API changes
- Increase number of returned rates from Coincap to 500

## 0.9.1 (2020-03-04)

- Pass promo codes to ChangeNow.
- Expose `pluginId`, as `pluginName` is being deprecated.

## 0.9.0 (2020-01-22)

- Require edge-core-js v0.16.18 or greater.
- Remove our react-native-io module.

## 0.8.13 (2020-01-02)

- Refactor Godex plugin
- Re-enable USDT for Godex

## 0.8.12 (2019-11-04)

- Support Faast unique identifiers

## 0.8.11 (2019-11-04)

- Support Totle fixed-rate quotes.
- Support CoinSwitch fixed-rate quotes.
- Update readme file.

## 0.8.10 (2019-10-28)

- Disable Faa.st XRP swaps

## 0.8.9 (2019-10-23)

- Include `apiKey` for Totle swaps
- Peg WBTC to BTC as 1-to-1 rate

## 0.8.8 (2019-10-22)

- Enable compound token exchange rates

## 0.8.7 (2019-10-09)

- Re-enable USDT on ChangeNow and Changelly.

## 0.8.6 (2019-09-27)

- Fix ChangeNow and Changelly issues with USDT

## 0.8.5 (2019-09-20)

- Remove obsolete plugins (deprecated API's)
- Implement constantRate plugins for pegged currencies

## 0.8.3 (2019-08-23)

- Fix GoDex unsupported currency error reporting
- Fix ShapeShift KYC error reporting

## 0.8.2 (2019-08-23)

- Disable USDT as a GoDex source currency
- Fix GoDex quote URI

## 0.8.1 (2019-08-22)

- Change GoDex transactions to fixed rate

## 0.8.0 (2019-08-14)

- Add Coinswitch as swap partner

## 0.7.3 (2019-08-06)

- Fix ShapeShift auth error logic.
- Fix ShapeShift quote expiration dates.

## 0.7.2 (2019-08-06)

- Change display name for Fox Exchange

## 0.7.1 (2019-08-03)

- Fix apiKey variable name for GoDex

## 0.7.0 (2019-07-29)

- Integrate Fox and GoDex as swap partners

## 0.6.12 (2019-07-25)

- Allow Totle transactions between wallets

## 0.6.11 (2019-07-24)

- Set nativeAmount for outgoing Totle tx after broadcast

## 0.6.10 (2019-07-22)

- Upgrade faa.st plugin.
- Fix crashes on old Android WebView versions.

## 0.6.9 (2019.07-13)

- Implement currency-not-supported error for Totle transactions between different ETH wallets

## 0.6.8 (2019-07-12)

- Add more info to readme
- Fix Totle unavailable swap pair case

## 0.6.6 (2019-07-09)

- Enable HERC and AGLD exchange rate fix

## 0.6.5 (2019-06-04)

- fix error when currency is temporarily disabled

## 0.6.4 (2019-06-04)

- fix amount string instead of number error

## 0.6.3 (2019-06-04)

- fixed upper case issue with currency code

## 0.6.2 (2019-06-04)

- Changelly fixed rate quotes in both directions.
- ChangeNOW fixed quote amount displayed to user.
- ChangeNOW added catch for below minimum.

## 0.6.1 (2019-05-21)

- Add `isEstimate` flags to swap quotes.

## 0.6.0 (2019-04-29)

- Add Shapeshift and Faa.st swap plugins.

## 0.5.7 (2019-04-25)

- Fix missing Nomics exchange rates issue

## 0.5.6 (2019-04-19)

- Add Nomics exchange rates
- Add new HERC endpoint

## 0.5.5 (2019-04-09)

- Add exchange rates from Coincap _legacy_ API

## 0.5.4 (2019-04-03)

- Upgrade to the coincap.io v2 API.

## 0.5.3 (2019-02-26)

- Move ChangeNow into this repo for CORS reasons
- Migrate Coincap to new API

## 0.5.2 (2019-02-21)

- Fix currencyconverterapi to use the production server, not the free server

## 0.5.1 (2019-02-21)

- Fix CORS issues with currencyconverterapi
- Add an API key to currencyconverterapi
- Move changelly into this repo for CORS reasons

## 0.5.0 (2019-02-19)

- Upgrade to the edge-core-js v0.15.0 and adapt to breaking changes.

## 0.4.1 (2019-02-15)

- Upgrade to the edge-core-js v0.14.0 types
- Modernize the build system

## 0.4.0

- Add HERC exchange rate support

### 0.3.0

- Add currencyconverterapi.com plugin for IMP and IRR support only

### 0.2.1

- Switch to v2 of Coinbase API

### 0.2.0

- Add CoinCap support

### 0.1.0

- Initial release
- Coinbase & Shapeshift
