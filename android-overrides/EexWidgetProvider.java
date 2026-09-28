package com.elgaly.express;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

public class EexWidgetProvider extends AppWidgetProvider {

    protected static final String PREFS_NAME = "eex_widget_data";
    protected static final String KEY_STREAK = "streak";
    protected static final String KEY_PENDING = "pending";
    protected static final String KEY_ALL_DONE = "all_done";
    protected static final String KEY_TITLE = "title";
    protected static final String KEY_SUBTITLE = "subtitle";

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
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int streak = prefs.getInt(KEY_STREAK, 0);
        int pending = prefs.getInt(KEY_PENDING, 1);
        boolean allDone = prefs.getBoolean(KEY_ALL_DONE, false);
        String customTitle = prefs.getString(KEY_TITLE, "");
        String customSubtitle = prefs.getString(KEY_SUBTITLE, "");

        RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);

        // Texto da Sequência / Streak
        String streakStr = streak + (streak == 1 ? " DIA" : " DIAS");
        views.setTextViewText(R.id.widget_streak_text, streakStr);

        // Ícone da Chama de Fogo (fireon.png somente se TODAS as rotinas forem cumpridas!)
        if (allDone) {
            views.setImageViewResource(R.id.widget_fire_icon, R.drawable.widget_fire_on);
            // Agente Brave comemora!
            views.setImageViewResource(R.id.widget_mascot_img, R.drawable.widget_agent_brave);
            views.setTextViewText(R.id.widget_title, !customTitle.isEmpty() ? customTitle : "ROTA ENTREGUE! 🚀");
            try {
                views.setTextViewText(R.id.widget_subtitle, !customSubtitle.isEmpty() ? customSubtitle : "Brave comemora: tudo feito hoje! Você é fera!");
            } catch (Exception ignored) {}
        } else {
            views.setImageViewResource(R.id.widget_fire_icon, R.drawable.widget_fire_off);
            // Agente Midnight em pânico!
            views.setImageViewResource(R.id.widget_mascot_img, R.drawable.widget_agent_midnight);
            views.setTextViewText(R.id.widget_title, !customTitle.isEmpty() ? customTitle : "ROTA PENDENTE! 🚨");
            String defaultSub = pending > 0 
                ? "Midnight em pânico: " + pending + " hábito(s) restante(s)!" 
                : "Midnight ansiosa: faça seu check-in hoje!";
            try {
                views.setTextViewText(R.id.widget_subtitle, !customSubtitle.isEmpty() ? customSubtitle : defaultSub);
            } catch (Exception ignored) {}
        }

        // Toque no widget abre o aplicativo
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
    }

    /**
     * Atualiza os dados de todos os widgets (4x2, 2x2 e 4x1) simultaneamente
     */
    public static void updateWidgetData(Context context, int streak, int pending, boolean allDone, String title, String subtitle) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putInt(KEY_STREAK, streak)
            .putInt(KEY_PENDING, pending)
            .putBoolean(KEY_ALL_DONE, allDone)
            .putString(KEY_TITLE, title != null ? title : "")
            .putString(KEY_SUBTITLE, subtitle != null ? subtitle : "")
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
    }
}
