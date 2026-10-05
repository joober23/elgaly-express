package com.elgaly.express;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EexIcon")
public class EexIconPlugin extends Plugin {

    // Alias padrão (ícone original roxo)
    private static final String ALIAS_DEFAULT  = "com.elgaly.express.MainActivity";
    private static final String ALIAS_ROSA     = "com.elgaly.express.IconRosaExpress";
    private static final String ALIAS_ROXO     = "com.elgaly.express.IconRoxoNumetalico";
    private static final String ALIAS_VERDE    = "com.elgaly.express.IconVerdeMagafico";

    private static final String[] ALL_ALIASES = {
        ALIAS_DEFAULT, ALIAS_ROSA, ALIAS_ROXO, ALIAS_VERDE
    };

    /**
     * Chamado do JavaScript via: Capacitor.Plugins.EexIcon.setThemeIcon({ theme: 'rosa-express' })
     */
    @PluginMethod
    public void setThemeIcon(PluginCall call) {
        // Desativado a pedido do usuário: manter sempre o ícone padrão oficial (sem trocar cor)
        String targetAlias = ALIAS_DEFAULT;

        try {
            PackageManager pm = getContext().getPackageManager();

            for (String alias : ALL_ALIASES) {
                boolean enable = alias.equals(targetAlias);
                pm.setComponentEnabledSetting(
                    new ComponentName(getContext(), alias),
                    enable
                        ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                );
            }

            call.resolve();
        } catch (Exception e) {
            call.reject("Erro ao fixar ícone padrão: " + e.getMessage(), e);
        }
    }
}
