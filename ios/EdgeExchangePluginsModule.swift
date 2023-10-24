@objc(EdgeExchangePluginsModule) class EdgeExchangePluginsModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { return false }

  @objc func constantsToExport() -> NSDictionary {
    return ["sourceUri": sourceUri() ?? ""]
  }

  func sourceUri() -> String? {
    if let bundleUrl = Bundle.main.url(
      forResource: "edge-exchange-plugins",
      withExtension: "bundle"
    ),
      let bundle = Bundle(url: bundleUrl),
      let script = bundle.url(forResource: "edge-exchange-plugins", withExtension: "js")
    {
      return script.absoluteString
    }
    return nil
  }
}
