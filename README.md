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

To test your exchange plugin, build the full application at [`edge-react-gui`](https://github.com/EdgeApp/edge-react-gui). Follow the README there for instructions on building and running the app.

Clone this repo as a peer in the same directory as `edge-react-gui`. Then run

```
yarn
yarn prepare
```

From within the `edge-react-gui`

```
yarn updot edge-exchange-plugins
yarn prepare
```

Make appropriate changes to `edge-react-gui` to include your plugin. Search `edge-react-gui` for the string `changelly` and make similar changes for your plugin.
You can then rebuild the `edge-react-gui` app and run and test the plugin. To do a swap with your plugin, go to Settings > Exchange Settings, then disable all other exchanges but yours. Then tap the bottom right `Exchange` button and try to do a swap. You'll of course need funds in your Edge account.

Please be aware that when considering merging pull requests for additional exchanges we require the following:

- Accompanying PR submitted to `edge-reports` that fetches transaction data to your exchange that is credited to Edge users
- Rebase of your branch upon this repo's `master` branch. For more info:
https://github.com/edx/edx-platform/wiki/How-to-Rebase-a-Pull-Request
- Accompanying PR submitted to `edge-react-gui` that includes (but is not limited to) the following:
    - Small 64x64 pixel square logos with a white background
    - 600x210 pixel horizontal logo for your exchange, with **no** empty space around the logo (we will add this programatically within the app
