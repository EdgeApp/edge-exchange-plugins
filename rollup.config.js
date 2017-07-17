import buble from 'rollup-plugin-buble'
import nodent from 'rollup-plugin-nodent'
import packageJson from './package.json'

const bubleOpts = {
  transforms: {
    dangerousForOf: true
  }
}

const nodentOpts = {
  noRuntime: true,
  promises: true
}

export default [
  {
    entry: 'src/index.js',
    plugins: [nodent(nodentOpts), buble(bubleOpts)],
    targets: [
      {
        dest: packageJson.main,
        format: 'cjs',
        sourceMap: true
      },
      {
        dest: packageJson.module,
        format: 'es',
        sourceMap: true
      }
    ]
  }
]
