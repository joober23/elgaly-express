package com.elgaly.express;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import android.widget.RemoteViews;

public class EexWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "EexWidget";
    protected static final String PREFS_NAME = "eex_widget_data";
    protected static final String KEY_STREAK = "streak";
    protected static final String KEY_PENDING = "pending";
    protected static final String KEY_COMPLETED = "completed";
    protected static final String KEY_TOTAL = "total";
    protected static final String KEY_SHELLS = "shells";
    protected static final String KEY_ALL_DONE = "all_done";
    protected static final String KEY_TITLE = "title";
    protected static final String KEY_SUBTITLE = "subtitle";
    protected static final String KEY_NEXT_HABIT = "next_habit";
    protected static final String KEY_AGENT_NAME = "agent_name";

    protected int getLayoutId() {
        return R.layout.eex_widget_layout_4x2;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId, getLayoutId());
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId, int layoutId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            int streak = prefs.getInt(KEY_STREAK, 0);
            int pending = prefs.getInt(KEY_PENDING, 1);
            int completed = prefs.getInt(KEY_COMPLETED, 0);
            int total = prefs.getInt(KEY_TOTAL, Math.max(1, completed + pending));
            int shells = prefs.getInt(KEY_SHELLS, 0);
            boolean allDone = prefs.getBoolean(KEY_ALL_DONE, false);
            String customTitle = prefs.getString(KEY_TITLE, "");
            String customSubtitle = prefs.getString(KEY_SUBTITLE, "");
            String nextHabit = prefs.getString(KEY_NEXT_HABIT, "");

            RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);

            // 1. Fundo do Card Neo-Brutalista com Sombra Rígida 3D
            try {
                int cardBgRes = allDone ? R.drawable.eex_widget_card_done : R.drawable.eex_widget_card_pending;
                views.setInt(R.id.widget_card_bg, "setBackgroundResource", cardBgRes);
            } catch (Exception ignored) {}

            // 2. Texto da Sequência / Streak em Darumadrop One
            String streakStr = streak + (streak == 1 ? " DIA" : " DIAS");
            views.setTextViewText(R.id.widget_streak_text, streakStr);

            // 3. Ícone da Chama de Fogo (fireon somente se 100% cumprida)
            if (allDone) {
                views.setImageViewResource(R.id.widget_fire_icon, R.drawable.widget_fire_on);
                views.setImageViewResource(R.id.widget_mascot_img, R.drawable.widget_agent_brave);

                try {
                    views.setTextViewText(R.id.widget_agent_tag, "BRAVE ★");
                } catch (Exception ignored) {}

                views.setTextViewText(R.id.widget_title, !customTitle.isEmpty() ? customTitle : "ROTA ENTREGUE! 🚀");

                try {
                    views.setTextViewText(R.id.widget_subtitle, !customSubtitle.isEmpty() ? customSubtitle : "Brave comemora: 100% dos hábitos concluídos! Lenda!");
                } catch (Exception ignored) {}

                try {
                    views.setTextViewText(R.id.widget_progress_text, "🎉 100% FEITO (" + total + "/" + total + " HÁBITOS)");
                } catch (Exception ignored) {}

                try {
                    views.setTextViewText(R.id.widget_next_habit, "★ EXPEDIENTE CUMPRIDO COM SUCESSO!");
                } catch (Exception ignored) {}

                try {
                    views.setTextViewText(R.id.widget_btn_action, "✨ VER ROTINA");
                } catch (Exception ignored) {}

            } else {
                views.setImageViewResource(R.id.widget_fire_icon, R.drawable.widget_fire_off);
                views.setImageViewResource(R.id.widget_mascot_img, R.drawable.widget_agent_midnight);

                try {
                    views.setTextViewText(R.id.widget_agent_tag, "MIDNIGHT 🚨");
                } catch (Exception ignored) {}

                views.setTextViewText(R.id.widget_title, !customTitle.isEmpty() ? customTitle : "ROTA PENDENTE! 🚨");

                String defaultSub = pending > 0 
                    ? "Midnight em pânico: faltam " + pending + " hábito(s) hoje!" 
                    : "Midnight ansiosa: faça seu check-in dimensional!";
                try {
                    views.setTextViewText(R.id.widget_subtitle, !customSubtitle.isEmpty() ? customSubtitle : defaultSub);
                } catch (Exception ignored) {}

                try {
                    views.setTextViewText(R.id.widget_progress_text, "⏳ " + completed + "/" + total + " HÁBITOS FEITOS (" + pending + " RESTANTES)");
                } catch (Exception ignored) {}

                try {
                    String nextText = !nextHabit.isEmpty() ? "🎯 PRÓXIMO: " + nextHabit : "🎯 PRÓXIMO: Abrir Central de Despacho";
                    views.setTextViewText(R.id.widget_next_habit, nextText);
                } catch (Exception ignored) {}

                try {
                    views.setTextViewText(R.id.widget_btn_action, "⚡ DESPACHAR");
                } catch (Exception ignored) {}
            }

            // 4. Conchas EEX faturadas
            try {
                views.setTextViewText(R.id.widget_shells_display, "🐚 " + shells + " CONCHAS");
            } catch (Exception ignored) {}

            // 5. Frase Fofa e Caótica da Tudum IA
            try {
                String quote = allDone 
                    ? "tudum!! despachei tudinho em tempo recorde! 🎀" 
                    : "tudum!! bora fatiar tudo pra não surtar! ✨";
                views.setTextViewText(R.id.widget_tudum_quote, quote);
            } catch (Exception ignored) {}

            // 6. Toque no widget abre o aplicativo
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 
                0, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

            appWidgetManager.updateAppWidget(appWidgetId, views);
        } catch (Throwable t) {
            Log.e(TAG, "Erro ao atualizar widget ID " + appWidgetId + " com layout " + layoutId, t);
        }
    }

    /**
     * Atualiza os dados de todos os widgets (4x2, 2x2 e 4x1) simultaneamente
     */
    public static void updateWidgetData(Context context, int streak, int pending, int completed, int total, int shells, boolean allDone, String title, String subtitle, String nextHabit, String agentName) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                .putInt(KEY_STREAK, streak)
                .putInt(KEY_PENDING, pending)
                .putInt(KEY_COMPLETED, completed)
                .putInt(KEY_TOTAL, total)
                .putInt(KEY_SHELLS, shells)
                .putBoolean(KEY_ALL_DONE, allDone)
                .putString(KEY_TITLE, title != null ? title : "")
                .putString(KEY_SUBTITLE, subtitle != null ? subtitle : "")
                .putString(KEY_NEXT_HABIT, nextHabit != null ? nextHabit : "")
                .putString(KEY_AGENT_NAME, agentName != null ? agentName : "Agente")
                .apply();

            AppWidgetManager mgr = AppWidgetManager.getInstance(context);

            // Atualiza 4x2
            int[] ids4x2 = mgr.getAppWidgetIds(new ComponentName(context, EexWidgetProvider.class));
            for (int id : ids4x2) {
                updateAppWidget(context, mgr, id, R.layout.eex_widget_layout_4x2);
            }

            // Atualiza 2x2
            int[] ids2x2 = mgr.getAppWidgetIds(new ComponentName(context, EexWidgetProvider2x2.class));
            for (int id : ids2x2) {
                updateAppWidget(context, mgr, id, R.layout.eex_widget_layout_2x2);
            }

            // Atualiza 4x1
            int[] ids4x1 = mgr.getAppWidgetIds(new ComponentName(context, EexWidgetProvider4x1.class));
            for (int id : ids4x1) {
                updateAppWidget(context, mgr, id, R.layout.eex_widget_layout_4x1);
            }
        } catch (Throwable t) {
            Log.e(TAG, "Erro ao gravar dados do widget", t);
        }
    }

    // Sobrecarga de compatibilidade retroativa
    public static void updateWidgetData(Context context, int streak, int pending, boolean allDone, String title, String subtitle) {
        updateWidgetData(context, streak, pending, 0, pending, 0, allDone, title, subtitle, "", "Agente");
    }
}
