/**
 * ELGALY EXPRESS - APLICAÇÃO DE ROTINAS & DESPACHO
 * Autenticação exclusivamente via Google (Rede EEX).
 * Onboarding no primeiro acesso + Crachás salvos com PIN de 6 dígitos.
 */

// ==========================================================================
// GERENCIADOR DE AUTENTICAÇÃO EEX (Somente Google + Rede EEX)
// ==========================================================================
const AuthManager = {
  currentUser: null,

  init() {
    const savedCurrent = localStorage.getItem('elgaly_express_current_user');
    if (savedCurrent) {
      try {
        const parsed = JSON.parse(savedCurrent);
        if (parsed && parsed.id && parsed.id !== 'guest') {
          this.currentUser = parsed;
        }
      } catch (e) {
        this.currentUser = null;
      }
    }
  },

  formatEexNickname(rawNick) {
    if (!rawNick) return 'agente.express.com';
    let clean = rawNick.toLowerCase().trim()
      .replace(/@.*$/, '')
      .replace(/[^a-z0-9_.-]/g, '');
    if (!clean) clean = 'agente';
    if (!clean.endsWith('.express.com')) {
      clean = clean.replace(/\.express$/, '') + '.express.com';
    }
    return clean;
  },

  async updateUserProfile(updatedFields) {
    if (!this.currentUser) return;
    this.currentUser = { ...this.currentUser, ...updatedFields };
    this.saveCurrent();

    // Atualiza o crachá salvo com novos dados (nome/avatar/eex)
    this.updateSavedBadge(this.currentUser);

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveProfileToCloud({
        name: this.currentUser.name,
        location: this.currentUser.location,
        avatar: this.currentUser.avatar,
        eexEmail: this.currentUser.eexEmail,
        nickname: this.currentUser.nickname
      });
    }
    return this.currentUser;
  },

  async logout() {
    if (typeof FirebaseService !== 'undefined' && this.currentUser && this.currentUser.isGoogle) {
      await FirebaseService.logout();
    }
    this.currentUser = null;
    localStorage.removeItem('elgaly_express_current_user');
    TaskManager.tasks = [];
    HabitManager.habits = [];
    HabitManager.history = {};
    AppUI.renderAll();
    AppUI.showToast('Você saiu da sua conta.');
  },

  isLoggedIn() {
    return this.currentUser !== null;
  },

  getCurrentUser() {
    return this.currentUser;
  },

  saveCurrent() {
    localStorage.setItem('elgaly_express_current_user', JSON.stringify(this.currentUser));
  },

  // ============================================================
  // SISTEMA DE CRACHÁS SALVOS — re-login rápido com PIN de 6 dígitos
  // ============================================================
  getSavedBadges() {
    try {
      return JSON.parse(localStorage.getItem('elgaly_express_badges') || '[]');
    } catch { return []; }
  },

  saveBadge(user, pin) {
    const badges = this.getSavedBadges();
    const idx = badges.findIndex(b => b.uid === user.id);
    const badge = {
      uid: user.id,
      name: user.name,
      eexEmail: user.eexEmail,
      avatar: user.avatar,
      pinHash: this.hashPin(pin)
    };
    if (idx >= 0) {
      badges[idx] = badge;
    } else {
      badges.push(badge);
    }
    localStorage.setItem('elgaly_express_badges', JSON.stringify(badges));
  },

  updateSavedBadge(user) {
    const badges = this.getSavedBadges();
    const idx = badges.findIndex(b => b.uid === user.id);
    if (idx >= 0) {
      badges[idx].name = user.name;
      badges[idx].eexEmail = user.eexEmail;
      badges[idx].avatar = user.avatar;
      localStorage.setItem('elgaly_express_badges', JSON.stringify(badges));
    }
  },

  removeBadge(uid) {
    const badges = this.getSavedBadges().filter(b => b.uid !== uid);
    localStorage.setItem('elgaly_express_badges', JSON.stringify(badges));
  },

  // Hash simples e determinístico — conforto de UX, não segurança criptográfica
  hashPin(pin) {
    let h = 0;
    const str = 'eex_salt_2026_' + pin;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return h.toString(36);
  },

  verifyPin(pin, badge) {
    return this.hashPin(pin) === badge.pinHash;
  }
};

// ==========================================================================
// GERENCIADOR DE TAREFAS / ENCOMENDAS (TaskManager)
// ==========================================================================
const TaskManager = {
  tasks: [],

  getStorageKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_tasks_${user.id}` : 'elgaly_tasks_default';
  },

  init() {
    if (!AuthManager.isLoggedIn()) {
      this.tasks = [];
      return;
    }

    const key = this.getStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        this.tasks = JSON.parse(saved);
      } catch (e) {
        this.tasks = [];
      }
    } else {
      this.tasks = [];
      this.saveLocally();
    }
  },

  saveLocally() {
    if (!AuthManager.isLoggedIn()) return;
    localStorage.setItem(this.getStorageKey(), JSON.stringify(this.tasks));
  },

  getAllTasks() {
    return this.tasks;
  },

  getTaskById(id) {
    return this.tasks.find(t => t.id === id);
  },

  async addTask(taskData) {
    const prefix = taskData.category === 'faculdade' ? 'FAC' : 'ELG';
    const randomNum = Math.floor(100 + Math.random() * 900);
    const newTask = {
      id: 'task-' + Date.now(),
      code: `${prefix}-${randomNum}`,
      title: taskData.title.trim(),
      description: taskData.description.trim(),
      category: taskData.category,
      priority: taskData.priority,
      dueDate: taskData.dueDate || null,
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null
    };

    this.tasks.unshift(newTask);
    this.saveLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveTaskToCloud(newTask);
    }

    return newTask;
  },

  async updateTask(id, updatedFields) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.tasks[idx] = { ...this.tasks[idx], ...updatedFields };
      this.saveLocally();

      if (typeof FirebaseService !== 'undefined') {
        await FirebaseService.saveTaskToCloud(this.tasks[idx]);
      }
      return this.tasks[idx];
    }
    return null;
  },

  async toggleComplete(id) {
    const task = this.getTaskById(id);
    if (!task) return;

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    this.saveLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveTaskToCloud(task);
    }

    if (task.completed && typeof confetti === 'function') {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 }
      });
    }

    return task;
  },

  async deleteTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.saveLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.deleteTaskFromCloud(id);
    }
  }
};

// ==========================================================================
// GERENCIADOR DE ROTINA DIÁRIA (HabitManager)
// ==========================================================================
const HabitManager = {
  habits: [],
  history: {},

  getHabitsKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_habits_${user.id}` : 'elgaly_habits_default';
  },

  getHistoryKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_history_${user.id}` : 'elgaly_history_default';
  },

  init() {
    if (!AuthManager.isLoggedIn()) {
      this.habits = [];
      this.history = {};
      return;
    }

    const savedHabits = localStorage.getItem(this.getHabitsKey());
    const savedHistory = localStorage.getItem(this.getHistoryKey());

    if (savedHabits) {
      try { this.habits = JSON.parse(savedHabits); } catch (e) { this.habits = []; }
    } else {
      this.habits = [];
      this.saveHabitsLocally();
    }

    if (savedHistory) {
      try { this.history = JSON.parse(savedHistory); } catch (e) { this.history = {}; }
    } else {
      this.history = {};
      this.saveHistoryLocally();
    }
  },

  saveHabitsLocally() {
    if (!AuthManager.isLoggedIn()) return;
    localStorage.setItem(this.getHabitsKey(), JSON.stringify(this.habits));
  },

  saveHistoryLocally() {
    if (!AuthManager.isLoggedIn()) return;
    localStorage.setItem(this.getHistoryKey(), JSON.stringify(this.history));
  },

  getTodayKey() {
    return new Date().toLocaleDateString('en-CA');
  },

  getAllHabits() {
    return this.habits;
  },

  getHistory() {
    return this.history;
  },

  getTodayCompleted() {
    const todayKey = this.getTodayKey();
    return this.history[todayKey] || [];
  },

  async toggleHabit(id) {
    const todayKey = this.getTodayKey();
    if (!this.history[todayKey]) {
      this.history[todayKey] = [];
    }

    const idx = this.history[todayKey].indexOf(id);
    if (idx === -1) {
      this.history[todayKey].push(id);
    } else {
      this.history[todayKey].splice(idx, 1);
    }

    this.saveHistoryLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveHabitHistoryToCloud(this.history);
    }

    return this.isCompletedToday(id);
  },

  isCompletedToday(id) {
    const todayKey = this.getTodayKey();
    const list = this.history[todayKey] || [];
    return list.includes(id);
  },

  async addHabit(title, category) {
    const newHabit = {
      id: 'habit-' + Date.now(),
      title: title.trim(),
      category: category || 'pessoal'
    };
    this.habits.push(newHabit);
    this.saveHabitsLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveHabitToCloud(newHabit);
    }

    return newHabit;
  },

  async deleteHabit(id) {
    this.habits = this.habits.filter(h => h.id !== id);
    this.saveHabitsLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.deleteHabitFromCloud(id);
    }
  },

  calculateStreak(habitId) {
    let streak = 0;
    const today = new Date();

    if (this.isCompletedToday(habitId)) {
      streak++;
    }

    for (let i = 1; i <= 365; i++) {
      const pastDate = new Date();
      pastDate.setDate(today.getDate() - i);
      const dateKey = pastDate.toLocaleDateString('en-CA');
      const list = this.history[dateKey] || [];
      if (list.includes(habitId)) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }
};

// ==========================================================================
// CONTROLADOR DE UI & INTERAÇÃO (AppUI)
// Com Portão de Autenticação Obrigatório, Edição de Perfil e Upload de Fotos
// ==========================================================================
const AppUI = {
  currentTab: 'inicio',
  currentFilter: 'todas',
  searchQuery: '',
  lastScrollTop: 0,
  uploadedAvatarBase64: null,
  editAvatarBase64: null,
  onboardingAvatarBase64: null,
  _pendingBadgeLogin: null,

  init() {
    AuthManager.init();
    TaskManager.init();
    HabitManager.init();

    this.bindEvents();
    this.initNavigation();
    this.initSmartNavbar();
    this.initMobileDrawer();
    this.updateCurrentDateDisplay();
    this.renderAll();

    setInterval(() => {
      if (AuthManager.isLoggedIn()) {
        this.renderTasks();
        this.renderHomeOverview();
      }
    }, 60000);
  },

  initSmartNavbar() {
    const header = document.querySelector('header');
    if (!header) return;

    window.addEventListener('scroll', () => {
      if (window.innerWidth <= 768) {
        header.classList.remove('header-hidden');
        return;
      }

      const st = window.pageYOffset || document.documentElement.scrollTop;
      if (st <= 80) {
        header.classList.remove('header-hidden');
        this.lastScrollTop = st;
        return;
      }

      if (st > this.lastScrollTop && st > 120) {
        header.classList.add('header-hidden');
      } else {
        header.classList.remove('header-hidden');
      }

      this.lastScrollTop = st <= 0 ? 0 : st;
    }, { passive: true });
  },

  initMobileDrawer() {
    const btnToggleDrawer = document.getElementById('btnMobileMenu');
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('drawerOverlay');
    const btnCloseDrawer = document.getElementById('btnCloseDrawer');

    const openDrawer = () => {
      if (drawer && overlay) {
        drawer.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    };

    const closeDrawer = () => {
      if (drawer && overlay) {
        drawer.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    };

    if (btnToggleDrawer) btnToggleDrawer.addEventListener('click', openDrawer);
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    document.querySelectorAll('.drawer-nav-link').forEach(link => {
      link.addEventListener('click', () => {
        closeDrawer();
        const tab = link.dataset.tab;
        window.location.hash = tab;
      });
    });
  },

  initNavigation() {
    const handleRoute = () => {
      const hash = window.location.hash.replace('#', '') || 'inicio';
      const validTabs = ['inicio', 'rotina', 'encomendas', 'relatorios', 'perfil'];
      this.switchTab(validTabs.includes(hash) ? hash : 'inicio');
    };

    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  },

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.nav-link, .drawer-nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.tab === tabName);
    });

    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.toggle('active-view', view.id === `view-${tabName}`);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabName === 'inicio') this.renderHomeOverview();
    if (tabName === 'rotina') this.renderDailyRoutine();
    if (tabName === 'encomendas') this.renderTasks();
    if (tabName === 'relatorios') ReportEngine.renderReportPreview();
    if (tabName === 'perfil') this.renderProfileView();
  },

  bindEvents() {
    // 1. Upload de Foto na Edição do Perfil
    const editAvatarInput = document.getElementById('editAvatarInput');
    const editAvatarPreview = document.getElementById('editAvatarPreview');
    if (editAvatarInput) {
      editAvatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            this.editAvatarBase64 = event.target.result;
            if (editAvatarPreview) editAvatarPreview.src = this.editAvatarBase64;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // 2. Botão de Login Google (via Firebase)
    const btnsGoogle = document.querySelectorAll('.action-google-login');
    btnsGoogle.forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof FirebaseService !== 'undefined') {
          FirebaseService.loginWithGoogle();
        }
      });
    });

    // 3. Formulário de Onboarding da Rede EEX (primeiro acesso após Google login)
    const formOnboarding = document.getElementById('formOnboarding');
    if (formOnboarding) {
      // Preview ao vivo do nick
      const onbNickInput = document.getElementById('onbNick');
      const onbNickPreview = document.getElementById('onbNickPreview');
      if (onbNickInput && onbNickPreview) {
        onbNickInput.addEventListener('input', (e) => {
          const val = e.target.value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
          onbNickPreview.textContent = val ? `${val}.express.com` : 'seunick.express.com';
        });
      }

      // Autocomplete de cidades de SP
      const onbLocation = document.getElementById('onbLocation');
      const citySugg = document.getElementById('citySuggestions');
      const SP_CITIES = [
        'São Paulo - SP', 'Campinas - SP', 'Guarulhos - SP', 'Santo André - SP',
        'São Bernardo do Campo - SP', 'Osasco - SP', 'Ribeirão Preto - SP',
        'Sorocaba - SP', 'Mauá - SP', 'São José dos Campos - SP',
        'Mogi das Cruzes - SP', 'Santos - SP', 'Diadema - SP', 'Jundiaí - SP',
        'Piracicaba - SP', 'Bauru - SP', 'São José do Rio Preto - SP',
        'Carapicuíba - SP', 'Araçatuba - SP', 'Limeira - SP', 'Taubaté - SP',
        'Franca - SP', 'Praia Grande - SP', 'Itaquaquecetuba - SP',
        'Suzano - SP', 'Barueri - SP', 'Taboão da Serra - SP'
      ];
      if (onbLocation && citySugg) {
        onbLocation.addEventListener('input', () => {
          const q = onbLocation.value.toLowerCase();
          if (q.length < 2) { citySugg.classList.remove('show'); return; }
          const matches = SP_CITIES.filter(c => c.toLowerCase().includes(q));
          if (matches.length === 0) { citySugg.classList.remove('show'); return; }
          citySugg.innerHTML = matches.map(c =>
            `<div class="city-suggestion-item" data-city="${c}">${c}</div>`
          ).join('');
          citySugg.classList.add('show');
        });
        citySugg.addEventListener('click', (e) => {
          const item = e.target.closest('.city-suggestion-item');
          if (item) {
            onbLocation.value = item.dataset.city;
            citySugg.classList.remove('show');
          }
        });
        document.addEventListener('click', (e) => {
          if (!onbLocation.contains(e.target) && !citySugg.contains(e.target)) {
            citySugg.classList.remove('show');
          }
        });
      }

      // Upload de avatar no onboarding
      const onbAvatarInput = document.getElementById('onbAvatarInput');
      const onbAvatarPreview = document.getElementById('onbAvatarPreview');
      if (onbAvatarInput) {
        onbAvatarInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              this.onboardingAvatarBase64 = ev.target.result;
              if (onbAvatarPreview) onbAvatarPreview.src = this.onboardingAvatarBase64;
            };
            reader.readAsDataURL(file);
          }
        });
      }

      // Submit do onboarding
      formOnboarding.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawNick = (document.getElementById('onbNick').value || '').trim();
        const location = (document.getElementById('onbLocation').value || '').trim();
        const pin = (document.getElementById('onbPin').value || '').trim();
        const errEl = document.getElementById('onbNickError');

        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

        if (rawNick.length < 2) {
          if (errEl) { errEl.textContent = '⚠️ O ID Express precisa ter pelo menos 2 caracteres!'; errEl.style.display = 'block'; }
          return;
        }
        if (!/^[0-9]{6}$/.test(pin)) {
          this.showToast('❌ O PIN deve ter exatamente 6 dígitos numéricos!');
          return;
        }

        const user = AuthManager.currentUser;
        if (!user) return;

        const eexEmail = AuthManager.formatEexNickname(rawNick);
        const nickname = eexEmail.replace('.express.com', '');
        const avatar = this.onboardingAvatarBase64 || user.avatar || 'images/elgalylogo.png';

        user.eexEmail = eexEmail;
        user.nickname = nickname;
        user.location = location || 'Nova Amerit - NA (Nova Arcanis)';
        user.avatar = avatar;
        user.onboardingDone = true;
        AuthManager.currentUser = user;
        AuthManager.saveCurrent();

        if (typeof FirebaseService !== 'undefined') {
          await FirebaseService.saveProfileToCloud({
            name: user.name,
            eexEmail: eexEmail,
            nickname: nickname,
            location: user.location,
            avatar: avatar,
            onboardingDone: true
          });
        }

        // Salva o crachá com PIN para re-login rápido
        AuthManager.saveBadge(user, pin);

        const modal = document.getElementById('modalOnboarding');
        if (modal) modal.classList.remove('active');
        this.onboardingAvatarBase64 = null;

        TaskManager.init();
        HabitManager.init();

        // Inicia sync em tempo real
        if (typeof FirebaseService !== 'undefined' && user.uid) {
          FirebaseService.startRealtimeSync(user.uid);
        }

        this.renderAll();
        this.showToast(`🚀 Bem-vindo à Rede EEX, ${eexEmail}!`);
      });
    }

    // 4. Modal de PIN (crachá salvo)
    const formPinLogin = document.getElementById('formPinLogin');
    const btnCancelPinLogin = document.getElementById('btnCancelPinLogin');
    if (formPinLogin) {
      formPinLogin.addEventListener('submit', (e) => {
        e.preventDefault();
        const pin = (document.getElementById('pinInput').value || '').trim();
        const errEl = document.getElementById('pinError');
        const badge = this._pendingBadgeLogin;
        if (errEl) errEl.textContent = '';
        if (!badge) return;

        if (AuthManager.verifyPin(pin, badge)) {
          document.getElementById('modalPinLogin').classList.remove('active');
          document.getElementById('pinInput').value = '';
          this._pendingBadgeLogin = null;
          // O Firebase tentará reutilizar a sessão ativa; se expirou, mostrará tela Google
          if (typeof FirebaseService !== 'undefined') {
            FirebaseService.loginWithGoogle();
          }
        } else {
          if (errEl) errEl.textContent = '❌ PIN incorreto. Tente novamente.';
          document.getElementById('pinInput').value = '';
        }
      });
    }
    if (btnCancelPinLogin) {
      btnCancelPinLogin.addEventListener('click', () => {
        document.getElementById('modalPinLogin').classList.remove('active');
        document.getElementById('pinInput').value = '';
        const errEl = document.getElementById('pinError');
        if (errEl) errEl.textContent = '';
        this._pendingBadgeLogin = null;
      });
    }

    // 5. Modal de Edição de Perfil
    const modalEditProfile = document.getElementById('modalEditProfile');
    const modalEditProfileClose = document.getElementById('modalEditProfileClose');
    const formEditProfile = document.getElementById('formEditProfile');

    if (modalEditProfileClose && modalEditProfile) {
      modalEditProfileClose.addEventListener('click', () => {
        modalEditProfile.classList.remove('active');
      });
    }

    if (formEditProfile) {
      formEditProfile.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = document.getElementById('editProfileName').value;
        const newLocation = document.getElementById('editProfileLocation').value;
        const updateData = {
          name: newName.trim(),
          location: newLocation.trim()
        };
        if (this.editAvatarBase64) {
          updateData.avatar = this.editAvatarBase64;
        }

        await AuthManager.updateUserProfile(updateData);
        modalEditProfile.classList.remove('active');
        this.renderAll();
        this.showToast('Crachá e informações atualizadas!');
      });
    }

    // 8. Filtros de Tarefas
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.renderTasks();
      });
    });

    // 9. Busca de Encomendas
    const searchInput = document.getElementById('taskSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.renderTasks();
      });
    }

    // 10. Botões de Nova Encomenda
    const btnsNewTask = document.querySelectorAll('.action-new-task');
    const modalTask = document.getElementById('modalTask');
    const formTask = document.getElementById('formTask');
    const modalTaskClose = document.getElementById('modalTaskClose');

    btnsNewTask.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!AuthManager.isLoggedIn()) return;
        this.openTaskModal();
      });
    });

    if (modalTaskClose && modalTask) {
      modalTaskClose.addEventListener('click', () => {
        modalTask.classList.remove('active');
      });
    }

    if (formTask) {
      formTask.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('taskId').value;
        const taskData = {
          title: document.getElementById('taskTitle').value,
          category: document.getElementById('taskCategory').value,
          priority: document.getElementById('taskPriority').value,
          dueDate: document.getElementById('taskDueDate').value,
          description: document.getElementById('taskDescription').value
        };

        if (id) {
          await TaskManager.updateTask(id, taskData);
          this.showToast('Encomenda atualizada com sucesso!');
        } else {
          await TaskManager.addTask(taskData);
          this.showToast('Nova encomenda despachada!');
        }

        modalTask.classList.remove('active');
        this.renderAll();
      });
    }

    // 11. Botões de Novo Hábito
    const btnsNewHabit = document.querySelectorAll('.action-new-habit');
    const modalHabit = document.getElementById('modalHabit');
    const formHabit = document.getElementById('formHabit');
    const modalHabitClose = document.getElementById('modalHabitClose');

    btnsNewHabit.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!AuthManager.isLoggedIn()) return;
        document.getElementById('habitTitle').value = '';
        modalHabit.classList.add('active');
      });
    });

    if (modalHabitClose && modalHabit) {
      modalHabitClose.addEventListener('click', () => {
        modalHabit.classList.remove('active');
      });
    }

    if (formHabit) {
      formHabit.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('habitTitle').value;
        const cat = document.getElementById('habitCategory').value;
        if (title) {
          await HabitManager.addHabit(title, cat);
          modalHabit.classList.remove('active');
          this.renderDailyRoutine();
          this.renderHomeOverview();
          ReportEngine.renderReportPreview();
          this.showToast('Novo hábito registrado no check-in diário!');
        }
      });
    }

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
        }
      });
    });

    document.querySelectorAll('.timeframe-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ReportEngine.setTimeframe(btn.dataset.days);
      });
    });

    const btnExportPDF = document.getElementById('btnExportPDF');
    if (btnExportPDF) {
      btnExportPDF.addEventListener('click', () => {
        ReportEngine.exportPDF();
      });
    }
  },

  updateCurrentDateDisplay() {
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const dateFormatted = new Date().toLocaleDateString('pt-BR', options);

    const elDate = document.getElementById('currentDateDisplay');
    const elHomeDate = document.getElementById('homeDateDisplay');
    if (elDate) elDate.textContent = dateFormatted;
    if (elHomeDate) elHomeDate.textContent = dateFormatted;
  },

  /**
   * Renderiza tudo e gerencia o Portão Obrigatório de Autenticação
   */
  renderAll() {
    const isLoggedIn = AuthManager.isLoggedIn();
    const authGateway = document.getElementById('authGateway');
    const appViewsContainer = document.getElementById('appViewsContainer');
    const desktopNav = document.querySelector('nav.desktop-nav');
    const btnMobileMenu = document.getElementById('btnMobileMenu');

    if (!isLoggedIn) {
      // Bloqueia acesso ao app e exibe portal de login
      if (authGateway) authGateway.style.display = 'block';
      if (appViewsContainer) appViewsContainer.style.display = 'none';
      if (desktopNav) desktopNav.style.display = 'none';
      if (btnMobileMenu) btnMobileMenu.style.display = 'none';
      this.renderSavedBadges();
      this.renderHeaderProfile();
      return;
    }

    // Usuário logado: libera a navegação e views
    if (authGateway) authGateway.style.display = 'none';
    if (appViewsContainer) appViewsContainer.style.display = 'block';
    if (desktopNav && window.innerWidth > 768) desktopNav.style.display = 'flex';
    if (btnMobileMenu && window.innerWidth <= 768) btnMobileMenu.style.display = 'inline-flex';

    this.renderHeaderProfile();
    this.renderHomeOverview();
    this.renderDailyRoutine();
    this.renderTasks();
    this.renderProfileView();
    ReportEngine.renderReportPreview();
  },

  /**
   * Renderiza crachás salvos no dispositivo para acesso rápido com PIN
   */
  renderSavedBadges() {
    const list = document.getElementById('savedBadgesList');
    const section = document.getElementById('savedBadgesSection');
    if (!list) return;

    const badges = AuthManager.getSavedBadges();
    if (badges.length === 0) {
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = 'block';

    list.innerHTML = badges.map(badge => `
      <div class="badge-chip" data-uid="${badge.uid}">
        <img class="badge-chip-avatar" src="${badge.avatar || 'images/elgalylogo.png'}" alt="" onerror="this.src='images/elgalylogo.png'">
        <div class="badge-chip-info">
          <div class="badge-chip-name">${badge.name}</div>
          <div class="badge-chip-eex">${badge.eexEmail}</div>
        </div>
        <span class="badge-chip-pin-icon">🔑</span>
      </div>
    `).join('');

    list.querySelectorAll('.badge-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const uid = chip.dataset.uid;
        const badge = AuthManager.getSavedBadges().find(b => b.uid === uid);
        if (!badge) return;
        document.getElementById('pinLoginAvatarImg').src = badge.avatar || 'images/elgalylogo.png';
        document.getElementById('pinLoginName').textContent = badge.name;
        document.getElementById('pinLoginEex').textContent = badge.eexEmail;
        document.getElementById('pinInput').value = '';
        const errEl = document.getElementById('pinError');
        if (errEl) errEl.textContent = '';
        this._pendingBadgeLogin = badge;
        document.getElementById('modalPinLogin').classList.add('active');
      });
    });
  },

  renderHeaderProfile() {
    const user = AuthManager.getCurrentUser();
    const userBadges = document.querySelectorAll('.header-user-badge');
    const userNickTexts = document.querySelectorAll('.header-user-nick');
    const userAvatarHeaders = document.querySelectorAll('.header-user-avatar');

    if (!user) {
      userBadges.forEach(b => b.style.display = 'none');
    } else {
      userBadges.forEach(b => b.style.display = 'inline-flex');
      userNickTexts.forEach(t => t.textContent = user.eexEmail);
      userAvatarHeaders.forEach(img => img.src = user.avatar);
    }
  },

  renderHomeOverview() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    const tasks = TaskManager.getAllTasks();
    const habits = HabitManager.getAllHabits();
    const todayHabits = HabitManager.getTodayCompleted();

    const greetingTitle = document.getElementById('homeGreetingTitle');
    const greetingSubtitle = document.getElementById('homeGreetingSubtitle');

    if (greetingTitle) {
      const hora = new Date().getHours();
      let saudacao = 'Bom dia';
      if (hora >= 12 && hora < 18) saudacao = 'Boa tarde';
      else if (hora >= 18 || hora < 5) saudacao = 'Boa noite';

      greetingTitle.textContent = `${saudacao}, ${user.name}!`;
    }

    if (greetingSubtitle) {
      greetingSubtitle.textContent = `Terminal de despacho conectado em ${user.location}. ${user.isGoogle ? 'Sincronizado na Nuvem (Firebase) ☁️' : 'Perfil Local EEX 💾'}`;
    }

    const pendingTasks = tasks.filter(t => !t.completed).length;
    const completedTasks = tasks.filter(t => t.completed).length;
    const overdueTasks = tasks.filter(t => !t.completed && t.dueDate && new Date(t.dueDate).getTime() < Date.now()).length;

    const elActive = document.getElementById('statActiveTasks');
    const elCompleted = document.getElementById('statCompletedTasks');
    const elHabitToday = document.getElementById('statHabitStreak');
    const elOverdue = document.getElementById('statOverdueTasks');

    if (elActive) elActive.textContent = pendingTasks;
    if (elCompleted) elCompleted.textContent = completedTasks;
    if (elHabitToday) elHabitToday.textContent = `${todayHabits.length}/${habits.length}`;
    if (elOverdue) elOverdue.textContent = overdueTasks;

    const urgentList = document.getElementById('homeUrgentList');
    if (urgentList) {
      const nextTasks = tasks
        .filter(t => !t.completed)
        .sort((a, b) => (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : -1)
        .slice(0, 3);

      if (nextTasks.length === 0) {
        urgentList.innerHTML = `
          <div class="empty-state-card">
            <h4>Tudo tranquilo por enquanto! 📦</h4>
            <p>Você não possui nenhuma encomenda pendente no momento. Aproveite para planejar suas próximas missões ou focar na sua rotina diária!</p>
          </div>
        `;
      } else {
        urgentList.innerHTML = '';
        nextTasks.forEach(task => {
          const item = document.createElement('div');
          item.className = 'home-urgent-item';
          const isOverdue = task.dueDate && new Date(task.dueDate).getTime() < Date.now();
          item.innerHTML = `
            <div class="urgent-item-header">
              <span class="task-tracking-code">${task.code}</span>
              <span class="task-badge ${task.category}">${task.category === 'faculdade' ? 'Faculdade' : 'Pessoal'}</span>
            </div>
            <h4>${task.title}</h4>
            <p style="font-size: 0.85rem; font-weight: 700; color: ${isOverdue ? 'var(--red-alert)' : 'var(--purple-dark)'};">
              ${isOverdue ? '⚠️ Prazo Estourado!' : '⏰ Prazo:'} ${task.dueDate ? new Date(task.dueDate).toLocaleString('pt-BR') : 'Sem data fixa'}
            </p>
          `;
          urgentList.appendChild(item);
        });
      }
    }
  },

  renderDailyRoutine() {
    const habits = HabitManager.getAllHabits();
    const container = document.getElementById('dailyHabitsGrid');
    const progressBar = document.getElementById('dailyProgressFill');
    const progressText = document.getElementById('dailyProgressText');

    if (!container) return;

    if (habits.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Nenhum Hábito Cadastrado Ainda!</h3>
          <p>Adicione hábitos diários como beber água, revisar matérias da faculdade ou focar em projetos pessoais para acompanhar sua sequência!</p>
          <button class="btn-comic action-new-habit" style="margin-top: 15px;">+ Criar Primeiro Hábito</button>
        </div>
      `;
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = '0 de 0 (0%)';
      return;
    }

    let completedCount = 0;
    container.innerHTML = '';

    habits.forEach(habit => {
      const isDone = HabitManager.isCompletedToday(habit.id);
      if (isDone) completedCount++;
      const streak = HabitManager.calculateStreak(habit.id);

      const card = document.createElement('div');
      card.className = `habit-card ${isDone ? 'completed' : ''}`;
      card.innerHTML = `
        <div class="habit-check-box">${isDone ? '✓' : ''}</div>
        <div class="habit-info">
          <div class="habit-title">${habit.title}</div>
          <div class="habit-meta">
            <span class="habit-tag ${habit.category}">${habit.category === 'faculdade' ? 'Faculdade' : 'Pessoal'}</span>
            ${streak > 0 ? `<span class="habit-streak">🔥 ${streak} ${streak === 1 ? 'dia' : 'dias'}</span>` : ''}
          </div>
        </div>
        <div class="habit-actions">
          <button class="habit-btn-delete" title="Remover Hábito" data-id="${habit.id}">✕</button>
        </div>
      `;

      card.addEventListener('click', async (e) => {
        if (e.target.classList.contains('habit-btn-delete')) return;
        await HabitManager.toggleHabit(habit.id);
        this.renderDailyRoutine();
        this.renderHomeOverview();
        ReportEngine.renderReportPreview();
      });

      const delBtn = card.querySelector('.habit-btn-delete');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Remover "${habit.title}" da sua rotina diária?`)) {
          await HabitManager.deleteHabit(habit.id);
          this.renderDailyRoutine();
          this.renderHomeOverview();
          ReportEngine.renderReportPreview();
        }
      });

      container.appendChild(card);
    });

    const pct = Math.round((completedCount / habits.length) * 100);
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `${completedCount} de ${habits.length} entregues (${pct}%)`;

    if (completedCount === habits.length && habits.length > 0) {
      if (progressBar) progressBar.style.background = 'linear-gradient(90deg, #4ade80, #10b981)';
    } else {
      if (progressBar) progressBar.style.background = 'linear-gradient(90deg, var(--yellow-bright), var(--magenta-bright))';
    }
  },

  renderTasks() {
    const container = document.getElementById('tasksGrid');
    if (!container) return;

    let tasks = TaskManager.getAllTasks();

    if (this.currentFilter === 'faculdade') {
      tasks = tasks.filter(t => t.category === 'faculdade');
    } else if (this.currentFilter === 'pessoal') {
      tasks = tasks.filter(t => t.category === 'pessoal');
    } else if (this.currentFilter === 'pendentes') {
      tasks = tasks.filter(t => !t.completed);
    } else if (this.currentFilter === 'concluidas') {
      tasks = tasks.filter(t => t.completed);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      tasks = tasks.filter(t => 
        (t.code && t.code.toLowerCase().includes(q)) ||
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
      );
    }

    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Nenhuma Encomenda Cadastrada!</h3>
          <p>Organize suas entregas acadêmicas e seus projetos pessoais com datas e prioridades.</p>
          <button class="btn-comic action-new-task" style="margin-top: 15px;">+ Cadastrar Primeira Encomenda</button>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    const now = Date.now();

    tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = `task-card ${task.completed ? 'is-completed' : ''}`;

      let deadlineHtml = '';
      let speedBadgeHtml = '';

      if (task.dueDate) {
        const dueTime = new Date(task.dueDate).getTime();
        const formattedDate = new Date(task.dueDate).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        if (task.completed) {
          if (task.completedAt) {
            const compTime = new Date(task.completedAt).getTime();
            const diffHours = (dueTime - compTime) / (1000 * 60 * 60);

            if (diffHours >= 12) {
              const dEarly = Math.round(diffHours / 24);
              speedBadgeHtml = `
                <div class="task-speed-badge speed-fast">
                  ⚡ <strong>Agilidade Express!</strong> Concluído ${dEarly > 0 ? dEarly + 'd' : Math.round(diffHours) + 'h'} antes do prazo.
                </div>
              `;
            } else if (diffHours >= 0) {
              speedBadgeHtml = `
                <div class="task-speed-badge speed-fast">
                  ✅ <strong>No Prazo!</strong> Concluído dentro do limite.
                </div>
              `;
            } else {
              const lateHours = Math.abs(Math.round(diffHours));
              speedBadgeHtml = `
                <div class="task-speed-badge speed-late">
                  🐢 <strong>Atraso Dimensional!</strong> Entregue ${lateHours > 24 ? Math.round(lateHours / 24) + 'd' : lateHours + 'h'} após a data.
                </div>
              `;
            }
          }

          deadlineHtml = `
            <div class="task-deadline-box">
              <div class="deadline-row">
                <span>Prazo Original:</span>
                <strong>${formattedDate}</strong>
              </div>
              <div class="deadline-status-text status-ontime">
                ✓ Encomenda Finalizada
              </div>
            </div>
          `;
        } else {
          const diffMs = dueTime - now;
          const diffHours = Math.round(diffMs / (1000 * 60 * 60));

          if (diffMs > 0) {
            const daysLeft = Math.floor(diffHours / 24);
            const hoursLeft = diffHours % 24;
            const isUrgent = diffHours <= 24;

            deadlineHtml = `
              <div class="task-deadline-box">
                <div class="deadline-row">
                  <span>Prazo Limite:</span>
                  <strong>${formattedDate}</strong>
                </div>
                <div class="deadline-status-text ${isUrgent ? 'status-urgent' : 'status-ontime'}">
                  ${isUrgent ? '⏳ URGENTE: Restam ' : '⏱️ Faltam '}${daysLeft > 0 ? daysLeft + 'd ' : ''}${hoursLeft}h
                </div>
              </div>
            `;
          } else {
            const overdueHours = Math.abs(diffHours);
            const overdueDays = Math.floor(overdueHours / 24);

            deadlineHtml = `
              <div class="task-deadline-box">
                <div class="deadline-row">
                  <span>Prazo Limite:</span>
                  <strong style="color: #dc2626;">${formattedDate}</strong>
                </div>
                <div class="deadline-status-text status-late">
                  ⚠️ ATRASADA há ${overdueDays > 0 ? overdueDays + 'd ' : ''}${overdueHours % 24}h!
                </div>
              </div>
            `;
          }
        }
      } else {
        deadlineHtml = `
          <div class="task-deadline-box">
            <div class="deadline-row">
              <span>Prazo:</span>
              <strong>Sem data fixa</strong>
            </div>
            <div class="deadline-status-text status-ontime">
              📦 Fluxo Contínuo
            </div>
          </div>
        `;
      }

      const priorityLabels = {
        baixa: 'Baixa',
        media: 'Média',
        alta: 'Alta',
        cosmica: 'Cósmica ⚡'
      };

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-tracking-code">${task.code || 'ELG-000'}</span>
          <div class="task-badges">
            <span class="task-badge ${task.category}">${task.category === 'faculdade' ? 'Faculdade' : 'Pessoal'}</span>
            <span class="task-badge priority-${task.priority}">${priorityLabels[task.priority] || task.priority}</span>
          </div>
        </div>

        <h3 class="task-title">${task.title}</h3>
        <p class="task-desc">${task.description || 'Sem observações adicionais.'}</p>

        ${deadlineHtml}
        ${speedBadgeHtml}

        <div class="task-card-footer">
          <button class="btn-task-action ${task.completed ? 'btn-reopen' : 'btn-complete'}" data-action="toggle" data-id="${task.id}">
            ${task.completed ? '↺ Reabrir' : '✓ Concluir Entrega'}
          </button>
          <button class="btn-task-action btn-edit" data-action="edit" data-id="${task.id}" title="Editar Encomenda">
            ✎
          </button>
          <button class="btn-task-action btn-delete" data-action="delete" data-id="${task.id}" title="Excluir Encomenda">
            ✕
          </button>
        </div>
      `;

      card.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
        await TaskManager.toggleComplete(task.id);
        this.renderAll();
      });

      card.querySelector('[data-action="edit"]').addEventListener('click', () => {
        this.openTaskModal(task);
      });

      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (confirm(`Deseja cancelar e remover a encomenda "${task.title}"?`)) {
          await TaskManager.deleteTask(task.id);
          this.renderAll();
        }
      });

      container.appendChild(card);
    });
  },

  renderProfileView() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    const tasks = TaskManager.getAllTasks();
    const habits = HabitManager.getAllHabits();

    const profileCard = document.getElementById('profileBadgeCard');
    if (!profileCard) return;

    const completedTasks = tasks.filter(t => t.completed).length;

    profileCard.innerHTML = `
      <div class="retro-badge-header">
        <span class="retro-badge-tag">ELGALY EXPRESS DISPATCH PASS</span>
        <span class="retro-badge-version">EEX OS v2.000</span>
      </div>

      <div class="retro-badge-body">
        <div class="retro-avatar-box">
          <img src="${user.avatar || 'images/elgalylogo.png'}" alt="Avatar" class="retro-avatar-img" id="passAvatarDisplay">
        </div>
        <div class="retro-user-details">
          <h3>${user.name}</h3>
          <div class="eex-retro-email">${user.eexEmail}</div>
          <p style="font-size: 0.9rem; color: #4b5563; margin-top: 5px;">
            Setor de Operações: <strong>${user.location || 'Nova Amerit - NA (Nova Arcanis)'}</strong>
          </p>
          <p style="font-size: 0.85rem; color: #6b7280;">
            Tipo de Acesso: ${user.isGoogle ? '☁️ Sincronizado na Nuvem (Firebase / Google)' : '💾 Perfil Local EEX'}
          </p>
        </div>
      </div>

      <div class="retro-badge-stats">
        <div class="badge-stat">
          <strong>${tasks.length}</strong>
          <span>TOTAL DESPACHADO</span>
        </div>
        <div class="badge-stat">
          <strong style="color: var(--green-dark);">${completedTasks}</strong>
          <span>ENTREGUES</span>
        </div>
        <div class="badge-stat">
          <strong>${habits.length}</strong>
          <span>HÁBITOS ATIVOS</span>
        </div>
      </div>

      <div class="retro-badge-actions" style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
        <button class="btn-comic btn-secondary" id="btnOpenEditProfile">
          ✎ Editar Perfil & Foto
        </button>
        <button class="btn-comic btn-outline" onclick="AuthManager.logout()">
          Sair da Conta (${user.eexEmail})
        </button>
      </div>
    `;

    const btnEdit = document.getElementById('btnOpenEditProfile');
    if (btnEdit) {
      btnEdit.addEventListener('click', () => {
        this.openEditProfileModal();
      });
    }
  },

  openEditProfileModal() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    const modal = document.getElementById('modalEditProfile');
    const nameInput = document.getElementById('editProfileName');
    const locInput = document.getElementById('editProfileLocation');
    const avatarPreview = document.getElementById('editAvatarPreview');

    if (nameInput) nameInput.value = user.name;
    if (locInput) locInput.value = user.location || 'Nova Amerit - NA (Nova Arcanis)';
    if (avatarPreview) avatarPreview.src = user.avatar || 'images/elgalylogo.png';
    this.editAvatarBase64 = null;

    if (modal) modal.classList.add('active');
  },

  openTaskModal(task = null) {
    const modal = document.getElementById('modalTask');
    const titleEl = document.getElementById('modalTaskTitle');
    const idInput = document.getElementById('taskId');
    const titleInput = document.getElementById('taskTitle');
    const catInput = document.getElementById('taskCategory');
    const prioInput = document.getElementById('taskPriority');
    const dueInput = document.getElementById('taskDueDate');
    const descInput = document.getElementById('taskDescription');

    if (task) {
      titleEl.textContent = `Editar Encomenda (${task.code})`;
      idInput.value = task.id;
      titleInput.value = task.title;
      catInput.value = task.category;
      prioInput.value = task.priority;
      dueInput.value = task.dueDate || '';
      descInput.value = task.description || '';
    } else {
      titleEl.textContent = 'Nova Encomenda Dimensional';
      idInput.value = '';
      titleInput.value = '';
      catInput.value = 'faculdade';
      prioInput.value = 'media';
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(18, 0, 0, 0);
      dueInput.value = tomorrow.toISOString().slice(0, 16);
      descInput.value = '';
    }

    modal.classList.add('active');
  },

  showToast(message) {
    let toast = document.getElementById('eexToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'eexToast';
      toast.className = 'eex-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AppUI.init();
});
