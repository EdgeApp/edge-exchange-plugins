const { exec } = require('child_process')
const path = require('path')
const webpack = require('webpack')
const { ESBuildMinifyPlugin } = require('esbuild-loader')

const debug = process.env.WEBPACK_SERVE

// Try exposing our socket to adb (errors are fine):
if (process.env.WEBPACK_SERVE) {
  console.log('adb reverse tcp:8083 tcp:8083')
  exec('adb reverse tcp:8083 tcp:8083', () => {})
}

const bundlePath = path.resolve(
  __dirname,
  'android/src/main/assets/edge-exchange-plugins'
)

module.exports = {
  devtool: debug ? 'source-map' : undefined,
  devServer: {
    allowedHosts: 'all',
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers':
        'X-Requested-With, content-type, Authorization',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    hot: false,
    port: 8083,
    static: bundlePath
  },
  entry: './src/index.ts',
  mode: debug ? 'development' : 'production',
  module: {
    rules: [
      {
        exclude: /\/node_modules\//,
        test: /\.ts$/,
        use: {
          loader: 'esbuild-loader',
          options: { loader: 'ts', target: 'chrome55' }
        }
      }
    ]
  },
  optimization: {
    minimizer: [
      new ESBuildMinifyPlugin({
        target: 'chrome67'
      })
    ]
  },
  output: {
    chunkFilename: '[name].chunk.js',
    filename: 'edge-exchange-plugins.js',
    path: bundlePath
  },
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^(https-proxy-agent)$/ }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.ProvidePlugin({
      process: path.resolve('node_modules/process/browser.js')
    })
  ],
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      crypto: require.resolve('crypto-browserify'),
      fs: false,
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      stream: require.resolve('stream-browserify'),
      url: require.resolve('url')
    }
  },
  target: ['web', 'es5']
}
