import { div } from 'biggystring'

const DIVIDE_PRECISION = 18

export const div18 = (x1: string, y1: string): string =>
  div(x1, y1, DIVIDE_PRECISION)
