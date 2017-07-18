# Airbitz Exchange Plugins

This library exports a collection of exchange-rate plugins for use with [`airbitz-core-js`](https://github.com/Airbitz/airbitz-core-js).

Use it like this:

```js
import { makeContext } from 'airbitz-core-js'
import { coinbasePlugin } from 'airbitz-exchange-plugins'

makeContext({
  plugins: [coinbasePlugin]
})
```
