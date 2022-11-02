import { add, div, gte } from 'biggystring'

export const round = (num: string): string => {
  const [out, r = '0'] = num.split('.')
  return add(out, gte(r[0], '5') ? '1' : '0')
}

const DIVIDE_PRECISION = 18

export const div18 = (x1: string, y1: string): string =>
  div(x1, y1, DIVIDE_PRECISION)
