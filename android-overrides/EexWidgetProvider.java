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

    private static final String PREFS_NAME = "eex_widget_data";
    private static final String KEY_STREAK = "streak";
    private static final String KEY_PENDING = "pending";
    private static final String KEY_ALL_DONE = "all_done";
    private static final String KEY_TITLE = "title";
    private static final String KEY_SUBTITLE = "subtitle";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int streak = prefs.getInt(KEY_STREAK, 0);
        int pending = prefs.getInt(KEY_PENDING, 1);
        boolean allDone = prefs.getBoolean(KEY_ALL_DONE, false);
        String customTitle = prefs.getString(KEY_TITLE, "");
        String customSubtitle = prefs.getString(KEY_SUBTITLE, "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.eex_widget_layout);

        // Badge de Sequência
        views.setTextViewText(R.id.widget_streak_badge, "🔥 " + streak + (streak == 1 ? " DIA" : " DIAS"));

        if (allDone) {
            // Agente Brave — Rotina concluída!
            views.setImageViewResource(R.id.widget_mascot_img, R.drawable.widget_agent_brave);
            views.setTextViewText(R.id.widget_title, !customTitle.isEmpty() ? customTitle : "ROTA ENTREGUE! 🚀");
            views.setTextViewText(R.id.widget_subtitle, !customSubtitle.isEmpty() ? customSubtitle : "Brave comemora: tudo feito hoje! Você é fera!");
        } else {
            // Agente Midnight — Rotina pendente, desespero estilo Duolingo!
            views.setImageViewResource(R.id.widget_mascot_img, R.drawable.widget_agent_midnight);
            views.setTextViewText(R.id.widget_title, !customTitle.isEmpty() ? customTitle : "ROTA PENDENTE! 🚨");
            String defaultSub = pending > 0 
                ? "Midnight em pânico! " + pending + " hábito(s) restante(s)!" 
                : "Midnight está ansiosa: faça seu check-in hoje!";
            views.setTextViewText(R.id.widget_subtitle, !customSubtitle.isEmpty() ? customSubtitle : defaultSub);
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
     * Atualiza os dados do widget e força atualização imediata na tela inicial
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

        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName componentName = new ComponentName(context, EexWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(componentName);

        for (int id : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, id);
        }
    }
}
