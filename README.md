# Edge Exchange Plugins

This library exports a collection of exchange-rate & swap plugins for use with [`edge-core-js`](https://github.com/EdgeApp/edge-core-js).

Please see [index.js](./src/index.js) for the list of plugins in this repo. These are compatible with edge-core-js v0.19.37 or later.

## Quick Links

- [Edge Company Conventions](https://github.com/EdgeApp/edge-conventions) - Company-wide development standards
- [TypeScript Style Guide](docs/conventions/typescript-style-guide.md) - Project-specific code conventions
- [Adding New Exchange Guide](docs/guides/adding-new-exchange.md) - Step-by-step integration guide
- [Plugin Architecture](docs/patterns/swap-plugin-architecture.md) - Understanding plugin patterns
- [Agent Guidelines](AGENTS.md) - For AI coding assistants

## Installing

Fist, add this library to your project:

```sh
yarn add edge-exchange-plugins
```

### Node.js

For Node.js, you should call `addEdgeCorePlugins` to register these plugins with edge-core-js:

```js
const { addEdgeCorePlugins, lockEdgeCorePlugins } = require("edge-core-js");
const plugins = require("edge-exchange-plugins");

addEdgeCorePlugins(plugins);

// Once you are done adding plugins, call this:
lockEdgeCorePlugins();
```

You can also add plugins individually if you want to be more picky:

```js
addEdgeCorePlugins({
  thorchain: plugins.thorchain,
});
```

### Browser

The bundle located in `dist/edge-exchange-plugins.js` will automatically register itself with edge-core-js. Just serve the entire `dist` directory along with your app, and then load the script:

```html
<script src='https://example.com/app/dist/edge-exchange-plugins.js'>
```

If you want to debug this project, run `yarn start` to start a Webpack server,
and then adjust your script URL to http://localhost:8083/edge-exchange-plugins.js.

### React Native

This package will automatically install itself using React Native autolinking. To integrate the plugins with edge-core-js, add its URI to the context component:

```jsx
import { pluginUri } from "edge-exchange-plugins";

<MakeEdgeContext
  pluginUris={[pluginUri]}
  // Plus other props as required...
/>;
```

To debug this project, run `yarn start` to start a Webpack server, and then use `debugUri` instead of `pluginUri`.

## edge-react-gui

To enable in edge-react-gui please make sure that the appropriate truthy value (can be object) is included into `env.json`, and that the new `env.json` values are updated on the server building and delivering the app. Since `env.json` is gitignored, plugins may be enabled on your local dev environment but will not be enabled for `develop` or `master` (release) builds until the `env.json` on that build server is updated to include the new plugin.

# Adding Your Exchange

To test your exchange plugin, build the full application at [`edge-react-gui`](https://github.com/EdgeApp/edge-react-gui). Follow the README there for instructions on building and running the app.

Clone this repo as a peer in the same directory as `edge-react-gui`. Then run

```sh
yarn
yarn prepare
```

From within the `edge-react-gui`

```sh
yarn updot edge-exchange-plugins
yarn prepare
yarn prepare.ios # For iPhone development
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
