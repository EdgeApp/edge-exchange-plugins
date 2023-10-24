declare module 'react-native' {
  export const NativeModules: {
    EdgeExchangePluginsModule: {
      getConstants: () => {
        sourceUri: string
      }
    }
  }
}
