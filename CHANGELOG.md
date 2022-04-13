# edge-exchange-plugins

# 0.12.16 (2022-04-13)

- Add SpookySwap exchange plugin

# 0.12.15 (2022-03-29)

- Coingecko: Add TSHARE, TOMB, and MAI exchange rates

# 0.12.14 (2022-03-02)

- Fix calling denomination methods from wrong wallet

# 0.12.13 (2022-03-02)

- Re-enable BNB Beacon Chain

# 0.12.12 (2022-03-02)

- Changelly: Add BNB Smart Chain support
- Disable BNB Beacon Chain in all swap plugins
- Use pluginIds instead of currency codes in transfer plugin

# 0.12.11 (2022-02-23)

- Add Binance Smart Chain to swap partners
- Changenow: Fix corner case where standard flow was skipped
- Use pluginIds instead of currency code keys in transcription and invalid-code maps
- Add helper function and transcription maps for changing mainnet codes

# 0.12.10 (2022-02-16)

- Exolix: Update plugin to use mainchain:tokencode values in requests
- Coingecko: Add Celo and Aave unique IDs
- Godex: Disable DGB selling

# 0.12.9 (2022-02-10)

- Coingecko: Add BOO unique ID
- Nomics: Add BOO unique ID

# 0.12.8 (2022-01-28)

- Coingecko: Add new tokens
- Coingecko: Fix BNT unique ID
- Add constant rates for AVAX wrapped tokens

# 0.12.7 (2022-01-11)

- Godex: Restrict AVAX trading to the AVAXC network
- Godex: Re-enable FTM trading

# 0.12.6 (2022-01-10)

- ChangeNow: Restore MATIC trading
- Prevent AVAX token trading on partners without mainnet identification

# 0.12.5 (2022-01-06)

- ChangeNow: Upgrade to v2 API
- Coingecko: Add AVAX

# 0.12.4 (2021-12-31)

- Sideshift: Fix currency code transcription

# 0.12.3 (2021-12-29)

- Sideshift: Use lowercase currency codes in API requests

# 0.12.2 (2021-12-27)

- Prevent MATIC ERC20 trading

# 0.12.1 (2021-12-21)

- Move invalid code checking and currency code transcription into helper functions

# 0.12.0 (2021-12-03)

- Add new swap partner Exolix
- Changelly: Disable estimated swaps (temporarily)

# 0.11.40 (2021-11-30)

- Remove Totle

# 0.11.39 (2021-11-24)

- Use the correct "to" currency code for the shapeshift's tx metadata

# 0.11.38 (2021-11-16)

- Prevent ZEC purchases from partners who don't support sending to shielded addresses

# 0.11.37 (2021-10-01)

- Changenow: Add Fantom mainnet support
- Godex: Disable Fantom trading

# 0.11.36 (2021-09-28)

- Move edge-core-js to devDependencies

# 0.11.35 (2021-09-22)

- Remove inactive swap plugins Faast and Coinswitch

# 0.11.34 (2021-09-17)

- Coingecko: add HBAR
- Nomics: Fix error handling

# 0.11.33 (2021-09-08)

- Disable FTM trading on all plugins that do not identify the version of FTM is supported (ERC20 or mainnet). Plugins will be updated as mainnet identification is added.
- Godex: Add support for RBTC network name

# 0.11.32 (2021-08-02)

- Swap: Ensure all quotes expire in the future
- Currency Converter: Fix response cleaner

# 0.11.31 (2021-07-28)

- Bitmax: Update url to ascendex.com

# 0.11.30 (2021-07-12)

- Totle: Patch error response handling

# 0.11.29 (2021-07-01)

- Totle: Fix error response handling

# 0.11.28 (2021-05-25)

Godex: Add the mainnet currencycodes to the transaction request
Fox: Check mainnet matches user's wallet

# 0.11.27 (2021-05-13)

- ChangeNow: Add ERC20-only filter to prevent trading for mainnet tokens when only the ETH ERC20 token is available

# 0.11.26 (2021-05-11)

- Add constant rate for fUSDT to USDT

# 0.11.25 (2021-04-27)

- Convert Nomics, Coincap, and Currencyconverter API to use bulk requests
- Sideshift: Add refund address

# 0.11.24 (2021-04-12)

- Sideshift: Move permission check after currency check
- Upgrade eslint-config-standard-kit to v0.15.1
- Upgrade to edge-core-js v0.17.29
- Upgrade to Webpack 5

# 0.11.23 (2021-03-19)

- Move REPV2 to constantRate plugin

# 0.11.22 (2021-03-15)

- Convert Coingecko to handle bulk queries
- Fix Sideshift error handling

# 0.11.21 (2021-02-27)

- Coingecko: Add FIO
- Bitmax: Remove FIO fallback value
- Log issues with API responses as warnings

# 0.11.20 (2021-02-25)

- Sideshift: Add order status URL
- Sideshift: Throw appropriate error messages instead of relying on cleaners

# 0.11.19 (2021-02-11)

- Move aTokens to constantRate plugin
- Rename TBTC to TESTBTC
- Sideshift: add uniqueIdentifier to swaps

# 0.11.18 (2021-01-01)

- Coingecko: Initialize `rates` in for-loop

# 0.11.17 (2021-01-01)

- Add Aave tokens to Coingecko

# 0.11.16 (2020-12-31)

- Add rates1 as a fiat/fiat exchange rate provider
- Fix Sideshift cleaner throws and formatting

# 0.11.15 (2020-12-21)

- Update ChangeNow to save `amount` returned from order creation endpoints to metadata

# 0.11.14 (2020-12-15)

- Add new swap partner SideShift
- Add ANT token to Coingecko
- Reduce Nomics queries by ignoring fiat/fiat pairs

# 0.11.13 (2020-12-03)

- Add support for FIRO
- Fix CORS issue with Coincap

# 0.11.12 (2020-11-15)

- Add support for rate hints. The exchange rate plugins will only return specific rate pairs requested from the core.

# 0.11.11 (2020-10-09)

- Update Changelly to use getFixRateForAmount

# 0.11.10 (2020-10-06)

- Fix debugging comment blocking broadcast

# 0.11.9 (2020-10-01)

- Fix Fox Exchange parent fee display for token trades

# 0.11.8 (2020-09-25)

- Fix CORS issues with Nomics
- Remove unused xagau and herc plugins

# 0.11.7 (2020-09-17)

- Enable Changelly order status URL
- Pass last Totle tx as orderId

# 0.11.6 (2020-08-11)

- Display parent currency and fiat fee for token swaps
- Add CoinGecko

# 0.11.5 (2020-07-29)

- Copy REP exchange rate for REPV2

# 0.11.4 (2020-07-09)

- ChangeNow - Add fallback to floating-rate if trade is outside fixed-rate min and max
- Add FIO rate via BitMax API

# 0.11.3 (2020-07-03)

- Add Coinmonitor rate API support for BTC/ARS pair

# 0.11.2 (2020-06-30)

- Add promoCode support to Switchain

# 0.11.1 (2020-06-22)

- Force high fee when swapping from BTC

# 0.11.0 (2020-06-01)

This version requires edge-core-js v0.17.3 or greater.

- Save swap metadata using the new, official edge-core-js API.

# 0.10.4 (2020-05-14)

- Add WazirX exchange rate provider
- Fix Switchain metadata

# 0.10.3 (2020-04-29)

- Fix Switchain ERC20 token sending issue
- Fix swapInfo orderUri variable name across all swap partners

# 0.10.2 (2020-04-17)

- Changed FIO temporary fixed rate

# 0.10.1 (2020-04-16)

- Add a Switchain swap plugin.
- Pass promo codes to Changelly, ChangeNow, and Godex.
- Fix ChangeNow on Android & add better logging.

# 0.10.0 (2020-04-09)

- Upgrade to the new edge-core-js v0.17.0 API.

# 0.9.3 (2020-04-09)

- Add a temporary $0.001 FIO exchange rate.

# 0.9.2 (2020-04-01)

- Update Totle plugin to address API changes
- Increase number of returned rates from Coincap to 500

# 0.9.1 (2020-03-04)

- Pass promo codes to ChangeNow.
- Expose `pluginId`, as `pluginName` is being deprecated.

# 0.9.0 (2020-01-22)

- Require edge-core-js v0.16.18 or greater.
- Remove our react-native-io module.

# 0.8.13 (2020-01-02)

- Refactor Godex plugin
- Re-enable USDT for Godex

# 0.8.12 (2019-11-04)

- Support Faast unique identifiers

# 0.8.11 (2019-11-04)

- Support Totle fixed-rate quotes.
- Support CoinSwitch fixed-rate quotes.
- Update readme file.

# 0.8.10 (2019-10-28)

- Disable Faa.st XRP swaps

# 0.8.9 (2019-10-23)

- Include `apiKey` for Totle swaps
- Peg WBTC to BTC as 1-to-1 rate

# 0.8.8 (2019-10-22)

- Enable compound token exchange rates

# 0.8.7 (2019-10-09)

- Re-enable USDT on ChangeNow and Changelly.

# 0.8.6 (2019-09-27)

- Fix ChangeNow and Changelly issues with USDT

# 0.8.5 (2019-09-20)

- Remove obsolete plugins (deprecated API's)
- Implement constantRate plugins for pegged currencies

# 0.8.3 (2019-08-23)

- Fix GoDex unsupported currency error reporting
- Fix ShapeShift KYC error reporting

# 0.8.2 (2019-08-23)

- Disable USDT as a GoDex source currency
- Fix GoDex quote URI

# 0.8.1 (2019-08-22)

- Change GoDex transactions to fixed rate

# 0.8.0 (2019-08-14)

- Add Coinswitch as swap partner

# 0.7.3 (2019-08-06)

- Fix ShapeShift auth error logic.
- Fix ShapeShift quote expiration dates.

# 0.7.2 (2019-08-06)

- Change display name for Fox Exchange

# 0.7.1 (2019-08-03)

- Fix apiKey variable name for GoDex

# 0.7.0 (2019-07-29)

- Integrate Fox and GoDex as swap partners

# 0.6.12 (2019-07-25)

- Allow Totle transactions between wallets

# 0.6.11 (2019-07-24)

- Set nativeAmount for outgoing Totle tx after broadcast

# 0.6.10 (2019-07-22)

- Upgrade faa.st plugin.
- Fix crashes on old Android WebView versions.

# 0.6.9 (2019.07-13)

- Implement currency-not-supported error for Totle transactions between different ETH wallets

# 0.6.8 (2019-07-12)

- Add more info to readme
- Fix Totle unavailable swap pair case

# 0.6.6 (2019-07-09)

- Enable HERC and AGLD exchange rate fix

# 0.6.5 (2019-06-04)

- fix error when currency is temporarily disabled

# 0.6.4 (2019-06-04)

- fix amount string instead of number error

# 0.6.3 (2019-06-04)

- fixed upper case issue with currency code

# 0.6.2 (2019-06-04)

- Changelly fixed rate quotes in both directions.
- ChangeNOW fixed quote amount displayed to user.
- ChangeNOW added catch for below minimum.

# 0.6.1 (2019-05-21)

- Add `isEstimate` flags to swap quotes.

# 0.6.0 (2019-04-29)

- Add Shapeshift and Faa.st swap plugins.

# 0.5.7 (2019-04-25)

- Fix missing Nomics exchange rates issue

# 0.5.6 (2019-04-19)

- Add Nomics exchange rates
- Add new HERC endpoint

# 0.5.5 (2019-04-09)

- Add exchange rates from Coincap _legacy_ API

# 0.5.4 (2019-04-03)

- Upgrade to the coincap.io v2 API.

# 0.5.3 (2019-02-26)

- Move ChangeNow into this repo for CORS reasons
- Migrate Coincap to new API

# 0.5.2 (2019-02-21)

- Fix currencyconverterapi to use the production server, not the free server

# 0.5.1 (2019-02-21)

- Fix CORS issues with currencyconverterapi
- Add an API key to currencyconverterapi
- Move changelly into this repo for CORS reasons

# 0.5.0 (2019-02-19)

- Upgrade to the edge-core-js v0.15.0 and adapt to breaking changes.

# 0.4.1 (2019-02-15)

- Upgrade to the edge-core-js v0.14.0 types
- Modernize the build system

# 0.4.0

- Add HERC exchange rate support

## 0.3.0

- Add currencyconverterapi.com plugin for IMP and IRR support only

## 0.2.1

- Switch to v2 of Coinbase API

## 0.2.0

- Add CoinCap support

## 0.1.0

- Initial release
- Coinbase & Shapeshift
