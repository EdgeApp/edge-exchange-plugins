import { makeConfig } from 'cleaner-config'
import { asObject, asOptional, asString } from 'cleaners'
import path from 'path'

const asMapctlConfig = asObject({
  CHANGEHERO_API_KEY: asOptional(asString, ''),
  CHANGENOW_API_KEY: asOptional(asString, ''),
  EXOLIX_API_KEY: asOptional(asString, ''),
  LETSEXCHANGE_API_KEY: asOptional(asString, ''),
  RANGO_API_KEY: asOptional(asString, ''),
  SWAPUZ_API_KEY: asOptional(asString, ''),
  SWAPKIT_API_KEY: asOptional(asString, '')
})

export type MapctlConfig = ReturnType<typeof asMapctlConfig>

// Path to mapctlConfig.json at the project root
const configPath = path.join(__dirname, '..', 'mapctlConfig.json')
export const config = makeConfig(asMapctlConfig, configPath)
