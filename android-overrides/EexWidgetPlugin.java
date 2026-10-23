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
        int completed = call.getInt("completed", 0);
        int total = call.getInt("total", Math.max(1, completed + pending));
        int shells = call.getInt("shells", 0);
        boolean allDone = call.getBoolean("allDone", false);
        String title = call.getString("title", "");
        String subtitle = call.getString("subtitle", "");
        String nextHabit = call.getString("nextHabit", "");
        String agentName = call.getString("agentName", "Agente");

        EexWidgetProvider.updateWidgetData(getContext(), streak, pending, completed, total, shells, allDone, title, subtitle, nextHabit, agentName);
        call.resolve();
    }
}
