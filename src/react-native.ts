import 'regenerator-runtime/runtime'

import edgeCorePlugins from './index'

if (
  typeof window !== 'undefined' &&
  typeof window.addEdgeCorePlugins === 'function'
) {
  window.addEdgeCorePlugins(edgeCorePlugins)
}
