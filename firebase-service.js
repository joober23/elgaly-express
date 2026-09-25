/**
 * ELGALY EXPRESS - SERVIÇO DE SINCRONIZAÇÃO EM NUVEM (FIREBASE)
 * Gerencia Login com Google e Banco de Dados Cloud Firestore em tempo real.
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
      this.setupAuthStateListener();
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
        // Usuário logado no Firebase (via Google)
        const email = firebaseUser.email || '';
        const suggestedNick = email ? email.split('@')[0] : (firebaseUser.displayName || 'entregador').toLowerCase().replace(/\s+/g, '.');
        const eexEmail = AuthManager.formatEexNickname(suggestedNick);

        const userData = {
          id: firebaseUser.uid,
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'Agente Google',
          nickname: suggestedNick,
          eexEmail: eexEmail,
          avatar: firebaseUser.photoURL || 'images/elgalylogo.png',
          email: email,
          isGoogle: true,
          joinedAt: new Date().toISOString()
        };

        AuthManager.currentUser = userData;
        AuthManager.saveCurrent();

        // Inicia sincronização em tempo real do banco de dados na nuvem
        this.startRealtimeSync(firebaseUser.uid);
        AppUI.renderAll();
        AppUI.showToast(`☁️ Conectado na Nuvem: ${eexEmail}`);
      } else {
        // Usuário deslogado do Firebase
        this.stopRealtimeSync();
        if (AuthManager.currentUser && AuthManager.currentUser.isGoogle) {
          AuthManager.loginAsGuest();
          AppUI.renderAll();
        }
      }
    });
  },

  /**
   * Realiza login popup com a Conta Google
   */
  async loginWithGoogle() {
    if (!this.isInitialized) {
      alert('Firebase ainda não inicializado. Verifique sua conexão com a internet.');
      return;
    }

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await this.auth.signInWithPopup(provider);
      
      const modal = document.getElementById('modalAuth');
      if (modal) modal.classList.remove('active');
    } catch (err) {
      console.error('Erro ao fazer login com Google:', err);
      // Se popup for bloqueado pelo navegador do celular, tenta com redirecionamento
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          await this.auth.signInWithRedirect(provider);
        } catch (redirErr) {
          alert('Erro ao conectar com Google: ' + redirErr.message);
        }
      } else {
        alert('Erro ao autenticar com o Google: ' + err.message);
      }
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

      // Ordenar por data de criação decrescente
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
  },

  stopRealtimeSync() {
    if (this.unsubscribeTasks) { this.unsubscribeTasks(); this.unsubscribeTasks = null; }
    if (this.unsubscribeHabits) { this.unsubscribeHabits(); this.unsubscribeHabits = null; }
    if (this.unsubscribeHistory) { this.unsubscribeHistory(); this.unsubscribeHistory = null; }
  },

  // ========================================================
  // OPERAÇÕES DE ESCRITA NO FIRESTORE
  // ========================================================

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
  }
};

// Inicializa o serviço do Firebase
document.addEventListener('DOMContentLoaded', () => {
  FirebaseService.init();
});
