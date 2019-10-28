# Edge Exchange Plugins

This library exports a collection of exchange-rate & swap plugins for use with [`edge-core-js`](https://github.com/EdgeApp/edge-core-js).

Use it like this:

```js
import {
  addEdgeCorePlugins,
  lockEdgeCorePlugins,
  makeEdgeContext
} from 'edge-core-js'
import exchangePlugins from 'edge-exchange-plugins'

addEdgeCorePlugins(exchangePlugins)
lockEdgeCorePlugins()

makeEdgeContext({
  apiKey: '',
  appId: '',
  plugins: {
    // Plugin names from edge-exchange-plugins:
    coinbase: true,
    shapeshift: true
  }
})

```

Please see [index.js](./src/index.js) for the list of plugins in this repo.

## edge-react-gui

To enable in edge-react-gui please make sure that the appropriate truthy value (can be object) is included into `env.json`, and that the new `env.json` values are updated on the server building and delivering the app. Since `env.json` is gitignored, plugins may be enabled on your local dev environment but will not be enabled for `develop` or `master` (release) builds until the `env.json` on that build server is updated to include the new plugin.

# Adding Your Exchange

Please be aware that when considering merging pull requests for additional exchanges we require the following:

- Accompanying PR submitted to `edge-reports` that fetches transaction data to your exchange that is credited to Edge users
- Rebase of your branch upon this repo's `master` branch. For more info:
https://github.com/edx/edx-platform/wiki/How-to-Rebase-a-Pull-Request
- Accompanying PR submitted to `edge-react-gui` that includes (but is not limited to) the following:
    - Small 64x64 pixel square logos with a white background
    - 600x210 pixel horizontal logo for your exchange, with **no** empty space around the logo (we will add this programatically within the app
