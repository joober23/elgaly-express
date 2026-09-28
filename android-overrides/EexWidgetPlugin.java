package com.elgaly.express;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EexWidget")
public class EexWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        int streak = call.getInt("streak", 0);
        int pending = call.getInt("pending", 0);
        boolean allDone = call.getBoolean("allDone", false);
        String title = call.getString("title", "");
        String subtitle = call.getString("subtitle", "");

        EexWidgetProvider.updateWidgetData(getContext(), streak, pending, allDone, title, subtitle);
        call.resolve();
    }
}
