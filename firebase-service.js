/**
 * ELGALY EXPRESS - SERVIÇO DE SINCRONIZAÇÃO EM NUVEM (FIREBASE)
 * Gerencia Login com Google, Perfis Customizados e Banco de Dados Cloud Firestore em tempo real.
 */

// Configuração oficial do projeto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCqiHc-EI3HKK557PXiVHoiqbZ6hPFGMws",
  authDomain: "elgaly-express-230108.firebaseapp.com",
  projectId: "elgaly-express-230108",
  storageBucket: "elgaly-express-230108.firebasestorage.app",
  messagingSenderId: "1008407071059",
  appId: "1:1008407071059:web:d42e1754bad1257a6bb9a6"
};

const FirebaseService = {
  auth: null,
  db: null,
  messaging: null,
  isInitialized: false,
  unsubscribeTasks: null,
  unsubscribeHabits: null,
  unsubscribeHistory: null,
  unsubscribeEvents: null,

  // VAPID Key publica do Firebase Console:
  // Firebase Console → Projeto → Cloud Messaging → Web Push certificates → Gerar par de chaves
  // Cole a chave publica aqui:
  VAPID_KEY: 'BKzC1OgoCC1Vths73Ne40SVrWRTjGlOZVi0E-fSWYL1mndbITK-QdSM0mXkxkAmJRmBh8lC_BHuAfIYPLP9mahY',


  init() {
    if (typeof firebase === 'undefined') {
      console.warn('SDK do Firebase não carregado.');
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      this.auth = firebase.auth();
      this.db = firebase.firestore();

      // Habilitar persistência offline do Firestore
      this.db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code === 'failed-precondition') {
          console.warn('Persistência offline desativada: múltiplas abas abertas.');
        } else if (err.code === 'unimplemented') {
          console.warn('Navegador não suporta persistência offline do Firestore.');
        }
      });

      this.isInitialized = true;
      
      // Processa retorno de autenticação via redirecionamento
      this.auth.getRedirectResult().then(result => {
        if (result && result.user) {
          console.log('✅ Autenticação por redirecionamento concluída:', result.user.email);
        }
      }).catch(err => {
        if (err.code !== 'auth/null-user') {
          console.warn('Aviso getRedirectResult:', err);
        }
      });

      this.setupAuthStateListener();

      // Inicializa GoogleAuth nativo caso esteja rodando como app Capacitor
      if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) {
        try {
          window.Capacitor.Plugins.GoogleAuth.initialize({
            clientId: '1008407071059-g2fqbpnscjgtq0st91g32q3bpf7r88lt.apps.googleusercontent.com',
            scopes: ['profile', 'email'],
            grantOfflineAccess: false
          });
          console.log('📱 GoogleAuth nativo inicializado no Capacitor.');
        } catch (e) {
          console.warn('GoogleAuth init:', e);
        }
      }

      console.log('⚡ Firebase conectado com sucesso!');
    } catch (err) {
      console.error('Erro ao inicializar Firebase:', err);
    }
  },

  /**
   * Inicializa o Firebase Cloud Messaging (FCM) para notificacoes push
   * Solicita permissao, obtem o token e salva no Firestore
   */
  async initFCM() {
    if (typeof firebase === 'undefined' || !firebase.messaging) {
      console.log('FCM: SDK de messaging nao disponivel.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.log('FCM: Navegador nao suporta Service Workers ou Notifications.');
      return;
    }
    if (this.VAPID_KEY === 'COLE_SUA_VAPID_KEY_AQUI') {
      console.warn('FCM: VAPID Key nao configurada. Veja firebase-service.js > VAPID_KEY.');
      return;
    }
    try {
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      this.messaging = firebase.messaging();
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('FCM: Permissao negada pelo usuario.');
        return;
      }
      const token = await this.messaging.getToken({
        vapidKey: this.VAPID_KEY,
        serviceWorkerRegistration: swReg
      });
      if (token) {
        await this.saveFcmToken(token);
        this.messaging.onTokenRefresh(async () => {
          const newToken = await this.messaging.getToken({ vapidKey: this.VAPID_KEY, serviceWorkerRegistration: swReg });
          if (newToken) await this.saveFcmToken(newToken);
        });
        // Mensagens em foreground — exibe como toast
        this.messaging.onMessage((payload) => {
          const title = (payload.notification && payload.notification.title) ? payload.notification.title : 'Elgaly Express';
          const body  = (payload.notification && payload.notification.body)  ? payload.notification.body  : '';
          const type  = (payload.data && payload.data.type) ? payload.data.type : '';
          if (typeof AppUI !== 'undefined' && AppUI.showToast) {
            const icons = { package: '📦', friend_request: '🤝', poke: '📢' };
            const icon  = icons[type] || '🔔';
            AppUI.showToast(icon + ' ' + title + (body ? ': ' + body.substring(0, 60) : ''));
          }
        });
        console.log('FCM: Notificacoes push ativas!');
      }
    } catch (err) {
      console.warn('FCM: Erro ao inicializar:', err);
    }
  },

  /**
   * Salva o token FCM no documento do usuario no Firestore
   */
  async saveFcmToken(token) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    try {
      await this.db.collection('users').doc(this.auth.currentUser.uid).set(
        { fcmToken: token, fcmUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.warn('FCM: Erro ao salvar token:', e);
    }
  },

  /**
   * Monitora estado de login do Firebase
   */
  setupAuthStateListener() {

    this.auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        const email = firebaseUser.email || '';
        const defaultNick = email ? email.split('@')[0] : (firebaseUser.displayName || 'agente').toLowerCase().replace(/\s+/g, '.');
        const defaultEexEmail = AuthManager.formatEexNickname(defaultNick);

        const realCreation = firebaseUser.metadata?.creationTime 
          ? new Date(firebaseUser.metadata.creationTime).toISOString() 
          : '2026-09-24T12:00:00.000Z';

        let userData = {
          id: firebaseUser.uid,
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'Agente',
          nickname: defaultNick,
          eexEmail: defaultEexEmail,
          avatar: firebaseUser.photoURL || 'images/elgalylogo.png',
          location: 'São Paulo - SP',
          email: email,
          isGoogle: true,
          onboardingDone: false,
          joinedAt: realCreation
        };

        // Verifica se o usuário já possui perfil customizado salvo no Firestore
        try {
          const profileDoc = await this.db.collection('users').doc(firebaseUser.uid).collection('system').doc('profile').get();
          if (profileDoc.exists) {
            const cloudProfile = profileDoc.data();
            if (cloudProfile.joinedAt) {
              const cloudDate = new Date(cloudProfile.joinedAt);
              const todayStr = new Date().toLocaleDateString('en-CA');
              const cloudStr = !isNaN(cloudDate.getTime()) ? cloudDate.toLocaleDateString('en-CA') : '';
              if ((cloudStr === todayStr || !cloudStr) && realCreation) {
                cloudProfile.joinedAt = realCreation;
                this.db.collection('users').doc(firebaseUser.uid).collection('system').doc('profile').set({ joinedAt: realCreation }, { merge: true });
              }
            } else {
              cloudProfile.joinedAt = realCreation;
              this.db.collection('users').doc(firebaseUser.uid).collection('system').doc('profile').set({ joinedAt: realCreation }, { merge: true });
            }
            userData = { ...userData, ...cloudProfile };
            if (cloudProfile.purchasedThemes && typeof ThemeManager !== 'undefined') {
              ThemeManager.syncPurchasedThemes(cloudProfile.purchasedThemes);
            }
            if (cloudProfile.preferredTheme && typeof ThemeManager !== 'undefined') {
              const targetTheme = ThemeManager.isThemeUnlocked(cloudProfile.preferredTheme, userData)
                ? cloudProfile.preferredTheme
                : 'rosa-express';
              ThemeManager.setTheme(targetTheme, false, false);
            }
          } else {
            this.db.collection('users').doc(firebaseUser.uid).collection('system').doc('profile').set({ joinedAt: realCreation }, { merge: true });
          }
        } catch (e) {
          console.warn('Perfil na nuvem não encontrado, usando padrão do Google.');
        }

        // Sanitiza localização antiga/fictícia para São Paulo - SP
        if (!userData.location || (typeof isValidSpCity === 'function' && !isValidSpCity(userData.location)) || /nova amerit|nova arcanis|elgaly edge/i.test(userData.location || '')) {
          userData.location = 'São Paulo - SP';
        }

        AuthManager.currentUser = userData;
        AuthManager.saveCurrent();

        // Primeiro acesso: onboarding obrigatório
        if (!userData.onboardingDone) {
          // Preenche o preview do avatar com a foto do Google
          const onbPreview = document.getElementById('onbAvatarPreview');
          if (onbPreview && userData.avatar) onbPreview.src = userData.avatar;
          // Oculta o auth gateway e exibe o modal de onboarding
          const gw = document.getElementById('authGateway');
          if (gw) gw.style.display = 'none';
          document.getElementById('appViewsContainer').style.display = 'none';
          document.getElementById('modalOnboarding').classList.add('active');
          return; // Não inicializa o app ainda
        }

        // Onboarding já feito — verifica se o EEX-PASS já foi validado nesta sessão
        // Garante que o crachá público esteja sincronizado no Firestore
        this.updatePublicProfile(userData).catch(() => {});

        const sessionVerified = sessionStorage.getItem('elgaly_eex_pass_verified_' + userData.uid) === 'true';
        if (sessionVerified) {
          AuthManager.isEexPassVerified = true;
          this.startRealtimeSync(firebaseUser.uid);
          if (typeof EEXPlusManager !== 'undefined') EEXPlusManager.init();
          AppUI.renderAll();
          AppUI.showToast(`☁️ Bem-vindo de volta, ${userData.name}!`);

          // Inicializa FCM para notificacoes push
          setTimeout(() => this.initFCM(), 2000);

        } else {
          // Exige validação do EEX-PASS antes de liberar o despacho
          AuthManager.isEexPassVerified = false;
          const gw = document.getElementById('authGateway');
          if (gw) gw.style.display = 'none';
          const appViews = document.getElementById('appViewsContainer');
          if (appViews) appViews.style.display = 'none';
          if (typeof AppUI !== 'undefined' && AppUI.showEexPassPrompt) {
            AppUI.showEexPassPrompt(userData);
          }
        }
      } else {
        // Usuário deslogado do Firebase
        this.stopRealtimeSync();
        if (AuthManager.currentUser) {
          sessionStorage.removeItem('elgaly_eex_pass_verified_' + AuthManager.currentUser.id);
          AuthManager.isEexPassVerified = false;
          AuthManager.currentUser = null;
          AuthManager.saveCurrent();
          AppUI.renderAll();
        }
      }
    });
  },

  /**
   * Realiza login com a Conta Google (Nativo no Android/APK e Pop-up no Navegador/PWA)
   */
  async loginWithGoogle() {
    if (!this.isInitialized) {
      alert('Firebase ainda não inicializado. Verifique sua conexão com a internet.');
      return;
    }

    const isNative = typeof window !== 'undefined' &&
      window.Capacitor &&
      window.Capacitor.isNativePlatform &&
      window.Capacitor.isNativePlatform();

    // 1. SE ESTIVER NO APLICATIVO NATIVO (APK ANDROID): Login nativo direto com Google Play Services
    if (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) {
      try {
        console.log('📱 Iniciando login nativo com Google Play Services...');
        const googleUser = await window.Capacitor.Plugins.GoogleAuth.signIn();
        if (googleUser && googleUser.authentication && googleUser.authentication.idToken) {
          const credential = firebase.auth.GoogleAuthProvider.credential(googleUser.authentication.idToken);
          await this.auth.signInWithCredential(credential);
          console.log('✅ Login nativo com Firebase concluído com sucesso!');
          const modal = document.getElementById('modalAuth');
          if (modal) modal.classList.remove('active');
          return;
        } else {
          throw new Error('Não foi possível obter o token de autenticação do Google.');
        }
      } catch (nativeErr) {
        console.error('Erro no login nativo do Google:', nativeErr);
        if (nativeErr && (nativeErr.error === '12501' || (typeof nativeErr === 'string' && nativeErr.includes('12501')) || nativeErr.message?.includes('12501') || nativeErr.message?.includes('canceled') || nativeErr.message?.includes('cancelled'))) {
          // Usuário fechou ou cancelou o diálogo de seleção de conta
          return;
        }
        alert('Erro no login nativo do Google: ' + (nativeErr.message || JSON.stringify(nativeErr)));
        return;
      }
    }

    // 2. SE ESTIVER NO NAVEGADOR / PWA: Login via Pop-up Web
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await this.auth.signInWithPopup(provider);
      
      const modal = document.getElementById('modalAuth');
      if (modal) modal.classList.remove('active');
    } catch (err) {
      console.error('Erro ao fazer login com Google:', err);

      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        console.log('Login cancelado pelo usuário.');
        return;
      }

      if (err.code === 'auth/unauthorized-domain') {
        const domain = window.location.hostname;
        alert(
          `⚠️ Domínio não autorizado no Firebase!\n\n` +
          `O domínio "${domain}" precisa ser adicionado no Console do Firebase:\n` +
          `1. Acesse https://console.firebase.google.com\n` +
          `2. Vá em Authentication > Configurações > Domínios autorizados\n` +
          `3. Clique em "Adicionar domínio" e digite: ${domain}`
        );
        return;
      }

      if (err.code === 'auth/popup-blocked') {
        alert('⚠️ O seu navegador bloqueou a janela pop-up de login do Google. Por favor, autorize pop-ups para este site e tente novamente.');
        return;
      }

      alert('Erro ao autenticar com o Google (' + err.code + '): ' + err.message);
    }
  },



  /**
   * Realiza logout
   */
  async logout() {
    this.stopRealtimeSync();
    if (this.auth && this.auth.currentUser) {
      await this.auth.signOut();
    }
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) {
      try {
        await window.Capacitor.Plugins.GoogleAuth.signOut();
      } catch (e) {}
    }
  },

  /**
   * Sincronização em tempo real com o Cloud Firestore
   */
  startRealtimeSync(uid) {
    if (!this.db) return;
    this.stopRealtimeSync();

    const userDoc = this.db.collection('users').doc(uid);

    // 1. Escuta tarefas em tempo real (qualquer mudança no PC reflete no celular!)
    this.unsubscribeTasks = userDoc.collection('tasks').onSnapshot(snapshot => {
      const cloudTasks = [];
      snapshot.forEach(doc => {
        cloudTasks.push({ id: doc.id, ...doc.data() });
      });

      cloudTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      TaskManager.tasks = cloudTasks;
      TaskManager.saveLocally();
      AppUI.renderTasks();
      AppUI.renderHomeOverview();
      ReportEngine.renderReportPreview();
    }, err => {
      console.warn('Erro ao escutar tarefas do Firestore:', err);
    });

    // 2. Escuta hábitos em tempo real
    this.unsubscribeHabits = userDoc.collection('habits').onSnapshot(snapshot => {
      const cloudHabits = [];
      snapshot.forEach(doc => {
        cloudHabits.push({ id: doc.id, ...doc.data() });
      });
      HabitManager.habits = cloudHabits;
      HabitManager.saveHabitsLocally();
      AppUI.renderDailyRoutine();
      AppUI.renderHomeOverview();
      ReportEngine.renderReportPreview();
    }, err => {
      console.warn('Erro ao escutar hábitos do Firestore:', err);
    });

    // 3. Escuta histórico de hábitos
    this.unsubscribeHistory = userDoc.collection('system').doc('habit_history').onSnapshot(doc => {
      if (doc.exists) {
        HabitManager.history = doc.data() || {};
        HabitManager.saveHistoryLocally();
        AppUI.renderDailyRoutine();
        AppUI.renderHomeOverview();
        ReportEngine.renderReportPreview();
      }
    }, err => {
      console.warn('Erro ao escutar histórico do Firestore:', err);
    });

    // 4. Escuta eventos e lembretes em tempo real
    this.unsubscribeEvents = userDoc.collection('events').onSnapshot(snapshot => {
      const cloudEvents = [];
      snapshot.forEach(doc => {
        cloudEvents.push({ id: doc.id, ...doc.data() });
      });
      cloudEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
      if (typeof EventManager !== 'undefined') {
        EventManager.events = cloudEvents;
        EventManager.saveLocally();
        AppUI.renderEvents();
        AppUI.renderHomeOverview();
      }
    }, err => {
      console.warn('Erro ao escutar eventos do Firestore:', err);
    });

    // 5. Escuta memórias e fotos com adesivos em tempo real
    this.unsubscribeMemories = userDoc.collection('memories').onSnapshot(snapshot => {
      const cloudMemories = [];
      snapshot.forEach(doc => {
        cloudMemories.push({ id: doc.id, ...doc.data() });
      });
      cloudMemories.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      if (typeof MemoriesManager !== 'undefined') {
        MemoriesManager.memories = cloudMemories;
        MemoriesManager.saveLocally();
        MemoriesManager.render();
      }
    }, err => {
      console.warn('Erro ao escutar memórias do Firestore:', err);
    });

    // 6. Escuta lista de amigos em tempo real
    this.unsubscribeFriends = userDoc.collection('friends').onSnapshot(async snapshot => {
      const friendIds = [];
      snapshot.forEach(doc => friendIds.push(doc.id));
      if (typeof FriendsManager !== 'undefined') {
        await FriendsManager.onFriendsListChanged(friendIds);
      }
    }, err => {
      console.warn('Erro ao escutar amigos do Firestore:', err);
    });

    // 7. Escuta pedidos de amizade pendentes recebidos
    this.unsubscribeRequests = this.db.collection('friend_requests')
      .where('toUid', '==', uid)
      .where('status', '==', 'pending')
      .onSnapshot(snapshot => {
        const reqs = [];
        snapshot.forEach(doc => reqs.push({ id: doc.id, ...doc.data() }));
        if (typeof FriendsManager !== 'undefined') {
          FriendsManager.setPendingRequests(reqs);
        }
      }, err => {
        console.warn('Erro ao escutar pedidos de amizade:', err);
      });

    // 8. Escuta cutucadas / pokes recebidos
    this.unsubscribePokes = userDoc.collection('pokes')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const poke = change.doc.data();
            const ageMs = Date.now() - (poke.timestamp || 0);
            if (ageMs < 120000 && typeof AppUI !== 'undefined') { // Recebido nos últimos 2 minutos
              AppUI.showToast(`⚡ Agente ${poke.fromName} (@${poke.fromNick}) buzinou e te deu um Boost de +15 XP! 📢`);
              if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
                AuthManager.addXp(15, `Boost de parceiro recebido de ${poke.fromName}! ⚡`);
              }
            }
          }
        });
      }, err => {
        console.warn('Erro ao escutar pokes:', err);
      });

    // 9. Escuta encomendas / cartinhas express recebidas
    this.unsubscribePackages = userDoc.collection('packages')
      .where('opened', '==', false)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const pkg = { id: change.doc.id, ...change.doc.data() };
            if (typeof FriendsManager !== 'undefined') {
              FriendsManager.onPackageReceived(pkg);
            }
          }
        });
      }, err => {
        console.warn('Erro ao escutar encomendas recebidas:', err);
      });

    // 10. Escuta preferências de perfil em tempo real (ex: tema sincronizado entre PC e Celular)
    this.unsubscribeProfile = userDoc.collection('system').doc('profile').onSnapshot(doc => {
      if (doc.exists) {
        const data = doc.data();
        if (data && data.purchasedThemes && typeof ThemeManager !== 'undefined') {
          ThemeManager.syncPurchasedThemes(data.purchasedThemes);
        }
        if (data && data.preferredTheme && typeof ThemeManager !== 'undefined') {
          // Se o usuário alterou o tema localmente nos últimos 3 segundos,
          // não permite que snapshot defasado do Firestore reverta ou cause conflito/loop
          const isRecentLocalChange = ThemeManager.lastLocalChange && (Date.now() - ThemeManager.lastLocalChange < 3000);
          if (!isRecentLocalChange) {
            const targetTheme = ThemeManager.isThemeUnlocked(data.preferredTheme)
              ? data.preferredTheme
              : 'rosa-express';
            if (ThemeManager.current !== targetTheme) {
              ThemeManager.setTheme(targetTheme, false, false);
            }
          }
        }
      }
    }, err => {
      console.warn('Erro ao escutar perfil do Firestore:', err);
    });

    // 11. Escuta anotações do Bloquinho EEX em tempo real
    this.unsubscribeNotes = userDoc.collection('notes').onSnapshot(snapshot => {
      const cloudNotes = [];
      snapshot.forEach(doc => {
        cloudNotes.push({ id: doc.id, ...doc.data() });
      });
      cloudNotes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      if (typeof NotesManager !== 'undefined') {
        NotesManager.onCloudSync(cloudNotes);
      }
    }, err => {
      console.warn('Erro ao escutar notas do Firestore:', err);
    });
  },

  stopRealtimeSync() {
    if (this.unsubscribeTasks) { this.unsubscribeTasks(); this.unsubscribeTasks = null; }
    if (this.unsubscribeHabits) { this.unsubscribeHabits(); this.unsubscribeHabits = null; }
    if (this.unsubscribeHistory) { this.unsubscribeHistory(); this.unsubscribeHistory = null; }
    if (this.unsubscribeEvents) { this.unsubscribeEvents(); this.unsubscribeEvents = null; }
    if (this.unsubscribeMemories) { this.unsubscribeMemories(); this.unsubscribeMemories = null; }
    if (this.unsubscribeNotes) { this.unsubscribeNotes(); this.unsubscribeNotes = null; }
    if (this.unsubscribeFriends) { this.unsubscribeFriends(); this.unsubscribeFriends = null; }
    if (this.unsubscribeRequests) { this.unsubscribeRequests(); this.unsubscribeRequests = null; }
    if (this.unsubscribePokes) { this.unsubscribePokes(); this.unsubscribePokes = null; }
    if (this.unsubscribePackages) { this.unsubscribePackages(); this.unsubscribePackages = null; }
    if (this.unsubscribeProfile) { this.unsubscribeProfile(); this.unsubscribeProfile = null; }
  },

  // ========================================================
  // OPERAÇÕES DE ESCRITA NO FIRESTORE
  // ========================================================

  async saveProfileTheme(themeId) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    try {
      await this.db.collection('users').doc(uid).collection('system').doc('profile').set({ preferredTheme: themeId }, { merge: true });
    } catch (e) {
      console.warn('Erro ao salvar preferência de tema na nuvem:', e);
    }
  },

  async saveProfileToCloud(profile) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('system').doc('profile').set(profile, { merge: true });

    // Sincroniza dados públicos do crachá na coleção global public_profiles
    if (profile.nickname || profile.eexEmail || profile.name) {
      const publicData = {
        uid: uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (profile.name) {
        publicData.name = profile.name;
        publicData.nameLower = profile.name.toLowerCase().trim();
      }
      if (profile.nickname) {
        publicData.nickname = profile.nickname.toLowerCase().trim().replace(/@.*$/, '').replace(/\.express(\.com)?$/, '');
      }
      if (profile.eexEmail) {
        publicData.eexEmail = profile.eexEmail.toLowerCase().trim();
      } else if (publicData.nickname) {
        publicData.eexEmail = `${publicData.nickname}.express.com`;
      }
      if (profile.location) publicData.location = profile.location;
      if (profile.avatar) publicData.avatar = this.getSafeAvatar(profile.avatar);
      if (profile.banner !== undefined) publicData.banner = profile.banner;

      this.db.collection('public_profiles').doc(uid).set(publicData, { merge: true }).catch(err => {
        console.warn('Erro ao atualizar public_profiles em saveProfileToCloud:', err);
      });
    }
  },

  async saveTaskToCloud(task) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('tasks').doc(task.id).set(task, { merge: true });
  },

  async deleteTaskFromCloud(taskId) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('tasks').doc(taskId).delete();
  },

  async saveHabitToCloud(habit) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('habits').doc(habit.id).set(habit, { merge: true });
  },

  async deleteHabitFromCloud(habitId) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('habits').doc(habitId).delete();
  },

  async saveHabitHistoryToCloud(history) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('system').doc('habit_history').set(history);
  },

  async saveEventToCloud(event) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('events').doc(event.id).set(event, { merge: true });
  },

  async deleteEventFromCloud(eventId) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('events').doc(eventId).delete();
  },

  async saveMemoryToCloud(memory) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('memories').doc(memory.id).set(memory, { merge: true });
  },

  async deleteMemoryFromCloud(memoryId) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('memories').doc(memoryId).delete();
  },

  async saveNoteToCloud(note) {
    if (!this.auth || !this.auth.currentUser || !this.db || !note || !note.id) return;
    const uid = this.auth.currentUser.uid;
    try {
      await this.db.collection('users').doc(uid).collection('notes').doc(note.id).set(note, { merge: true });
    } catch (e) {
      console.warn('Erro ao salvar nota na nuvem:', e);
    }
  },

  async deleteNoteFromCloud(noteId) {
    if (!this.auth || !this.auth.currentUser || !this.db || !noteId) return;
    const uid = this.auth.currentUser.uid;
    try {
      await this.db.collection('users').doc(uid).collection('notes').doc(noteId).delete();
    } catch (e) {
      console.warn('Erro ao excluir nota da nuvem:', e);
    }
  },

  async saveAllNotesToCloud(notes) {
    if (!this.auth || !this.auth.currentUser || !this.db || !Array.isArray(notes)) return;
    const uid = this.auth.currentUser.uid;
    const batch = this.db.batch();
    const notesCol = this.db.collection('users').doc(uid).collection('notes');
    notes.forEach(n => {
      if (n && n.id) {
        batch.set(notesCol.doc(n.id), n, { merge: true });
      }
    });
    try {
      await batch.commit();
    } catch (e) {
      console.warn('Erro ao salvar lote de notas na nuvem:', e);
    }
  },

  // ========================================================
  // EEX-FRIENDS (REDE DE AMIGOS & ENTREGAS COLETIVAS)
  // ========================================================

  getSafeAvatar(avatar, user) {
    if (typeof avatar === 'string' && avatar.length > 70000) {
      if (user && user.googlePhotoURL && typeof user.googlePhotoURL === 'string' && user.googlePhotoURL.startsWith('http')) {
        return user.googlePhotoURL;
      }
      return 'images/elgalylogo.png';
    }
    return avatar || 'images/elgalylogo.png';
  },

  async updatePublicProfile(data) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    try {
      const name = data.name || 'Agente Express';
      let cleanNick = (data.nickname || '').toLowerCase().trim().replace(/@.*$/, '').replace(/\.express(\.com)?$/, '');
      if (!cleanNick && data.eexEmail) {
        cleanNick = data.eexEmail.toLowerCase().trim().replace(/@.*$/, '').replace(/\.express(\.com)?$/, '');
      }
      if (!cleanNick) cleanNick = 'agente';
      const fullEex = `${cleanNick}.express.com`;

      const payload = {
        uid: uid,
        name: name,
        nameLower: name.toLowerCase().trim(),
        nickname: cleanNick,
        eexEmail: fullEex,
        avatar: this.getSafeAvatar(data.avatar, data),
        location: data.location || 'São Paulo - SP',
        streak: typeof data.streak === 'number' ? data.streak : 0,
        allDoneToday: !!data.allDoneToday,
        pendingToday: typeof data.pendingToday === 'number' ? data.pendingToday : 0,
        sosActive: !!data.sosActive,
        radioStatus: data.radioStatus || '',
        xp: typeof data.xp === 'number' ? data.xp : 0,
        rankLevel: typeof data.rankLevel === 'number' ? data.rankLevel : 1,
        rankTitle: data.rankTitle || 'Recruta da Rota Express 📦',
        shells: typeof data.shells === 'number' ? data.shells : 0,
        completedTasksCount: typeof data.completedTasksCount === 'number' ? data.completedTasksCount : 0,
        unlockedAchievements: Array.isArray(data.unlockedAchievements) ? data.unlockedAchievements : [],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (data.banner !== undefined) {
        payload.banner = data.banner || '';
      }

      if (data.todayHabits && Array.isArray(data.todayHabits)) {
        payload.todayHabits = data.todayHabits;
      }
      if (data.recentMemories && Array.isArray(data.recentMemories)) {
        payload.recentMemories = data.recentMemories;
      }

      await this.db.collection('public_profiles').doc(uid).set(payload, { merge: true });
    } catch (e) {
      console.warn('Erro ao atualizar perfil público:', e);
    }
  },

  async searchPublicUsers(query) {
    if (!this.db) return [];
    try {
      const raw = (query || '').trim();
      let cleanNick = raw.toLowerCase().replace(/^@+/, '').trim();
      cleanNick = cleanNick.replace(/@.*$/, '').replace(/\.express(\.com)?$/, '').trim();
      cleanNick = cleanNick.replace(/[^a-z0-9_.-]/g, '');

      if (cleanNick.length < 2) return [];

      const myUid = this.auth?.currentUser?.uid;
      const resultsMap = new Map();

      // 1. Busca por prefixo de nickname (ex: "pedr" -> acha "pedrinho")
      try {
        const snapshot = await this.db.collection('public_profiles')
          .where('nickname', '>=', cleanNick)
          .where('nickname', '<=', cleanNick + '\uf8ff')
          .limit(10)
          .get();

        snapshot.forEach(doc => {
          const u = doc.data();
          if (u.uid !== myUid) {
            resultsMap.set(u.uid, u);
          }
        });
      } catch (errNick) {
        console.warn('Erro na busca por nickname:', errNick);
      }

      // 2. Busca exata por eexEmail (caso o nickname seja diferente)
      const expectedEex = `${cleanNick}.express.com`;
      try {
        const emailSnap = await this.db.collection('public_profiles')
          .where('eexEmail', '==', expectedEex)
          .limit(5)
          .get();

        emailSnap.forEach(doc => {
          const u = doc.data();
          if (u.uid !== myUid) {
            resultsMap.set(u.uid, u);
          }
        });
      } catch (errEmail) {}

      // 3. Busca por prefixo de eexEmail
      try {
        const eexPrefixSnap = await this.db.collection('public_profiles')
          .where('eexEmail', '>=', cleanNick)
          .where('eexEmail', '<=', cleanNick + '\uf8ff')
          .limit(10)
          .get();

        eexPrefixSnap.forEach(doc => {
          const u = doc.data();
          if (u.uid !== myUid) {
            resultsMap.set(u.uid, u);
          }
        });
      } catch (errEexPrefix) {}

      // 4. Busca por prefixo do nome de exibição em minúsculas
      try {
        const nameSnap = await this.db.collection('public_profiles')
          .where('nameLower', '>=', cleanNick)
          .where('nameLower', '<=', cleanNick + '\uf8ff')
          .limit(5)
          .get();

        nameSnap.forEach(doc => {
          const u = doc.data();
          if (u.uid !== myUid) {
            resultsMap.set(u.uid, u);
          }
        });
      } catch (errName) {}

      return Array.from(resultsMap.values());
    } catch (e) {
      console.warn('Erro ao pesquisar agentes:', e);
      return [];
    }
  },

  async sendFriendRequest(targetUser) {
    if (!this.auth || !this.auth.currentUser || !this.db) return { success: false, error: 'Não autenticado' };
    const myUid = this.auth.currentUser.uid;
    const currentUser = AuthManager.getCurrentUser();
    if (!currentUser) return { success: false, error: 'Usuário local inválido' };

    try {
      const reqId = `${myUid}_${targetUser.uid}`;
      await this.db.collection('friend_requests').doc(reqId).set({
        id: reqId,
        fromUid: myUid,
        fromNick: currentUser.nickname || 'agente',
        fromName: currentUser.name || 'Agente Express',
        fromAvatar: this.getSafeAvatar(currentUser.avatar, currentUser),
        fromEexEmail: currentUser.eexEmail || 'agente.express.com',
        toUid: targetUser.uid,
        toNick: targetUser.nickname || '',
        toName: targetUser.name || '',
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (e) {
      console.error('Erro ao enviar pedido de amizade:', e);
      return { success: false, error: e.message };
    }
  },

  async acceptFriendRequest(request) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const myUid = this.auth.currentUser.uid;
    const myUser = AuthManager.getCurrentUser();

    try {
      const batch = this.db.batch();

      // 1. Adiciona o amigo no meu perfil
      const myFriendRef = this.db.collection('users').doc(myUid).collection('friends').doc(request.fromUid);
      batch.set(myFriendRef, {
        uid: request.fromUid,
        nickname: request.fromNick,
        name: request.fromName,
        avatar: this.getSafeAvatar(request.fromAvatar),
        eexEmail: request.fromEexEmail || `${request.fromNick}.express.com`,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 2. Adiciona meu perfil na lista de amigos dele
      const otherFriendRef = this.db.collection('users').doc(request.fromUid).collection('friends').doc(myUid);
      batch.set(otherFriendRef, {
        uid: myUid,
        nickname: myUser.nickname || 'agente',
        name: myUser.name || 'Agente Express',
        avatar: this.getSafeAvatar(myUser.avatar, myUser),
        eexEmail: myUser.eexEmail || 'agente.express.com',
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 3. Atualiza o status do request para 'accepted'
      const reqRef = this.db.collection('friend_requests').doc(request.id);
      batch.delete(reqRef);

      await batch.commit();
      return { success: true };
    } catch (e) {
      console.error('Erro ao aceitar pedido:', e);
      return { success: false, error: e.message };
    }
  },

  async rejectFriendRequest(requestId) {
    if (!this.db) return;
    try {
      await this.db.collection('friend_requests').doc(requestId).delete();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async removeFriend(friendUid) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const myUid = this.auth.currentUser.uid;
    try {
      const batch = this.db.batch();
      batch.delete(this.db.collection('users').doc(myUid).collection('friends').doc(friendUid));
      batch.delete(this.db.collection('users').doc(friendUid).collection('friends').doc(myUid));
      await batch.commit();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  async sendPoke(toUid, pokeType = 'forca') {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const currentUser = AuthManager.getCurrentUser();
    if (!currentUser) return;

    try {
      await this.db.collection('users').doc(toUid).collection('pokes').add({
        fromUid: this.auth.currentUser.uid,
        fromName: currentUser.name || 'Agente Parceiro',
        fromNick: currentUser.nickname || 'agente',
        fromAvatar: this.getSafeAvatar(currentUser.avatar, currentUser),
        pokeType: pokeType,
        timestamp: Date.now(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (e) {
      console.warn('Erro ao buzinar/cutucar amigo:', e);
      return { success: false };
    }
  },

  async sendPackage(toUid, packageData) {
    if (!this.auth || !this.auth.currentUser || !this.db) return { success: false, error: 'Não autenticado' };
    const currentUser = AuthManager.getCurrentUser();
    if (!currentUser) return { success: false, error: 'Perfil não carregado' };

    try {
      await this.db.collection('users').doc(toUid).collection('packages').add({
        fromUid: this.auth.currentUser.uid,
        fromName: currentUser.name || 'Agente Express',
        fromNick: currentUser.nickname || 'agente',
        fromAvatar: this.getSafeAvatar(currentUser.avatar, currentUser),
        fromEexEmail: currentUser.eexEmail || 'agente.express.com',
        stamp: packageData.stamp || 'selo-brave',
        boxType: packageData.boxType || 'caixa-reforcada',
        message: packageData.message || 'Uma entrega dimensional surpresa para você!',
        opened: false,
        timestamp: Date.now(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (e) {
      console.error('Erro ao enviar encomenda express:', e);
      return { success: false, error: e.message };
    }
  },

  async markPackageOpened(packageId) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    try {
      await this.db.collection('users').doc(uid).collection('packages').doc(packageId).update({
        opened: true,
        openedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('Erro ao marcar encomenda como aberta:', e);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  FirebaseService.init();
});
