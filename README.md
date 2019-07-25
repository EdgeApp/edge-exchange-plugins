# Airbitz Exchange Plugins

This library exports a collection of exchange-rate plugins for use with [`airbitz-core-js`](https://github.com/Airbitz/airbitz-core-js).

Use it like this:

```js
import { makeContext } from 'airbitz-core-js'
import { coinbasePlugin, shapeshiftPlugin } from 'airbitz-exchange-plugins'

makeContext({
  plugins: [coinbasePlugin, shapeshiftPlugin]
})
```

The supported plugins are:

* `coinbasePlugin` - Converts from BTC to most fiat currencies.
* `shapeshiftPlugin` - Converts from BTC to most common altcoins.


To enable in edge-react-gui please make sure that the appropriate truthy value (can be object) is included into `env.json`, and that the new `env.json` values are updated on the server building and delivering the app. Since `env.json` is gitignored, plugins may be enabled on your local dev environment but will not be enabled for `develop` or `master` (release) builds until the `env.json` on that build server is updted to include the new plugin.
