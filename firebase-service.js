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
              AppUI.showToast(`⚡ Agente ${poke.fromName} (@${poke.fromNick}) buzinou! Não esqueça da rotina! 📢`);
            }
          }
        });
      }, err => {
        console.warn('Erro ao escutar pokes:', err);
      });
  },

  stopRealtimeSync() {
    if (this.unsubscribeTasks) { this.unsubscribeTasks(); this.unsubscribeTasks = null; }
    if (this.unsubscribeHabits) { this.unsubscribeHabits(); this.unsubscribeHabits = null; }
    if (this.unsubscribeHistory) { this.unsubscribeHistory(); this.unsubscribeHistory = null; }
    if (this.unsubscribeEvents) { this.unsubscribeEvents(); this.unsubscribeEvents = null; }
    if (this.unsubscribeMemories) { this.unsubscribeMemories(); this.unsubscribeMemories = null; }
    if (this.unsubscribeFriends) { this.unsubscribeFriends(); this.unsubscribeFriends = null; }
    if (this.unsubscribeRequests) { this.unsubscribeRequests(); this.unsubscribeRequests = null; }
    if (this.unsubscribePokes) { this.unsubscribePokes(); this.unsubscribePokes = null; }
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

  // ========================================================
  // EEX-FRIENDS (REDE DE AMIGOS & ENTREGAS COLETIVAS)
  // ========================================================

  async updatePublicProfile(data) {
    if (!this.auth || !this.auth.currentUser || !this.db) return;
    const uid = this.auth.currentUser.uid;
    try {
      await this.db.collection('public_profiles').doc(uid).set({
        uid: uid,
        name: data.name || 'Agente Express',
        nickname: (data.nickname || '').toLowerCase().trim(),
        eexEmail: data.eexEmail || 'agente.express.com',
        avatar: data.avatar || 'images/elgalylogo.png',
        location: data.location || 'Nova Amerit - NA',
        streak: data.streak || 0,
        allDoneToday: !!data.allDoneToday,
        pendingToday: data.pendingToday || 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('Erro ao atualizar perfil público:', e);
    }
  },

  async searchPublicUsers(query) {
    if (!this.db) return [];
    try {
      const q = (query || '').toLowerCase().trim().replace(/@.*$/, '').replace(/[^a-z0-9_.-]/g, '');
      if (q.length < 2) return [];

      const myUid = this.auth?.currentUser?.uid;
      const snapshot = await this.db.collection('public_profiles')
        .where('nickname', '>=', q)
        .where('nickname', '<=', q + '\uf8ff')
        .limit(10)
        .get();

      const results = [];
      snapshot.forEach(doc => {
        const u = doc.data();
        if (u.uid !== myUid) {
          results.push(u);
        }
      });
      return results;
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
        fromAvatar: currentUser.avatar || 'images/elgalylogo.png',
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
        avatar: request.fromAvatar,
        eexEmail: request.fromEexEmail || `${request.fromNick}.express.com`,
        addedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // 2. Adiciona meu perfil na lista de amigos dele
      const otherFriendRef = this.db.collection('users').doc(request.fromUid).collection('friends').doc(myUid);
      batch.set(otherFriendRef, {
        uid: myUid,
        nickname: myUser.nickname || 'agente',
        name: myUser.name || 'Agente Express',
        avatar: myUser.avatar || 'images/elgalylogo.png',
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
        fromAvatar: currentUser.avatar || 'images/elgalylogo.png',
        pokeType: pokeType,
        timestamp: Date.now(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (e) {
      console.warn('Erro ao buzinar/cutucar amigo:', e);
      return { success: false };
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  FirebaseService.init();
});
