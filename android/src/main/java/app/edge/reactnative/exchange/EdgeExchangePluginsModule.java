package app.edge.reactnative.exchange;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import java.util.HashMap;
import java.util.Map;

public class EdgeExchangePluginsModule extends ReactContextBaseJavaModule {
  EdgeExchangePluginsModule(ReactApplicationContext context) {
    super(context);
  }

  @Override
  public Map<String, Object> getConstants() {
    final Map<String, Object> constants = new HashMap<>();
    constants.put(
        "sourceUri",
        "file:///android_asset/edge-exchange-plugins/edge-exchange-plugins.js");
    return constants;
  }

  @Override
  public String getName() {
    return "EdgeExchangePluginsModule";
  }
}
