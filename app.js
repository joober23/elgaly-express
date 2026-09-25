/**
 * ELGALY EXPRESS - APLICAÇÃO DE ROTINAS & DESPACHO
 * Gerenciador de tarefas, hábitos, autenticação EEX (.express.com), sincronização Firebase,
 * Navbar inteligente (esconde ao rolar) e Menu Lateral Mobile.
 */

// ==========================================================================
// GERENCIADOR DE AUTENTICAÇÃO & IDENTIDADE EEX (AuthManager)
// Vibe anos 2000: nickname.express.com + Suporte a Login com Google / Firebase
// ==========================================================================
const AuthManager = {
  currentUser: null,
  users: {},

  init() {
    const savedUsers = localStorage.getItem('elgaly_express_users');
    if (savedUsers) {
      try { this.users = JSON.parse(savedUsers); } catch (e) { this.users = {}; }
    }

    const savedCurrent = localStorage.getItem('elgaly_express_current_user');
    if (savedCurrent) {
      try { this.currentUser = JSON.parse(savedCurrent); } catch (e) { this.currentUser = null; }
    }

    if (!this.currentUser) {
      this.loginAsGuest();
    }
  },

  formatEexNickname(rawNick) {
    if (!rawNick) return 'entregador.express.com';
    let clean = rawNick.toLowerCase().trim()
      .replace(/@.*$/, '')
      .replace(/[^a-z0-9_.-]/g, '');
    if (!clean) clean = 'entregador';
    
    if (!clean.endsWith('.express.com')) {
      clean = clean.replace(/\.express$/, '') + '.express.com';
    }
    return clean;
  },

  loginAsGuest() {
    const guestUser = {
      id: 'guest',
      name: 'Entregador Novato',
      nickname: 'recruta',
      eexEmail: 'recruta.express.com',
      avatar: 'images/elgalylogo.png',
      isGoogle: false,
      joinedAt: new Date().toISOString()
    };
    this.currentUser = guestUser;
    this.saveCurrent();
  },

  registerUser(name, rawNick, avatarUrl = '') {
    const eexEmail = this.formatEexNickname(rawNick);
    const userId = eexEmail.replace('.express.com', '');

    const newUser = {
      id: userId,
      name: name.trim() || userId,
      nickname: userId,
      eexEmail: eexEmail,
      avatar: avatarUrl || 'images/elgalylogo.png',
      isGoogle: false,
      joinedAt: new Date().toISOString()
    };

    this.users[userId] = newUser;
    this.currentUser = newUser;
    this.saveUsers();
    this.saveCurrent();
    return newUser;
  },

  async logout() {
    if (typeof FirebaseService !== 'undefined' && this.currentUser && this.currentUser.isGoogle) {
      await FirebaseService.logout();
    }
    this.loginAsGuest();
    TaskManager.init();
    HabitManager.init();
    AppUI.renderAll();
    AppUI.showToast('Você saiu da sua conta.');
  },

  getCurrentUser() {
    return this.currentUser;
  },

  saveUsers() {
    localStorage.setItem('elgaly_express_users', JSON.stringify(this.users));
  },

  saveCurrent() {
    localStorage.setItem('elgaly_express_current_user', JSON.stringify(this.currentUser));
  }
};

// ==========================================================================
// GERENCIADOR DE TAREFAS / ENCOMENDAS (TaskManager)
// Suporta armazenamento local E sincronização em tempo real na nuvem (Firestore)
// ==========================================================================
const TaskManager = {
  tasks: [],

  getStorageKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_tasks_${user.id}` : 'elgaly_tasks_default';
  },

  init() {
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

    // Sincroniza com Firebase se logado
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
// Suporta armazenamento local E sincronização em tempo real na nuvem (Firestore)
// ==========================================================================
const HabitManager = {
  habits: [],
  history: {}, // { 'YYYY-MM-DD': ['habit-1', 'habit-2'] }

  getHabitsKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_habits_${user.id}` : 'elgaly_habits_default';
  },

  getHistoryKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_history_${user.id}` : 'elgaly_history_default';
  },

  init() {
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
    localStorage.setItem(this.getHabitsKey(), JSON.stringify(this.habits));
  },

  saveHistoryLocally() {
    localStorage.setItem(this.getHistoryKey(), JSON.stringify(this.history));
  },

  getTodayKey() {
    return new Date().toISOString().split('T')[0];
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
      const dateKey = pastDate.toISOString().split('T')[0];
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
// Com Navbar Inteligente (Auto-hide no desktop) e Menu Lateral (Mobile Drawer)
// ==========================================================================
const AppUI = {
  currentTab: 'inicio',
  currentFilter: 'todas',
  searchQuery: '',
  lastScrollTop: 0,

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
      this.renderTasks();
      this.renderHomeOverview();
    }, 60000);
  },

  /**
   * 1. Navbar Inteligente: Esconde ao rolar para baixo no desktop, reaparece ao rolar para cima!
   */
  initSmartNavbar() {
    const header = document.querySelector('header');
    if (!header) return;

    window.addEventListener('scroll', () => {
      // Apenas ativa no desktop (> 768px)
      if (window.innerWidth <= 768) {
        header.classList.remove('header-hidden');
        return;
      }

      const st = window.pageYOffset || document.documentElement.scrollTop;
      
      // Evita esconder se estiver bem perto do topo
      if (st <= 80) {
        header.classList.remove('header-hidden');
        this.lastScrollTop = st;
        return;
      }

      if (st > this.lastScrollTop && st > 120) {
        // Rolando para baixo: esconde
        header.classList.add('header-hidden');
      } else {
        // Rolando para cima: mostra
        header.classList.remove('header-hidden');
      }

      this.lastScrollTop = st <= 0 ? 0 : st;
    }, { passive: true });
  },

  /**
   * 2. Menu Lateral Mobile: Gaveta lateral deslizante em telas menores
   */
  initMobileDrawer() {
    const btnToggleDrawer = document.getElementById('btnMobileMenu');
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('drawerOverlay');
    const btnCloseDrawer = document.getElementById('btnCloseDrawer');

    const openDrawer = () => {
      if (drawer && overlay) {
        drawer.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // impede scroll de fundo
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

    // Fechar gaveta ao clicar em qualquer link da navegação mobile
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

    // Atualizar links desktop e mobile
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
    // Links de navegação desktop
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        window.location.hash = link.dataset.tab;
      });
    });

    // Filtros de Tarefas
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.renderTasks();
      });
    });

    // Busca de Encomendas
    const searchInput = document.getElementById('taskSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.renderTasks();
      });
    }

    // Modal de Login / Registro
    const btnsOpenAuth = document.querySelectorAll('.action-open-auth');
    const modalAuth = document.getElementById('modalAuth');
    const modalAuthClose = document.getElementById('modalAuthClose');
    const formDirectRegister = document.getElementById('formDirectRegister');
    const btnGoogleLogin = document.getElementById('btnGoogleLoginCustom');

    btnsOpenAuth.forEach(btn => {
      btn.addEventListener('click', () => {
        if (modalAuth) modalAuth.classList.add('active');
      });
    });

    if (modalAuthClose && modalAuth) {
      modalAuthClose.addEventListener('click', () => {
        modalAuth.classList.remove('active');
      });
    }

    // Botão Oficial do Google via Firebase
    if (btnGoogleLogin) {
      btnGoogleLogin.addEventListener('click', () => {
        if (typeof FirebaseService !== 'undefined') {
          FirebaseService.loginWithGoogle();
        }
      });
    }

    if (formDirectRegister) {
      formDirectRegister.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('regName').value;
        const nick = document.getElementById('regNick').value;
        if (nick) {
          AuthManager.registerUser(name, nick);
          TaskManager.init();
          HabitManager.init();
          modalAuth.classList.remove('active');
          this.renderAll();
          this.showToast(`Passaporte EEX ativado: ${AuthManager.getCurrentUser().eexEmail}!`);
        }
      });
    }

    const regNickInput = document.getElementById('regNick');
    const nickPreview = document.getElementById('nickPreview');
    if (regNickInput && nickPreview) {
      regNickInput.addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
        nickPreview.textContent = val ? `${val}.express.com` : 'seu-nick.express.com';
      });
    }

    // Botões de Nova Encomenda
    const btnsNewTask = document.querySelectorAll('.action-new-task');
    const modalTask = document.getElementById('modalTask');
    const formTask = document.getElementById('formTask');
    const modalTaskClose = document.getElementById('modalTaskClose');

    btnsNewTask.forEach(btn => {
      btn.addEventListener('click', () => {
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

    // Botões de Novo Hábito
    const btnsNewHabit = document.querySelectorAll('.action-new-habit');
    const modalHabit = document.getElementById('modalHabit');
    const formHabit = document.getElementById('formHabit');
    const modalHabitClose = document.getElementById('modalHabitClose');

    btnsNewHabit.forEach(btn => {
      btn.addEventListener('click', () => {
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

  renderAll() {
    this.renderHeaderProfile();
    this.renderHomeOverview();
    this.renderDailyRoutine();
    this.renderTasks();
    this.renderProfileView();
    ReportEngine.renderReportPreview();
  },

  renderHeaderProfile() {
    const user = AuthManager.getCurrentUser();
    const btnsAuth = document.querySelectorAll('.action-open-auth');
    const userBadges = document.querySelectorAll('.header-user-badge');
    const userNickTexts = document.querySelectorAll('.header-user-nick');

    if (!user || user.id === 'guest') {
      btnsAuth.forEach(b => b.style.display = 'inline-flex');
      userBadges.forEach(b => b.style.display = 'none');
    } else {
      btnsAuth.forEach(b => b.style.display = 'none');
      userBadges.forEach(b => b.style.display = 'inline-flex');
      userNickTexts.forEach(t => t.textContent = user.eexEmail);
    }
  },

  renderHomeOverview() {
    const user = AuthManager.getCurrentUser();
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

      if (user && user.id !== 'guest') {
        greetingTitle.textContent = `${saudacao}, Agente ${user.eexEmail}!`;
      } else {
        greetingTitle.textContent = `${saudacao}! Sem Tempo Para Descanso!`;
      }
    }

    if (greetingSubtitle) {
      if (user && user.id !== 'guest') {
        greetingSubtitle.textContent = `Seu terminal operacional de despacho da Ilha de Elgaly Edge está ativo. ${user.isGoogle ? 'Sincronizado na Nuvem com o Firebase ☁️!' : ''}`;
      } else {
        greetingSubtitle.textContent = `Entregando cartas, organizando encomendas e invocando entidades ancestrais em toda a ilha de Elgaly Edge!`;
      }
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
            <p>Você não possui nenhuma encomenda pendente no momento. Aproveite para criar novas tarefas ou focar na sua rotina diária!</p>
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
          <p>Adicione hábitos diários como beber água, revisar matérias da faculdade ou desenhar a HQ para acompanhar sua sequência!</p>
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
    const tasks = TaskManager.getAllTasks();
    const habits = HabitManager.getAllHabits();

    const profileCard = document.getElementById('profileBadgeCard');
    if (!profileCard) return;

    const completedTasks = tasks.filter(t => t.completed).length;
    const isGuest = !user || user.id === 'guest';

    profileCard.innerHTML = `
      <div class="retro-badge-header">
        <span class="retro-badge-tag">ELGALY EXPRESS DISPATCH PASS</span>
        <span class="retro-badge-version">EEX OS v2.000</span>
      </div>

      <div class="retro-badge-body">
        <div class="retro-avatar-box">
          <img src="${user ? user.avatar : 'images/elgalylogo.png'}" alt="Avatar" class="retro-avatar-img">
        </div>
        <div class="retro-user-details">
          <h3>${user ? user.name : 'Entregador Visitante'}</h3>
          <div class="eex-retro-email">${user ? user.eexEmail : 'recruta.express.com'}</div>
          <p style="font-size: 0.9rem; color: #4b5563; margin-top: 5px;">
            Setor de Operações: <strong>Nova Amerit - NA (Nova Arcanis)</strong>
          </p>
          <p style="font-size: 0.85rem; color: #6b7280;">
            Tipo de Acesso: ${user && user.isGoogle ? '☁️ Sincronizado na Nuvem (Firebase / Google)' : '💾 Perfil Local EEX'}
          </p>
        </div>
      </div>

      <div class="retro-badge-stats">
        <div class="badge-stat">
          <strong>${tasks.length}</strong>
          <span>Total Despachado</span>
        </div>
        <div class="badge-stat">
          <strong style="color: var(--green-dark);">${completedTasks}</strong>
          <span>Entregues</span>
        </div>
        <div class="badge-stat">
          <strong>${habits.length}</strong>
          <span>Hábitos Ativos</span>
        </div>
      </div>

      <div class="retro-badge-actions">
        ${isGuest ? `
          <button class="btn-comic btn-secondary action-open-auth">
            🔑 Cadastrar ou Fazer Login com Google
          </button>
        ` : `
          <button class="btn-comic btn-outline" onclick="AuthManager.logout()">
            Sair da Conta (${user.eexEmail})
          </button>
        `}
      </div>
    `;
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
