const path = require('path')
const webpack = require('webpack')

const babelOptions = {
  // For debugging, just remove "@babel/preset-env":
  presets: ['@babel/preset-env', '@babel/preset-flow'],
  plugins: [['@babel/plugin-transform-for-of', { assumeArray: true }]],
  cacheDirectory: true
}

module.exports = {
  devtool: 'source-map',
  entry: './src/react-native.js',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: { loader: 'babel-loader', options: babelOptions }
      }
    ]
  },
  output: {
    filename: 'edge-exchange-plugins.js',
    path: path.join(path.resolve(__dirname), 'lib/react-native')
  },
  plugins: [
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
    new webpack.ProvidePlugin({ process: ['process'] })
  ],
  resolve: {
    fallback: {
      assert: require.resolve('assert/'),
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify')
    }
  },
  target: ['web', 'es5']
}
