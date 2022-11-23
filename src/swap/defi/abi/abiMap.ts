import { ContractInterface } from 'ethers'

import TC_AVAX_GENERIC from './TC_AVAX_GENERIC'
import TC_AVAX_PANGOLIN from './TC_AVAX_PANGOLIN'
import TC_AVAX_TRADER_JOE from './TC_AVAX_TRADER_JOE'
import TC_ETH_GENERIC from './TC_ETH_GENERIC'
import TC_ETH_LEG_UNISWAP_V2 from './TC_ETH_LEG_UNISWAP_V2'
import TC_ETH_SHORT_SUSHISWAP from './TC_ETH_SHORT_SUSHISWAP'
import TC_ETH_SHORT_UNISWAP_V2 from './TC_ETH_SHORT_UNISWAP_V2'
import TC_ETH_SHORT_UNISWAP_V3_001 from './TC_ETH_SHORT_UNISWAP_V3_001'
import TC_ETH_SHORT_UNISWAP_V3_1 from './TC_ETH_SHORT_UNISWAP_V3_1'
import TC_ETH_SHORT_UNISWAP_V3_03 from './TC_ETH_SHORT_UNISWAP_V3_03'
import TC_ETH_SHORT_UNISWAP_V3_005 from './TC_ETH_SHORT_UNISWAP_V3_005'
import TC_ETH_SUSHISWAP from './TC_ETH_SUSHISWAP'
import TC_ETH_UNISWAP_V2 from './TC_ETH_UNISWAP_V2'
import TC_ETH_UNISWAP_V3_1 from './TC_ETH_UNISWAP_V3_1'
import TC_ETH_UNISWAP_V3_03 from './TC_ETH_UNISWAP_V3_03'
import TC_ETH_UNISWAP_V3_005 from './TC_ETH_UNISWAP_V3_005'

export type TcRouterType =
  | 'TC_ROUTER_GENERIC'
  | 'TC_ROUTER_UNISWAP'
  | 'TC_ROUTER_PANGOLIN'
  | 'INVALID'
interface AbiMap {
  [pluginId: string]: {
    [contractAddress: string]: {
      name: string
      type: TcRouterType
      data: ContractInterface
    }
  }
}
export const abiMap: AbiMap = {
  ethereum: {
    '0x7c38b8b2eff28511ecc14a621e263857fb5771d3': {
      name: 'Thorchain Aggregator Ethereum Uniswap V2',
      data: TC_ETH_UNISWAP_V2,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0x0f2cd5df82959e00be7afeef8245900fc4414199': {
      name: 'Thorchain Aggregator Ethereum Sushiswap',
      data: TC_ETH_SUSHISWAP,
      type: 'INVALID'
    },
    '0x0747c681e5ada7936ad915ccff6cd3bd71dbf121': {
      name: 'Thorchain Aggregator Ethereum Uniswap V3 0.05%',
      data: TC_ETH_UNISWAP_V3_005,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0xd1ea5f7ce9da98d0bd7b1f4e3e05985e88b1ef10': {
      name: 'Thorchain Aggregator Ethereum Uniswap V3 0.3%',
      data: TC_ETH_UNISWAP_V3_03,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0x94a852f0a21e473078846cf88382dd8d15bd1dfb': {
      name: 'Thorchain Aggregator Ethereum Uniswap V3 1.0%',
      data: TC_ETH_UNISWAP_V3_1,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0x3660de6c56cfd31998397652941ece42118375da': {
      name: 'Thorchain Aggregator Leg Ethereum Uniswap V2',
      data: TC_ETH_LEG_UNISWAP_V2,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0xd31f7e39afecec4855fecc51b693f9a0cec49fd2': {
      name: 'Thorchain Aggregator Ethereum Generic',
      data: TC_ETH_GENERIC,
      type: 'TC_ROUTER_GENERIC'
    },
    '0x86904eb2b3c743400d03f929f2246efa80b91215': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V2',
      data: TC_ETH_SHORT_UNISWAP_V2,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0xbf365e79aa44a2164da135100c57fdb6635ae870': {
      name: 'Thorchain Aggregator Ethereum Short Notation Sushiswap',
      data: TC_ETH_SHORT_SUSHISWAP,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0xbd68cbe6c247e2c3a0e36b8f0e24964914f26ee8': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 0.01%',
      data: TC_ETH_SHORT_UNISWAP_V3_001,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0xe4ddca21881bac219af7f217703db0475d2a9f02': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 0.005',
      data: TC_ETH_SHORT_UNISWAP_V3_005,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0x11733abf0cdb43298f7e949c930188451a9a9ef2': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 0.3%',
      data: TC_ETH_SHORT_UNISWAP_V3_03,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0xb33874810e5395eb49d8bd7e912631db115d5a03': {
      name: 'Thorchain Aggregator Ethereum Short Notation Uniswap V3 1%',
      data: TC_ETH_SHORT_UNISWAP_V3_1,
      type: 'TC_ROUTER_UNISWAP'
    }
  },
  avalanche: {
    '0x942c6da485fd6cef255853ef83a149d43a73f18a': {
      name: 'Thorchain Aggregator Avalanche Pangolin',
      data: TC_AVAX_PANGOLIN,
      type: 'TC_ROUTER_PANGOLIN'
    },
    '0x3b7dbdd635b99cea39d3d95dbd0217f05e55b212': {
      name: 'Thorchain Aggregator Avalanche Trader Joe',
      data: TC_AVAX_TRADER_JOE,
      type: 'TC_ROUTER_UNISWAP'
    },
    '0x7c38b8b2eff28511ecc14a621e263857fb5771d3': {
      name: 'Thorchain Aggregator Avalanche Generic',
      data: TC_AVAX_GENERIC,
      type: 'TC_ROUTER_GENERIC'
    }
  }
}
