import { asArray, asBoolean, asObject, asString } from 'cleaners'

export const asWizardSwapCurrency = asObject({
  symbol: asString,
  name: asString,
  has_extra_id: asBoolean
}).withRest

export const asWizardSwapCurrencyResponse = asArray(asWizardSwapCurrency)
