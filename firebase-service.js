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
  isInitialized: false,
  unsubscribeTasks: null,
  unsubscribeHabits: null,
  unsubscribeHistory: null,
  unsubscribeEvents: null,

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
            grantOfflineAccess: true
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
   * Monitora estado de login do Firebase
   */
  setupAuthStateListener() {
    this.auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        const email = firebaseUser.email || '';
        const defaultNick = email ? email.split('@')[0] : (firebaseUser.displayName || 'agente').toLowerCase().replace(/\s+/g, '.');
        const defaultEexEmail = AuthManager.formatEexNickname(defaultNick);

        let userData = {
          id: firebaseUser.uid,
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'Agente',
          nickname: defaultNick,
          eexEmail: defaultEexEmail,
          avatar: firebaseUser.photoURL || 'images/elgalylogo.png',
          location: 'Nova Amerit - NA (Nova Arcanis)',
          email: email,
          isGoogle: true,
          onboardingDone: false,
          joinedAt: new Date().toISOString()
        };

        // Verifica se o usuário já possui perfil customizado salvo no Firestore
        try {
          const profileDoc = await this.db.collection('users').doc(firebaseUser.uid).collection('system').doc('profile').get();
          if (profileDoc.exists) {
            const cloudProfile = profileDoc.data();
            userData = { ...userData, ...cloudProfile };
          }
        } catch (e) {
          console.warn('Perfil na nuvem não encontrado, usando padrão do Google.');
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

        // Onboarding já feito — inicializa o app normalmente
        this.startRealtimeSync(firebaseUser.uid);
        AppUI.renderAll();
        AppUI.showToast(`☁️ Bem-vindo de volta, ${userData.eexEmail}!`);
      } else {
        // Usuário deslogado do Firebase
        this.stopRealtimeSync();
        if (AuthManager.currentUser && AuthManager.currentUser.isGoogle) {
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
   * Realiza login ou registro direto com E-mail e Senha / PIN
   */
  async loginWithEmail(email, password) {
    if (!this.isInitialized) {
      alert('Firebase ainda não inicializado. Verifique sua conexão com a internet.');
      return;
    }
    try {
      await this.auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        try {
          await this.auth.createUserWithEmailAndPassword(email, password);
          return;
        } catch (regErr) {
          alert('Erro ao criar conta com e-mail: ' + regErr.message);
          return;
        }
      }
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        alert('❌ Senha ou PIN incorreto para este e-mail.');
        return;
      }
      alert('Erro na autenticação: ' + err.message);
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
  },

  stopRealtimeSync() {
    if (this.unsubscribeTasks) { this.unsubscribeTasks(); this.unsubscribeTasks = null; }
    if (this.unsubscribeHabits) { this.unsubscribeHabits(); this.unsubscribeHabits = null; }
    if (this.unsubscribeHistory) { this.unsubscribeHistory(); this.unsubscribeHistory = null; }
    if (this.unsubscribeEvents) { this.unsubscribeEvents(); this.unsubscribeEvents = null; }
  },

  // ========================================================
  // OPERAÇÕES DE ESCRITA NO FIRESTORE
  // ========================================================

  async saveProfileToCloud(profile) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    await this.db.collection('users').doc(uid).collection('system').doc('profile').set(profile, { merge: true });
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
  }
};

document.addEventListener('DOMContentLoaded', () => {
  FirebaseService.init();
});
