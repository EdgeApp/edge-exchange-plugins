# edge-exchange-plugins

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
