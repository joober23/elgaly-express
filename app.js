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
    if (typeof MemoriesManager !== 'undefined') {
      MemoriesManager.memories = [];
      localStorage.removeItem('elgaly_express_daily_memories');
    }
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
    WidgetManager.update();

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

  async addHabit(title, category, days = [0, 1, 2, 3, 4, 5, 6]) {
    const newHabit = {
      id: 'habit-' + Date.now(),
      title: title.trim(),
      category: category || 'pessoal',
      days: Array.isArray(days) && days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]
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

  async resetHabitStreak(id) {
    const todayKey = this.getTodayKey();
    // Remove de hoje
    if (this.history[todayKey]) {
      this.history[todayKey] = this.history[todayKey].filter(hId => hId !== id);
    }
    // Zera o streak removendo o histórico deste hábito completamente
    Object.keys(this.history).forEach(k => {
      this.history[k] = this.history[k].filter(hId => hId !== id);
    });
    this.saveHistoryLocally();
    WidgetManager.update();
    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveHabitHistoryToCloud(this.history);
    }
  },

  calculateStreak(habitId) {
    const habit = this.habits.find(h => h.id === habitId);
    const scheduledDays = (habit && habit.days && habit.days.length > 0) ? habit.days : [0, 1, 2, 3, 4, 5, 6];

    let streak = 0;
    const today = new Date();

    if (this.isCompletedToday(habitId)) {
      streak++;
    }

    for (let i = 1; i <= 365; i++) {
      const pastDate = new Date();
      pastDate.setDate(today.getDate() - i);
      const dow = pastDate.getDay();

      // Se não era dia previsto para esse hábito (ex: fim de semana sem faculdade), não quebra o streak
      if (!scheduledDays.includes(dow)) {
        continue;
      }

      const dateKey = pastDate.toLocaleDateString('en-CA');
      const list = this.history[dateKey] || [];
      if (list.includes(habitId)) {
        streak++;
      } else {
        break; // Dia previsto que não foi cumprido: encerra o streak
      }
    }
    return streak;
  },

  getTodayStats() {
    const todayDow = new Date().getDay();
    const scheduled = this.habits.filter(h => !h.days || h.days.includes(todayDow));
    const completed = scheduled.filter(h => this.isCompletedToday(h.id));
    const pending = scheduled.filter(h => !this.isCompletedToday(h.id));
    const allDone = scheduled.length > 0 && pending.length === 0;
    const streak = this.habits.length > 0 ? Math.max(...this.habits.map(h => this.calculateStreak(h.id)), 0) : 0;

    return {
      scheduledCount: scheduled.length,
      completedCount: completed.length,
      pendingCount: pending.length,
      allDone: allDone,
      streak: streak
    };
  }
};

// ==========================================================================
// GERENCIADOR DE WIDGET (EEX Widget: Agente Midnight & Agente Brave)
// ==========================================================================
const WidgetManager = {
  update() {
    if (typeof HabitManager === 'undefined') return;
    const stats = HabitManager.getTodayStats();

    const title = stats.allDone 
      ? 'ROTA ENTREGUE! 🚀' 
      : (stats.pendingCount > 0 ? 'ROTA PENDENTE! 🚨' : 'CENTRAL EM ESPERA');

    const subtitle = stats.allDone
      ? 'Agente Brave comemora: rotina 100% cumprida! Você é uma lenda!'
      : (stats.pendingCount > 0
          ? `Agente Midnight em pânico: faltam ${stats.pendingCount} hábito(s) hoje!`
          : 'Agente Midnight ansiosa: faça seu check-in dimensional!');

    // 1. Atualiza Widget Nativo Android via plugin Capacitor (se estiver no APK)
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EexWidget) {
      try {
        window.Capacitor.Plugins.EexWidget.update({
          streak: stats.streak,
          pending: stats.pendingCount,
          allDone: stats.allDone,
          title: title,
          subtitle: subtitle
        });
      } catch (e) {
        console.warn('Erro ao atualizar EexWidget nativo:', e);
      }
    }

    // 2. Renderiza Widget no Início do App
    this.renderInAppWidget(stats, title, subtitle);
  },

  renderInAppWidget(stats, title, subtitle) {
    const container = document.getElementById('eexMascotWidget');
    if (!container) return;

    const isDone = stats.allDone;
    const mascotImg = isDone ? 'images/brave.png' : 'images/midnight.png';
    const agentName = isDone ? 'Agente Brave' : 'Agente Midnight';
    const fireIcon = isDone ? 'images/fireon.png' : 'images/fireoff.png';
    const streakText = `${stats.streak} ${stats.streak === 1 ? 'DIA' : 'DIAS'} DE SEQUÊNCIA`;

    container.className = `eex-mascot-widget ${isDone ? 'widget-mood-done' : 'widget-mood-pending'}`;
    container.innerHTML = `
      <div class="mascot-widget-avatar-wrap">
        <img src="${mascotImg}" alt="${agentName}" class="mascot-widget-img ${isDone ? 'mascot-cheer' : 'mascot-cry'}">
        <span class="mascot-widget-agent-tag">${agentName}</span>
      </div>
      <div class="mascot-widget-body">
        <div class="mascot-widget-badge-row">
          <span class="mascot-widget-badge" style="display:inline-flex;align-items:center;gap:4px;">
            <img src="${fireIcon}" alt="Fogo" style="width:16px;height:22px;object-fit:contain;">
            ${streakText}
          </span>
          <span class="mascot-widget-counter">${isDone ? '✅ 100% Concluído' : `⏳ ${stats.completedCount}/${stats.scheduledCount} Hábitos`}</span>
        </div>
        <h3 class="mascot-widget-title">${title}</h3>
        <p class="mascot-widget-desc">${subtitle}</p>
        <div class="mascot-widget-footer">
          <a href="#rotina" class="btn-comic btn-sm ${isDone ? 'btn-secondary' : ''}">
            ${isDone ? '✨ Ver Rotina Feita' : '⚡ Despachar Hábitos Agora'}
          </a>
        </div>
      </div>
    `;
  }
};

// ==========================================================================
// GERENCIADOR DE REGISTROS DIÁRIOS (Memórias com Fotos e Adesivos EEX)
// ==========================================================================
const MemoriesManager = {
  memories: [],

  init() {
    try {
      this.memories = JSON.parse(localStorage.getItem('elgaly_express_daily_memories') || '[]');
    } catch {
      this.memories = [];
    }
  },

  saveLocally() {
    localStorage.setItem('elgaly_express_daily_memories', JSON.stringify(this.memories));
  },

  async addMemory(item) {
    const memory = {
      id: 'mem-' + Date.now(),
      habitTitle: item.habitTitle || 'Rotina Concluída',
      photo: item.photo,
      caption: item.caption || 'Momento bacana da rotina!',
      sticker: item.sticker || 'brave',
      date: new Date().toLocaleDateString('pt-BR'),
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now()
    };
    this.memories.unshift(memory);
    this.saveLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveMemoryToCloud(memory);
    }
    this.render();
    return memory;
  },

  async deleteMemory(id) {
    this.memories = this.memories.filter(m => m.id !== id);
    this.saveLocally();
    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.deleteMemoryFromCloud(id);
    }
    this.render();
  },

  render() {
    const grid = document.getElementById('dailyMemoriesGrid');
    if (!grid) return;

    if (this.memories.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 28px; background: var(--card-bg); border: 3px dashed var(--purple-main); border-radius: 18px;">
          <span style="font-size: 2.2rem; display: block; margin-bottom: 6px;">📷</span>
          <h4 style="font-size: 1.15rem; color: var(--purple-dark); margin-bottom: 4px;">Nenhum Registro Diário Ainda</h4>
          <p style="font-size: 0.88rem; color: #6b7280; font-weight: 600;">
            Ao concluir hábitos na sua rotina, tire fotos e adicione adesivos dos agentes para preencher este mural!
          </p>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.memories.map(mem => `
      <div class="daily-memory-card">
        <div class="memory-polaroid-frame">
          <img src="${mem.photo}" alt="${mem.caption}" class="memory-polaroid-img">
          <img src="images/${mem.sticker === 'midnight' ? 'midnight.png' : (mem.sticker === 'fire' ? 'fireon.png' : 'brave.png')}" alt="Sticker" class="memory-polaroid-sticker">
        </div>
        <div class="memory-card-body">
          <div class="memory-card-habit">✨ ${mem.habitTitle}</div>
          <div class="memory-card-caption">"${mem.caption}"</div>
          <div class="memory-card-meta">
            <span>📅 ${mem.date} às ${mem.time}</span>
            <button class="memory-del-btn" data-id="${mem.id}" title="Excluir Registro">🗑️</button>
          </div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.memory-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (confirm('Deseja excluir este registro diário?')) {
          this.deleteMemory(id);
        }
      });
    });
  }
};

// ==========================================================================
// GERENCIADOR DO EEX-FRIENDS (Rede de Amigos & Entregas Coletivas)
// ==========================================================================
const FriendsManager = {
  friends: [],
  pendingRequests: [],
  currentSubtab: 'mural',

  init() {
    try {
      this.friends = JSON.parse(localStorage.getItem('elgaly_express_friends') || '[]');
    } catch {
      this.friends = [];
    }
  },

  saveLocally() {
    localStorage.setItem('elgaly_express_friends', JSON.stringify(this.friends));
  },

  async syncMyPublicProfile() {
    const user = AuthManager.getCurrentUser();
    if (!user || typeof FirebaseService === 'undefined') return;
    try {
      const stats = HabitManager.getTodayStats();
      await FirebaseService.updatePublicProfile({
        name: user.name,
        nickname: user.nickname,
        eexEmail: user.eexEmail,
        avatar: user.avatar,
        location: user.location,
        streak: stats.streak,
        allDoneToday: stats.allDone,
        pendingToday: stats.pending
      });
    } catch (e) {
      console.warn('Erro ao sincronizar perfil público:', e);
    }
  },

  async onFriendsListChanged(friendIds) {
    if (!friendIds || friendIds.length === 0) {
      this.friends = [];
      this.saveLocally();
      this.render();
      return;
    }

    try {
      if (typeof FirebaseService !== 'undefined' && FirebaseService.db) {
        const promises = friendIds.map(uid => 
          FirebaseService.db.collection('public_profiles').doc(uid).get()
        );
        const docs = await Promise.all(promises);
        this.friends = docs.filter(d => d.exists).map(d => ({ uid: d.id, ...d.data() }));
        this.saveLocally();
        this.render();
      }
    } catch (e) {
      console.warn('Erro ao carregar dados dos amigos:', e);
    }
  },

  setPendingRequests(requests) {
    this.pendingRequests = requests || [];
    this.render();
    this.updateBadge();
  },

  updateBadge() {
    const badgeEl = document.getElementById('friendsReqBadge');
    if (badgeEl) {
      if (this.pendingRequests.length > 0) {
        badgeEl.textContent = this.pendingRequests.length;
        badgeEl.style.display = 'inline-flex';
      } else {
        badgeEl.style.display = 'none';
      }
    }
  },

  render() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    // Atualiza o display do meu ID Express
    const myIdEl = document.getElementById('myEexIdDisplay');
    if (myIdEl) myIdEl.textContent = user.eexEmail || `${user.nickname || 'agente'}.express.com`;

    const countBadge = document.getElementById('friendsCountBadge');
    if (countBadge) countBadge.textContent = this.friends.length;
    this.updateBadge();

    this.renderMural();
    this.renderRequests();
  },

  renderMural() {
    const grid = document.getElementById('friendsListGrid');
    if (!grid) return;

    if (this.friends.length === 0) {
      grid.innerHTML = `
        <div class="friends-empty-box">
          <span style="font-size: 2.6rem; display: block; margin-bottom: 8px;">🤝</span>
          <h3>Nenhum Parceiro Adicionado Ainda</h3>
          <p>
            Trabalhe em equipe! Busque seus amigos na aba <strong>Buscar Agentes</strong> ou mande seu ID Express para eles se conectarem!
          </p>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.friends.map(friend => {
      const isDone = !!friend.allDoneToday;
      const mascotImg = isDone ? 'images/brave.png' : 'images/midnight.png';
      const mascotStatus = isDone 
        ? '✨ Brave comemora: rotina de hoje 100% cumprida!' 
        : (friend.pendingToday > 0 
            ? `😭 Midnight em pânico: ${friend.pendingToday} hábito(s) pendente(s)!` 
            : '😭 Midnight ansiosa: check-in de hoje pendente!');

      return `
        <div class="friend-card ${isDone ? 'done-today' : 'pending-today'}">
          <div class="friend-card-top">
            <img src="${friend.avatar || 'images/elgalylogo.png'}" alt="${friend.name}" class="friend-avatar">
            <div class="friend-details">
              <h4 class="friend-name">${friend.name || 'Agente'}</h4>
              <span class="friend-nick">@${friend.eexEmail || (friend.nickname + '.express.com')}</span>
              <span class="friend-location">📍 ${friend.location || 'Nova Amerit - NA'}</span>
            </div>
            <div class="friend-streak-pill" title="Sequência de Rotina">
              <img src="images/${isDone ? 'fireon.png' : 'fireoff.png'}" alt="Fogo" class="friend-fire-icon">
              <span>${friend.streak || 0} DIAS</span>
            </div>
          </div>

          <div class="friend-mascot-status">
            <img src="${mascotImg}" alt="Status" class="friend-status-mascot ${isDone ? 'bounce' : 'shake'}">
            <span class="friend-status-text">${mascotStatus}</span>
          </div>

          <div class="friend-card-actions">
            <button type="button" class="btn-comic btn-poke" data-uid="${friend.uid}" data-name="${friend.name || friend.nickname}">
              📢 Dar uma Força!
            </button>
            <button type="button" class="btn-comic btn-secondary btn-del-friend" data-uid="${friend.uid}" data-name="${friend.name || friend.nickname}" title="Remover Parceiro">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Eventos dos botões de cada amigo
    grid.querySelectorAll('.btn-poke').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        btn.disabled = true;
        btn.textContent = '⚡ Enviando...';
        await FirebaseService.sendPoke(uid);
        AppUI.showToast(`📢 Você deu uma força para ${name}!`);
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '📢 Dar uma Força!';
        }, 3000);
      });
    });

    grid.querySelectorAll('.btn-del-friend').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        if (confirm(`Deseja desfazer a parceria com ${name}?`)) {
          await FirebaseService.removeFriend(uid);
          AppUI.showToast(`Parceria com ${name} desfeita.`);
        }
      });
    });
  },

  renderRequests() {
    const list = document.getElementById('friendsRequestsList');
    if (!list) return;

    if (this.pendingRequests.length === 0) {
      list.innerHTML = `
        <div class="friends-empty-box">
          <span style="font-size: 2.2rem; display: block; margin-bottom: 6px;">📬</span>
          <h4>Nenhum Pedido Pendente</h4>
          <p>Quando outros entregadores da Rede EEX enviarem pedidos de parceria, eles aparecerão aqui.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = this.pendingRequests.map(req => `
      <div class="friend-request-card">
        <img src="${req.fromAvatar || 'images/elgalylogo.png'}" alt="${req.fromName}" class="request-avatar">
        <div class="request-info">
          <h4>${req.fromName}</h4>
          <span>@${req.fromEexEmail || (req.fromNick + '.express.com')}</span>
          <small>Quer se conectar para entregas coletivas!</small>
        </div>
        <div class="request-actions">
          <button type="button" class="btn-comic btn-accept-req" data-id="${req.id}" data-name="${req.fromName}">
            ✅ Aceitar
          </button>
          <button type="button" class="btn-comic btn-secondary btn-reject-req" data-id="${req.id}">
            ❌ Recusar
          </button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-accept-req').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reqId = btn.dataset.id;
        const req = this.pendingRequests.find(r => r.id === reqId);
        if (!req) return;
        btn.disabled = true;
        await FirebaseService.acceptFriendRequest(req);
        AppUI.showToast(`🎉 Parceria aceita com ${btn.dataset.name}!`);
      });
    });

    list.querySelectorAll('.btn-reject-req').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reqId = btn.dataset.id;
        btn.disabled = true;
        await FirebaseService.rejectFriendRequest(reqId);
        AppUI.showToast('Solicitação recusada.');
      });
    });
  }
};

// ==========================================================================
// GERENCIADOR DE TEMAS (ThemeManager) — Modo Claro & Modo Escuro
// ==========================================================================
const ThemeManager = {
  current: 'light',

  init() {
    const saved = localStorage.getItem('elgaly_theme') || 
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.setTheme(saved);
  },

  toggle() {
    this.setTheme(this.current === 'dark' ? 'light' : 'dark');
  },

  setTheme(theme) {
    this.current = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('elgaly_theme', theme);

    const btn = document.getElementById('btnThemeToggle');
    if (btn) btn.innerHTML = theme === 'dark' ? '☀️ Alternar para Modo Claro' : '🌙 Alternar para Modo Escuro';

    const statusLabel = document.getElementById('themeStatusLabel');
    if (statusLabel) statusLabel.textContent = theme === 'dark' ? '🌙 Modo Escuro Ativo' : '☀️ Modo Claro Ativo';

    const iconBtn = document.getElementById('btnHeaderTheme');
    if (iconBtn) iconBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
  }
};

// ==========================================================================
// GERENCIADOR DE EVENTOS & LEMBRETES (EventManager)
// Provas da faculdade, aniversários, reuniões e compromissos com data fixa
// ==========================================================================
const EventManager = {
  events: [],

  getStorageKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_events_${user.id}` : 'elgaly_events_default';
  },

  init() {
    if (!AuthManager.isLoggedIn()) {
      this.events = [];
      return;
    }
    const key = this.getStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try { this.events = JSON.parse(saved); } catch (e) { this.events = []; }
    } else {
      this.events = [];
    }
  },

  saveLocally() {
    if (!AuthManager.isLoggedIn()) return;
    localStorage.setItem(this.getStorageKey(), JSON.stringify(this.events));
  },

  getAllEvents() {
    return this.events.sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  getUpcomingEvents() {
    const today = new Date().toLocaleDateString('en-CA');
    return this.getAllEvents().filter(e => !e.completed && e.date >= today);
  },

  async addEvent(eventData) {
    const newEvent = {
      id: 'evt-' + Date.now(),
      title: eventData.title.trim(),
      date: eventData.date,
      time: eventData.time || '',
      category: eventData.category || 'faculdade',
      description: (eventData.description || '').trim(),
      completed: false,
      createdAt: new Date().toISOString()
    };
    this.events.push(newEvent);
    this.saveLocally();
    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveEventToCloud(newEvent);
    }
    return newEvent;
  },

  async updateEvent(id, updatedFields) {
    const idx = this.events.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.events[idx] = { ...this.events[idx], ...updatedFields };
      this.saveLocally();
      if (typeof FirebaseService !== 'undefined') {
        await FirebaseService.saveEventToCloud(this.events[idx]);
      }
    }
  },

  async deleteEvent(id) {
    this.events = this.events.filter(e => e.id !== id);
    this.saveLocally();
    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.deleteEventFromCloud(id);
    }
  },

  async toggleEvent(id) {
    const evt = this.events.find(e => e.id === id);
    if (evt) {
      evt.completed = !evt.completed;
      this.saveLocally();
      if (typeof FirebaseService !== 'undefined') {
        await FirebaseService.saveEventToCloud(evt);
      }
    }
  }
};

// ==========================================================================
// UTILITÁRIO DE AUTOCOMPLETE DE CIDADES DE SÃO PAULO (645 Municípios)
// ==========================================================================
function setupCityAutocomplete(inputEl, suggestionsEl) {
  if (!inputEl || !suggestionsEl) return;
  const cities = window.SP_CITIES || ['São Paulo - SP', 'Campinas - SP', 'Guarulhos - SP'];
  const normalize = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  inputEl.addEventListener('input', () => {
    const q = normalize(inputEl.value);
    if (q.length < 2) {
      suggestionsEl.classList.remove('show');
      return;
    }
    const matches = cities.filter(c => normalize(c).includes(q)).slice(0, 15);
    if (matches.length === 0) {
      suggestionsEl.classList.remove('show');
      return;
    }
    suggestionsEl.innerHTML = matches.map(c => 
      `<div class="city-suggestion-item" data-city="${c}">${c}</div>`
    ).join('');
    suggestionsEl.classList.add('show');
  });

  suggestionsEl.addEventListener('click', (e) => {
    const item = e.target.closest('.city-suggestion-item');
    if (item) {
      inputEl.value = item.dataset.city;
      suggestionsEl.classList.remove('show');
    }
  });

  document.addEventListener('click', (e) => {
    if (!inputEl.contains(e.target) && !suggestionsEl.contains(e.target)) {
      suggestionsEl.classList.remove('show');
    }
  });
}

// ==========================================================================
// GERENCIADOR DE NOTIFICAÇÕES LOCAIS (Capacitor Native + Web)
// Notificações de 3 em 3 horas para hábitos pendentes, prazos e eventos
// ==========================================================================
const NotificationManager = {
  _plugin: null,
  _ready: false,
  _debounceTimer: null,

  isNative() {
    return typeof window !== 'undefined' &&
      !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },

  async init() {
    try {
      if (this.isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        this._plugin = window.Capacitor.Plugins.LocalNotifications;
        const status = await this._plugin.requestPermissions();
        this._ready = status && status.display === 'granted';
        console.log(`📱 Capacitor LocalNotifications ativo: ${this._ready ? 'Concedido' : 'Negado'}`);
        if (this._ready) {
          this.scheduleAll();
        }
      }
    } catch (err) {
      console.warn('⚠️ Falha ao inicializar NotificationManager:', err);
      this._ready = false;
    }
  },

  async requestPermission() {
    if (!this.isNative()) {
      return false;
    }
    try {
      if (this._plugin) {
        const res = await this._plugin.requestPermissions();
        this._ready = res && res.display === 'granted';
        return this._ready;
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  },

  /**
   * Agenda todas as notificações:
   * 1. Rotina Diária: a cada 3 horas (08h, 11h, 14h, 17h, 20h) para os próximos 7 dias
   * 2. Encomendas com prazo: 3 dias antes, 1 dia antes e no dia da entrega
   * 3. Eventos: 1 dia antes, 1 hora antes e na hora do evento
   */
  scheduleAll() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._executeSchedule();
    }, 1500);
  },

  async _executeSchedule() {
    if (!this.isNative() || !this._ready || !this._plugin) {
      return;
    }

    try {
      // 1. Cancela notificações pendentes anteriores para re-agendamento limpo
      const pending = await this._plugin.getPending();
      if (pending && pending.notifications && pending.notifications.length > 0) {
        await this._plugin.cancel({
          notifications: pending.notifications.map(n => ({ id: n.id }))
        });
      }

      const notifications = [];
      const now = new Date();
      let notifId = 1000;

      // -------------------------------------------------------------
      // 1. ROTINA DIÁRIA (HÁBITOS PENDENTES) - De 3 em 3 horas
      // Horários: 08:00, 11:00, 14:00, 17:00, 20:00
      // -------------------------------------------------------------
      const habits = (typeof HabitManager !== 'undefined' && HabitManager.habits) ? HabitManager.habits : [];
      const routineHours = [8, 11, 14, 17, 20];
      const dayMap = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };

      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + dayOffset);
        const dayOfWeek = targetDate.getDay();
        const dayKey = dayMap[dayOfWeek];

        const scheduledHabits = habits.filter(h => {
          if (!h.days || h.days.length === 0) return true;
          return h.days.includes(dayKey);
        });

        const pendingHabits = (dayOffset === 0)
          ? scheduledHabits.filter(h => !h.done)
          : scheduledHabits;

        if (pendingHabits.length === 0) continue;

        for (const hour of routineHours) {
          const schedTime = new Date(targetDate);
          schedTime.setHours(hour, 0, 0, 0);

          if (schedTime > now) {
            notifications.push({
              id: notifId++,
              title: '🔄 Rotina EEX Pendente',
              body: `Você tem ${pendingHabits.length} hábito(s) da rotina diária pendentes hoje! Não deixe acumular 💪`,
              schedule: { at: schedTime },
              sound: 'eex_notification.mp3'
            });
          }
        }
      }

      // -------------------------------------------------------------
      // 2. ENCOMENDAS & TAREFAS COM PRAZO
      // - 3 dias antes (09:00)
      // - 1 dia antes (09:00)
      // - No dia da entrega (09:00)
      // -------------------------------------------------------------
      const tasks = (typeof TaskManager !== 'undefined' && TaskManager.tasks) ? TaskManager.tasks : [];
      for (const task of tasks) {
        if (task.completed || !task.dueDate) continue;

        const dueDate = new Date(task.dueDate.includes('T') ? task.dueDate : `${task.dueDate}T09:00:00`);
        if (isNaN(dueDate.getTime())) continue;

        const title = task.title || 'Encomenda';

        // 3 dias antes às 09:00
        const threeDaysBefore = new Date(dueDate);
        threeDaysBefore.setDate(threeDaysBefore.getDate() - 3);
        threeDaysBefore.setHours(9, 0, 0, 0);
        if (threeDaysBefore > now) {
          notifications.push({
            id: notifId++,
            title: '📦 Entregar em 3 dias!',
            body: `A encomenda "${title}" vence em 3 dias! Prepare o envio ⏰`,
            schedule: { at: threeDaysBefore },
            sound: 'eex_notification.mp3'
          });
        }

        // 1 dia antes às 09:00
        const oneDayBefore = new Date(dueDate);
        oneDayBefore.setDate(oneDayBefore.getDate() - 1);
        oneDayBefore.setHours(9, 0, 0, 0);
        if (oneDayBefore > now) {
          notifications.push({
            id: notifId++,
            title: '🚨 Entregar amanhã!',
            body: `A encomenda "${title}" precisa ser despachada amanhã! 📦`,
            schedule: { at: oneDayBefore },
            sound: 'eex_notification.mp3'
          });
        }

        // No dia da entrega às 09:00
        const dayOf = new Date(dueDate);
        dayOf.setHours(9, 0, 0, 0);
        if (dayOf > now) {
          notifications.push({
            id: notifId++,
            title: '🔴 Dia de Entrega!',
            body: `A encomenda "${title}" vence HOJE! Finalize e entregue no prazo! 🚨`,
            schedule: { at: dayOf },
            sound: 'eex_notification.mp3'
          });
        }
      }

      // -------------------------------------------------------------
      // 3. EVENTOS & LEMBRETES
      // - 1 dia antes (09:00)
      // - 1 hora antes do horário
      // - No momento do evento
      // -------------------------------------------------------------
      const events = (typeof EventManager !== 'undefined' && EventManager.events) ? EventManager.events : [];
      for (const ev of events) {
        if (ev.done || !ev.date) continue;

        const timeStr = ev.time || '09:00';
        const eventDateTime = new Date(`${ev.date}T${timeStr}:00`);
        if (isNaN(eventDateTime.getTime())) continue;

        const evTitle = ev.title || 'Evento';

        // 1 dia antes às 09:00
        const dayBefore = new Date(eventDateTime);
        dayBefore.setDate(dayBefore.getDate() - 1);
        dayBefore.setHours(9, 0, 0, 0);
        if (dayBefore > now) {
          notifications.push({
            id: notifId++,
            title: '📅 Evento Amanhã!',
            body: `Lembrete: "${evTitle}" acontece amanhã às ${timeStr} 🎯`,
            schedule: { at: dayBefore },
            sound: 'eex_notification.mp3'
          });
        }

        // 1 hora antes
        const oneHourBefore = new Date(eventDateTime);
        oneHourBefore.setHours(oneHourBefore.getHours() - 1);
        if (oneHourBefore > now) {
          notifications.push({
            id: notifId++,
            title: '⏰ Evento próximo!',
            body: `O evento "${evTitle}" começa em 1 hora! Prepare-se 🚀`,
            schedule: { at: oneHourBefore },
            sound: 'eex_notification.mp3'
          });
        }

        // No horário do evento
        if (eventDateTime > now) {
          notifications.push({
            id: notifId++,
            title: '🎯 Evento agora!',
            body: `O evento "${evTitle}" está acontecendo agora! 🔔`,
            schedule: { at: eventDateTime },
            sound: 'eex_notification.mp3'
          });
        }
      }

      // Agenda até 64 notificações no dispositivo
      if (notifications.length > 0) {
        const batch = notifications.slice(0, 64);
        await this._plugin.schedule({ notifications: batch });
        console.log(`✅ [NotificationManager] ${batch.length} notificações locais agendadas.`);
      }
    } catch (err) {
      console.error('❌ [NotificationManager] Erro ao agendar notificações:', err);
    }
  },

  async testNotification() {
    if (this.isNative() && this._plugin) {
      try {
        if (!this._ready) {
          const res = await this._plugin.requestPermissions();
          this._ready = res && res.display === 'granted';
        }
        if (!this._ready) {
          AppUI.showToast('❌ Permissão de notificações negada no Android.');
          return;
        }

        const testDate = new Date(Date.now() + 5000);
        await this._plugin.schedule({
          notifications: [{
            id: 9999,
            title: '🚀 Elgaly Express: Notificação Ativa!',
            body: 'Suas notificações nativas estão funcionando com sucesso! 📦',
            schedule: { at: testDate },
            sound: 'eex_notification.mp3'
          }]
        });
        AppUI.showToast('🔔 Notificação teste agendada para daqui a 5 segundos!');
      } catch (e) {
        console.error('Erro ao testar notificação:', e);
        AppUI.showToast('⚠️ Erro ao enviar notificação de teste.');
      }
    } else {
      PWAManager.testNotification();
    }
  }
};

// ==========================================================================
// GERENCIADOR DE PWA & NOTIFICAÇÕES (PWAManager)
// Instalação na tela inicial do celular/PC e alertas operacionais
// ==========================================================================
const PWAManager = {
  deferredPrompt: null,

  init() {
    // 1. Registro do Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => console.log('PWA Service Worker ativo:', reg.scope))
          .catch((err) => console.warn('PWA SW registro falhou:', err));
      });
    }

    // 2. Intercepta evento de instalação do app
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showInstallButtons(true);
    });

    // 3. App instalado com sucesso
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.showInstallButtons(false);
      AppUI.showToast('🎉 Elgaly Express instalado com sucesso na sua tela inicial!');
      const statusEl = document.getElementById('pwaStatusText');
      if (statusEl) statusEl.textContent = '✅ Aplicativo instalado neste dispositivo!';
    });

    // 4. Se já estiver rodando em standalone
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      this.showInstallButtons(false);
      const statusEl = document.getElementById('pwaStatusText');
      if (statusEl) statusEl.textContent = '⚡ Você está usando a versão aplicativo (PWA)!';
    }
  },

  showInstallButtons(show) {
    document.querySelectorAll('.btn-pwa-install').forEach(btn => {
      btn.style.display = show ? 'inline-block' : 'none';
    });
  },

  async promptInstall() {
    if (!this.deferredPrompt) {
      AppUI.showToast('💡 No menu do seu navegador (três pontinhos ou compartilhar), toque em "Adicionar à Tela de Início"!');
      return;
    }
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      this.deferredPrompt = null;
      this.showInstallButtons(false);
    }
  },

  async testNotification() {
    if (!('Notification' in window)) {
      AppUI.showToast('⚠️ Este navegador não tem suporte a notificações.');
      return;
    }

    if (Notification.permission === 'granted') {
      this.sendSampleNotification();
      AppUI.showToast('🔔 Notificação enviada!');
      return;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        this.sendSampleNotification();
        AppUI.showToast('🎉 Notificações autorizadas com sucesso!');
      } else {
        AppUI.showToast('❌ Permissão de notificações negada.');
      }
    } else {
      AppUI.showToast('⚠️ Notificações bloqueadas nas configurações do navegador.');
    }
  },

  sendSampleNotification() {
    const user = AuthManager.getCurrentUser();
    const name = user ? user.name : 'Agente';
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification('📦 Elgaly Express: Despacho em Rota!', {
          body: `Olá, ${name}! Suas encomendas e rotinas diárias estão sincronizadas e em dia.`,
          icon: 'images/icon-192.png',
          badge: 'images/icon-192.png',
          vibrate: [200, 100, 200]
        });
      });
    } else {
      new Notification('📦 Elgaly Express: Despacho em Rota!', {
        body: `Olá, ${name}! Suas encomendas e rotinas diárias estão sincronizadas e em dia.`,
        icon: 'images/icon-192.png'
      });
    }
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

  isMobileDevice() {
    return (
      (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768
    );
  },

  showSplash(message = 'CARREGANDO...') {
    const splash = document.getElementById('eexSplashScreen');
    const msgEl = document.getElementById('eexSplashStatus');
    if (msgEl) msgEl.textContent = message;
    if (splash) splash.classList.remove('hidden');
  },

  hideSplash() {
    const splash = document.getElementById('eexSplashScreen');
    if (splash) {
      setTimeout(() => {
        splash.classList.add('hidden');
      }, 400);
    }
  },

  init() {
    ThemeManager.init();
    AuthManager.init();
    TaskManager.init();
    HabitManager.init();
    EventManager.init();
    MemoriesManager.init();
    FriendsManager.init();
    PWAManager.init();
    NotificationManager.init();

    this.bindEvents();
    this.initNavigation();
    this.initSmartNavbar();
    this.initMobileDrawer();
    this.updateCurrentDateDisplay();
    this.renderAll();

    setInterval(() => {
      if (AuthManager.isLoggedIn()) {
        this.renderTasks();
        this.renderEvents();
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
        if (tab) {
          window.location.hash = tab;
          this.switchTab(tab);
        }
      });
    });
  },

  initNavigation() {
    const handleRoute = () => {
      const hash = window.location.hash.replace('#', '') || 'inicio';
      const validTabs = ['inicio', 'rotina', 'encomendas', 'relatorios', 'amigos', 'perfil', 'configuracoes'];
      this.switchTab(validTabs.includes(hash) ? hash : 'inicio');
    };

    window.addEventListener('hashchange', handleRoute);

    // Garante resposta de toque imediata no app mobile e desktop
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const tab = link.dataset.tab;
        if (tab) {
          e.preventDefault();
          if (window.location.hash !== `#${tab}`) {
            window.location.hash = tab;
          } else {
            this.switchTab(tab);
          }
        }
      });
    });

    handleRoute();
  },

  switchTab(tabName) {
    this.currentTab = tabName;

    document.querySelectorAll('.nav-link, .drawer-nav-link, .bottom-nav-item').forEach(link => {
      link.classList.toggle('active', link.dataset.tab === tabName);
    });

    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.toggle('active-view', view.id === `view-${tabName}`);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabName === 'inicio') this.renderHomeOverview();
    if (tabName === 'rotina') this.renderDailyRoutine();
    if (tabName === 'encomendas') { this.renderTasks(); this.renderEvents(); }
    if (tabName === 'relatorios') { ReportEngine.renderReportPreview(); MemoriesManager.render(); }
    if (tabName === 'amigos') {
      FriendsManager.render();
      FriendsManager.syncMyPublicProfile();
    }
    if (tabName === 'perfil') this.renderProfileView();
    if (tabName === 'configuracoes') this.renderConfiguracoes();
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

      // Autocomplete de cidades de SP (Todos os 645 municípios)
      const onbLocation = document.getElementById('onbLocation');
      const citySugg = document.getElementById('citySuggestions');
      setupCityAutocomplete(onbLocation, citySugg);

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
        EventManager.init();

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

    // 6. Filtros de Tarefas
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.renderTasks();
      });
    });

    // 7. Busca de Encomendas
    const searchInput = document.getElementById('taskSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.renderTasks();
      });
    }

    // 8. Botões de Nova Encomenda
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

    // 9. Seletor de Dias da Semana para Hábitos
    document.querySelectorAll('#habitDaysPicker .weekday-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
      });
    });

    document.querySelectorAll('.weekday-quick-presets .preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        const allBtns = document.querySelectorAll('#habitDaysPicker .weekday-btn');
        if (preset === 'all') {
          allBtns.forEach(b => b.classList.add('active'));
        } else if (preset === 'weekdays') {
          allBtns.forEach(b => {
            const d = parseInt(b.dataset.day, 10);
            b.classList.toggle('active', d >= 1 && d <= 5);
          });
        } else if (preset === 'weekend') {
          allBtns.forEach(b => {
            const d = parseInt(b.dataset.day, 10);
            b.classList.toggle('active', d === 0 || d === 6);
          });
        }
      });
    });

    // 10. Botões de Novo Hábito
    const btnsNewHabit = document.querySelectorAll('.action-new-habit');
    const modalHabit = document.getElementById('modalHabit');
    const formHabit = document.getElementById('formHabit');
    const modalHabitClose = document.getElementById('modalHabitClose');

    btnsNewHabit.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!AuthManager.isLoggedIn()) return;
        document.getElementById('habitTitle').value = '';
        // Reseta todos os dias como ativos por padrão
        document.querySelectorAll('#habitDaysPicker .weekday-btn').forEach(b => b.classList.add('active'));
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
        const selectedDays = [];
        document.querySelectorAll('#habitDaysPicker .weekday-btn.active').forEach(b => {
          selectedDays.push(parseInt(b.dataset.day, 10));
        });

        if (title) {
          await HabitManager.addHabit(title, cat, selectedDays.length ? selectedDays : [0, 1, 2, 3, 4, 5, 6]);
          modalHabit.classList.remove('active');
          this.renderDailyRoutine();
          this.renderHomeOverview();
          ReportEngine.renderReportPreview();
          this.showToast('Novo hábito registrado no check-in!');
        }
      });
    }

    // 11. Modal de Novo Evento / Lembrete
    const btnsNewEvent = document.querySelectorAll('.action-new-event');
    const modalEvent = document.getElementById('modalEvent');
    const formEvent = document.getElementById('formEvent');
    const modalEventClose = document.getElementById('modalEventClose');

    btnsNewEvent.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!AuthManager.isLoggedIn()) return;
        this.openEventModal();
      });
    });

    if (modalEventClose && modalEvent) {
      modalEventClose.addEventListener('click', () => {
        modalEvent.classList.remove('active');
      });
    }

    if (formEvent) {
      formEvent.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('eventId').value;
        const eventData = {
          title: document.getElementById('eventTitle').value,
          date: document.getElementById('eventDate').value,
          time: document.getElementById('eventTime').value,
          category: document.getElementById('eventCategory').value,
          description: document.getElementById('eventDescription').value
        };

        if (id) {
          await EventManager.updateEvent(id, eventData);
          this.showToast('Evento atualizado!');
        } else {
          await EventManager.addEvent(eventData);
          this.showToast('📅 Lembrete de evento adicionado!');
        }

        modalEvent.classList.remove('active');
        this.renderEvents();
        this.renderHomeOverview();
      });
    }

    // 12. Subnav Tabs (Encomendas vs Eventos)
    const tabBtnTasks = document.getElementById('tabBtnTasks');
    const tabBtnEvents = document.getElementById('tabBtnEvents');
    const subviewTasks = document.getElementById('subviewTasks');
    const subviewEvents = document.getElementById('subviewEvents');

    if (tabBtnTasks && tabBtnEvents) {
      tabBtnTasks.addEventListener('click', () => {
        tabBtnTasks.classList.add('active');
        tabBtnEvents.classList.remove('active');
        if (subviewTasks) subviewTasks.style.display = 'block';
        if (subviewEvents) subviewEvents.style.display = 'none';
      });

      tabBtnEvents.addEventListener('click', () => {
        tabBtnEvents.classList.add('active');
        tabBtnTasks.classList.remove('active');
        if (subviewTasks) subviewTasks.style.display = 'none';
        if (subviewEvents) subviewEvents.style.display = 'block';
        this.renderEvents();
      });
    }

    // 13. Configurações: Alternar Tema (Modo Escuro / Claro)
    const btnThemeToggle = document.getElementById('btnThemeToggle');
    const btnHeaderTheme = document.getElementById('btnHeaderTheme');
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', () => ThemeManager.toggle());
    }
    if (btnHeaderTheme) {
      btnHeaderTheme.addEventListener('click', () => ThemeManager.toggle());
    }

    // 14. Configurações: Atualizar PIN
    const formChangePin = document.getElementById('formChangePin');
    if (formChangePin) {
      formChangePin.addEventListener('submit', (e) => {
        e.preventDefault();
        const newPin = (document.getElementById('cfgNewPin').value || '').trim();
        if (!/^[0-9]{6}$/.test(newPin)) {
          this.showToast('❌ O PIN deve ter 6 dígitos numéricos!');
          return;
        }
        const user = AuthManager.getCurrentUser();
        if (user) {
          AuthManager.saveBadge(user, newPin);
          this.showToast('🔐 PIN do crachá atualizado com sucesso!');
          document.getElementById('cfgNewPin').value = '';
        }
      });
    }

    // 15. Configurações: Atualizar Localização com Autocomplete SP
    const cfgLocationInput = document.getElementById('cfgLocation');
    const cfgCitySuggestions = document.getElementById('cfgCitySuggestions');
    setupCityAutocomplete(cfgLocationInput, cfgCitySuggestions);

    const formChangeLocation = document.getElementById('formChangeLocation');
    if (formChangeLocation) {
      formChangeLocation.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = (document.getElementById('cfgLocation').value || '').trim();
        if (loc) {
          await AuthManager.updateUserProfile({ location: loc });
          this.renderAll();
          this.showToast(`📍 Setor atualizado para ${loc}!`);
        }
      });
    }

    // 16. Configurações: Logout
    const btnSettingsLogout = document.getElementById('btnSettingsLogout');
    if (btnSettingsLogout) {
      btnSettingsLogout.addEventListener('click', () => {
        if (confirm('Deseja realmente sair da sua conta?')) {
          AuthManager.logout();
        }
      });
    }

    // 17. Configurações: PWA Instalação & Notificações
    document.querySelectorAll('.btn-pwa-install').forEach(btn => {
      btn.addEventListener('click', () => PWAManager.promptInstall());
    });
    const btnPWANotify = document.getElementById('btnPWANotify');
    if (btnPWANotify) {
      btnPWANotify.addEventListener('click', () => NotificationManager.testNotification());
    }

    // 18. Fechamento de Modais clicando fora — NÃO FECHA O ONBOARDING MANDATÓRIO
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          if (overlay.id === 'modalOnboarding') return; // Onboarding obrigatório não fecha ao clicar fora!
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

    // 19. Modal de Aviso: É MELHOR MENTIR DO QUE SE DAR MAL!
    const btnKeepHabitDone = document.getElementById('btnKeepHabitDone');
    const btnConfirmResetStreak = document.getElementById('btnConfirmResetStreak');
    const modalWarnUnmark = document.getElementById('modalWarnUnmark');

    if (btnKeepHabitDone && modalWarnUnmark) {
      btnKeepHabitDone.addEventListener('click', () => {
        modalWarnUnmark.classList.remove('active');
        this._pendingUnmarkHabit = null;
      });
    }

    if (btnConfirmResetStreak && modalWarnUnmark) {
      btnConfirmResetStreak.addEventListener('click', async () => {
        if (this._pendingUnmarkHabit) {
          await HabitManager.resetHabitStreak(this._pendingUnmarkHabit.id);
          this.renderDailyRoutine();
          this.renderHomeOverview();
          ReportEngine.renderReportPreview();
          this.showToast('💀 Hábito desmarcado e streak zerado! Às vezes era melhor ter mentido...');
        }
        modalWarnUnmark.classList.remove('active');
        this._pendingUnmarkHabit = null;
      });
    }

    // 20. Modal de Registro do Momento Bacana
    const modalMomentCapture = document.getElementById('modalMomentCapture');
    const modalMomentClose = document.getElementById('modalMomentClose');
    const btnSkipMoment = document.getElementById('btnSkipMoment');
    const btnSaveMoment = document.getElementById('btnSaveMoment');
    const momentFileInput = document.getElementById('momentFileInput');

    if (modalMomentClose && modalMomentCapture) {
      modalMomentClose.addEventListener('click', () => {
        modalMomentCapture.classList.remove('active');
      });
    }
    if (btnSkipMoment && modalMomentCapture) {
      btnSkipMoment.addEventListener('click', () => {
        modalMomentCapture.classList.remove('active');
      });
    }

    if (momentFileInput) {
      momentFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            this._momentPhotoBase64 = ev.target.result;
            const preview = document.getElementById('momentPhotoPreview');
            const placeholder = document.getElementById('momentPlaceholder');
            if (preview) { preview.src = this._momentPhotoBase64; preview.style.display = 'block'; }
            if (placeholder) placeholder.style.display = 'none';
          };
          reader.readAsDataURL(file);
        }
      });
    }

    document.querySelectorAll('.moment-sticker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.moment-sticker-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedMomentSticker = btn.dataset.sticker;
        const stickerOverlay = document.getElementById('momentStickerOverlay');
        if (stickerOverlay) {
          if (this._selectedMomentSticker === 'midnight') stickerOverlay.src = 'images/midnight.png';
          else if (this._selectedMomentSticker === 'fire') stickerOverlay.src = 'images/fireon.png';
          else stickerOverlay.src = 'images/brave.png';
        }
      });
    });

    if (btnSaveMoment && modalMomentCapture) {
      btnSaveMoment.addEventListener('click', async () => {
        const caption = (document.getElementById('momentCaptionInput').value || '').trim();
        const habitTitle = this._currentMomentHabit ? this._currentMomentHabit.title : 'Rotina Concluída';
        const stickerChoice = this._selectedMomentSticker || 'brave';

        // Renderiza no Canvas para embutir o adesivo na imagem
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const baseImg = new Image();

        baseImg.onload = () => {
          const maxDim = 800;
          const scale = Math.min(maxDim / baseImg.width, maxDim / baseImg.height, 1);
          canvas.width = Math.round(baseImg.width * scale);
          canvas.height = Math.round(baseImg.height * scale);
          ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

          // Carrega e desenha o adesivo no canto inferior direito
          const stickerImg = new Image();
          stickerImg.onload = async () => {
            const stickerSize = Math.round(canvas.width * 0.28);
            ctx.drawImage(stickerImg, canvas.width - stickerSize - 16, canvas.height - stickerSize - 16, stickerSize, stickerSize);
            const finalPhoto = canvas.toDataURL('image/jpeg', 0.85);

            await MemoriesManager.addMemory({
              habitTitle: habitTitle,
              photo: finalPhoto,
              caption: caption || 'Momento bacana da rotina!',
              sticker: stickerChoice
            });

            modalMomentCapture.classList.remove('active');
            AppUI.showToast('📸 Momento bacana registrado com sucesso no relatório!');
          };

          if (stickerChoice === 'midnight') stickerImg.src = 'images/midnight.png';
          else if (stickerChoice === 'fire') stickerImg.src = 'images/fireon.png';
          else stickerImg.src = 'images/brave.png';
        };

        baseImg.src = this._momentPhotoBase64 || 'images/widgetbackground.png';
      });
    }

    // 21. EEX-Friends: Copiar Meu ID Express
    const btnCopyMyEexId = document.getElementById('btnCopyMyEexId');
    if (btnCopyMyEexId) {
      btnCopyMyEexId.addEventListener('click', async () => {
        const user = AuthManager.getCurrentUser();
        const idText = user?.eexEmail || `${user?.nickname || 'agente'}.express.com`;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(idText);
          } else {
            const temp = document.createElement('textarea');
            temp.value = idText;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
          }
          AppUI.showToast(`📋 ID Express copiado: ${idText}`);
        } catch (e) {
          AppUI.showToast(`Seu ID Express é: ${idText}`);
        }
      });
    }

    // 22. EEX-Friends: Alternância de Sub-Abas (Mural, Buscar, Pedidos)
    document.querySelectorAll('.friends-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const subtab = btn.dataset.subtab;
        document.querySelectorAll('.friends-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.friends-subtab-pane').forEach(p => p.classList.remove('active'));
        const paneMap = {
          mural: 'paneFriendsMural',
          buscar: 'paneFriendsBuscar',
          pedidos: 'paneFriendsPedidos'
        };
        const targetId = paneMap[subtab] || `paneFriends${subtab.charAt(0).toUpperCase() + subtab.slice(1)}`;
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');

        if (subtab === 'mural') FriendsManager.renderMural();
        if (subtab === 'pedidos') FriendsManager.renderRequests();
      });
    });

    // 23. EEX-Friends: Colar ID Express e Busca de Amigos
    const formSearchFriends = document.getElementById('formSearchFriends');
    const inputSearchFriend = document.getElementById('inputSearchFriend');
    const btnPasteFriendId = document.getElementById('btnPasteFriendId');
    const resultsContainer = document.getElementById('friendsSearchResults');

    if (btnPasteFriendId && inputSearchFriend) {
      btnPasteFriendId.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const clipText = await navigator.clipboard.readText();
            if (clipText && clipText.trim()) {
              inputSearchFriend.value = clipText.trim();
              inputSearchFriend.focus();
              AppUI.showToast(`📋 ID colado: ${clipText.trim()}`);
              return;
            }
          }
          inputSearchFriend.focus();
          AppUI.showToast('Cole o ID Express no campo com Ctrl+V');
        } catch (e) {
          inputSearchFriend.focus();
          AppUI.showToast('Cole o ID Express no campo com Ctrl+V');
        }
      });
    }

    if (formSearchFriends && inputSearchFriend && resultsContainer) {
      formSearchFriends.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = inputSearchFriend.value.trim();
        const cleanQuery = raw.replace(/^@+/, '').replace(/\.express\.com.*$/, '').trim();

        if (cleanQuery.length < 2) {
          AppUI.showToast('Digite pelo menos 2 caracteres do ID Express ou apelido.');
          return;
        }

        resultsContainer.innerHTML = `
          <div style="text-align: center; padding: 24px; color: var(--purple-dark); font-weight: 700;">
            🔍 Buscando parceiros na Rede EEX para "${raw}"...
          </div>
        `;

        const found = await FirebaseService.searchPublicUsers(raw);
        if (found.length === 0) {
          resultsContainer.innerHTML = `
            <div style="text-align: center; padding: 24px; color: #6b7280; font-weight: 600;">
              Nenhum parceiro encontrado com o ID "<strong>${raw}</strong>".<br>
              <small style="display:block; margin-top:8px; color: var(--purple-dark);">
                Dica: Verifique se o amigo já entrou na Rede EEX pelo menos uma vez para ativar o crachá público!
              </small>
            </div>
          `;
          return;
        }

        resultsContainer.innerHTML = found.map(u => {
          const isAlreadyFriend = FriendsManager.friends.some(f => f.uid === u.uid);
          return `
            <div class="search-agent-card">
              <img src="${u.avatar || 'images/elgalylogo.png'}" alt="${u.name}" class="search-agent-avatar">
              <div class="search-agent-info">
                <strong>${u.name}</strong>
                <span>@${u.eexEmail || (u.nickname + '.express.com')}</span>
                <small>📍 ${u.location || 'Nova Amerit - NA'}</small>
              </div>
              <div class="search-agent-action">
                ${isAlreadyFriend 
                  ? '<span class="already-partner-badge">🤝 Já é Parceiro</span>'
                  : `<button type="button" class="btn-comic btn-send-request" data-uid="${u.uid}" data-nick="${u.nickname}" data-name="${u.name}">
                      ➕ Enviar Pedido
                    </button>`
                }
              </div>
            </div>
          `;
        }).join('');

        resultsContainer.querySelectorAll('.btn-send-request').forEach(btn => {
          btn.addEventListener('click', async () => {
            const targetUid = btn.dataset.uid;
            const targetUser = found.find(u => u.uid === targetUid);
            if (!targetUser) return;
            btn.disabled = true;
            btn.textContent = 'Enviando...';
            const res = await FirebaseService.sendFriendRequest(targetUser);
            if (res.success) {
              btn.textContent = '✅ Pedido Enviado!';
              AppUI.showToast(`🚀 Pedido de parceria enviado para ${targetUser.name}!`);
            } else {
              btn.disabled = false;
              btn.textContent = '➕ Enviar Pedido';
              AppUI.showToast('Erro ao enviar pedido: ' + (res.error || 'Tente novamente.'));
            }
          });
        });
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
    const bottomNavBar = document.getElementById('bottomNavBar');

    if (!isLoggedIn) {
      // Bloqueia acesso ao app e exibe portal de login
      if (authGateway) authGateway.style.display = 'block';
      if (appViewsContainer) appViewsContainer.style.display = 'none';
      if (desktopNav) desktopNav.style.display = 'none';
      if (btnMobileMenu) btnMobileMenu.style.display = 'none';
      if (bottomNavBar) bottomNavBar.style.display = 'none';
      this.renderSavedBadges();
      this.renderHeaderProfile();
      this.hideSplash();
      return;
    }

    // Usuário logado: libera a navegação e views
    if (authGateway) authGateway.style.display = 'none';
    if (appViewsContainer) appViewsContainer.style.display = 'block';
    if (desktopNav && window.innerWidth > 768) desktopNav.style.display = 'flex';
    if (bottomNavBar) bottomNavBar.style.removeProperty('display');

    this.renderHeaderProfile();
    this.renderHomeOverview();
    this.renderDailyRoutine();
    this.renderTasks();
    this.renderEvents();
    this.renderProfileView();
    this.renderConfiguracoes();
    ReportEngine.renderReportPreview();
    NotificationManager.scheduleAll();
    this.hideSplash();
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

    const todayDow = new Date().getDay();
    const todayScheduledHabits = habits.filter(h => !h.days || h.days.includes(todayDow));

    const elActive = document.getElementById('statActiveTasks');
    const elCompleted = document.getElementById('statCompletedTasks');
    const elHabitToday = document.getElementById('statHabitStreak');
    const elOverdue = document.getElementById('statOverdueTasks');

    if (elActive) elActive.textContent = pendingTasks;
    if (elCompleted) elCompleted.textContent = completedTasks;
    if (elHabitToday) elHabitToday.textContent = `${todayHabits.length}/${todayScheduledHabits.length}`;
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

    WidgetManager.update();
    this.renderEvents();
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

    const todayDow = new Date().getDay(); // 0 = Dom, 1 = Seg ...
    const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const formatDaysBadge = (days) => {
      if (!days || days.length === 7) return '📅 Todos os dias';
      if (days.length === 5 && [1,2,3,4,5].every(d => days.includes(d))) return '📅 Seg a Sex';
      if (days.length === 2 && [0,6].every(d => days.includes(d))) return '📅 Fim de semana';
      return '📅 ' + days.map(d => DAY_NAMES[d]).join(', ');
    };

    const todayHabits = habits.filter(h => !h.days || h.days.includes(todayDow));
    const restHabits = habits.filter(h => h.days && !h.days.includes(todayDow));

    let completedCount = 0;
    container.innerHTML = '';

    // Renderiza hábitos de hoje
    todayHabits.forEach(habit => {
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
            <span class="habit-days-badge">${formatDaysBadge(habit.days)}</span>
            ${streak > 0 ? `<span class="habit-streak">🔥 ${streak} ${streak === 1 ? 'dia' : 'dias'}</span>` : ''}
          </div>
        </div>
        <div class="habit-actions">
          <button class="habit-btn-delete" title="Remover Hábito" data-id="${habit.id}">✕</button>
        </div>
      `;

      card.addEventListener('click', async (e) => {
        if (e.target.classList.contains('habit-btn-delete')) return;
        const alreadyDone = HabitManager.isCompletedToday(habit.id);
        if (alreadyDone) {
          // Já concluído: avisa que é melhor mentir do que se dar mal!
          this.promptUnmarkHabit(habit);
          return;
        }

        // Marcando como concluído!
        await HabitManager.toggleHabit(habit.id);
        this.renderDailyRoutine();
        this.renderHomeOverview();
        ReportEngine.renderReportPreview();

        // Abre modal para registrar esse momento bacana!
        this.openMomentCaptureModal(habit);
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

    // Se houver hábitos programados para outros dias (descanso hoje)
    if (restHabits.length > 0) {
      const restBox = document.createElement('div');
      restBox.className = 'rest-habits-box';
      restBox.style.gridColumn = '1 / -1';
      restBox.innerHTML = `
        <div class="rest-habits-title">🛌 Rotinas em Descanso Hoje (${restHabits.length} programados para outros dias)</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${restHabits.map(h => `
            <span style="background: var(--card-bg); border: 2px solid var(--purple-main); border-radius: 10px; padding: 6px 12px; font-size: 0.85rem; font-weight: 700; color: var(--purple-dark);">
              ${h.title} <small style="color: var(--purple-main);">(${formatDaysBadge(h.days)})</small>
            </span>
          `).join('')}
        </div>
      `;
      container.appendChild(restBox);
    }

    const totalToday = todayHabits.length;
    const pct = totalToday > 0 ? Math.round((completedCount / totalToday) * 100) : 100;
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `${completedCount} de ${totalToday} hábitos de hoje entregues (${pct}%)`;

    if (completedCount === totalToday && totalToday > 0) {
      if (progressBar) progressBar.style.background = 'linear-gradient(90deg, #4ade80, #10b981)';
    } else {
      if (progressBar) progressBar.style.background = 'linear-gradient(90deg, var(--yellow-bright), var(--magenta-bright))';
    }
  },

  promptUnmarkHabit(habit) {
    this._pendingUnmarkHabit = habit;
    const modal = document.getElementById('modalWarnUnmark');
    if (modal) modal.classList.add('active');
  },

  openMomentCaptureModal(habit) {
    // Restrição solicitada pelo usuário: apenas no celular é permitido registrar foto
    if (!this.isMobileDevice()) {
      this.showToast('🎉 Rotina concluída! 📱 Para registrar foto e adesivos, acesse pelo celular!');
      return;
    }

    this._currentMomentHabit = habit;
    this._selectedMomentSticker = 'brave';
    this._momentPhotoBase64 = null;

    const modal = document.getElementById('modalMomentCapture');
    const preview = document.getElementById('momentPhotoPreview');
    const placeholder = document.getElementById('momentPlaceholder');
    const captionInput = document.getElementById('momentCaptionInput');
    const stickerOverlay = document.getElementById('momentStickerOverlay');
    const fileInput = document.getElementById('momentFileInput');

    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'flex';
    if (captionInput) captionInput.value = '';
    if (fileInput) fileInput.value = '';
    if (stickerOverlay) stickerOverlay.src = 'images/brave.png';

    document.querySelectorAll('.moment-sticker-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sticker === 'brave');
    });

    if (modal) modal.classList.add('active');
  },

  openEventModal(event = null) {
    const modal = document.getElementById('modalEvent');
    const titleEl = document.getElementById('modalEventTitle');
    const idInput = document.getElementById('eventId');
    const titleInput = document.getElementById('eventTitle');
    const dateInput = document.getElementById('eventDate');
    const timeInput = document.getElementById('eventTime');
    const catInput = document.getElementById('eventCategory');
    const descInput = document.getElementById('eventDescription');

    if (event) {
      titleEl.textContent = 'Editar Evento & Lembrete';
      idInput.value = event.id;
      titleInput.value = event.title;
      dateInput.value = event.date;
      timeInput.value = event.time || '';
      catInput.value = event.category || 'faculdade';
      descInput.value = event.description || '';
    } else {
      titleEl.textContent = 'Novo Evento & Lembrete';
      idInput.value = '';
      titleInput.value = '';
      dateInput.value = new Date().toLocaleDateString('en-CA');
      timeInput.value = '';
      catInput.value = 'faculdade';
      descInput.value = '';
    }

    modal.classList.add('active');
  },

  renderEvents() {
    const events = EventManager.getAllEvents();
    const container = document.getElementById('eventsGrid');
    const homeContainer = document.getElementById('homeEventsGrid');

    const renderToContainer = (targetEl, limit = null) => {
      if (!targetEl) return;
      const list = limit ? events.filter(e => !e.completed).slice(0, limit) : events;

      if (list.length === 0) {
        targetEl.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1; padding: 20px;">
            <p style="font-weight: 700; color: var(--purple-dark); margin: 0 0 10px;">Nenhum evento ou prova agendada no momento.</p>
            <button class="btn-comic action-new-event" style="font-size: 0.9rem;">+ Adicionar Prova ou Lembrete</button>
          </div>
        `;
        targetEl.querySelectorAll('.action-new-event').forEach(btn => {
          btn.addEventListener('click', () => this.openEventModal());
        });
        return;
      }

      targetEl.innerHTML = '';

      list.forEach(evt => {
        let badgeClass = 'upcoming';
        let badgeText = 'EM BREVE';

        const evtDate = new Date(evt.date + 'T00:00:00');
        const now = new Date();
        now.setHours(0,0,0,0);
        const diffDays = Math.round((evtDate - now) / (1000 * 60 * 60 * 24));

        if (evt.completed) {
          badgeClass = 'past';
          badgeText = '✅ CONCLUÍDO';
        } else if (diffDays === 0) {
          badgeClass = 'today';
          badgeText = '🚨 É HOJE!';
        } else if (diffDays === 1) {
          badgeClass = 'tomorrow';
          badgeText = '⏰ É AMANHÃ!';
        } else if (diffDays > 1 && diffDays <= 7) {
          badgeClass = 'upcoming';
          badgeText = `📅 EM ${diffDays} DIAS`;
        } else if (diffDays > 7) {
          badgeClass = 'upcoming';
          badgeText = `📅 EM ${diffDays} DIAS`;
        } else {
          badgeClass = 'past';
          badgeText = '⚠️ PASSOU';
        }

        const dateFormatted = new Date(evt.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

        const card = document.createElement('div');
        card.className = `event-card ${evt.completed ? 'completed' : ''}`;
        card.innerHTML = `
          <div class="event-header">
            <span class="habit-tag ${evt.category}">${evt.category === 'faculdade' ? '🎓 Faculdade' : (evt.category === 'trabalho' ? '💼 Trabalho' : '🌟 Pessoal')}</span>
            <span class="event-countdown-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="event-title">${evt.title}</div>
          <div class="event-date-row">
            <span>🗓️ ${dateFormatted}</span>
            ${evt.time ? `<span>• ⏰ ${evt.time}</span>` : ''}
          </div>
          ${evt.description ? `<div class="event-desc">${evt.description}</div>` : ''}
          <div class="event-footer">
            <button class="btn-comic btn-secondary btn-toggle-event" data-id="${evt.id}" style="font-size: 0.8rem; padding: 4px 10px;">
              ${evt.completed ? '↺ Reabrir' : '✓ Concluir'}
            </button>
            <div class="event-actions">
              <button class="btn-event-action btn-del-event" data-id="${evt.id}" title="Excluir">🗑️</button>
            </div>
          </div>
        `;

        card.querySelector('.btn-toggle-event').addEventListener('click', async () => {
          await EventManager.toggleEvent(evt.id);
          this.renderEvents();
          this.renderHomeOverview();
        });

        card.querySelector('.btn-del-event').addEventListener('click', async () => {
          if (confirm(`Excluir evento "${evt.title}"?`)) {
            await EventManager.deleteEvent(evt.id);
            this.renderEvents();
            this.renderHomeOverview();
          }
        });

        targetEl.appendChild(card);
      });
    };

    renderToContainer(container);
    renderToContainer(homeContainer, 3);
  },

  renderConfiguracoes() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    const nameEl = document.getElementById('cfgUserName');
    const eexEl = document.getElementById('cfgUserEex');
    const locInput = document.getElementById('cfgLocation');

    if (nameEl) nameEl.textContent = user.name;
    if (eexEl) eexEl.textContent = user.eexEmail;
    if (locInput) locInput.value = user.location || 'Nova Amerit - NA (Nova Arcanis)';

    const statusLabel = document.getElementById('themeStatusLabel');
    if (statusLabel) statusLabel.textContent = ThemeManager.current === 'dark' ? '🌙 Modo Escuro Ativo' : '☀️ Modo Claro Ativo';
    const btnTheme = document.getElementById('btnThemeToggle');
    if (btnTheme) btnTheme.innerHTML = ThemeManager.current === 'dark' ? '☀️ Alternar para Modo Claro' : '🌙 Alternar para Modo Escuro';
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
