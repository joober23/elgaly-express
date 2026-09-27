# ⚡ Elgaly Express (EEX)

Sistema de Gestão de Rotinas, Encomendas Dimensionais e Agenda de Eventos.

---

## 📱 Como Baixar o APK do Aplicativo Android (via GitHub Actions)

Não é necessário ter o Android Studio instalado no seu computador! O GitHub compila o APK nas nuvens automaticamente.

### Passo a Passo:

1. **Suba as alterações para o seu repositório GitHub:**
   ```bash
   git add .
   git commit -m "feat: suporte a Capacitor e notificações nativas"
   git push origin main
   ```
2. **Abra o repositório no seu navegador:**
   - Clique na aba **"Actions"** no topo da página do GitHub.
   - Você verá o fluxo **"Build Android APK"** sendo executado.
3. **Baixe o arquivo `.apk`:**
   - Quando o fluxo concluir (aparecerá um ícone verde ✅), clique nele.
   - Role até a seção **"Artifacts"** no final da página.
   - Clique em **`elgaly-express-debug-apk`** para baixar o arquivo zip.
   - Extraia o `.apk` e envie para o seu celular (via WhatsApp, Google Drive, cabo USB ou Telegram).
4. **Instalação no celular:**
   - Toque no arquivo `.apk` no seu celular para instalar.
   - Se o Android pedir, permita a instalação de "Fontes desconhecidas" para o gerenciador de arquivos/navegador.

---

## 🔔 Sistema de Notificações Inteligentes

O Elgaly Express agenda alertas locais automáticos no seu dispositivo:

1. **🔄 Rotina Diária (A cada 3 horas):**
   - Disparos automáticos às **08:00**, **11:00**, **14:00**, **17:00** e **20:00**.
   - Notifica apenas quando ainda houver hábitos programados para o dia que não foram marcados como concluídos.
   - Planejado para os próximos 7 dias com base nos dias da semana definidos para cada hábito.

2. **📦 Encomendas & Prazos:**
   - **3 dias antes** do prazo (às 09:00): *"📦 Entregar em 3 dias! A encomenda [Nome] vence em 3 dias!"*
   - **1 dia antes** do prazo (às 09:00): *"🚨 Entregar amanhã! A encomenda [Nome] precisa ser despachada amanhã!"*
   - **No dia do vencimento** (às 09:00): *"🔴 Dia de Entrega! A encomenda [Nome] vence HOJE!"*

3. **📅 Eventos & Lembretes:**
   - **1 dia antes** (às 09:00): *"📅 Evento Amanhã! Lembrete do evento [Nome]"*
   - **1 hora antes** do horário marcado: *"⏰ Evento próximo! O evento [Nome] começa em 1 hora!"*
   - **No horário do evento**: *"🎯 Evento agora! O evento [Nome] está acontecendo agora!"*

---

## ⚙️ Tecnologias

- **Core:** HTML5, CSS3 Brutalista/Cyberpunk, JavaScript Vanilla (ES6+)
- **Cloud & Auth:** Firebase Auth (Google) & Cloud Firestore
- **Mobile Engine:** Capacitor 6 (@capacitor/android, @capacitor/local-notifications)
- **Offline & Web:** Service Worker & PWA Manifest
- **CI/CD:** GitHub Actions (Build automático de APK Debug)
