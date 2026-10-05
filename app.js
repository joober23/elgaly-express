/**
 * ELGALY EXPRESS - APLICAÇÃO DE ROTINAS & DESPACHO
 * Autenticação exclusivamente via Google (Rede EEX).
 * Onboarding no primeiro acesso + Crachás salvos com PIN de 6 dígitos.
 */

// ==========================================================================
// VERSÃO ATUAL DO APP
// ==========================================================================
const EEX_APP_VERSION = '1.0.0';
const EEX_GITHUB_REPO = 'joober23/elgaly-express';

// ==========================================================================
// GERENCIADOR DE ATUALIZAÇÕES (Verifica nova versão via GitHub Releases)
// ==========================================================================
const UpdateManager = {
  _checked: false,

  /**
   * Compara duas strings de versão semver (ex: "1.2.3")
   * Retorna true se remoteVersion > localVersion
   */
  _isNewer(localVersion, remoteVersion) {
    const parse = (v) => String(v || '0').replace(/^v/, '').split('.').map(Number);
    const local = parse(localVersion);
    const remote = parse(remoteVersion);
    for (let i = 0; i < Math.max(local.length, remote.length); i++) {
      const l = local[i] || 0;
      const r = remote[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false;
  },

  async check() {
    // Só verifica uma vez por sessão
    if (this._checked) return;
    this._checked = true;

    // Não verifica se estiver rodando no app nativo Capacitor (já tem a versão mais recente)
    const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNative;

    try {
      const res = await fetch(
        `https://api.github.com/repos/${EEX_GITHUB_REPO}/releases/latest`,
        { headers: { 'Accept': 'application/vnd.github+json' } }
      );
      if (!res.ok) return;
      const data = await res.json();
      const latestTag = data.tag_name || '';
      const apkAsset = (data.assets || []).find(a =>
        a.name && a.name.toLowerCase().endsWith('.apk')
      );
      const downloadUrl = apkAsset
        ? apkAsset.browser_download_url
        : data.html_url;

      if (this._isNewer(EEX_APP_VERSION, latestTag)) {
        // Mostra popup apenas no app nativo; no web, o código web já é o mais recente
        if (isNative) {
          this._showUpdateModal(latestTag, downloadUrl, data.body || '');
        }
      }
    } catch (e) {
      // Sem internet ou erro na API — ignora silenciosamente
    }
  },

  _showUpdateModal(version, downloadUrl, notes) {
    const modal = document.getElementById('modalUpdateAvailable');
    if (!modal) return;

    const verEl = document.getElementById('updateModalVersion');
    const notesEl = document.getElementById('updateModalNotes');
    const btnDownload = document.getElementById('btnUpdateDownload');

    if (verEl) verEl.textContent = version;
    if (notesEl) notesEl.textContent = notes || 'Melhorias de desempenho e correções de bugs.';
    if (btnDownload) {
      btnDownload.onclick = () => {
        window.open(downloadUrl, '_blank');
      };
    }
    modal.classList.add('active');
  }
};

// ==========================================================================
// GERENCIADOR DE AUTENTICAÇÃO EEX (Somente Google + Rede EEX)
// ==========================================================================
const AuthManager = {
  currentUser: null,
  isEexPassVerified: false,

  init() {
    const savedCurrent = localStorage.getItem('elgaly_express_current_user');
    if (savedCurrent) {
      try {
        const parsed = JSON.parse(savedCurrent);
        if (parsed && parsed.id && parsed.id !== 'guest') {
          // Sanitização preventiva de avatar gigante (evita erro de 1MB no Firestore)
          if (parsed.avatar && typeof parsed.avatar === 'string' && parsed.avatar.length > 70000) {
            if (parsed.googlePhotoURL && typeof parsed.googlePhotoURL === 'string' && parsed.googlePhotoURL.startsWith('http')) {
              parsed.avatar = parsed.googlePhotoURL;
            } else {
              parsed.avatar = 'images/elgalylogo.png';
            }
          }
          // Sanitização preventiva de cidade: cidades inventadas do sistema antigo viram 'São Paulo - SP'
          if (!parsed.location || (typeof isValidSpCity === 'function' && !isValidSpCity(parsed.location)) || /nova amerit|nova arcanis|elgaly edge/i.test(parsed.location || '')) {
            parsed.location = 'São Paulo - SP';
            localStorage.setItem('elgaly_express_current_user', JSON.stringify(parsed));
          }
          this.currentUser = parsed;
          const sessionVerified = sessionStorage.getItem('elgaly_eex_pass_verified_' + parsed.id);
          this.isEexPassVerified = (sessionVerified === 'true');
        }
      } catch (e) {
        this.currentUser = null;
        this.isEexPassVerified = false;
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
    if (updatedFields && updatedFields.location && ((typeof isValidSpCity === 'function' && !isValidSpCity(updatedFields.location)) || /nova amerit|nova arcanis|elgaly edge/i.test(updatedFields.location))) {
      updatedFields.location = 'São Paulo - SP';
    }
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
        nickname: this.currentUser.nickname,
        bonusXp: this.currentUser.bonusXp || 0,
        unlockedAchievements: this.currentUser.unlockedAchievements || []
      });
    }
    return this.currentUser;
  },

  getXp() {
    return (this.currentUser && typeof this.currentUser.bonusXp === 'number') ? this.currentUser.bonusXp : 0;
  },

  async addXp(amount, reason = '') {
    if (!this.currentUser) return;
    const current = this.getXp();
    this.currentUser.bonusXp = current + amount;
    this.saveCurrent();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveProfileToCloud({
        bonusXp: this.currentUser.bonusXp
      });
    }

    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      FriendsManager.syncMyPublicProfile();
    }

    if (reason && typeof AppUI !== 'undefined' && AppUI.showToast) {
      AppUI.showToast(`✨ +${amount} XP: ${reason}`);
    }

    // Atualiza visão de perfil em tempo real se estiver aberta
    const activeView = document.querySelector('.app-view.active-view');
    if (activeView && activeView.id === 'view-perfil' && typeof AppUI !== 'undefined' && AppUI.renderProfileView) {
      AppUI.renderProfileView();
    }
  },

  async logout() {
    if (this.currentUser) {
      sessionStorage.removeItem('elgaly_eex_pass_verified_' + this.currentUser.id);
    }
    this.isEexPassVerified = false;

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
    if (typeof EEXPlusManager !== 'undefined') {
      EEXPlusManager._premium = null;
    }
    localStorage.removeItem('elgaly_eexplus_status');
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
  },

  verifyEexPass(pin, user) {
    if (!user) return false;
    const hash = this.hashPin(pin);
    // 1. Verifica contra o pinHash salvo no perfil do usuário
    if (user.pinHash && user.pinHash === hash) return true;
    // 2. Fallback: verifica contra badges legados
    const badges = this.getSavedBadges();
    const badge = badges.find(b => b.uid === user.id);
    if (badge && badge.pinHash === hash) {
      // Migra para o perfil
      user.pinHash = hash;
      this.saveCurrent();
      if (typeof FirebaseService !== 'undefined') {
        FirebaseService.saveProfileToCloud({ pinHash: hash });
      }
      return true;
    }
    // 3. Fallback para usuários antigos que não tinham PIN cadastrado ainda
    if (!user.pinHash && badges.length === 0) {
      user.pinHash = hash;
      this.saveCurrent();
      if (typeof FirebaseService !== 'undefined') {
        FirebaseService.saveProfileToCloud({ pinHash: hash });
      }
      return true;
    }
    return false;
  },

  // Retorna URL segura para uso no Firestore (nunca base64, que ultrapassa 1MB)
  // Usa a foto do Google (googlePhotoURL) ou o caminho padrão
  safeAvatarUrl(user) {
    if (!user) return 'images/elgalylogo.png';
    // Preferência 1: URL do Google (pequena, começa com https://)
    if (user.googlePhotoURL && user.googlePhotoURL.startsWith('http')) {
      return user.googlePhotoURL;
    }
    // Preferência 2: avatar salvo, MAS apenas se for URL (não base64)
    if (user.avatar && user.avatar.startsWith('http')) {
      return user.avatar;
    }
    // Fallback: ícone padrão (nunca manda base64 pro Firestore)
    return 'images/elgalylogo.png';
  },

  isMagafusVIP(user) {
    if (!user) return false;
    const nick = (user.nickname || '').toLowerCase().trim();
    const eex = (user.eexEmail || '').toLowerCase().trim();
    const email = (user.email || '').toLowerCase().trim();
    return nick === 'pedrinho' || nick === 'kotundashed' ||
           eex.includes('pedrinho') || eex.includes('kotundashed') ||
           email.includes('pedrinho') || email.includes('kotundashed');
  }
};

// ==========================================================================
// UTILITÁRIO DE COMPRESSÃO DE IMAGENS (Evita exceder limite de 1MB do Firestore)
// ==========================================================================
function compressImageFile(file, maxWidth = 300, maxHeight = 300, quality = 0.75) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };
      img.onerror = () => {
        if (e.target.result && e.target.result.length < 150000) resolve(e.target.result);
        else resolve(null);
      };
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ==========================================================================
// EEX+ — GERENCIADOR DE ASSINATURA PREMIUM
// Dois planos: Mensal (R$4,99) e Vitalício (R$19,99 = ~4 meses)
// Ativação via código gerado na coleção Firestore `eex_codes`
// ==========================================================================
const EEXPlusManager = {
  _premium: null,       // cache do status premium
  _nightMode: false,    // modo noturno ativo
  _nightTimer: null,    // intervalo do ciclo dia/noite

  isKotunUser(user) {
    if (!user) user = (typeof AuthManager !== 'undefined') ? AuthManager.getCurrentUser() : null;
    if (!user) return false;
    const nick = (user.nickname || '').toLowerCase().trim();
    const eex = (user.eexEmail || '').toLowerCase().trim();
    const email = (user.email || '').toLowerCase().trim();
    return nick === 'kotundashed' || eex.includes('kotundashed') || email.includes('kotundashed');
  },

  // ── STATUS ───────────────────────────────────────────────────────────────

  isPremium() {
    if (!this._premium) return false;
    // O modo de teste 'lifetime' é restrito exclusivamente para kotundashed.express.com
    if (this._premium.plan === 'lifetime') {
      return this.isKotunUser();
    }
    if (this._premium.plan === 'monthly' && this._premium.expiresAt) {
      return new Date(this._premium.expiresAt) > new Date();
    }
    return false;
  },

  getPlan() { return this._premium ? this._premium.plan : null; },

  getExpiresAt() {
    if (!this._premium || !this._premium.expiresAt) return null;
    return new Date(this._premium.expiresAt);
  },

  // Retorna label bonitinho para UI
  getPlanLabel() {
    if (!this.isPremium()) return null;
    if (this._premium.plan === 'lifetime') return 'Modo Teste VIP 🧪';
    const exp = this.getExpiresAt();
    if (!exp) return 'Mensal';
    return 'Mensal (até ' + exp.toLocaleDateString('pt-BR') + ')';
  },

  // ── CARREGAR / SALVAR STATUS ──────────────────────────────────────────────

  async loadStatus() {
    const user = AuthManager.getCurrentUser();
    const uid = user?.id;
    const isKotun = this.isKotunUser(user);

    // Se NÃO for kotundashed, limpa qualquer resquício de teste local imediatamente!
    if (!isKotun) {
      this._premium = null;
      localStorage.removeItem('elgaly_eexplus_status');
      if (uid) localStorage.removeItem(`elgaly_eexplus_status_${uid}`);
    } else {
      const local = (uid ? localStorage.getItem(`elgaly_eexplus_status_${uid}`) : null) || localStorage.getItem('elgaly_eexplus_status');
      if (local) {
        try {
          this._premium = JSON.parse(local);
        } catch (e) {
          this._premium = null;
        }
      }
    }

    if (!uid || !FirebaseService.db) return;
    try {
      const doc = await FirebaseService.db
        .collection('users').doc(uid)
        .collection('system').doc('eexplus').get();
      if (doc.exists) {
        const data = doc.data();
        if (data && data.plan === 'lifetime' && !isKotun) {
          // Se uma conta não-kotun tiver documento de teste, limpa no Firestore
          this._premium = null;
          await FirebaseService.db.collection('users').doc(uid).collection('system').doc('eexplus').delete().catch(() => {});
        } else {
          this._premium = data;
          if (uid) localStorage.setItem(`elgaly_eexplus_status_${uid}`, JSON.stringify(this._premium));
        }
      } else if (!isKotun) {
        this._premium = null;
      }
    } catch (e) {
      console.warn('EEX+: erro ao carregar status:', e);
    }
  },

  async _saveStatus(data) {
    const uid = AuthManager.getCurrentUser()?.id;
    this._premium = data;
    if (data) {
      localStorage.setItem('elgaly_eexplus_status', JSON.stringify(data));
      if (uid) localStorage.setItem(`elgaly_eexplus_status_${uid}`, JSON.stringify(data));
    } else {
      localStorage.removeItem('elgaly_eexplus_status');
      if (uid) localStorage.removeItem(`elgaly_eexplus_status_${uid}`);
    }

    if (!uid || !FirebaseService.db) return;
    try {
      await FirebaseService.db
        .collection('users').doc(uid)
        .collection('system').doc('eexplus').set(data || {}, { merge: true });
    } catch (e) {
      console.warn('EEX+: erro ao salvar no Firestore:', e);
    }
  },

  toggleTestMode() {
    const currentUser = AuthManager.getCurrentUser();
    if (!this.isKotunUser(currentUser)) {
      if (typeof AppUI !== 'undefined') AppUI.showToast('⚠️ Apenas a conta kotundashed.express.com pode ativar o modo teste!');
      return false;
    }
    if (this.isPremium()) {
      this._saveStatus(null);
      return false;
    } else {
      const testData = {
        plan: 'lifetime',
        activatedAt: new Date().toISOString(),
        expiresAt: null,
        codeUsed: 'MODO-TESTE-VIP'
      };
      this._saveStatus(testData);

      // Desbloqueia conquista permanente "100% Express"
      const user = AuthManager.getCurrentUser();
      if (user) {
        const existing = user.unlockedAchievements || [];
        if (!existing.includes('express-total')) {
          user.unlockedAchievements = [...existing, 'express-total'];
          AuthManager.currentUser = user;
          AuthManager.saveCurrent();
        }
      }
      return true;
    }
  },

  // ── ATIVAÇÃO POR CÓDIGO ───────────────────────────────────────────────────

  async activate(rawCode) {
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) return { ok: false, msg: 'Código inválido.' };

    const uid = AuthManager.getCurrentUser()?.id;

    // Códigos rápidos de demonstração / teste
    const TEST_CODES = ['TESTE', 'EEXPLUS', 'PLUS', 'VIP', 'VITALICIO', 'PROMO499'];
    if (TEST_CODES.includes(code)) {
      const plan = (code === 'PROMO499') ? 'monthly' : 'lifetime';
      let expiresAt = null;
      if (plan === 'monthly') {
        const exp = new Date();
        exp.setMonth(exp.getMonth() + 1);
        expiresAt = exp.toISOString();
      }
      const premiumData = {
        plan: plan,
        activatedAt: new Date().toISOString(),
        expiresAt: expiresAt,
        codeUsed: code
      };
      await this._saveStatus(premiumData);

      const user = AuthManager.getCurrentUser();
      if (user) {
        const existing = user.unlockedAchievements || [];
        if (!existing.includes('express-total')) {
          user.unlockedAchievements = [...existing, 'express-total'];
          AuthManager.currentUser = user;
          AuthManager.saveCurrent();
        }
      }
      return { ok: true, plan: plan };
    }

    if (!FirebaseService.db) return { ok: false, msg: 'Sem conexão com Firebase.' };
    if (!uid) return { ok: false, msg: 'Você precisa estar logado.' };

    try {
      // Busca o código na coleção
      const snap = await FirebaseService.db
        .collection('eex_codes')
        .where('code', '==', code)
        .limit(1).get();

      if (snap.empty) return { ok: false, msg: 'Código não encontrado. Verifique e tente novamente.' };

      const codeDoc = snap.docs[0];
      const codeData = codeDoc.data();

      if (codeData.used) return { ok: false, msg: 'Este código já foi utilizado.' };

      // Marca o código como usado
      await codeDoc.ref.update({
        used: true,
        usedBy: uid,
        usedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Calcula expiração para plano mensal
      let expiresAt = null;
      if (codeData.plan === 'monthly') {
        const exp = new Date();
        exp.setMonth(exp.getMonth() + 1);
        expiresAt = exp.toISOString();
      }

      const premiumData = {
        plan: codeData.plan || 'monthly',
        activatedAt: new Date().toISOString(),
        expiresAt: expiresAt,
        codeUsed: code
      };

      await this._saveStatus(premiumData);

      // Desbloqueia conquista "100% Express" permanentemente
      const user = AuthManager.getCurrentUser();
      if (user) {
        const existing = user.unlockedAchievements || [];
        if (!existing.includes('express-total')) {
          user.unlockedAchievements = [...existing, 'express-total'];
          AuthManager.currentUser = user;
          AuthManager.saveCurrent();
          if (FirebaseService.db) {
            await FirebaseService.db.collection('users').doc(uid).set(
              { unlockedAchievements: user.unlockedAchievements },
              { merge: true }
            );
          }
        }
      }

      return { ok: true, plan: codeData.plan };
    } catch (e) {
      console.error('EEX+: erro ao ativar:', e);
      return { ok: false, msg: 'Erro ao validar o código. Tente novamente.' };
    }
  },

  // ── LIMITE DE HÁBITOS ─────────────────────────────────────────────────────

  HABIT_LIMIT_FREE: 12,

  canAddHabit() {
    if (this.isPremium()) return true;
    const count = (typeof HabitManager !== 'undefined') ? HabitManager.habits.length : 0;
    return count < this.HABIT_LIMIT_FREE;
  },

  // ── BÔNUS DE CONCHAS EEX+ (+5 por recompensa) ────────────────────────────

  async applyShellBonus(baseAmount, sourceId, type) {
    if (!this.isPremium()) return;
    // Bonus flat de +5 conchas, sem passar pelo anti-farm (é um bônus separado)
    await ShellsManager.addShells(5, '✨ Bônus EEX+ (+5 conchas)');
  },

  // ── CICLO DIA/NOITE ───────────────────────────────────────────────────────

  isNightTime() {
    const h = new Date().getHours();
    return h >= 19 || h < 7; // Noite: 19h–7h
  },

  applyNightMode(force) {
    if (!this.isPremium()) {
      this._nightMode = false;
      document.documentElement.classList.remove('theme-night');
      localStorage.setItem('eex_night_manual', '0');
      return;
    }
    const shouldBeNight = force !== undefined ? force : (this.isPremium() && this.isNightTime());
    this._nightMode = shouldBeNight;
    document.documentElement.classList.toggle('theme-night', shouldBeNight);
    localStorage.setItem('eex_night_manual', shouldBeNight ? '1' : '0');
  },

  startDayNightCycle() {
    if (!this.isPremium()) {
      this.applyNightMode(false);
      return;
    }
    // Aplica imediatamente e verifica a cada 5 min
    this.applyNightMode();
    if (this._nightTimer) clearInterval(this._nightTimer);
    this._nightTimer = setInterval(() => {
      if (this.isPremium()) {
        this.applyNightMode();
      } else {
        this.stopDayNightCycle();
      }
    }, 5 * 60 * 1000);
  },

  stopDayNightCycle() {
    if (this._nightTimer) { clearInterval(this._nightTimer); this._nightTimer = null; }
    this.applyNightMode(false);
  },

  // ── INICIALIZAÇÃO ─────────────────────────────────────────────────────────

  async init() {
    await this.loadStatus();
    if (this.isPremium()) {
      this.startDayNightCycle();
    } else {
      this.applyNightMode(false);
    }
  }
};

// ==========================================================================
// GERENCIADOR DE CONCHAS EEX (ShellsManager — Moeda de Recompensa EEX com Anti-Farm)
// ==========================================================================
const ShellsManager = {

  WEEKLY_CAP: 350,

  getStorageKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_shells_${user.id}` : 'elgaly_shells_default';
  },

  getAuditKey() {
    const user = AuthManager.getCurrentUser();
    return user ? `elgaly_shells_audit_${user.id}` : 'elgaly_shells_audit_default';
  },

  getAuditData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.getAuditKey()) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  },

  saveAuditData(audit) {
    localStorage.setItem(this.getAuditKey(), JSON.stringify(audit));
  },

  getTodayKey() {
    return new Date().toLocaleDateString('en-CA');
  },

  getWeekKey() {
    const d = new Date();
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  },

  getWeekEarned() {
    const audit = this.getAuditData();
    const currentWeek = this.getWeekKey();
    if (audit.lastWeek !== currentWeek) return 0;
    return audit.weekTotal || 0;
  },

  getTodayEarned() {
    return this.getWeekEarned();
  },

  getBalance() {
    const user = AuthManager.getCurrentUser();
    if (user && typeof user.shells === 'number') {
      return user.shells;
    }
    const val = parseInt(localStorage.getItem(this.getStorageKey()) || '0', 10);
    return isNaN(val) ? 0 : val;
  },

  async addShells(amount, reason = '') {
    if (!amount || amount <= 0) return 0;
    const current = this.getBalance();
    const updated = current + amount;
    localStorage.setItem(this.getStorageKey(), updated.toString());

    const user = AuthManager.getCurrentUser();
    if (user) {
      user.shells = updated;
      AuthManager.currentUser = user;
      AuthManager.saveCurrent();
      if (typeof FirebaseService !== 'undefined' && FirebaseService.db && user.uid) {
        try {
          await FirebaseService.saveProfileToCloud({ shells: updated });
        } catch (e) {
          console.warn('Erro ao salvar conchas na nuvem:', e);
        }
      }
    }

    this.render();
    this.animateEarn(amount, reason);
    return updated;
  },

  /**
   * Sistema Anti-Farm: Proteção contra spam e exploits de conchas
   * - Limite SEMANAL de 350 conchas (WEEKLY_CAP)
   * - Tarefas/Eventos: 1x por item (permanente)
   * - Hábitos: 1x por dia por hábito
   * - Anti-spam rate-limit de 400ms
   */
  async rewardWithProtection(sourceId, type, amount, reason = '') {
    if (!sourceId) return 0;
    const audit = this.getAuditData();
    const today = this.getTodayKey();
    const currentWeek = this.getWeekKey();

    // Reset semanal se mudou a semana (segunda-feira ou novo ciclo)
    if (audit.lastWeek !== currentWeek) {
      audit.lastWeek = currentWeek;
      audit.weekTotal = 0;
    }

    // Reset diário de hábitos para evitar repetir mesmo hábito no mesmo dia
    if (audit.lastDate !== today) {
      audit.lastDate = today;
      audit.rewardedHabitsToday = [];
    }
    if (!Array.isArray(audit.rewardedItems)) audit.rewardedItems = [];
    if (!Array.isArray(audit.rewardedHabitsToday)) audit.rewardedHabitsToday = [];

    // 1. Verificação de hábito já recompensado hoje
    if (type === 'habit') {
      if (audit.rewardedHabitsToday.includes(sourceId)) {
        AppUI.showToast('<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Hábito já recompensado hoje! Volte amanhã para mais conchas! ✨');
        return 0;
      }
    } else {
      // 2. Verificação de tarefa ou evento já recompensado
      if (audit.rewardedItems.includes(sourceId)) {
        AppUI.showToast('<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Essa entrega já foi recompensada! Sem trapaça com a C.E.O.! 😼📦');
        return 0;
      }
    }

    // 3. Verificação de limite SEMANAL de conchas (350/semana)
    if (audit.weekTotal >= this.WEEKLY_CAP) {
      AppUI.showToast('<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Limite semanal de conchas atingido (350/semana)! Descanse suas patinhas, agente! 🐾');
      return 0;
    }

    // 4. Rate-limit rápido (anti-autoclicker: 400ms)
    const now = Date.now();
    if (audit.lastRewardTimestamp && (now - audit.lastRewardTimestamp < 400)) {
      return 0;
    }

    // Ajusta valor caso atinja o teto semanal
    let finalAmount = amount;
    if (audit.weekTotal + finalAmount > this.WEEKLY_CAP) {
      finalAmount = this.WEEKLY_CAP - audit.weekTotal;
    }
    if (finalAmount <= 0) return 0;

    // Registra a recompensa na auditoria
    audit.weekTotal += finalAmount;
    audit.lastRewardTimestamp = now;

    if (type === 'habit') {
      audit.rewardedHabitsToday.push(sourceId);
    } else {
      audit.rewardedItems.push(sourceId);
    }
    this.saveAuditData(audit);

    return await this.addShells(finalAmount, reason);
  },

  async spendShells(amount, reason = '') {
    if (!amount || amount <= 0) return false;
    const current = this.getBalance();
    if (current < amount) {
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast(`<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Conchas insuficientes! Você possui ${current} conchas e precisa de ${amount}.`);
      }
      return false;
    }
    const updated = current - amount;
    localStorage.setItem(this.getStorageKey(), updated.toString());

    const user = AuthManager.getCurrentUser();
    if (user) {
      user.shells = updated;
      AuthManager.currentUser = user;
      AuthManager.saveCurrent();
      if (typeof FirebaseService !== 'undefined' && FirebaseService.db && user.uid) {
        try {
          await FirebaseService.saveProfileToCloud({ shells: updated });
        } catch (e) {
          console.warn('Erro ao atualizar saldo de conchas no Firestore:', e);
        }
      }
    }

    this.render();
    if (typeof LojaEEXManager !== 'undefined') LojaEEXManager.render();
    const pill = document.getElementById('headerShellsPill');
    if (pill) {
      pill.classList.remove('shell-bump');
      void pill.offsetWidth;
      pill.classList.add('shell-bump');
    }
    if (reason && typeof AppUI !== 'undefined') {
      AppUI.showToast(`<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> -${amount} Conchas: ${reason}`);
    }
    return true;
  },

  render() {
    const countEl = document.getElementById('headerShellsCount');
    if (countEl) {
      countEl.textContent = this.getBalance().toLocaleString('pt-BR');
    }
    const lojaCountEl = document.getElementById('lojaModalShellsCount');
    if (lojaCountEl) {
      lojaCountEl.textContent = this.getBalance().toLocaleString('pt-BR');
    }
  },

  animateEarn(amount, reason) {
    const pill = document.getElementById('headerShellsPill');
    if (pill) {
      pill.classList.remove('shell-bump');
      void pill.offsetWidth;
      pill.classList.add('shell-bump');
    }
    AppUI.showToast(`<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> +${amount} Conchas! ${reason}`.trim());
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
    const prefix = taskData.category === 'faculdade' ? 'FAC' : (taskData.category === 'trabalho' ? 'JOB' : 'ELG');
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

    if (task.completed) {
      if (typeof confetti === 'function') {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.7 }
        });
      }

      if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
        let isEarly = false;
        if (task.dueDate) {
          const due = new Date(task.dueDate + 'T23:59:59');
          if (due >= new Date()) isEarly = true;
        }
        if (isEarly) {
          AuthManager.addXp(45, 'Entrega antecipada antes do prazo! ⚡📦');
        } else {
          AuthManager.addXp(25, 'Encomenda entregue com sucesso! 📦');
        }
      }

      if (typeof ShellsManager !== 'undefined') {
        const conchas = Math.floor(Math.random() * 11) + 15; // 15 a 25 conchas
        await ShellsManager.rewardWithProtection(task.id, 'task', conchas, 'Encomenda entregue!');
        if (typeof EEXPlusManager !== 'undefined') EEXPlusManager.applyShellBonus(conchas, task.id, 'task');
      }

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
    const wasCompleted = (idx !== -1);
    if (!wasCompleted) {
      this.history[todayKey].push(id);
      if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
        AuthManager.addXp(15, 'Hábito da rotina cumprido! ☀️');
      }
      if (typeof ShellsManager !== 'undefined') {
        const conchas = Math.floor(Math.random() * 11) + 10; // 10 a 20 conchas
        await ShellsManager.rewardWithProtection(id, 'habit', conchas, 'Rotina cumprida!');
        if (typeof EEXPlusManager !== 'undefined') EEXPlusManager.applyShellBonus(conchas, id, 'habit');
      }

    } else {
      this.history[todayKey].splice(idx, 1);
    }

    this.saveHistoryLocally();
    WidgetManager.update();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveHabitHistoryToCloud(this.history);
    }

    // SINCRONIZAÇÃO EM TEMPO REAL COM AMIGOS:
    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      FriendsManager.syncMyPublicProfile();
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

    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      FriendsManager.syncMyPublicProfile();
    }

    return newHabit;
  },

  async deleteHabit(id) {
    this.habits = this.habits.filter(h => h.id !== id);
    this.saveHabitsLocally();

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.deleteHabitFromCloud(id);
    }

    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      FriendsManager.syncMyPublicProfile();
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
  sosActive: false,
  radioStatus: '',
  activeFriendForProfile: null,
  activeFriendForPackage: null,

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
      const todayHabits = (HabitManager.habits || [])
        .filter(h => HabitManager.isScheduledForToday(h))
        .map(h => ({
          id: h.id,
          title: h.title,
          category: h.category || 'geral',
          done: HabitManager.isCompletedToday(h.id)
        }));

      const recentMemories = (MemoriesManager.memories || []).slice(0, 8).map(m => ({
        id: m.id,
        habitTitle: m.habitTitle,
        photo: m.photo,
        caption: m.caption,
        sticker: m.sticker,
        date: m.date,
        time: m.time
      }));

      const career = (typeof AppUI !== 'undefined' && AppUI.calculateCareerStats) 
        ? AppUI.calculateCareerStats() 
        : { totalXp: 0, level: 1, rankTitle: 'Recruta da Rota Express 📦' };

      const shells = typeof ShellsManager !== 'undefined' ? ShellsManager.getBalance() : (user.shells || 0);
      const completedTasksCount = (TaskManager.tasks || []).filter(t => t.completed).length;
      const myAchievements = (typeof AppUI !== 'undefined' && AppUI.getAchievements)
        ? AppUI.getAchievements({
            streak: stats.streak,
            completedTasks: completedTasksCount,
            friendsCount: (FriendsManager.friends || []).length,
            memoriesCount: recentMemories.length,
            sosActive: this.sosActive,
            radioStatus: this.radioStatus,
            shells: shells
          }).filter(a => a.unlocked).map(a => a.id)
        : [];

      await FirebaseService.updatePublicProfile({
        name: user.name,
        nickname: user.nickname,
        eexEmail: user.eexEmail,
        avatar: user.avatar,
        location: user.location,
        streak: stats.streak,
        allDoneToday: stats.allDone,
        pendingToday: stats.pending,
        sosActive: this.sosActive,
        radioStatus: this.radioStatus,
        todayHabits: todayHabits,
        recentMemories: recentMemories,
        xp: career.totalXp,
        rankLevel: career.level,
        rankTitle: career.rankTitle,
        shells: shells,
        completedTasksCount: completedTasksCount,
        unlockedAchievements: myAchievements
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

    // Atualiza estado do botão SOS
    const btnSos = document.getElementById('btnToggleSos');
    if (btnSos) {
      if (this.sosActive) {
        btnSos.textContent = '🚨 SOS ATIVADO!';
        btnSos.classList.add('sos-active');
      } else {
        btnSos.textContent = '🚨 SOS Resgate';
        btnSos.classList.remove('sos-active');
      }
    }

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
      const isSos = !!friend.sosActive;
      const mascotImg = isDone ? 'images/brave.png' : 'images/midnight.png';
      const mascotStatus = isDone 
        ? '✨ Brave comemora: rotina de hoje 100% cumprida!' 
        : (friend.pendingToday > 0 
            ? `😭 Midnight em pânico: ${friend.pendingToday} hábito(s) pendente(s)!` 
            : '😭 Midnight ansiosa: check-in de hoje pendente!');

      return `
        <div class="friend-card ${isDone ? 'done-today' : 'pending-today'} ${isSos ? 'friend-card-sos' : ''}" data-uid="${friend.uid}">
          ${isSos ? `
            <div class="friend-sos-ribbon">
              🚨 PEDIDO DE RESGATE SOS! AJUDE ANTES DA MEIA-NOITE! 🚨
            </div>
          ` : ''}

          <div class="friend-card-top">
            <img src="${friend.avatar || 'images/elgalylogo.png'}" alt="${friend.name}" class="friend-avatar btn-open-profile" data-uid="${friend.uid}" title="Ver Passaporte Completo">
            <div class="friend-details btn-open-profile" data-uid="${friend.uid}" style="cursor: pointer;">
              <h4 class="friend-name">${friend.name || 'Agente'}</h4>
              <span class="friend-nick">@${friend.eexEmail || (friend.nickname + '.express.com')}</span>
              <span class="friend-location">📍 ${friend.location || 'Nova Amerit - NA'}</span>
            </div>
            <div class="friend-streak-pill" title="Sequência de Rotina">
              <img src="images/${isDone ? 'fireon.png' : 'fireoff.png'}" alt="Fogo" class="friend-fire-icon">
              <span>${friend.streak || 0} DIAS</span>
            </div>
          </div>

          ${friend.radioStatus ? `
            <div class="friend-radio-pill">
              <span class="radio-icon">📻</span>
              <span class="radio-msg">"${friend.radioStatus}"</span>
            </div>
          ` : ''}

          <div class="friend-mascot-status">
            <img src="${mascotImg}" alt="Status" class="friend-status-mascot ${isDone ? 'bounce' : 'shake'}">
            <span class="friend-status-text">${mascotStatus}</span>
          </div>

          <div class="friend-card-actions">
            <button type="button" class="btn-comic btn-view-profile" data-uid="${friend.uid}">
              🪪 Ver Passaporte & Rotina
            </button>
            <button type="button" class="btn-comic btn-send-package" data-uid="${friend.uid}" title="Mandar Encomenda Express">
              📦
            </button>
            <button type="button" class="btn-comic btn-poke" data-uid="${friend.uid}" data-name="${friend.name || friend.nickname}" title="Dar uma Força!">
              📢
            </button>
            <button type="button" class="btn-comic btn-secondary btn-del-friend" data-uid="${friend.uid}" data-name="${friend.name || friend.nickname}" title="Remover Parceiro">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Eventos de clique nos cards
    grid.querySelectorAll('.btn-view-profile, .btn-open-profile').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = el.dataset.uid;
        if (uid) FriendsManager.openFriendProfile(uid);
      });
    });

    grid.querySelectorAll('.btn-send-package').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.uid;
        const friend = FriendsManager.friends.find(f => f.uid === uid);
        if (friend) FriendsManager.openSendPackageModal(friend);
      });
    });

    grid.querySelectorAll('.btn-poke').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;

        // Anti-farm: 1 buzina por amigo por dia
        const cooldownKey = `eex_poke_cd_${AuthManager.getCurrentUser()?.id}_${uid}`;
        const lastPoke = localStorage.getItem(cooldownKey);
        const today = new Date().toLocaleDateString('en-CA');
        if (lastPoke === today) {
          AppUI.showToast(`📢 Você já buzinou para ${name} hoje! Volte amanhã. 😄`);
          return;
        }

        btn.disabled = true;
        btn.textContent = '⚡';
        await FirebaseService.sendPoke(uid);
        localStorage.setItem(cooldownKey, today);
        if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
          AuthManager.addXp(10, `Apoio/buzina enviada para ${name}! 📢⚡`);
        }
        AppUI.showToast(`📢 Você deu uma força para ${name}! (+10 XP)`);
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '📢';
        }, 3000);
      });
    });


    grid.querySelectorAll('.btn-del-friend').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
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
  },

  // ==========================================================
  // PASSAPORTE DO PARCEIRO (VER ROTINA E FOTOS DO AMIGO)
  // ==========================================================
  async openFriendProfile(uid, fallbackData = null) {
    try {
      let friend = this.friends.find(f => f.uid === uid);
      if (!friend && fallbackData && (fallbackData.uid === uid || !uid)) {
        friend = { ...fallbackData };
      }
      if (!friend && typeof FirebaseService !== 'undefined' && FirebaseService.db && uid) {
        try {
          const doc = await FirebaseService.db.collection('public_profiles').doc(uid).get();
          if (doc.exists) {
            friend = { uid: doc.id, ...doc.data() };
          }
        } catch (e) {
          console.warn('Erro ao carregar perfil do parceiro:', e);
        }
      }
      if (!friend && fallbackData) {
        friend = { ...fallbackData };
      }
      if (!friend) {
        AppUI.showToast('Não foi possível carregar o perfil do agente.');
        return;
      }

      this.activeFriendForProfile = friend;
      const modal = document.getElementById('modalFriendProfile');
      if (!modal) {
        console.error('modalFriendProfile não encontrado no DOM!');
        return;
      }

    // 1. Crachá retrô anos 2000
    const badgeContainer = document.getElementById('friendModalBadge');
    if (badgeContainer) {
      badgeContainer.innerHTML = `
        <div class="friend-badge-inner">
          <div class="friend-badge-header">
            <span class="badge-tag">REDE EEX // CREDENCIAL OPERACIONAL</span>
          </div>
          <div class="friend-badge-body">
            <div class="friend-badge-photo-wrap">
              <img src="${friend.avatar || 'images/elgalylogo.png'}" alt="${friend.name}" class="friend-badge-photo">
              <span class="friend-badge-stamp">OFICIAL</span>
            </div>
            <div class="friend-badge-info">
              <div class="agent-name-seal-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <h2 class="friend-badge-name" style="color: #f9e000 !important; font-family: var(--font-display, 'Darumadrop One', cursive) !important; font-size: 1.6rem !important; text-shadow: 2px 2px 0 #000; margin: 0 0 2px 0;">${friend.name || 'Agente'}</h2>
                ${AuthManager.isMagafusVIP(friend) ? `
                  <button type="button" class="magafic-seal-btn" id="friendBadgeSealBtn" title="Selo Magáfico Oficial 💜" style="margin:0;">
                    <img src="images/magaficseal.png" alt="Selo Magáfico" class="magafic-seal-img" id="friendBadgeSealImg">
                  </button>
                ` : ''}
              </div>
              <div class="friend-badge-eex">@${friend.eexEmail || (friend.nickname + '.express.com')}</div>
              <div class="friend-badge-detail">📍 Setor: <strong>${friend.location || 'Nova Amerit - NA'}</strong></div>
              <div class="friend-badge-streak">
                🔥 Sequência: <strong>${friend.streak || 0} Dias Consecutivos</strong>
              </div>
            </div>
          </div>
        </div>
      `;

      // Evento do Selo Magáfico no crachá de terceiros: toca som + dança, sem exibir as frases privadas
      const friendSealBtn = document.getElementById('friendBadgeSealBtn');
      const friendSealImg = document.getElementById('friendBadgeSealImg');
      if (friendSealBtn) {
        friendSealBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try {
            const audio = new Audio('images/magaficseal.mp3');
            audio.currentTime = 0;
            audio.play().catch(() => {});
          } catch (err) {}
          if (friendSealImg) {
            friendSealImg.classList.remove('magafic-dance');
            void friendSealImg.offsetWidth;
            friendSealImg.classList.add('magafic-dance');
          }
        });
      }
    }

    // 2. Banner de Status do Mascote
    const bannerEl = document.getElementById('friendModalMascotBanner');
    if (bannerEl) {
      const isDone = !!friend.allDoneToday;
      bannerEl.innerHTML = `
        <div class="friend-modal-mascot-card ${isDone ? 'mascot-celebrate' : 'mascot-panic'}">
          <img src="images/${isDone ? 'brave.png' : 'midnight.png'}" class="friend-modal-mascot-img ${isDone ? 'bounce' : 'shake'}" alt="Mascote">
          <div>
            <h4>${isDone ? 'Agente Brave Comemora!' : 'Agente Midnight em Alerta!'}</h4>
            <p>${isDone 
              ? 'Todas as entregas da rotina de hoje foram 100% cumpridas! Excelente trabalho!' 
              : (friend.pendingToday > 0 
                  ? `Ainda restam ${friend.pendingToday} hábitos pendentes para fechar a rota de hoje!` 
                  : 'Ainda não começou o check-in de hoje. Dê uma força!')}
            </p>
          </div>
        </div>
      `;
    }

    // 3. Lista de Hábitos de Hoje do Amigo
    const habitsList = document.getElementById('friendModalHabitsList');
    if (habitsList) {
      const habits = friend.todayHabits || [];
      if (habits.length === 0) {
        habitsList.innerHTML = `
          <div class="empty-subtab-box">
            <span>📋</span>
            <p>O agente ainda não sincronizou a lista detalhada de hábitos de hoje.</p>
          </div>
        `;
      } else {
        habitsList.innerHTML = habits.map(h => `
          <div class="friend-habit-item ${h.done ? 'habit-done' : 'habit-pending'}">
            <span class="friend-habit-icon">${h.done ? '✅' : '⏳'}</span>
            <div class="friend-habit-info">
              <strong class="friend-habit-title">${h.title}</strong>
              <small class="friend-habit-cat">Setor: ${h.category || 'Geral'}</small>
            </div>
            <span class="friend-habit-status-badge">${h.done ? 'CONCLUÍDO' : 'EM ROTA'}</span>
          </div>
        `).join('');
      }
    }

    // 4. Galeria de Fotos / Momentos com Stickers do Amigo
    const photosGrid = document.getElementById('friendModalPhotosGrid');
    if (photosGrid) {
      const memories = friend.recentMemories || [];
      if (memories.length === 0) {
        photosGrid.innerHTML = `
          <div class="empty-subtab-box">
            <span>📷</span>
            <p>Nenhum registro fotográfico publicado recentemente por este parceiro.</p>
          </div>
        `;
      } else {
        photosGrid.innerHTML = memories.map(mem => `
          <div class="friend-photo-polaroid">
            <div class="friend-polaroid-img-wrap">
              <img src="${mem.photo}" alt="${mem.caption}" class="friend-polaroid-img">
              <img src="images/${mem.sticker === 'midnight' ? 'midnight.png' : (mem.sticker === 'fire' ? 'fireon.png' : 'brave.png')}" alt="Adesivo" class="friend-polaroid-sticker">
            </div>
            <div class="friend-polaroid-body">
              <strong>✨ ${mem.habitTitle || 'Rotina EEX'}</strong>
              <p>"${mem.caption || ''}"</p>
              <small>📅 ${mem.date || 'Hoje'} às ${mem.time || ''}</small>
            </div>
          </div>
        `).join('');
      }
    }

    // 5. Conquistas & Insígnias do Parceiro
    const achievementsList = document.getElementById('friendModalAchievementsList');
    if (achievementsList) {
      const friendAchievements = (typeof AppUI !== 'undefined' && AppUI.getAchievements)
        ? AppUI.getAchievements({
            streak: friend.streak || 0,
            completedTasks: friend.completedTasksCount || 0,
            friendsCount: 1,
            memoriesCount: (friend.recentMemories || []).length,
            sosActive: friend.sosActive,
            radioStatus: friend.radioStatus,
            shells: friend.shells || 0
          })
        : [];
      const unlockedCount = friendAchievements.filter(a => a.unlocked).length;

      achievementsList.innerHTML = `
        <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <span style="font-weight: 700; color: var(--purple-dark); font-size: 0.95rem;">Insígnias & Medalhas Oficiais</span>
          <span class="achievements-counter">${unlockedCount} de ${friendAchievements.length} Desbloqueadas</span>
        </div>
        <div class="achievements-grid">
          ${friendAchievements.map(ach => `
            <div class="achievement-card ${ach.unlocked ? 'unlocked' : 'locked'}">
              <div class="achievement-icon-wrap">
                <span class="achievement-icon">${ach.icon}</span>
                ${!ach.unlocked ? '<span class="lock-indicator">🔒</span>' : ''}
              </div>
              <div class="achievement-info">
                <strong>${ach.title}</strong>
                <p>${ach.desc}</p>
                <span class="achievement-badge-pill">${ach.unlocked ? '✨ DESBLOQUEADO' : 'BLOQUEADO'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Default para a aba de rotina
    document.querySelectorAll('.btn-friend-nav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.friend-tab-section').forEach(s => s.classList.remove('active'));
    const defBtn = document.querySelector('.btn-friend-nav[data-friend-tab="rotina"]');
    if (defBtn) defBtn.classList.add('active');
    const defSec = document.getElementById('friendTabRotina');
    if (defSec) defSec.classList.add('active');

    modal.classList.add('active');
    } catch (err) {
      console.error('Erro ao abrir passaporte do parceiro:', err);
      AppUI.showToast('Erro ao abrir passaporte. Tente novamente.');
    }
  },

  // ==========================================================
  // ENVIAR ENCOMENDA EXPRESS
  // ==========================================================
  openSendPackageModal(friend) {
    this.activeFriendForPackage = friend;
    const modal = document.getElementById('modalSendPackage');
    if (!modal) return;

    const nameEl = document.getElementById('sendPkgTargetName');
    const nickEl = document.getElementById('sendPkgTargetNick');
    if (nameEl) nameEl.textContent = friend.name || 'Agente';
    if (nickEl) nickEl.textContent = `@${friend.eexEmail || (friend.nickname + '.express.com')}`;

    const inputMsg = document.getElementById('pkgMessage');
    if (inputMsg) inputMsg.value = '';

    modal.classList.add('active');
  },

  // ==========================================================
  // RECEBIMENTO DE ENCOMENDA EXPRESS (UNBOXING)
  // ==========================================================
  onPackageReceived(pkg) {
    const modal = document.getElementById('modalOpenPackage');
    if (!modal) return;

    const nameEl = document.getElementById('unboxingSenderName');
    const nickEl = document.getElementById('unboxingSenderNick');
    const msgEl = document.getElementById('unboxingMessageText');
    const stampBadge = document.getElementById('unboxingStampBadge');
    const stampIcon = document.getElementById('unboxingStampIcon');
    const stampTitle = document.getElementById('unboxingStampTitle');
    const boxIcon = document.getElementById('unboxingBoxIcon');

    if (nameEl) nameEl.textContent = pkg.fromName || 'Agente Parceiro';
    if (nickEl) nickEl.textContent = `@${pkg.fromEexEmail || (pkg.fromNick + '.express.com')}`;
    if (msgEl) msgEl.textContent = pkg.message || 'Entrega com sucesso total!';

    // Mapeamento do selo postal
    const stampMap = {
      'selo-brave': { icon: '🐾', title: 'Selo de Honra Brave' },
      'selo-cafe':  { icon: '☕', title: 'Vale Café Dimensional' },
      'selo-turbo': { icon: '⚡', title: 'Carga Turbo de Energia' },
      'selo-fragil':{ icon: '⚠️', title: 'Aviso: Cuidado Frágil' }
    };
    const s = stampMap[pkg.stamp] || stampMap['selo-brave'];
    if (stampIcon) stampIcon.textContent = s.icon;
    if (stampTitle) stampTitle.textContent = s.title;

    // Embalagem
    if (boxIcon) {
      boxIcon.textContent = pkg.boxType === 'envelope-confidencial' ? '✉️' : (pkg.boxType === 'pacote-fita' ? '🎁' : '📦');
    }

    modal.classList.add('active');

    // Marca como aberta no Firebase
    if (typeof FirebaseService !== 'undefined' && pkg.id) {
      FirebaseService.markPackageOpened(pkg.id);
      if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
        AuthManager.addXp(35, 'Encomenda postal recebida e desembalada! 🎁✨');
      }
    }

    // 📦 Notificação local (Capacitor nativo) — dispara mesmo com app em segundo plano
    try {
      if (
        typeof window !== 'undefined' &&
        window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.LocalNotifications
      ) {
        const senderName = pkg.fromName || 'Um agente parceiro';
        const boxEmoji = pkg.boxType === 'envelope-confidencial' ? '✉️' : (pkg.boxType === 'pacote-fita' ? '🎁' : '📦');
        window.Capacitor.Plugins.LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 90000) + 10000,
            title: `${boxEmoji} Nova Encomenda EEX chegou!`,
            body: `${senderName} enviou uma encomenda para você: "${(pkg.message || '').substring(0, 60)}"`,
            schedule: { at: new Date(Date.now() + 500) },
            extra: JSON.stringify({ type: 'package', fromUid: pkg.fromUid })
          }]
        });
      }
    } catch (e) {
      // Sem suporte nativo — ignora
    }
  },


  // ==========================================================
  // SOS & RÁDIO COMUNICADOR
  // ==========================================================
  toggleSos() {
    this.sosActive = !this.sosActive;
    if (this.sosActive) {
      AppUI.showToast('🚨 RESGATE SOS ATIVADO! Seus parceiros foram alertados para mandar reforços!');
    } else {
      AppUI.showToast('🟢 Alerta SOS cancelado. Situação sob controle!');
    }
    this.render();
    this.syncMyPublicProfile();
  },

  sendRadioStatus(statusText) {
    this.radioStatus = statusText;
    AppUI.showToast(`📻 [RÁDIO EEX]: Câmbio, status transmitido: "${statusText}"`);
    const modal = document.getElementById('modalRadioBip');
    if (modal) modal.classList.remove('active');
    if (typeof AppUI !== 'undefined') {
      AppUI.unlockAchievement('frequencia-aberta');
    }
    this.syncMyPublicProfile();
    this.render();
  }
};

// ==========================================================================
// GAZETA DA PROVIDÊNCIA & ATUALIZAÇÕES DA C.E.O. (ProvidenteNewsManager)
// Boletim oficial em formato de jornal e carta selada por Providente
// ==========================================================================
const ProvidenteNewsManager = {
  currentEditionIndex: 0,
  latestVersion: 'v2.8',

  editions: [
    {
      version: 'v2.8',
      date: 'Outubro / 2026',
      headline: 'MODO PROFISSÃO ATIVADO, AMIGOS LIBERADOS & PASSAPORTE CORRIGIDO!',
      subheadline: 'Decreto de Expansão Operacional // Autorizado por Providente C.E.O.',
      badge: 'EDIÇÃO ATUAL',
      happy: {
        title: 'Modo Profissão entra em operação! 💼',
        text: 'A pedido de agentes que trabalham além da faculdade e vida pessoal, a C.E.O. Providente autorizou o novo Modo Profissão! Ative nas configurações e desbloqueie a categoria Trabalho em tarefas, hábitos e eventos. Quem já tinha conta recebeu um popup especial da C.E.O. perguntando se deseja ativar. Bem-vindo(a) ao mundo corporativo do Elgaly Express! 💼🚀',
        tags: ['Modo Profissão', 'Categoria Trabalho', 'EEX-Friends Aberto!', 'Passaporte Corrigido']
      },
      sad: {
        title: 'Sistema de Recuperação de EEX-PASS por E-mail foi suspenso temporariamente.',
        text: 'A C.E.O. Providente ordenou a suspensão do sistema de recuperação por EmailJS enquanto realiza uma auditoria de segurança interna. O EEX-PASS ainda pode ser usado normalmente — apenas a recuperação automática foi pausada.',
        tags: ['Recuperação Suspensa', 'EEX-PASS Seguro']
      },
      angry: {
        title: 'Providente consertou o Passaporte dos Amigos e os Microwidgets!',
        text: 'Dois bugs críticos foram eliminados: o botão de Passaporte dos Parceiros voltou a funcionar corretamente, e os microwidgets da tela inicial agora aparecem com total nitidez em todos os temas — inclusive no lindo Verde Magáfico! As configurações também foram reorganizadas com espaçamento e separação entre os cards.',
        tags: ['Passaporte OK', 'Widgets Visíveis', 'Configurações Organizadas']
      }
    },
    {
      version: 'v2.7',
      date: 'Setembro / 2026',
      headline: 'CALIBRAÇÃO NOTURNA PERFEITA & SINCRONIZAÇÃO TOTAL PC & CELULAR!',
      subheadline: 'Decreto de Nitidez e Telemetria em Nuvem // Autorizado por Providente C.E.O.',
      badge: 'EDIÇÃO ATUAL',
      happy: {
        title: 'Sincronização de Temas em Tempo Real entre PC e Celular! 📱☁️💻',
        text: 'Mudou para o Verde Magáfico ou Roxo NuMetálico no computador? O seu celular recebe na hora a nova paleta sem recarregar nada! Sua preferência de tema agora fica salva diretamente na sua conta da nuvem e te segue por toda a galáxia!',
        tags: ['Sincronia PC/Celular', 'Tema na Nuvem', 'Multi-dispositivo']
      },
      sad: {
        title: 'Textos escondidos e cores escuras sobrepostas foram banidos!',
        text: 'Aquele título apagado e letrinhas escuras dentro de cartões escuros foram limpos de uma vez por todas! O fundo escuro agora respeita a visão noturna dos nossos agentes e a barra de navegação recebeu o destaque merecido!',
        tags: ['Fim dos Textos Ocultos', 'Visão Noturna Calibrada']
      },
      angry: {
        title: 'Providente ajustou o contraste da Navbar e dos Cartões!',
        text: 'A C.E.O. Providente exigiu com punho de ferro: a Navbar agora tem seu próprio tom lilás claro luminoso sobre o fundo espacial escuro, a caixa de conta do agente tem alto relevo legível e os inputs respondem com textos brancos e nítidos!',
        tags: ['Navbar Iluminada', 'Bugfixes Noturnos', 'Perfeição Visual']
      }
    },
    {
      version: 'v2.6',
      date: 'Setembro / 2026',
      headline: 'A TRINDADE CROMÁTICA: ROSA EXPRESS, ROXO NUMETÁLICO E VERDE MAGÁFICO!',
      subheadline: 'Decreto Presidencial de Personalização Visual // Autorizado por Providente C.E.O.',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Três Temas Oficiais & Homenagem à Magafus! 💜',
        text: 'A C.E.O. Providente inaugurou a nova Central de Estilo da Frota! Agora você escolhe entre o clássico Rosa Express, o pesado Roxo NuMetálico e a grande estreia do Verde Magáfico — um verde musgo nostálgico e estiloso com recados carinhosos para a lendária Magafus! 💜🌿',
        tags: ['3 Novos Temas', 'Verde Magáfico 🌿', 'Roxo NuMetálico 🎸', 'A Magafus ama essa cor! 💜']
      },
      sad: {
        title: 'O antigo interruptor claro/escuro foi mandado pro descarte!',
        text: 'Aquele botãozinho monocromático de "modo claro/escuro" foi aposentado. Agora você tem identidades visuais completas com recadinhos especiais para cada tema!',
        tags: ['Adeus Monocromático', 'Mais Estilo']
      },
      angry: {
        title: 'Providente inspecionou todos os contrastes e bordas!',
        text: 'A C.E.O. Providente desceu com a régua e o esquadro: botões, abas da barra de navegação, crachás e caixas de texto foram calibrados para que o verde musgo mantenha o estilo neo-brutalista 100% legível e nítido!',
        tags: ['Contraste Impecável', 'Neo-Brutalismo Puro']
      }
    },
    {
      version: 'v2.5',
      date: 'Setembro / 2026',
      headline: 'A ERA CELESTIAL: 100 PATENTES, O OLHO DE PROVIDENTE & SINCRO TOTAL!',
      subheadline: 'Edição Extraordinária da Diretoria // Autorizado por Providente C.E.O.',
      badge: 'HISTÓRICO',
      happy: {
        title: 'O Céu é o Limite! Patente 100 e Faixas Holográficas!',
        text: 'Nossa frota agora conta com 100 Patentes Oficiais! A cada 10 níveis você desbloqueia um título glorioso, culminando no cobiçado "Nível 100 - O Olho de Providente"! E tem mais: a faixa holográfica do seu crachá agora evolui visualmente a cada patente conquistada, brilhando com prismas e luz divina!',
        tags: ['100 Níveis', 'Faixa Evolutiva', 'XP Social & Bônus']
      },
      sad: {
        title: 'Adeus ao .express.com poluindo o topo da tela!',
        text: 'A C.E.O. Providente ordenou a desobstrução visual: removemos aquele endereço longo e fixo do cabeçalho para dar lugar a este lindo Boletim Oficial e a um design muito mais limpo e confortável em celulares e PCs.',
        tags: ['Header Mais Limpo', 'Foco no Que Importa']
      },
      angry: {
        title: 'Providente deu bronca nos bugs de sincronização!',
        text: 'Chega de hábitos fantasmas! A C.E.O. desceu até a central de roteamento: agora quando você marca um hábito na sua rotina diária, ele é transmitido IMEDIATAMENTE para os seus amigos! Seu parceiro agora vê seu progresso em tempo real no mural e no passaporte!',
        tags: ['Sincronização Imediata', 'Bug da Rotina Corrigido', 'Navegação PC Aprimorada']
      }
    },
    {
      version: 'v2.4',
      date: 'Setembro / 2026',
      headline: 'PASSAPORTE DOS PARCEIROS, GALERIA POLAROID & RÁDIO BIP!',
      subheadline: 'Expansão da Malha de Amizades de Nova Amerit',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Abram alas para o Passaporte EEX-Friends!',
        text: 'Agora você pode clicar no cartão de qualquer amigo para abrir o Passaporte Completo dele: veja a lista de hábitos do dia, galeria de fotos com carimbos e stickers e o humor dos mascotes Brave & Midnight em tempo real!',
        tags: ['Passaporte Completo', 'Galeria de Fotos', 'Rádio Comunicador', 'SOS Resgate']
      },
      sad: {
        title: 'Midnight ainda tem ataques de pânico se você atrasar!',
        text: 'Aviso da chefia: quando a rotina está incompleta, a mascote Midnight entra em modo desespero no passaporte. Não deixe sua colega na mão!',
        tags: ['Alerta da Mascote']
      },
      angry: {
        title: 'Bugs de IDs com arroba e sufixo eliminados!',
        text: 'Providente corrigiu a busca de amigos: agora você pode colar com ou sem @, com ou sem .express.com, e o sistema encontra seu amigo na hora!',
        tags: ['Busca Flexível', 'Correção de ID']
      }
    },
    {
      version: 'v2.3',
      date: 'Setembro / 2026',
      headline: 'ENCOMENDAS POSTAIS DIMENSIONAIS ENTRE AMIGOS!',
      subheadline: 'O Serviço Postal Particular da Frota EEX Entra em Operação',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Despacho de Caixas & Selos Colecionáveis!',
        text: 'Agora você pode enviar caixas postais dimensionais com presentes, mensagens rápidas e selos colecionáveis (Brave Veloz, Café Turbo, Frágil) para seus amigos, com direito a cerimônia de unboxing com confetes!',
        tags: ['Encomendas Postais', 'Selos Oficiais', 'Unboxing Animado']
      },
      sad: {
        title: 'Não aceitamos encomendas sem remetente!',
        text: 'Para manter a segurança de Nova Amerit, todas as encomendas exigem credencial autenticada na Rede EEX.',
        tags: ['Segurança Postal']
      },
      angry: {
        title: 'Resolvidos erros no envio de caixas pesadas!',
        text: 'A equipe de engenharia eliminou as falhas que travavam caixas postais na fronteira dimensional.',
        tags: ['Entrega Garantida']
      }
    },
    {
      version: 'v2.2',
      date: 'Setembro / 2026',
      headline: 'REDE EEX: CRACHÁ RÁPIDO COM PIN DE 6 DÍGITOS!',
      subheadline: 'Autenticação Unificada Google + Carteira Local de Crachás',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Acesso Ultrarrápido pelo Crachá Salvo!',
        text: 'Guarde seus crachás na tela inicial do dispositivo e acerte suas rotinas inserindo apenas seu PIN numérico de 6 dígitos!',
        tags: ['Crachás com PIN', 'Onboarding Integrado', 'Nuvem Firestore']
      },
      sad: {
        title: 'Fim dos cadastros locais sem backup na nuvem!',
        text: 'Cadastros offline foram aposentados para proteger suas informações de perda caso limpe os dados do navegador.',
        tags: ['Adeus Cadastros Locais']
      },
      angry: {
        title: 'Fim das falhas de login em múltiplos aparelhos!',
        text: 'Providente sincronizou todas as contas com o Google Auth e Firestore.',
        tags: ['Sincronia Total']
      }
    },
    {
      version: 'v2.1',
      date: 'Agosto / 2026',
      headline: 'APP ANDROID NATIVO & ALERTAS DE NOTIFICAÇÃO!',
      subheadline: 'Elgaly Express no Bolso com Capacitor 6',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Notificações Locais no Celular!',
        text: 'Agora você recebe lembretes de rotina a cada 3 horas e avisos antecipados de entregas diretamente na barra de notificações do seu Android!',
        tags: ['APK Android', 'Push Notifications', 'Capacitor']
      },
      sad: {
        title: 'Avisos sonoros do celular podem te acordar!',
        text: 'Se não quiser ser acordado de madrugada pela Midnight, configure seus horários de rotina com sabedoria!',
        tags: ['Lembretes Ativos']
      },
      angry: {
        title: 'Corrigido agendamento fantasma de notificações!',
        text: 'Bugs de notificações duplicadas em horários passados foram erradicados.',
        tags: ['Alarmes Precisos']
      }
    },
    {
      version: 'v2.0',
      date: 'Julho / 2026',
      headline: 'RENASCIMENTO NEO-BRUTALISTA: O ESTILO ANOS 2000!',
      subheadline: 'Nova Era Visual para o Sistema de Despacho & Rotinas',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Estilo Comic Radical com Bordas Grossas!',
        text: 'O Elgaly Express ganhou sua identidade definitiva inspirada na estética retrô anos 2000, paleta roxo/amarelo vibrante e tipografia expressiva!',
        tags: ['Neo-Brutalismo', 'Anos 2000', 'Novo Design']
      },
      sad: {
        title: 'Layout cinza sem graça foi jogado no triturador!',
        text: 'Aquele visual corporativo sem personalidade agora é coisa do passado.',
        tags: ['Visual Antigo Descartado']
      },
      angry: {
        title: 'Bugs de quebra de layout em telas pequenas resolvidos!',
        text: 'A responsividade mobile foi reconstruída do zero para funcionar como um console portátil!',
        tags: ['Responsividade Total']
      }
    }
  ],

  init() {
    this.updateBadge();
  },

  hasUnread() {
    const lastRead = localStorage.getItem('elgaly_providente_last_read');
    return lastRead !== this.latestVersion;
  },

  updateBadge() {
    const badges = document.querySelectorAll('.providente-badge, #providenteNewsBadge, #providenteBadge');
    const isUnread = this.hasUnread();
    badges.forEach(b => {
      b.style.display = isUnread ? 'inline-block' : 'none';
    });
  },

  markAsRead() {
    localStorage.setItem('elgaly_providente_last_read', this.latestVersion);
    this.updateBadge();
  },

  openModal(editionIndex = 0) {
    this.currentEditionIndex = editionIndex;
    const modal = document.getElementById('modalProvidenteUpdates');
    if (!modal) return;
    this.renderEdition(editionIndex);
    modal.classList.add('active');
    this.markAsRead();
  },

  closeModal() {
    const modal = document.getElementById('modalProvidenteUpdates');
    if (modal) modal.classList.remove('active');
  },

  renderEdition(index) {
    this.currentEditionIndex = index;
    const ed = this.editions[index] || this.editions[0];
    const container = document.getElementById('providenteGazetteContent');
    if (!container) return;

    // Renderiza abas de navegação de edições
    const navContainer = document.getElementById('providenteEditionsTabs');
    if (navContainer) {
      navContainer.innerHTML = this.editions.map((e, idx) => `
        <button type="button" class="btn-comic edition-tab-btn ${idx === index ? 'active' : ''}" data-idx="${idx}">
          ${e.version} ${idx === 0 ? '🌟 (Atual)' : ''}
        </button>
      `).join('');

      navContainer.querySelectorAll('.edition-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetIdx = parseInt(btn.dataset.idx, 10);
          this.renderEdition(targetIdx);
        });
      });
    }

    container.innerHTML = `
      <div class="gazette-paper">
        <div class="gazette-top-meta">
          <span>📰 EDIÇÃO Nº ${this.editions.length - index} // ${ed.version}</span>
          <span>📅 ${ed.date}</span>
          <span class="gazette-stamp-pill">${ed.badge}</span>
        </div>

        <h2 class="gazette-headline">${ed.headline}</h2>
        <div class="gazette-subheadline">${ed.subheadline}</div>

        <div class="gazette-sections-grid">
          <!-- 1. NOTÍCIAS BOAS & CELEBRAÇÃO (HAPPY PROVIDENT) -->
          <div class="gazette-card card-happy">
            <div class="gazette-card-header">
              <img src="images/happy_provident.png" alt="Providente Feliz" class="providente-art bounce-subtle">
              <div>
                <span class="gazette-section-label">✨ O QUE TEM DE NOVO / CELEBRAÇÃO</span>
                <h3 class="gazette-card-title">${ed.happy.title}</h3>
              </div>
            </div>
            <p class="gazette-card-text">${ed.happy.text}</p>
            <div class="gazette-tag-list">
              ${ed.happy.tags.map(t => `<span class="gazette-tag tag-green">${t}</span>`).join('')}
            </div>
          </div>

          <!-- 2. AVISOS & MUDANÇAS (SAD PROVIDENT) -->
          <div class="gazette-card card-sad">
            <div class="gazette-card-header">
              <img src="images/sad_provident.png" alt="Providente Chateada" class="providente-art">
              <div>
                <span class="gazette-section-label">⚠️ DESPEDIDAS & AVISOS DA C.E.O.</span>
                <h3 class="gazette-card-title">${ed.sad.title}</h3>
              </div>
            </div>
            <p class="gazette-card-text">${ed.sad.text}</p>
            <div class="gazette-tag-list">
              ${ed.sad.tags.map(t => `<span class="gazette-tag tag-orange">${t}</span>`).join('')}
            </div>
          </div>

          <!-- 3. CORREÇÕES DE BUGS & BRONCA (ANGRY PROVIDENT) -->
          <div class="gazette-card card-angry">
            <div class="gazette-card-header">
              <img src="images/angry-provident.png" alt="Providente Brava" class="providente-art shake-subtle">
              <div>
                <span class="gazette-section-label">🛠️ EXPULSANDO BUGS & ERROS</span>
                <h3 class="gazette-card-title">${ed.angry.title}</h3>
              </div>
            </div>
            <p class="gazette-card-text">${ed.angry.text}</p>
            <div class="gazette-tag-list">
              ${ed.angry.tags.map(t => `<span class="gazette-tag tag-red">${t}</span>`).join('')}
            </div>
          </div>
        </div>

        <div class="gazette-seal-footer">
          <div class="gazette-signature">
            <div class="seal-icon">👁️✨</div>
            <div>
              <strong>PROVIDENTE</strong>
              <small>C.E.O. & Guardiã Dourada da Elgaly Express // Nova Amerit</small>
            </div>
          </div>
          <div class="gazette-bar-code">||| | | |||| | ||| | ||||| EEX-OFFICIAL-GAZETTE</div>
        </div>
      </div>
    `;
  }
};

// ==========================================================================
// GERENCIADOR DE TEMAS DA FROTA (ThemeManager)
// 1. Rosa Express (Clássico Chiclete - Grátis)
// 2. Roxo NuMetálico (65 Conchas)
// 3. Verde Magáfico (255 Conchas - Grátis para pedrinho.express.com)
// 4. Vermelho Culposo (95 Conchas - Vermelho Pastel & Bege Clarinho)
// 5. Azul Arcânico (EEX+)
// 6. Ouro Providêntico (EEX+)
// ==========================================================================
const ThemeManager = {
  current: 'rosa-express',

  themes: {
    'rosa-express': {
      id: 'rosa-express',
      name: 'Rosa Express',
      icon: '🌸',
      premium: false,
      price: 0,
      quotes: [
        'Esse tema ficou demais! 🌸',
        'O clássico despacho postal de Nova Amerit em tons de chiclete cósmico!',
        'Velocidade, fofura e rotinas cumpridas sem piedade! 📦✨'
      ]
    },
    'roxo-numetalico': {
      id: 'roxo-numetalico',
      name: 'Roxo NuMetálico',
      icon: '🎸',
      premium: false,
      price: 65,
      quotes: [
        'Pesado, sombrio e distorcido! 🎸⚡ Sintonizado na frequência dos anos 2000!',
        'Para quem pilota rotas noturnas ouvindo guitarras pesadas! 🤘🌙',
        'A noite de Nova Amerit é implacável, e a sua rotina também! ⚡'
      ]
    },
    'verde-magafico': {
      id: 'verde-magafico',
      name: 'Verde Magáfico',
      icon: '🌿',
      premium: false,
      price: 255,
      quotes: [
        'A Magafus ama essa cor! 💜',
        'Direto do refúgio botânico dimensional de Nova Arcanis! A Magafus aprova! 💜🌿',
        'Verde musgo de respeito! A Magafus mandou avisar que seu bom gosto é nota 10! 💜'
      ]
    },
    'vermelho-culposo': {
      id: 'vermelho-culposo',
      name: 'Vermelho Culposo',
      icon: '🏮',
      premium: false,
      price: 95,
      quotes: [
        'Vermelho suave com toque de pergaminho antigo! 🏮📜',
        'Estética retrô acolhedora com tons bege e rubi pastel!',
        'Para agentes de coração caloroso e despacho impecável! ☕📮'
      ]
    },
    'azul-arcanico': {
      id: 'azul-arcanico',
      name: 'Azul Arcânico',
      icon: '🌌',
      premium: true,
      price: 0,
      quotes: [
        'Das profundezas de Nova Arcanis, o azul dimensional te envolve! 🌌',
        'Azul profundo com centelhas de laranja — a cor do portal interdimensional! ✨',
        'Exclusivo para Agentes de Elite da Rede EEX! 🔒'
      ]
    },
    'ouro-providentico': {
      id: 'ouro-providentico',
      name: 'Ouro Providêntico',
      icon: '👑',
      premium: true,
      price: 0,
      quotes: [
        'A C.E.O. Providente aprova pessoalmente este tema! 👑',
        'Ouro, elegância e poder — o tema da diretora executiva de Nova Amerit!',
        'Só para os Agentes mais dedicados da Frota EEX! ✨'
      ]
    }
  },

  isPedrinho(user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    if (!user) return false;
    const nick = (user.nickname || '').toLowerCase().trim();
    const eex = (user.eexEmail || '').toLowerCase().trim();
    const email = (user.email || '').toLowerCase().trim();
    return nick === 'pedrinho' || eex.includes('pedrinho') || email.includes('pedrinho');
  },

  getPurchasedThemes(user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    const uid = user ? (user.id || user.uid) : 'default';
    let local = [];
    try {
      local = JSON.parse(localStorage.getItem(`elgaly_purchased_themes_${uid}`) || '[]');
    } catch { local = []; }
    if (user && Array.isArray(user.purchasedThemes)) {
      return Array.from(new Set([...local, ...user.purchasedThemes]));
    }
    return local;
  },

  savePurchasedThemes(list, user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    const uid = user ? (user.id || user.uid) : 'default';
    localStorage.setItem(`elgaly_purchased_themes_${uid}`, JSON.stringify(list));
    if (user) {
      user.purchasedThemes = list;
      if (typeof AuthManager !== 'undefined') {
        AuthManager.currentUser = user;
        AuthManager.saveCurrent();
      }
    }
  },

  syncPurchasedThemes(cloudList) {
    if (!Array.isArray(cloudList)) return;
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    const current = this.getPurchasedThemes(user);
    const merged = Array.from(new Set([...current, ...cloudList]));
    this.savePurchasedThemes(merged, user);
    if (typeof LojaEEXManager !== 'undefined') LojaEEXManager.render();
    if (typeof AppUI !== 'undefined') AppUI.renderConfiguracoes();
  },

  isThemeUnlocked(themeId, user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    if (!themeId || themeId === 'rosa-express') return true;

    // Temas EEX+
    if (themeId === 'azul-arcanico' || themeId === 'ouro-providentico') {
      return typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium();
    }

    // Exceção pedrinho.express.com para Verde Magáfico (liberado sem pagar)
    if (themeId === 'verde-magafico' && this.isPedrinho(user)) {
      return true;
    }

    // Verifica temas comprados com conchas
    const purchased = this.getPurchasedThemes(user);
    return purchased.includes(themeId);
  },

  async purchaseTheme(themeId) {
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    if (!user) {
      if (typeof AppUI !== 'undefined') AppUI.showToast('Faça login para adquirir itens na Loja EEX!');
      return false;
    }
    const theme = this.themes[themeId];
    if (!theme) return false;

    if (this.isThemeUnlocked(themeId, user)) {
      if (typeof AppUI !== 'undefined') AppUI.showToast(`Você já possui o tema ${theme.name}!`);
      this.setTheme(themeId, true);
      return true;
    }

    const price = theme.price || 0;
    const balance = typeof ShellsManager !== 'undefined' ? ShellsManager.getBalance() : 0;
    if (balance < price) {
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast(`🐚 Conchas insuficientes! Você tem ${balance} conchas e precisa de ${price} conchas.`);
      }
      return false;
    }

    const success = await ShellsManager.spendShells(price, `Compra do tema ${theme.name}`);
    if (!success) return false;

    const purchased = this.getPurchasedThemes(user);
    if (!purchased.includes(themeId)) {
      purchased.push(themeId);
    }
    this.savePurchasedThemes(purchased, user);

    if (typeof FirebaseService !== 'undefined' && FirebaseService.db && user.uid) {
      try {
        await FirebaseService.saveProfileToCloud({ purchasedThemes: purchased });
      } catch (e) {
        console.warn('Erro ao salvar tema comprado no Firestore:', e);
      }
    }

    this.setTheme(themeId, true);
    if (typeof LojaEEXManager !== 'undefined') LojaEEXManager.render();
    if (typeof AppUI !== 'undefined') AppUI.renderConfiguracoes();

    if (typeof AppUI !== 'undefined') {
      AppUI.showToast(`🎉 Tema ${theme.name} desbloqueado e ativado com sucesso!`);
    }
    return true;
  },

  init() {
    let saved = localStorage.getItem('elgaly_theme') || 'rosa-express';
    if (saved === 'light') saved = 'rosa-express';
    if (saved === 'dark')  saved = 'roxo-numetalico';
    if (!this.themes[saved]) saved = 'rosa-express';
    // Se tema não for desbloqueado pelo usuário, volta imediatamente pro padrão: Rosa Express
    if (!this.isThemeUnlocked(saved)) {
      saved = 'rosa-express';
    }
    this.setTheme(saved, false);
  },

  cycle() {
    const all = ['rosa-express', 'roxo-numetalico', 'verde-magafico', 'vermelho-culposo', 'azul-arcanico', 'ouro-providentico'];
    const unlocked = all.filter(t => this.isThemeUnlocked(t));
    if (unlocked.length === 0) unlocked.push('rosa-express');
    const nextIdx = (unlocked.indexOf(this.current) + 1) % unlocked.length;
    this.setTheme(unlocked[nextIdx], true);
  },


  setTheme(themeId, showToastNotification = false, syncCloud = true) {
    if (!this.themes[themeId]) themeId = 'rosa-express';
    // Se o tema estiver bloqueado, volta para rosa-express
    if (!this.isThemeUnlocked(themeId)) {
      themeId = 'rosa-express';
    }
    this.current = themeId;
    const themeObj = this.themes[themeId];

    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('elgaly_theme', themeId);

    // Atualiza botão do Header
    const iconBtn = document.getElementById('btnHeaderTheme');
    if (iconBtn) {
      iconBtn.innerHTML = themeObj.icon;
      iconBtn.title = `Tema: ${themeObj.name} (Clique para alternar)`;
    }

    // Atualiza os cartões seletores na tela de configurações
    document.querySelectorAll('.theme-pick-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeId === themeId);
    });

    // Atualiza a caixinha de mensagem com frases do tema
    this.updateQuoteBox(themeId);

    if (showToastNotification && typeof AppUI !== 'undefined' && AppUI.showToast) {
      const quote = themeObj.quotes[0];
      AppUI.showToast(`${themeObj.icon} ${themeObj.name}: "${quote}"`);
    }

    // Sincronização em tempo real do tema entre PC e Celular via Firestore
    if (syncCloud && typeof FirebaseService !== 'undefined' && FirebaseService.saveProfileTheme) {
      FirebaseService.saveProfileTheme(themeId);
    }

    // Mantém sempre o ícone padrão oficial (sem trocar cor do ícone no launcher Android a pedido do usuário)
    try {
      if (
        typeof window !== 'undefined' &&
        window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.EexIcon
      ) {
        window.Capacitor.Plugins.EexIcon.setThemeIcon({ theme: 'default' });
      }
    } catch (e) {
      // Sem suporte nativo — ignora silenciosamente
    }
  },

  updateQuoteBox(themeId) {
    const box = document.getElementById('themeQuoteBox');
    const mascot = document.getElementById('themeQuoteMascot');
    const author = document.getElementById('themeQuoteAuthor');
    const text = document.getElementById('themeQuoteText');
    if (!box || !mascot || !text) return;

    const theme = this.themes[themeId] || this.themes['rosa-express'];
    const quote = theme.quotes[0];

    mascot.textContent = theme.icon;
    if (author) author.textContent = `${theme.name}:`;
    text.textContent = `"${quote}"`;

    box.classList.remove('quote-pop');
    void box.offsetWidth;
    box.classList.add('quote-pop');
  }
};

// ==========================================================================
// GERENCIADOR DA LOJA EEX (LojaEEXManager — Bazar do Correio)
// Menu popup, categorias verticais à esquerda, compra de itens com conchas
// ==========================================================================
const LojaEEXManager = {
  currentCategory: 'temas',

  init() {
    this.bindEvents();
    this.render();
  },

  open(category = 'temas') {
    this.currentCategory = category;
    const modal = document.getElementById('modalLojaEEX');
    if (modal) {
      modal.classList.add('active');
      this.render();
    }
  },

  close() {
    const modal = document.getElementById('modalLojaEEX');
    if (modal) {
      modal.classList.remove('active');
    }
  },

  bindEvents() {
    // Fechar botão
    const btnClose = document.getElementById('btnLojaClose');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.close());
    }

    // Fechar clicando no backdrop
    const modal = document.getElementById('modalLojaEEX');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.close();
      });
    }

    // Botões de categorias na barra lateral esquerda (organizados de cima para baixo)
    document.querySelectorAll('.loja-category-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('disabled')) {
          const cat = btn.dataset.category || '';
          if (typeof AppUI !== 'undefined') {
            AppUI.showToast(`⏳ Categoria "${cat.toUpperCase()}" estará disponível em breve!`);
          }
          return;
        }
        const cat = btn.dataset.category;
        if (cat) {
          this.currentCategory = cat;
          document.querySelectorAll('.loja-category-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.category === cat);
          });
          this.render();
        }
      });
    });

    // Cliques em ações de itens da loja
    const grid = document.getElementById('lojaThemesGrid');
    if (grid) {
      grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-loja-action');
        if (!btn || btn.disabled) return;

        const action = btn.dataset.action;
        const themeId = btn.dataset.themeId;

        if (action === 'eexplus') {
          this.close();
          const modalEex = document.getElementById('modalEEXPlus');
          if (modalEex) modalEex.classList.add('active');
          return;
        }

        if (action === 'equip') {
          if (themeId) {
            ThemeManager.setTheme(themeId, true);
            this.render();
            if (typeof AppUI !== 'undefined') AppUI.renderConfiguracoes();
          }
          return;
        }

        if (action === 'buy') {
          if (themeId) {
            const success = await ThemeManager.purchaseTheme(themeId);
            if (success) {
              this.render();
            }
          }
        }
      });
    }
  },

  render() {
    // Atualiza saldo no modal da loja
    const shellsCount = document.getElementById('lojaModalShellsCount');
    if (shellsCount && typeof ShellsManager !== 'undefined') {
      shellsCount.textContent = ShellsManager.getBalance().toLocaleString('pt-BR');
    }

    this.renderThemes();
  },

  renderThemes() {
    const grid = document.getElementById('lojaThemesGrid');
    if (!grid) return;

    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    const balance = typeof ShellsManager !== 'undefined' ? ShellsManager.getBalance() : 0;
    const isPedrinho = ThemeManager.isPedrinho(user);

    const storeThemes = [
      {
        id: 'rosa-express',
        name: 'Rosa Express',
        icon: '🌸',
        tagline: 'Tema Padrão Oficial',
        desc: 'O clássico despacho postal chiclete de Nova Amerit. Grátis para todos os agentes.',
        type: 'free',
        price: 0,
        swatchClass: 'swatch-rosa'
      },
      {
        id: 'roxo-numetalico',
        name: 'Roxo NuMetálico',
        icon: '🎸',
        tagline: 'Noturno & Anos 2000',
        desc: 'Guitarras pesadas, frequências sombrias e modo noturno imersivo de alta intensidade.',
        type: 'shells',
        price: 65,
        swatchClass: 'swatch-roxo'
      },
      {
        id: 'vermelho-culposo',
        name: 'Vermelho Culposo',
        icon: '🏮',
        tagline: 'Pastel & Bege Retrô',
        desc: 'Vermelho pastel acolhedor com detalhes elegantes em bege clarinho no lugar do branco.',
        type: 'shells',
        price: 95,
        swatchClass: 'swatch-vermelho'
      },
      {
        id: 'verde-magafico',
        name: 'Verde Magáfico',
        icon: '🌿',
        tagline: 'Musgo & Magafus 💜',
        desc: 'Inspirado nos refúgios botânicos de Nova Arcanis e aprovado com honras pela Magafus.',
        type: 'shells',
        price: 255,
        swatchClass: 'swatch-verde'
      },
      {
        id: 'azul-arcanico',
        name: 'Azul Arcânico',
        icon: '🌌',
        tagline: 'Portal Interdimensional',
        desc: 'Azul dimensional profundo com centelhas de laranja cósmico. Exclusivo EEX+.',
        type: 'premium',
        price: 0,
        swatchClass: 'swatch-azul'
      },
      {
        id: 'ouro-providentico',
        name: 'Ouro Providêntico',
        icon: '👑',
        tagline: 'Gabinete da C.E.O.',
        desc: 'Ouro, nobreza e distinção máxima da diretoria executiva de Nova Amerit. Exclusivo EEX+.',
        type: 'premium',
        price: 0,
        swatchClass: 'swatch-ouro'
      }
    ];

    grid.innerHTML = storeThemes.map(t => {
      const isEquipped = ThemeManager.current === t.id;
      const isUnlocked = ThemeManager.isThemeUnlocked(t.id, user);

      let priceHtml = '';
      let actionBtnHtml = '';
      let badgeHtml = '';

      if (t.id === 'verde-magafico' && isPedrinho) {
        badgeHtml = '<span class="loja-badge-vip">💜 CORTESIA VIP PEDRINHO</span>';
      }

      if (t.type === 'free') {
        priceHtml = '<span class="loja-item-price free">Grátis</span>';
      } else if (t.type === 'premium') {
        priceHtml = '<span class="loja-item-price eexplus">✨ Exclusivo EEX+</span>';
      } else {
        if (t.id === 'verde-magafico' && isPedrinho) {
          priceHtml = '<span class="loja-item-price free">Liberado (VIP)</span>';
        } else {
          priceHtml = `<span class="loja-item-price shells"><img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> ${t.price} Conchas</span>`;
        }
      }

      if (isEquipped) {
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action disabled" disabled style="background:#16a34a;color:#ffffff;border-color:var(--black);cursor:default;">✓ Equipado</button>`;
      } else if (isUnlocked) {
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action" data-action="equip" data-theme-id="${t.id}" style="background:var(--yellow-bright);color:var(--black);">⚡ Equipar</button>`;
      } else if (t.type === 'premium') {
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action" data-action="eexplus" style="background:linear-gradient(135deg, #ec4899, #f59e0b);color:#fff;">⭐ Ver no EEX+</button>`;
      } else {
        const canAfford = balance >= t.price;
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action" data-action="buy" data-theme-id="${t.id}" ${canAfford ? '' : 'style="opacity:0.75;"'}>🛒 Comprar (${t.price} <img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas">)</button>`;
      }

      return `
        <div class="loja-item-card ${isEquipped ? 'item-equipped' : ''} ${isUnlocked ? 'item-owned' : ''}">
          <div class="loja-item-top">
            <div class="theme-swatch ${t.swatchClass}">
              <span class="swatch-stripe s1"></span>
              <span class="swatch-stripe s2"></span>
              <span class="swatch-stripe s3"></span>
            </div>
            <div class="loja-item-meta">
              <strong class="loja-item-name">${t.icon} ${t.name}</strong>
              <span class="loja-item-tagline">${t.tagline}</span>
            </div>
          </div>
          ${badgeHtml}
          <p class="loja-item-desc">${t.desc}</p>
          <div class="loja-item-footer">
            ${priceHtml}
            ${actionBtnHtml}
          </div>
        </div>
      `;
    }).join('');
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
      if (evt.completed && typeof ShellsManager !== 'undefined') {
        const conchas = Math.floor(Math.random() * 6) + 10; // 10 a 15 conchas
        ShellsManager.rewardWithProtection(evt.id, 'event', conchas, 'Evento cumprido!');
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

function isValidSpCity(cityName) {
  if (!cityName || typeof cityName !== 'string') return false;
  const clean = cityName.trim();
  if (/nova amerit|nova arcanis|elgaly edge/i.test(clean)) return false;
  const cities = (typeof SP_CITIES !== 'undefined' && Array.isArray(SP_CITIES))
    ? SP_CITIES
    : ((typeof window !== 'undefined' && Array.isArray(window.SP_CITIES)) ? window.SP_CITIES : []);
  if (cities.length === 0) return true;
  const normalize = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const target = normalize(clean);
  return cities.some(c => normalize(c) === target || normalize(c.replace(/ - SP/i, '')) === target);
}

// ==========================================================================
// GERENCIADOR DE CLIMA EM TEMPO REAL (Open-Meteo)
// ==========================================================================
const WeatherManager = {
  _cache: null,
  _lastFetchTime: 0,
  _fetching: false,

  getValidCity(rawCity) {
    if (!rawCity || typeof rawCity !== 'string') return 'São Paulo - SP';
    const clean = rawCity.trim();
    if (!isValidSpCity(clean)) {
      return 'São Paulo - SP';
    }
    return clean;
  },

  getCachedWeather() {
    return this._cache;
  },

  getWmoDescription(code) {
    const map = {
      0:  { label: 'Céu Limpo', icon: '☀️' },
      1:  { label: 'Ensolarado', icon: '🌤️' },
      2:  { label: 'Parcialmente Nublado', icon: '⛅' },
      3:  { label: 'Nublado', icon: '☁️' },
      45: { label: 'Nevoeiro', icon: '🌫️' },
      48: { label: 'Nevoeiro Úmido', icon: '🌫️' },
      51: { label: 'Garoa Leve', icon: '🌦️' },
      53: { label: 'Garoa Moderada', icon: '🌦️' },
      55: { label: 'Garoa Forte', icon: '🌧️' },
      61: { label: 'Chuva Fraca', icon: '🌧️' },
      63: { label: 'Chuva Moderada', icon: '🌧️' },
      65: { label: 'Chuva Forte', icon: '🌧️' },
      80: { label: 'Pancadas de Chuva', icon: '🌦️' },
      81: { label: 'Pancadas Fortes', icon: '⛈️' },
      82: { label: 'Chuva Torrencial', icon: '⛈️' },
      95: { label: 'Trovoada', icon: '⛈️' },
      96: { label: 'Trovoada com Granizo', icon: '⛈️' },
      99: { label: 'Tempestade Severa', icon: '⛈️' }
    };
    return map[code] || { label: 'Tempo Bom', icon: '⛅' };
  },

  async fetchWeatherForCity(rawCity) {
    const validCity = this.getValidCity(rawCity);
    const cleanCity = validCity.replace(/ - SP/i, '').replace(/ - NA.*/i, '').trim();

    // Cache de 20 minutos por cidade
    const now = Date.now();
    if (this._cache && this._cache.city === cleanCity && (now - this._lastFetchTime < 20 * 60 * 1000)) {
      this.updateUI(this._cache);
      return;
    }

    if (this._fetching) return;
    this._fetching = true;

    try {
      // 1. Geocodificação Open-Meteo
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=pt&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) throw new Error('Geocoding falhou');
      const geoData = await geoRes.json();
      
      let lat = -23.5505, lon = -46.6333; // Fallback SP
      let resolvedCity = cleanCity;
      if (geoData.results && geoData.results.length > 0) {
        lat = geoData.results[0].latitude;
        lon = geoData.results[0].longitude;
        resolvedCity = geoData.results[0].name || cleanCity;
      }

      // 2. Clima atual Open-Meteo
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) throw new Error('Forecast falhou');
      const weatherData = await weatherRes.json();

      const temp = Math.round(weatherData.current?.temperature_2m ?? 22);
      const wmo = weatherData.current?.weather_code ?? 0;
      const { label, icon } = this.getWmoDescription(wmo);

      this._cache = {
        city: cleanCity,
        displayCity: resolvedCity,
        temp: temp,
        label: label,
        icon: icon
      };
      this._lastFetchTime = now;
      this.updateUI(this._cache);
    } catch (err) {
      console.warn('Weather fetch fallback:', err);
      this.updateUI({
        icon: '⛅',
        temp: 23,
        label: 'Agradável',
        displayCity: cleanCity
      });
    } finally {
      this._fetching = false;
    }
  },

  updateUI(data) {
    const iconEl = document.getElementById('dailyWeatherIcon');
    const textEl = document.getElementById('dailyWeatherText');
    const badgeEl = document.getElementById('dailyWeatherBadge');
    if (iconEl) iconEl.textContent = data.icon || '⛅';
    if (textEl) textEl.textContent = `${data.temp}°C • ${data.label} (${data.displayCity})`;
    if (badgeEl) badgeEl.title = `Clima em tempo real: ${data.temp}°C, ${data.label} em ${data.displayCity}`;

    // Atualiza o subtítulo no Início (substitui a antiga frase com dados climáticos reais)
    const homeSub = document.getElementById('homeGreetingSubtitle');
    if (homeSub) {
      homeSub.innerHTML = `${data.icon || '⛅'} <strong>${data.temp}°C • ${data.label}</strong> em ${data.displayCity}. Terminal conectado na nuvem ☁️`;
    }
  }
};

// ==========================================================================
// GERENCIADOR DO BLOQUINHO DE NOTAS EEX (Notas, Ideias & Lembretes)
// ==========================================================================
const NotesManager = {
  notes: [],

  init() {
    try {
      const saved = localStorage.getItem('elgaly_express_notes');
      this.notes = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(this.notes)) this.notes = [];
    } catch (e) {
      this.notes = [];
    }
    this.render();
  },

  save() {
    localStorage.setItem('elgaly_express_notes', JSON.stringify(this.notes));
    if (typeof FirebaseService !== 'undefined' && AuthManager.isLoggedIn()) {
      const user = AuthManager.getCurrentUser();
      if (user && user.id && FirebaseService.saveUserNotes) {
        FirebaseService.saveUserNotes(user.id, this.notes).catch(() => {});
      }
    }
  },

  addNote(note) {
    const newNote = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: (note.title || '').trim(),
      content: (note.content || '').trim(),
      color: note.color || 'yellow',
      pinned: !!note.pinned,
      createdAt: new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
    if (!newNote.content && !newNote.title) return false;

    if (newNote.pinned) {
      this.notes.unshift(newNote);
    } else {
      const lastPinnedIdx = this.notes.map(n => n.pinned).lastIndexOf(true);
      if (lastPinnedIdx >= 0) {
        this.notes.splice(lastPinnedIdx + 1, 0, newNote);
      } else {
        this.notes.unshift(newNote);
      }
    }
    this.save();
    this.render();
    return true;
  },

  togglePin(id) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;
    note.pinned = !note.pinned;
    this.notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    this.save();
    this.render();
  },

  deleteNote(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    this.save();
    this.render();
  },

  render(searchTerm = '') {
    const grid = document.getElementById('notesGrid');
    const badge = document.getElementById('notesCountBadge');
    if (!grid) return;

    if (badge) badge.textContent = this.notes.length;

    let filtered = this.notes;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(n => (n.title && n.title.toLowerCase().includes(q)) || (n.content && n.content.toLowerCase().includes(q)));
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="note-empty-state-box">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 8px;">📝</span>
          <h3 style="margin: 0 0 6px; color: var(--purple-dark, #11220e); font-size: 1.2rem; font-weight: 900;">Nenhuma anotação por aqui!</h3>
          <p style="margin: 0; color: #4b5563; font-size: 0.92rem; font-weight: 600;">
            Use o criador acima para salvar recados, senhas, lembretes de rotinas ou ideias rápidas.
          </p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(note => {
      const colorClass = `note-${note.color || 'yellow'}`;
      const pinIcon = note.pinned ? `<span class="note-card-pin" title="Nota Fixada">📌</span>` : '';
      return `
        <div class="note-card ${colorClass}" data-note-id="${note.id}">
          ${pinIcon}
          <div>
            ${note.title ? `<div class="note-card-title">${note.title}</div>` : ''}
            <div class="note-card-content">${note.content}</div>
          </div>
          <div class="note-card-footer">
            <span>${note.createdAt || ''}</span>
            <div class="note-card-actions">
              <button type="button" class="note-action-btn action-pin-note" title="${note.pinned ? 'Desafixar' : 'Fixar no topo'}">
                ${note.pinned ? '📌' : '📍'}
              </button>
              <button type="button" class="note-action-btn action-copy-note" title="Copiar texto da nota">
                📋
              </button>
              <button type="button" class="note-action-btn action-delete-note" title="Excluir nota" style="color: #e11d48;">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.action-pin-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.note-card').dataset.noteId;
        this.togglePin(id);
      });
    });

    grid.querySelectorAll('.action-copy-note').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = e.target.closest('.note-card');
        const note = this.notes.find(n => n.id === card.dataset.noteId);
        if (note) {
          const text = (note.title ? note.title + '\n\n' : '') + note.content;
          try {
            await navigator.clipboard.writeText(text);
            AppUI.showToast('📋 Anotação copiada para a área de transferência!');
          } catch {
            AppUI.showToast('Nota copiada!');
          }
        }
      });
    });

    grid.querySelectorAll('.action-delete-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.note-card').dataset.noteId;
        this.deleteNote(id);
        AppUI.showToast('🗑️ Anotação removida.');
      });
    });
  }
};

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
// PORTÃO MOBILE — Exibe tela da Providente no navegador de celular
// ==========================================================================
const MobileGateManager = {
  show() {
    // Esconde splash e mostra a tela de download mobile
    const splash = document.getElementById('eexSplashScreen');
    if (splash) splash.classList.add('hidden');

    const gate = document.getElementById('mobileGateScreen');
    if (gate) {
      gate.style.display = 'flex';
    }

    // Ao clicar em "Baixar APK", busca a última release no GitHub
    const btnDl = document.getElementById('btnMobileGateDownload');
    if (btnDl) {
      btnDl.addEventListener('click', async () => {
        btnDl.textContent = '⏳ Buscando versão mais recente...';
        btnDl.disabled = true;
        try {
          const res = await fetch(
            `https://api.github.com/repos/${EEX_GITHUB_REPO}/releases/latest`,
            { headers: { 'Accept': 'application/vnd.github+json' } }
          );
          if (res.ok) {
            const data = await res.json();
            const apkAsset = (data.assets || []).find(a =>
              a.name && a.name.toLowerCase().endsWith('.apk')
            );
            const url = apkAsset ? apkAsset.browser_download_url : data.html_url;
            window.open(url, '_blank');
          } else {
            window.open(`https://github.com/${EEX_GITHUB_REPO}/releases/latest`, '_blank');
          }
        } catch {
          window.open(`https://github.com/${EEX_GITHUB_REPO}/releases/latest`, '_blank');
        }
        btnDl.textContent = '📲 Baixar App EEX';
        btnDl.disabled = false;
      });
    }
  }
};

// ==========================================================================
// RELÓGIO POMODORO EEX+ (PomodoroManager)
// Fases: Foco 25min → Pausa Curta 5min → (a cada 4 ciclos: Pausa Longa 15min)
// ==========================================================================
const PomodoroManager = {
  PHASES: [
    { id: 'focus',       label: 'Foco',        duration: 25 * 60, icon: '🍅' },
    { id: 'short-break', label: 'Pausa Curta', duration:  5 * 60, icon: '☕' },
    { id: 'long-break',  label: 'Pausa Longa', duration: 15 * 60, icon: '🛌' }
  ],

  _phase: 0,        // índice da fase atual (0=focus, 1=short, 2=long)
  _cycleCount: 0,   // quantos ciclos de foco completos
  _timeLeft: 0,     // segundos restantes
  _running: false,
  _timer: null,
  _tickSound: null,

  init() {
    this._phase = 0;
    this._cycleCount = 0;
    this._timeLeft = this.PHASES[0].duration;
    this._running = false;
    this._renderUI();
  },

  _currentPhase() { return this.PHASES[this._phase]; },

  start() {
    if (typeof EEXPlusManager !== 'undefined' && !EEXPlusManager.isPremium()) {
      if (typeof AppUI !== 'undefined') AppUI.showToast('🔒 O Relógio Pomodoro é exclusivo do EEX+! ✨');
      return;
    }
    if (this._running) return;
    this._running = true;
    this._timer = setInterval(() => this._tick(), 1000);
    this._renderUI();
  },

  pause() {
    this._running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._renderUI();
  },

  reset() {
    this.pause();
    this._timeLeft = this._currentPhase().duration;
    this._renderUI();
  },

  skip() {
    this.pause();
    this._nextPhase(false);
  },

  _tick() {
    if (this._timeLeft > 0) {
      this._timeLeft--;
      this._renderUI();
    } else {
      this._onPhaseComplete();
    }
  },

  _onPhaseComplete() {
    this.pause();
    const phase = this._currentPhase();

    // Notificação (Capacitor nativo ou browser)
    this._notify(phase);

    // Bônus de conchas no EEX+ ao completar foco
    if (phase.id === 'focus') {
      this._cycleCount++;
      if (typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium()) {
        ShellsManager.addShells(10, '🍅 Pomodoro EEX+ concluído!');
      }
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast('🍅 Foco concluído! +' + (EEXPlusManager?.isPremium() ? '10 conchas' : 'Ótimo trabalho') + '!');
      }
    }

    // Avança para próxima fase
    this._nextPhase(true);
  },

  _nextPhase(auto) {
    const wasFocus = this._currentPhase().id === 'focus';
    if (wasFocus) {
      // A cada 4 ciclos de foco → pausa longa; senão → pausa curta
      this._phase = (this._cycleCount % 4 === 0 && this._cycleCount > 0) ? 2 : 1;
    } else {
      this._phase = 0; // volta para foco
    }
    this._timeLeft = this._currentPhase().duration;
    this._renderUI();
  },

  _notify(phase) {
    const msgs = {
      'focus':       { title: '🍅 Foco concluído!',      body: 'Hora da pausa. Você merece!' },
      'short-break': { title: '☕ Pausa curta encerrada!', body: 'Bora voltar ao foco!' },
      'long-break':  { title: '🛌 Pausa longa encerrada!', body: 'Você está ótimo! Bora lá!' }
    };
    const n = msgs[phase.id];
    try {
      if (window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.LocalNotifications) {
        window.Capacitor.Plugins.LocalNotifications.schedule({ notifications: [{
          id: 7777, title: n.title, body: n.body, schedule: { at: new Date(Date.now() + 300) }
        }]});
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(n.title, { body: n.body, icon: '/images/icon-192.png' });
      }
    } catch (e) {}
  },

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return m + ':' + s;
  },

  _renderUI() {
    const phase    = this._currentPhase();
    const total    = phase.duration;
    const pct      = ((total - this._timeLeft) / total) * 100;

    // Atualiza elementos do modal
    const elTime   = document.getElementById('pomodoroTime');
    const elPhase  = document.getElementById('pomodoroPhaseLabel');
    const elIcon   = document.getElementById('pomodoroPhaseIcon');
    const elCycles = document.getElementById('pomodoroCycles');
    const elBar    = document.getElementById('pomodoroProgressBar');
    const btnStart = document.getElementById('btnPomodoroStart');
    const btnPause = document.getElementById('btnPomodoroPause');
    const btnReset = document.getElementById('btnPomodoroReset');
    const btnSkip  = document.getElementById('btnPomodoroSkip');

    if (elTime)   elTime.textContent   = this._formatTime(this._timeLeft);
    if (elPhase)  elPhase.textContent  = phase.label;
    if (elIcon)   elIcon.textContent   = phase.icon;
    if (elCycles) elCycles.textContent = 'Ciclos de foco: ' + this._cycleCount;
    if (elBar)    elBar.style.width    = pct + '%';

    // Cor da barra por fase
    const barColors = { focus: '#e62b7e', 'short-break': '#10b981', 'long-break': '#3b82f6' };
    if (elBar) elBar.style.background = barColors[phase.id] || '#e62b7e';

    if (btnStart) btnStart.style.display = this._running ? 'none' : 'inline-flex';
    if (btnPause) btnPause.style.display = this._running ? 'inline-flex' : 'none';

    // Atualiza widget flutuante (quando Pomodoro está rodando em segundo plano)
    const floatingWidget = document.getElementById('pomodoroFloatingWidget');
    const floatingTime   = document.getElementById('pomodoroFloatingTime');
    const floatingPhase  = document.getElementById('pomodoroFloatingPhase');
    const floatingIcon   = floatingWidget ? floatingWidget.querySelector('.pomodoro-floating-icon') : null;
    const modalPomodoro  = document.getElementById('modalPomodoro');
    const isModalOpen    = modalPomodoro && modalPomodoro.classList.contains('active');

    if (floatingTime)  floatingTime.textContent  = this._formatTime(this._timeLeft);
    if (floatingPhase) floatingPhase.textContent  = phase.label;
    if (floatingIcon)  floatingIcon.textContent   = phase.icon;
    if (floatingWidget) {
      if (this._running && !isModalOpen && (typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium())) {
        floatingWidget.style.display = 'flex';
      } else {
        floatingWidget.style.display = 'none';
      }
    }

    // Atualiza título da aba do browser
    if (this._running) {
      document.title = this._formatTime(this._timeLeft) + ' ' + phase.icon + ' — Elgaly Express';
    } else {
      document.title = 'Elgaly Express';
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
  _placedStickers: [],
  _selectedNoteColor: 'yellow',

  addStickerToMoment(stickerType, xPct = 50, yPct = 50) {
    const id = 'stk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const stickerMap = {
      brave: 'images/brave.png',
      midnight: 'images/midnight.png',
      fire: 'images/fireon.png',
      shell: 'images/shellcoin.png',
      seal: 'images/magaficseal.png'
    };
    const src = stickerMap[stickerType] || 'images/brave.png';
    const newSticker = { id, type: stickerType, src, xPct, yPct, size: 72 };
    this._placedStickers.push(newSticker);
    this.renderPlacedStickers();
  },

  renderPlacedStickers() {
    const container = document.getElementById('momentStickersContainer');
    const stage = document.getElementById('momentPreviewStage');
    if (!container || !stage) return;

    container.innerHTML = '';
    this._placedStickers.forEach(item => {
      const el = document.createElement('div');
      el.className = 'moment-placed-sticker';
      el.dataset.id = item.id;
      el.style.left = item.xPct + '%';
      el.style.top = item.yPct + '%';

      el.innerHTML = `
        <img src="${item.src}" alt="${item.type}">
        <span class="sticker-delete-btn" title="Remover adesivo">&times;</span>
      `;

      el.querySelector('.sticker-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this._placedStickers = this._placedStickers.filter(s => s.id !== item.id);
        this.renderPlacedStickers();
      });

      let isDragging = false;
      let startX, startY, origLeft, origTop;

      const onStart = (clientX, clientY) => {
        isDragging = true;
        startX = clientX;
        startY = clientY;
        const stageRect = stage.getBoundingClientRect();
        origLeft = (item.xPct / 100) * stageRect.width;
        origTop = (item.yPct / 100) * stageRect.height;
      };

      const onMove = (clientX, clientY) => {
        if (!isDragging) return;
        const stageRect = stage.getBoundingClientRect();
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        let newX = origLeft + deltaX;
        let newY = origTop + deltaY;

        newX = Math.max(0, Math.min(stageRect.width - item.size, newX));
        newY = Math.max(0, Math.min(stageRect.height - item.size, newY));

        item.xPct = (newX / stageRect.width) * 100;
        item.yPct = (newY / stageRect.height) * 100;

        el.style.left = item.xPct + '%';
        el.style.top = item.yPct + '%';
      };

      const onEnd = () => { isDragging = false; };

      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.sticker-delete-btn')) return;
        e.preventDefault();
        onStart(e.clientX, e.clientY);

        const moveHandler = (ev) => onMove(ev.clientX, ev.clientY);
        const upHandler = () => {
          onEnd();
          window.removeEventListener('mousemove', moveHandler);
          window.removeEventListener('mouseup', upHandler);
        };
        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler);
      });

      el.addEventListener('touchstart', (e) => {
        if (e.target.closest('.sticker-delete-btn')) return;
        const touch = e.touches[0];
        if (touch) onStart(touch.clientX, touch.clientY);
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        if (touch && isDragging) {
          e.preventDefault();
          onMove(touch.clientX, touch.clientY);
        }
      }, { passive: false });

      el.addEventListener('touchend', () => { onEnd(); });

      container.appendChild(el);
    });
  },

  openPhotoZoom(src, title, caption, date) {
    const modal = document.getElementById('modalPhotoZoom');
    const img = document.getElementById('photoZoomImage');
    const titleEl = document.getElementById('photoZoomTitle');
    const captionEl = document.getElementById('photoZoomCaption');
    const dateEl = document.getElementById('photoZoomDate');

    if (!modal || !img) return;
    img.src = src;
    if (titleEl) titleEl.textContent = title || 'Momento da Rotina';
    if (captionEl) captionEl.textContent = caption || '';
    if (dateEl) dateEl.textContent = date ? `📅 ${date}` : '';
    modal.classList.add('active');
  },

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
    // Detecta navegador mobile fora do app nativo — exibe tela de download
    const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const isMobileBrowser = !isNative && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobileBrowser) {
      MobileGateManager.show();
      return; // Não inicializa o resto do app
    }

    ThemeManager.init();
    AuthManager.init();
    TaskManager.init();
    HabitManager.init();
    EventManager.init();
    MemoriesManager.init();
    FriendsManager.init();
    ProvidenteNewsManager.init();
    PWAManager.init();
    NotificationManager.init();
    PomodoroManager.init();
    if (typeof NotesManager !== 'undefined') NotesManager.init();
    if (typeof ShellsManager !== 'undefined') ShellsManager.render();
    if (typeof LojaEEXManager !== 'undefined') LojaEEXManager.init();

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
      const validTabs = ['inicio', 'rotina', 'encomendas', 'notas', 'relatorios', 'amigos', 'perfil', 'configuracoes'];
      this.switchTab(validTabs.includes(hash) ? hash : 'inicio');
    };

    window.addEventListener('hashchange', handleRoute);

    // Garante resposta de toque imediata no app mobile e desktop
    document.querySelectorAll('.nav-link, .bottom-nav-item').forEach(link => {
      link.addEventListener('click', (e) => {
        const tab = link.dataset.tab;
        if (tab === 'pomodoro') {
          e.preventDefault();
          openPomodoro();
          return;
        }
        if (tab === 'loja') {
          e.preventDefault();
          if (typeof LojaEEXManager !== 'undefined') LojaEEXManager.open('temas');
          return;
        }
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

    // Rola suavemente o item da barra inferior para visualização caso necessário
    const activeBottom = document.querySelector(`.bottom-nav-item[data-tab="${tabName}"]`);
    if (activeBottom && typeof activeBottom.scrollIntoView === 'function') {
      activeBottom.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }

    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.toggle('active-view', view.id === `view-${tabName}`);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (tabName === 'inicio') this.renderHomeOverview();
    if (tabName === 'rotina') this.renderDailyRoutine();
    if (tabName === 'encomendas') { this.renderTasks(); this.renderEvents(); }
    if (tabName === 'notas') { if (typeof NotesManager !== 'undefined') NotesManager.render(); }
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
      editAvatarInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const compressed = await compressImageFile(file, 220, 220, 0.75);
          if (compressed) {
            this.editAvatarBase64 = compressed;
            if (editAvatarPreview) editAvatarPreview.src = this.editAvatarBase64;
          }
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
        onbAvatarInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (file) {
            const compressed = await compressImageFile(file, 220, 220, 0.75);
            if (compressed) {
              this.onboardingAvatarBase64 = compressed;
              if (onbAvatarPreview) onbAvatarPreview.src = this.onboardingAvatarBase64;
            }
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
        if (!location || !isValidSpCity(location)) {
          if (errEl) {
            errEl.textContent = '⚠️ Selecione uma cidade existente de São Paulo na lista!';
            errEl.style.display = 'block';
          }
          this.showToast('⚠️ Por favor, escolha uma cidade válida da lista de municípios de SP!');
          return;
        }
        if (!/^[0-9]{6}$/.test(pin)) {
          this.showToast('❌ O EEX-PASS deve ter exatamente 6 dígitos numéricos!');
          return;
        }

        const user = AuthManager.currentUser;
        if (!user) return;

        const eexEmail = AuthManager.formatEexNickname(rawNick);
        const nickname = eexEmail.replace('.express.com', '');
        const avatar = this.onboardingAvatarBase64 || user.avatar || 'images/elgalylogo.png';
        const pinHash = AuthManager.hashPin(pin);

        user.eexEmail = eexEmail;
        user.nickname = nickname;
        user.location = location || 'Nova Amerit - NA (Nova Arcanis)';
        user.avatar = avatar;
        const workMode = !!document.getElementById('onbWorkMode')?.checked;
        user.pinHash = pinHash;
        user.onboardingDone = true;
        user.workMode = workMode;
        user.workModePrompted = true;
        AuthManager.currentUser = user;
        AuthManager.saveCurrent();

        // Sessão autenticada e validada
        sessionStorage.setItem('elgaly_eex_pass_verified_' + user.id, 'true');
        AuthManager.isEexPassVerified = true;

        if (typeof FirebaseService !== 'undefined') {
          await FirebaseService.saveProfileToCloud({
            name: user.name,
            eexEmail: eexEmail,
            nickname: nickname,
            location: user.location,
            avatar: avatar,
            pinHash: pinHash,
            onboardingDone: true,
            workMode: workMode,
            workModePrompted: true
          });
        }

        const modal = document.getElementById('modalOnboarding');
        if (modal) modal.classList.remove('active');
        this.onboardingAvatarBase64 = null;

        TaskManager.init();
        HabitManager.init();
        EventManager.init();

        // Inicia sync em tempo real
        if (typeof FirebaseService !== 'undefined' && user.uid) {
          FirebaseService.startRealtimeSync(user.uid);
          setTimeout(() => FirebaseService.initFCM(), 2000);
        }

        this.renderAll();
        this.showToast(`🚀 Bem-vindo à Rede EEX, ${eexEmail}!`);
      });
    }

    // 4. Modal de Verificação de Segurança (EEX-PASS obrigatório pós-Google login)
    const formPinLogin = document.getElementById('formPinLogin');
    const btnCancelPinLogin = document.getElementById('btnCancelPinLogin');
    if (formPinLogin) {
      formPinLogin.addEventListener('submit', async (e) => {
        e.preventDefault();

        const pin = (document.getElementById('pinInput').value || '').trim();
        const errEl = document.getElementById('pinError');
        const user = AuthManager.getCurrentUser();
        if (errEl) errEl.textContent = '';
        if (!user) return;

        if (AuthManager.verifyEexPass(pin, user)) {
          // EEX-PASS correto!
          sessionStorage.setItem('elgaly_eex_pass_verified_' + user.id, 'true');
          AuthManager.isEexPassVerified = true;
          document.getElementById('modalPinLogin').classList.remove('active');
          document.getElementById('pinInput').value = '';

          TaskManager.init();
          HabitManager.init();
          EventManager.init();
          if (typeof FriendsManager !== 'undefined') {
            FriendsManager.init();
          }
          if (typeof MemoriesManager !== 'undefined') {
            MemoriesManager.init();
          }

          if (typeof FirebaseService !== 'undefined' && user.uid) {
            FirebaseService.startRealtimeSync(user.uid);
          }
          if (typeof EEXPlusManager !== 'undefined') {
            await EEXPlusManager.init();
          }

          this.renderAll();

          this.showToast(`🔓 EEX-PASS confirmado! Acesso liberado, ${user.name}! 🚀`);
        } else {
          if (errEl) errEl.textContent = '❌ EEX-PASS incorreto. Tente novamente.';
          const pinInp = document.getElementById('pinInput');
          if (pinInp) {
            pinInp.value = '';
            pinInp.focus();
          }
        }
      });
    }
    if (btnCancelPinLogin) {
      btnCancelPinLogin.addEventListener('click', () => {
        document.getElementById('modalPinLogin').classList.remove('active');
        document.getElementById('pinInput').value = '';
        const errEl = document.getElementById('pinError');
        if (errEl) errEl.textContent = '';
        AuthManager.logout();
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

    // 8. Botões de Nova Encomenda (delegação — botões podem ser renderizados dinamicamente)
    const modalTask = document.getElementById('modalTask');
    const formTask = document.getElementById('formTask');
    const modalTaskClose = document.getElementById('modalTaskClose');

    document.addEventListener('click', (e) => {
      if (e.target.closest('.action-new-task')) {
        if (!AuthManager.isLoggedIn()) return;
        this.openTaskModal();
      }
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

    // 10. Botões de Novo Hábito (delegação — botões podem ser renderizados dinamicamente)
    const modalHabit = document.getElementById('modalHabit');
    const formHabit = document.getElementById('formHabit');
    const modalHabitClose = document.getElementById('modalHabitClose');

    document.addEventListener('click', (e) => {
      if (e.target.closest('.action-new-habit')) {
        if (!AuthManager.isLoggedIn()) return;
        if (typeof EEXPlusManager !== 'undefined' && !EEXPlusManager.canAddHabit()) {
          this.showToast(`🔒 Limite de ${EEXPlusManager.HABIT_LIMIT_FREE} rotinas atingido! Assine o EEX+ para ter rotinas ilimitadas ✨`);
          const modal = document.getElementById('modalEEXPlus');
          if (modal) modal.classList.add('active');
          return;
        }
        const habitTitleEl = document.getElementById('habitTitle');
        if (habitTitleEl) habitTitleEl.value = '';
        // Reseta todos os dias como ativos por padrão
        document.querySelectorAll('#habitDaysPicker .weekday-btn').forEach(b => b.classList.add('active'));
        if (modalHabit) modalHabit.classList.add('active');
      }
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
          // Limite de hábitos: 12 para free, ilimitado para EEX+
          if (typeof EEXPlusManager !== 'undefined' && !EEXPlusManager.canAddHabit()) {
            modalHabit.classList.remove('active');
            AppUI.showToast(`🔒 Limite de ${EEXPlusManager.HABIT_LIMIT_FREE} hábitos atingido! Assine o EEX+ para hábitos ilimitados ✨`);
            return;
          }
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

    // 13. Configurações: Seleção dos 3 Temas & Alternar no Header
    const btnHeaderTheme = document.getElementById('btnHeaderTheme');
    if (btnHeaderTheme) {
      btnHeaderTheme.addEventListener('click', () => ThemeManager.cycle());
    }

    const btnThemeToggle = document.getElementById('btnThemeToggle');
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', () => ThemeManager.cycle());
    }

    document.querySelectorAll('.theme-pick-card').forEach(card => {
      card.addEventListener('click', () => {
        const themeId = card.dataset.themeId;
        const themeObj = ThemeManager.themes[themeId];
        if (!themeObj) return;

        // Se tema EEX+ e não for premium
        if (themeObj.premium && (typeof EEXPlusManager === 'undefined' || !EEXPlusManager.isPremium())) {
          this.showToast(`🔒 O tema ${themeObj.name} é exclusivo do Elgaly Express+! ✨`);
          const modal = document.getElementById('modalEEXPlus');
          if (modal) modal.classList.add('active');
          return;
        }

        // Se tema pago com conchas e não estiver desbloqueado
        if (!ThemeManager.isThemeUnlocked(themeId)) {
          this.showToast(`🔒 O tema ${themeObj.name} é desbloqueado na Loja EEX por ${themeObj.price} Conchas! 🐚`);
          if (typeof LojaEEXManager !== 'undefined') {
            LojaEEXManager.open('temas');
          }
          return;
        }

        if (themeId) ThemeManager.setTheme(themeId, true);
      });
    });

    // ---- RELÓGIO POMODORO EEX+ ----
    const modalPomodoro = document.getElementById('modalPomodoro');
    const openPomodoro = () => {
      if (typeof EEXPlusManager === 'undefined' || !EEXPlusManager.isPremium()) {
        this.showToast('🔒 O Relógio Pomodoro é exclusivo do Elgaly Express+! ✨');
        openEexPlus();
        return;
      }
      if (modalPomodoro) {
        modalPomodoro.classList.add('active');
        PomodoroManager._renderUI();
      }
    };

    const btnNavPomodoro = document.getElementById('btnNavPomodoro');
    if (btnNavPomodoro) {
      btnNavPomodoro.addEventListener('click', (e) => {
        e.preventDefault();
        openPomodoro();
      });
    }

    const btnDrawerPomodoro = document.getElementById('btnDrawerPomodoro');
    if (btnDrawerPomodoro) {
      btnDrawerPomodoro.addEventListener('click', () => {
        if (typeof this.closeMobileDrawer === 'function') this.closeMobileDrawer();
        openPomodoro();
      });
    }

    const btnBottomPomodoro = document.getElementById('btnBottomPomodoro');
    if (btnBottomPomodoro) {
      btnBottomPomodoro.addEventListener('click', (e) => {
        e.preventDefault();
        openPomodoro();
      });
    }

    // ---- LOJA EEX (BAZAR DO CORREIO) ----
    const openLoja = () => {
      if (typeof LojaEEXManager !== 'undefined') {
        LojaEEXManager.open('temas');
      }
    };

    const headerShellsPill = document.getElementById('headerShellsPill');
    if (headerShellsPill) {
      headerShellsPill.addEventListener('click', () => {
        openLoja();
      });
    }

    const btnNavLoja = document.getElementById('btnNavLoja');
    if (btnNavLoja) {
      btnNavLoja.addEventListener('click', (e) => {
        e.preventDefault();
        openLoja();
      });
    }

    const btnDrawerLoja = document.getElementById('btnDrawerLoja');
    if (btnDrawerLoja) {
      btnDrawerLoja.addEventListener('click', () => {
        if (typeof this.closeMobileDrawer === 'function') this.closeMobileDrawer();
        openLoja();
      });
    }

    const btnBottomLoja = document.getElementById('btnBottomLoja');
    if (btnBottomLoja) {
      btnBottomLoja.addEventListener('click', (e) => {
        e.preventDefault();
        openLoja();
      });
    }

    // Balão flutuante do Pomodoro em segundo plano
    const pomodoroFloatingWidget = document.getElementById('pomodoroFloatingWidget');
    if (pomodoroFloatingWidget) {
      pomodoroFloatingWidget.addEventListener('click', () => {
        openPomodoro();
      });
    }

    const btnPomodoroClose = document.getElementById('btnPomodoroClose');
    if (btnPomodoroClose && modalPomodoro) {
      btnPomodoroClose.addEventListener('click', () => {
        modalPomodoro.classList.remove('active');
        PomodoroManager._renderUI();
      });
    }
    if (modalPomodoro) {
      modalPomodoro.addEventListener('click', (e) => {
        if (e.target === modalPomodoro) {
          modalPomodoro.classList.remove('active');
          PomodoroManager._renderUI();
        }
      });
    }

    const btnPomodoroStart = document.getElementById('btnPomodoroStart');
    if (btnPomodoroStart) btnPomodoroStart.addEventListener('click', () => PomodoroManager.start());

    const btnPomodoroPause = document.getElementById('btnPomodoroPause');
    if (btnPomodoroPause) btnPomodoroPause.addEventListener('click', () => PomodoroManager.pause());

    const btnPomodoroReset = document.getElementById('btnPomodoroReset');
    if (btnPomodoroReset) btnPomodoroReset.addEventListener('click', () => PomodoroManager.reset());

    const btnPomodoroSkip = document.getElementById('btnPomodoroSkip');
    if (btnPomodoroSkip) btnPomodoroSkip.addEventListener('click', () => PomodoroManager.skip());

    // ---- ELGALY EXPRESS+ (EEX+) MODAL & ATIVAÇÃO ----
    const modalEEXPlus = document.getElementById('modalEEXPlus');
    const openEexPlus = () => {
      if (modalEEXPlus) modalEEXPlus.classList.add('active');
    };
    const btnHeaderEexPlus = document.getElementById('btnHeaderEexPlus');
    if (btnHeaderEexPlus) btnHeaderEexPlus.addEventListener('click', openEexPlus);

    const btnDrawerEexPlus = document.getElementById('btnDrawerEexPlus');
    if (btnDrawerEexPlus) {
      btnDrawerEexPlus.addEventListener('click', () => {
        if (typeof this.closeMobileDrawer === 'function') this.closeMobileDrawer();
        openEexPlus();
      });
    }

    const btnOpenPlansModal = document.getElementById('btnOpenPlansModal');
    if (btnOpenPlansModal) btnOpenPlansModal.addEventListener('click', openEexPlus);

    const btnEexPlusClose = document.getElementById('btnEexPlusClose');
    if (btnEexPlusClose && modalEEXPlus) {
      btnEexPlusClose.addEventListener('click', () => modalEEXPlus.classList.remove('active'));
    }
    if (modalEEXPlus) {
      modalEEXPlus.addEventListener('click', (e) => {
        if (e.target === modalEEXPlus) modalEEXPlus.classList.remove('active');
      });
    }

    // Botões de compra dos planos dentro do modal
    document.querySelectorAll('.btn-plan-purchase').forEach(btn => {
      btn.addEventListener('click', () => {
        const plan = btn.dataset.plan;
        const checkoutBox = document.getElementById('eexplusCheckoutBox');
        const checkoutTitle = document.getElementById('checkoutPlanTitle');
        const whatsappBtn = document.getElementById('btnWhatsappCheckout');
        const user = AuthManager.getCurrentUser();
        const userNick = user ? (user.eexEmail || user.name) : 'meu-id';

        if (checkoutBox) checkoutBox.style.display = 'block';
        if (checkoutTitle) {
          checkoutTitle.textContent = (plan === 'mensal')
            ? '💳 Assinatura Plano Mensal (R$ 4,99)'
            : '⭐ Acesso 4 Meses / Vitalício (R$ 19,99)';
        }
        if (whatsappBtn) {
          const planName = (plan === 'mensal') ? 'Plano Mensal (R$ 4,99)' : 'Acesso 4 Meses (R$ 19,99)';
          const text = encodeURIComponent(`Olá! Gostaria de assinar o Elgaly Express+ [${planName}] para o ID Express: ${userNick}`);
          whatsappBtn.href = `https://wa.me/?text=${text}`;
        }
        if (checkoutBox && typeof checkoutBox.scrollIntoView === 'function') {
          checkoutBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    const btnCloseCheckoutBox = document.getElementById('btnCloseCheckoutBox');
    if (btnCloseCheckoutBox) {
      btnCloseCheckoutBox.addEventListener('click', () => {
        const checkoutBox = document.getElementById('eexplusCheckoutBox');
        if (checkoutBox) checkoutBox.style.display = 'none';
      });
    }

    const btnCopyPixKey = document.getElementById('btnCopyPixKey');
    if (btnCopyPixKey) {
      btnCopyPixKey.addEventListener('click', () => {
        navigator.clipboard.writeText('pagamentos@elgaly.express').then(() => {
          this.showToast('📋 Chave Pix copiada com sucesso!');
        }).catch(() => {
          this.showToast('📋 Chave: pagamentos@elgaly.express');
        });
      });
    }

    // Alternador de modo de teste EEX+ (local instantâneo)
    const handleToggleTestMode = () => {
      const isNowPrem = EEXPlusManager.toggleTestMode();
      this.renderAll();
      if (isNowPrem) {
        if (typeof confetti === 'function') confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        this.showToast('🧪 Modo de Teste: EEX+ ATIVADO com sucesso! Aproveite todos os recursos VIP ✨');
      } else {
        this.showToast('🧪 Modo de Teste: EEX+ DESATIVADO (retornou para Versão Gratuita).');
      }
    };

    const btnToggleEexPlusTestMode = document.getElementById('btnToggleEexPlusTestMode');
    if (btnToggleEexPlusTestMode) {
      btnToggleEexPlusTestMode.addEventListener('click', handleToggleTestMode);
    }

    const btnModalToggleTestMode = document.getElementById('btnModalToggleTestMode');
    if (btnModalToggleTestMode) {
      btnModalToggleTestMode.addEventListener('click', handleToggleTestMode);
    }

    // Função compartilhada para ativar código EEX+
    const handleActivateCode = async (codeInputEl) => {
      if (!codeInputEl) return;
      const code = codeInputEl.value.trim();
      if (!code) {
        this.showToast('⚠️ Digite o código de ativação do EEX+!');
        return;
      }
      this.showToast('⏳ Validando código EEX+...');
      const res = await EEXPlusManager.activate(code);
      if (res.ok) {
        codeInputEl.value = '';
        if (modalEEXPlus) modalEEXPlus.classList.remove('active');
        this.renderAll();
        if (typeof confetti === 'function') {
          confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
        }
        this.showToast(`🎉 Parabéns! Elgaly Express+ (${res.plan === 'lifetime' ? '4 Meses / Vitalício' : 'Mensal'}) ativado com sucesso! 🚀`);
      } else {
        this.showToast(`❌ ${res.msg}`);
      }
    };

    const btnActivateEexPlus = document.getElementById('btnActivateEexPlus');
    if (btnActivateEexPlus) {
      btnActivateEexPlus.addEventListener('click', () => {
        handleActivateCode(document.getElementById('inputEexPlusCode'));
      });
    }

    const btnModalActivateEexPlus = document.getElementById('btnModalActivateEexPlus');
    if (btnModalActivateEexPlus) {
      btnModalActivateEexPlus.addEventListener('click', () => {
        handleActivateCode(document.getElementById('inputModalEexPlusCode'));
      });
    }

    // ---- MODO NOTURNO (EEX+) ----
    const btnToggleNightMode = document.getElementById('btnToggleNightMode');
    const badgeNightStatus = document.getElementById('badgeNightStatus');
    const updateNightBadge = () => {
      if (!badgeNightStatus) return;
      if (typeof EEXPlusManager !== 'undefined' && !EEXPlusManager.isPremium()) {
        badgeNightStatus.textContent = '🔒 BLOQUEADO';
        badgeNightStatus.style.background = '#fef2f2';
        badgeNightStatus.style.color = '#ef4444';
        return;
      }
      const isNight = document.documentElement.classList.contains('theme-night');
      badgeNightStatus.textContent = isNight ? 'ATIVADO' : 'DESLIGADO';
      badgeNightStatus.style.background = isNight ? '#ffd700' : '#e2e8f0';
      badgeNightStatus.style.color = isNight ? '#000' : '#475569';
    };
    if (btnToggleNightMode) {
      btnToggleNightMode.addEventListener('click', () => {
        if (typeof EEXPlusManager === 'undefined' || !EEXPlusManager.isPremium()) {
          this.showToast('🔒 O Conforto Ocular e Ciclo Dia & Noite são exclusivos do EEX+! ✨');
          openEexPlus();
          return;
        }
        const current = document.documentElement.classList.contains('theme-night');
        EEXPlusManager.applyNightMode(!current);
        updateNightBadge();
        this.showToast(!current ? '🌙 Conforto ocular noturno ativado!' : '☀️ Conforto noturno desativado!');
      });
      updateNightBadge();
    }

    // ---- RELATÓRIOS: DIAS PERSONALIZADOS (EEX+) ----
    const btnCustomDaysReport = document.getElementById('btnCustomDaysReport');
    const customDaysBox = document.getElementById('customDaysBox');
    const inputCustomDays = document.getElementById('inputCustomDays');
    const btnApplyCustomDays = document.getElementById('btnApplyCustomDays');

    if (btnCustomDaysReport) {
      btnCustomDaysReport.addEventListener('click', () => {
        if (typeof EEXPlusManager === 'undefined' || !EEXPlusManager.isPremium()) {
          this.showToast('🔒 Período personalizado de relatório é exclusivo do EEX+! ✨');
          openEexPlus();
          return;
        }
        if (customDaysBox) {
          const isHidden = customDaysBox.style.display === 'none' || !customDaysBox.style.display;
          customDaysBox.style.display = isHidden ? 'flex' : 'none';
        }
      });
    }

    if (btnApplyCustomDays && inputCustomDays) {
      btnApplyCustomDays.addEventListener('click', () => {
        const days = parseInt(inputCustomDays.value, 10);
        if (isNaN(days) || days < 1 || days > 365) {
          this.showToast('⚠️ Escolha um período entre 1 e 365 dias.');
          return;
        }
        ReportEngine.setTimeframe(days);
        document.querySelectorAll('.timeframe-btn').forEach(b => b.classList.remove('active'));
        if (btnCustomDaysReport) btnCustomDaysReport.classList.add('active');
        this.showToast(`📊 Relatório gerado para os últimos ${days} dias!`);
      });
    }


    // 14. Configurações: Atualizar PIN
    const formChangePin = document.getElementById('formChangePin');
    if (formChangePin) {
      formChangePin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newPin = (document.getElementById('cfgNewPin').value || '').trim();
        if (!/^[0-9]{6}$/.test(newPin)) {
          this.showToast('❌ O EEX-PASS deve ter 6 dígitos numéricos!');
          return;
        }
        const user = AuthManager.getCurrentUser();
        if (user) {
          const hash = AuthManager.hashPin(newPin);
          user.pinHash = hash;
          AuthManager.currentUser = user;
          AuthManager.saveCurrent();
          sessionStorage.setItem('elgaly_eex_pass_verified_' + user.id, 'true');
          if (typeof FirebaseService !== 'undefined') {
            await FirebaseService.saveProfileToCloud({ pinHash: hash });
          }
          this.showToast('🔐 EEX-PASS atualizado com sucesso!');
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
        if (!loc || !isValidSpCity(loc)) {
          this.showToast('⚠️ Por favor, selecione uma cidade existente da lista de São Paulo!');
          return;
        }
        await AuthManager.updateUserProfile({ location: loc });
        this.renderAll();
        if (typeof WeatherManager !== 'undefined') {
          WeatherManager.fetchWeatherForCity(loc);
        }
        this.showToast(`📍 Setor atualizado para ${loc}!`);
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
        if (btn.dataset.days === 'custom') return;
        const box = document.getElementById('customDaysBox');
        if (box) box.style.display = 'none';
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
      momentFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const compressed = await compressImageFile(file, 640, 640, 0.75);
          if (compressed) {
            this._momentPhotoBase64 = compressed;
            const preview = document.getElementById('momentPhotoPreview');
            const placeholder = document.getElementById('momentPlaceholder');
            if (preview) { preview.src = this._momentPhotoBase64; preview.style.display = 'block'; }
            if (placeholder) placeholder.style.display = 'none';
          }
        }
      });
    }

    // 20. Adesivos Livres no Momento Bacana
    document.querySelectorAll('.moment-sticker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const stk = btn.dataset.sticker;
        if (stk) {
          // Adiciona sticker centralizado com leve variação para não sobrepor exatamente
          const offset = (Math.random() * 20) - 10;
          this.addStickerToMoment(stk, 50 + offset, 50 + offset);
          this.showToast('✨ Adesivo adicionado! Arraste para posicionar onde quiser.');
        }
      });
    });

    const btnClearStickers = document.getElementById('btnClearStickers');
    if (btnClearStickers) {
      btnClearStickers.addEventListener('click', () => {
        this._placedStickers = [];
        this.renderPlacedStickers();
        this.showToast('🗑️ Adesivos removidos da prévia.');
      });
    }

    if (btnSaveMoment && modalMomentCapture) {
      btnSaveMoment.addEventListener('click', async () => {
        const caption = (document.getElementById('momentCaptionInput').value || '').trim();
        const habitTitle = this._currentMomentHabit ? this._currentMomentHabit.title : 'Rotina Concluída';

        // Renderiza no Canvas para embutir todos os adesivos na imagem
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const baseImg = new Image();

        baseImg.onload = async () => {
          const maxDim = 800;
          const scale = Math.min(maxDim / baseImg.width, maxDim / baseImg.height, 1);
          canvas.width = Math.round(baseImg.width * scale);
          canvas.height = Math.round(baseImg.height * scale);
          ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

          const placed = [...(this._placedStickers || [])];
          if (placed.length === 0) {
            placed.push({ src: 'images/brave.png', xPct: 65, yPct: 65, type: 'brave' });
          }

          const loadImg = (src) => new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = src;
          });

          for (const item of placed) {
            const stkImg = await loadImg(item.src);
            if (stkImg) {
              const stickerW = Math.round(canvas.width * 0.22);
              const stickerH = stickerW;
              const posX = Math.round((item.xPct / 100) * (canvas.width - stickerW));
              const posY = Math.round((item.yPct / 100) * (canvas.height - stickerH));
              ctx.drawImage(stkImg, Math.max(0, posX), Math.max(0, posY), stickerW, stickerH);
            }
          }

          const finalPhoto = canvas.toDataURL('image/jpeg', 0.85);

          await MemoriesManager.addMemory({
            habitTitle: habitTitle,
            photo: finalPhoto,
            caption: caption || 'Momento bacana da rotina!',
            sticker: placed[0]?.type || 'brave'
          });

          modalMomentCapture.classList.remove('active');
          AppUI.showToast('📸 Momento bacana registrado com sucesso no relatório!');
        };

        baseImg.src = this._momentPhotoBase64 || 'images/widgetbackground.png';
      });
    }

    // 21. Eventos do Bloquinho de Notas EEX
    const btnAddNote = document.getElementById('btnAddNote');
    if (btnAddNote) {
      btnAddNote.addEventListener('click', () => {
        const title = (document.getElementById('noteTitleInput')?.value || '').trim();
        const content = (document.getElementById('noteContentInput')?.value || '').trim();
        const pinned = !!document.getElementById('notePinCheckbox')?.checked;
        const color = this._selectedNoteColor || 'yellow';

        if (!content && !title) {
          this.showToast('⚠️ Escreva algo para salvar a sua anotação!');
          return;
        }

        const ok = NotesManager.addNote({ title, content, color, pinned });
        if (ok) {
          const tInput = document.getElementById('noteTitleInput');
          const cInput = document.getElementById('noteContentInput');
          const pCheck = document.getElementById('notePinCheckbox');
          if (tInput) tInput.value = '';
          if (cInput) cInput.value = '';
          if (pCheck) pCheck.checked = false;
          this.showToast('📝 Anotação salva com sucesso no Bloquinho!');
        }
      });
    }

    document.querySelectorAll('.note-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.note-color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedNoteColor = btn.dataset.color || 'yellow';
      });
    });

    const noteSearchInput = document.getElementById('noteSearchInput');
    if (noteSearchInput) {
      noteSearchInput.addEventListener('input', (e) => {
        NotesManager.render(e.target.value.trim());
      });
    }

    // 22. Modal de Zoom da Foto (Grande Ângulo)
    const modalPhotoZoom = document.getElementById('modalPhotoZoom');
    const modalPhotoZoomClose = document.getElementById('modalPhotoZoomClose');
    if (modalPhotoZoomClose && modalPhotoZoom) {
      modalPhotoZoomClose.addEventListener('click', () => {
        modalPhotoZoom.classList.remove('active');
      });
      modalPhotoZoom.addEventListener('click', (e) => {
        if (e.target === modalPhotoZoom) modalPhotoZoom.classList.remove('active');
      });
    }

    // Delegação global para fotos clicáveis (abrir zoom)
    document.addEventListener('click', (e) => {
      const targetImg = e.target.closest('.memory-polaroid-img, .friend-polaroid-img');
      if (targetImg && targetImg.src && !targetImg.classList.contains('memory-polaroid-sticker') && !targetImg.classList.contains('friend-polaroid-sticker')) {
        const parentCard = targetImg.closest('.memory-polaroid-item, .friend-polaroid-card');
        const caption = parentCard?.querySelector('.memory-polaroid-caption, .friend-polaroid-caption')?.textContent || targetImg.alt || '';
        const title = parentCard?.querySelector('.memory-polaroid-habit')?.textContent || 'Momento da Rotina EEX';
        const date = parentCard?.querySelector('.memory-polaroid-date')?.textContent || '';
        this.openPhotoZoom(targetImg.src, title, caption, date);
      }
    });

    // Botão de Detalhes no painel de assinante ativo EEX+
    const btnSettingsManagePlan = document.getElementById('btnSettingsManagePlan');
    if (btnSettingsManagePlan) {
      btnSettingsManagePlan.addEventListener('click', () => {
        const modal = document.getElementById('modalEEXPlus');
        if (modal) modal.classList.add('active');
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
              <img src="${u.avatar || 'images/elgalylogo.png'}" alt="${u.name}" class="search-agent-avatar btn-open-search-passport" data-uid="${u.uid}" style="cursor:pointer;" title="Clique para ver o Passaporte">
              <div class="search-agent-info btn-open-search-passport" data-uid="${u.uid}" style="cursor:pointer;">
                <strong>${u.name}</strong>
                <span>@${u.eexEmail || (u.nickname + '.express.com')}</span>
                <small>📍 ${u.location || 'Nova Amerit - NA'}</small>
              </div>
              <div class="search-agent-action" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <button type="button" class="btn-comic btn-view-search-passport btn-open-search-passport" data-uid="${u.uid}">
                  🪪 Ver Passaporte
                </button>
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

        resultsContainer.querySelectorAll('.btn-open-search-passport').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            const uid = el.dataset.uid;
            const targetUser = found.find(u => u.uid === uid);
            if (uid) FriendsManager.openFriendProfile(uid, targetUser);
          });
        });

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

    // 24. EEX-Friends: Botão de Alerta SOS Resgate
    const btnToggleSos = document.getElementById('btnToggleSos');
    if (btnToggleSos) {
      btnToggleSos.addEventListener('click', () => {
        FriendsManager.toggleSos();
      });
    }

    // 25. EEX-Friends: Rádio Comunicador Bip
    const btnRadioBip = document.getElementById('btnRadioBip');
    const modalRadioBip = document.getElementById('modalRadioBip');
    const btnCancelRadio = document.getElementById('btnCancelRadio');
    if (btnRadioBip && modalRadioBip) {
      btnRadioBip.addEventListener('click', () => {
        modalRadioBip.classList.add('active');
      });
    }
    if (btnCancelRadio && modalRadioBip) {
      btnCancelRadio.addEventListener('click', () => {
        modalRadioBip.classList.remove('active');
      });
    }
    document.querySelectorAll('.radio-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        if (status) FriendsManager.sendRadioStatus(status);
      });
    });

    // 26. EEX-Friends: Modal de Perfil do Parceiro (Passaporte)
    const modalFriendProfile = document.getElementById('modalFriendProfile');
    const btnCloseFriendProfile = document.getElementById('btnCloseFriendProfile');
    if (btnCloseFriendProfile && modalFriendProfile) {
      btnCloseFriendProfile.addEventListener('click', () => {
        modalFriendProfile.classList.remove('active');
      });
    }

    // Alternância de abas internas no perfil do amigo (Rotina vs Fotos)
    document.querySelectorAll('.btn-friend-nav').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.friendTab;
        document.querySelectorAll('.btn-friend-nav').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.friend-tab-section').forEach(s => s.classList.remove('active'));
        const targetSection = document.getElementById(`friendTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
        if (targetSection) targetSection.classList.add('active');
      });
    });

    // Ações dentro do modal de perfil do amigo
    const btnFriendModalSendPackage = document.getElementById('btnFriendModalSendPackage');
    if (btnFriendModalSendPackage) {
      btnFriendModalSendPackage.addEventListener('click', () => {
        if (FriendsManager.activeFriendForProfile) {
          if (modalFriendProfile) modalFriendProfile.classList.remove('active');
          FriendsManager.openSendPackageModal(FriendsManager.activeFriendForProfile);
        }
      });
    }

    const btnFriendModalPoke = document.getElementById('btnFriendModalPoke');
    if (btnFriendModalPoke) {
      btnFriendModalPoke.addEventListener('click', async () => {
        const friend = FriendsManager.activeFriendForProfile;
        if (!friend) return;

        // Anti-farm: 1 buzina por amigo por dia
        const cooldownKey = `eex_poke_cd_${AuthManager.getCurrentUser()?.id}_${friend.uid}`;
        const lastPoke = localStorage.getItem(cooldownKey);
        const today = new Date().toLocaleDateString('en-CA');
        if (lastPoke === today) {
          AppUI.showToast(`📢 Você já buzinou para ${friend.name || friend.nickname} hoje! Volte amanhã. 😄`);
          return;
        }

        btnFriendModalPoke.disabled = true;
        btnFriendModalPoke.textContent = '⚡ Enviando reforço...';
        await FirebaseService.sendPoke(friend.uid);
        localStorage.setItem(cooldownKey, today);
        if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
          AuthManager.addXp(10, `Apoio/buzina enviada para ${friend.name || friend.nickname}! 📢⚡`);
        }
        AppUI.showToast(`📢 Você deu uma força para ${friend.name || friend.nickname}! (+10 XP)`);
        setTimeout(() => {
          btnFriendModalPoke.disabled = false;
          btnFriendModalPoke.textContent = '📢 Dar uma Força!';
        }, 3000);
      });
    }


    // 27. EEX-Friends: Envio de Encomenda Express
    const formSendPackage = document.getElementById('formSendPackage');
    const modalSendPackage = document.getElementById('modalSendPackage');
    const btnCancelSendPackage = document.getElementById('btnCancelSendPackage');
    const inputPkgMsg = document.getElementById('pkgMessage');

    if (btnCancelSendPackage && modalSendPackage) {
      btnCancelSendPackage.addEventListener('click', () => {
        modalSendPackage.classList.remove('active');
      });
    }

    // Chips de mensagens rápidas
    document.querySelectorAll('.chip-msg').forEach(chip => {
      chip.addEventListener('click', () => {
        if (inputPkgMsg) {
          inputPkgMsg.value = chip.textContent.trim();
          inputPkgMsg.focus();
        }
      });
    });

    if (formSendPackage && modalSendPackage) {
      formSendPackage.addEventListener('submit', async (e) => {
        e.preventDefault();
        const friend = FriendsManager.activeFriendForPackage;
        if (!friend) return;

        const stamp = formSendPackage.querySelector('input[name="pkgStamp"]:checked')?.value || 'selo-brave';
        const boxType = document.getElementById('pkgBoxType')?.value || 'caixa-reforcada';
        const message = inputPkgMsg?.value.trim() || 'Uma entrega dimensional surpresa para você!';

        const submitBtn = formSendPackage.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '⚡ Despachando Encomenda...';
        }

        const res = await FirebaseService.sendPackage(friend.uid, {
          stamp: stamp,
          boxType: boxType,
          message: message
        });

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '🚀 Selar & Despachar Encomenda!';
        }

        if (res.success) {
          modalSendPackage.classList.remove('active');
          if (typeof AuthManager !== 'undefined' && AuthManager.addXp) {
            AuthManager.addXp(30, 'Encomenda postal despachada para parceiro! 📦💌');
          }
          AppUI.showToast(`📦 Encomenda despachada com sucesso para ${friend.name || friend.nickname}! (+30 XP)`);
        } else {
          AppUI.showToast('Erro ao despachar encomenda: ' + (res.error || 'Tente novamente.'));
        }
      });
    }

    // 28. EEX-Friends: Desembrulho da Encomenda Recebida
    const modalOpenPackage = document.getElementById('modalOpenPackage');
    const btnDismissPackage = document.getElementById('btnDismissPackage');
    if (btnDismissPackage && modalOpenPackage) {
      btnDismissPackage.addEventListener('click', () => {
        modalOpenPackage.classList.remove('active');
      });
    }

    // 29. Gazeta da Providência (Atualizações da C.E.O.)
    const btnProvidenteNews = document.getElementById('btnProvidenteNews');
    const btnDrawerProvidenteNews = document.getElementById('btnDrawerProvidenteNews');
    const btnCloseProvidenteNews = document.getElementById('btnCloseProvidenteNews');
    const btnAckProvidenteNews = document.getElementById('btnAckProvidenteNews');

    if (btnProvidenteNews) {
      btnProvidenteNews.addEventListener('click', () => {
        ProvidenteNewsManager.openModal(0);
      });
    }

    if (btnDrawerProvidenteNews) {
      btnDrawerProvidenteNews.addEventListener('click', () => {
        const drawer = document.getElementById('mobileDrawer');
        const overlay = document.getElementById('drawerOverlay');
        if (drawer) drawer.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        ProvidenteNewsManager.openModal(0);
      });
    }

    if (btnCloseProvidenteNews) {
      btnCloseProvidenteNews.addEventListener('click', () => {
        ProvidenteNewsManager.closeModal();
      });
    }

    if (btnAckProvidenteNews) {
      btnAckProvidenteNews.addEventListener('click', () => {
        ProvidenteNewsManager.closeModal();
        AppUI.showToast('🌟 Comunicado da C.E.O. Providente assimilado com louvor!');
      });
    }

    // Modal de Atualização Disponível — Botão "Agora Não"
    const btnUpdateDismiss = document.getElementById('btnUpdateDismiss');
    if (btnUpdateDismiss) {
      btnUpdateDismiss.addEventListener('click', () => {
        const modal = document.getElementById('modalUpdateAvailable');
        if (modal) modal.classList.remove('active');
        this.showToast('🔔 Você pode atualizar depois pelo app!');
      });
    }

    // 30. Popup da C.E.O. - Modo Profissão / Trabalho
    const btnCeoEnableWork = document.getElementById('btnCeoEnableWork');
    if (btnCeoEnableWork) {
      btnCeoEnableWork.addEventListener('click', async () => {
        const user = AuthManager.getCurrentUser();
        if (user) {
          user.workMode = true;
          user.workModePrompted = true;
          AuthManager.saveCurrent();
          if (typeof FirebaseService !== 'undefined') {
            await FirebaseService.saveProfileToCloud({ workMode: true, workModePrompted: true });
          }
          AppUI.updateWorkModeUI(true);
          AppUI.renderTasks();
          AppUI.renderDailyRoutine();
        }
        document.getElementById('modalCeoWorkPrompt')?.classList.remove('active');
        AppUI.showToast('💼 Modo Profissão ativado com louvor pela C.E.O.! 📦');
      });
    }

    const btnCeoDismissWork = document.getElementById('btnCeoDismissWork');
    if (btnCeoDismissWork) {
      btnCeoDismissWork.addEventListener('click', async () => {
        const user = AuthManager.getCurrentUser();
        if (user) {
          user.workMode = false;
          user.workModePrompted = true;
          AuthManager.saveCurrent();
          if (typeof FirebaseService !== 'undefined') {
            await FirebaseService.saveProfileToCloud({ workMode: false, workModePrompted: true });
          }
          AppUI.updateWorkModeUI(false);
        }
        document.getElementById('modalCeoWorkPrompt')?.classList.remove('active');
      });
    }

    // 31. Configurações: Toggle Modo Profissão
    const btnToggleSettingsWorkMode = document.getElementById('btnToggleSettingsWorkMode');
    if (btnToggleSettingsWorkMode) {
      btnToggleSettingsWorkMode.addEventListener('click', async () => {
        const user = AuthManager.getCurrentUser();
        if (!user) return;
        user.workMode = !user.workMode;
        user.workModePrompted = true;
        AuthManager.saveCurrent();
        if (typeof FirebaseService !== 'undefined') {
          await FirebaseService.saveProfileToCloud({ workMode: user.workMode, workModePrompted: true });
        }
        AppUI.updateWorkModeUI(user.workMode);
        AppUI.renderTasks();
        AppUI.renderDailyRoutine();
        AppUI.showToast(user.workMode ? '💼 Modo Profissão ativado!' : '💼 Modo Profissão desativado.');
      });
    }

    // 32. Configurações: Toggle Saudação (VIP / Providente)
    const btnToggleMagaficGreeting = document.getElementById('btnToggleMagaficGreeting');
    if (btnToggleMagaficGreeting) {
      btnToggleMagaficGreeting.addEventListener('click', () => {
        const user = AuthManager.getCurrentUser();
        const isVip = AppUI.isMagafusVIP(user);
        const isDisabled = localStorage.getItem('eex_magafus_greeting_disabled') === 'true';
        if (isDisabled) {
          localStorage.removeItem('eex_magafus_greeting_disabled');
          AppUI.showToast(isVip ? '💜 Saudação do Coração Magáfico ao entrar ativada!' : '👑 Saudação da C.E.O. Providente ativada!');
        } else {
          localStorage.setItem('eex_magafus_greeting_disabled', 'true');
          AppUI.showToast(isVip ? '💜 Saudação do Coração Magáfico desativada.' : '👑 Saudação da C.E.O. Providente desativada.');
        }
        AppUI.renderConfiguracoes();
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
   * Renderiza tudo e gerencia o Portão Obrigatório de Autenticação + EEX-PASS
   */
  renderAll() {
    const isLoggedIn = AuthManager.isLoggedIn();
    const isVerified = AuthManager.isEexPassVerified;
    const authGateway = document.getElementById('authGateway');
    const appViewsContainer = document.getElementById('appViewsContainer');
    const desktopNav = document.querySelector('nav.desktop-nav');
    const btnMobileMenu = document.getElementById('btnMobileMenu');
    const bottomNavBar = document.getElementById('bottomNavBar');

    if (!isLoggedIn || !isVerified) {
      // Bloqueia acesso ao app e exibe portal de login se não estiver logado
      if (!isLoggedIn) {
        if (authGateway) authGateway.style.display = 'block';
      } else {
        if (authGateway) authGateway.style.display = 'none';
      }
      if (appViewsContainer) appViewsContainer.style.display = 'none';
      if (desktopNav) desktopNav.style.display = 'none';
      if (btnMobileMenu) btnMobileMenu.style.display = 'none';
      if (bottomNavBar) bottomNavBar.style.display = 'none';
      this.renderHeaderProfile();
      this.hideSplash();
      return;
    }

    // Usuário logado e verificado com EEX-PASS: libera a navegação e views
    if (authGateway) authGateway.style.display = 'none';
    if (appViewsContainer) appViewsContainer.style.display = 'block';
    if (desktopNav && window.innerWidth > 768) desktopNav.style.display = 'flex';
    if (btnMobileMenu) btnMobileMenu.style.display = 'none';
    if (bottomNavBar) bottomNavBar.style.removeProperty('display');

    this.renderHeaderProfile();
    this.renderHomeOverview();
    this.renderDailyRoutine();
    this.renderTasks();
    this.renderEvents();
    this.renderProfileView();
    this.renderConfiguracoes();
    this.renderEexPlusStatus();
    ReportEngine.renderReportPreview();
    NotificationManager.scheduleAll();
    if (typeof ShellsManager !== 'undefined') ShellsManager.render();


    const user = AuthManager.getCurrentUser();
    if (user) {
      this.updateWorkModeUI(!!user.workMode);
      this.checkCeoWorkPrompt(user);
      this.triggerMagafusLoginGreeting(user);
    }

    // Verifica atualização disponível (uma vez por sessão, após login completo)
    setTimeout(() => UpdateManager.check(), 3000);

    this.hideSplash();
  },


  /**
   * Exibe o modal de solicitação do EEX-PASS após o login com Google
   */
  showEexPassPrompt(user) {
    const modal = document.getElementById('modalPinLogin');
    if (!modal) return;
    const avatarEl = document.getElementById('pinLoginAvatarImg');
    const nameEl = document.getElementById('pinLoginName');
    const eexEl = document.getElementById('pinLoginEex');
    const pinInput = document.getElementById('pinInput');
    const errEl = document.getElementById('pinError');

    if (avatarEl) avatarEl.src = user.avatar || 'images/elgalylogo.png';
    if (nameEl) nameEl.textContent = user.name || 'Agente';
    if (eexEl) eexEl.textContent = `@${user.eexEmail || (user.nickname + '.express.com')}`;
    if (pinInput) {
      pinInput.value = '';
      setTimeout(() => pinInput.focus(), 250);
    }
    if (errEl) errEl.textContent = '';

    modal.classList.add('active');
  },

  renderSavedBadges() {
    // Crachás na tela de login desativados por política de segurança EEX-PASS
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
      const safeCity = (typeof WeatherManager !== 'undefined') ? WeatherManager.getValidCity(user.location) : (user.location || 'São Paulo - SP');
      const cached = (typeof WeatherManager !== 'undefined') ? WeatherManager.getCachedWeather() : null;
      if (cached && (cached.city === safeCity.replace(/ - SP/i, '').trim() || cached.displayCity)) {
        greetingSubtitle.innerHTML = `${cached.icon || '⛅'} <strong>${cached.temp}°C • ${cached.label}</strong> em ${cached.displayCity}. Terminal conectado na nuvem ☁️`;
      } else {
        greetingSubtitle.innerHTML = `🌤️ Carregando clima em <strong>${safeCity}</strong>... Terminal conectado na nuvem ☁️`;
      }
      if (typeof WeatherManager !== 'undefined') {
        WeatherManager.fetchWeatherForCity(safeCity);
      }
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
              <span class="task-badge ${task.category}">${task.category === 'faculdade' ? 'Faculdade' : (task.category === 'trabalho' ? '💼 Trabalho' : 'Pessoal')}</span>
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
    const routineLimitBadge = document.getElementById('routineLimitBadge');

    const user = AuthManager.getCurrentUser();
    if (typeof WeatherManager !== 'undefined' && user?.location) {
      WeatherManager.fetchWeatherForCity(user.location);
    }

    if (routineLimitBadge) {
      const isPrem = typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium();
      if (isPrem) {
        routineLimitBadge.innerHTML = `Rotinas: <strong>${habits.length} (Ilimitado EEX+ ✨)</strong>`;
        routineLimitBadge.classList.add('eexplus-unlimited');
      } else {
        routineLimitBadge.innerHTML = `Rotinas: <strong>${habits.length}/12 utilizadas</strong>`;
        routineLimitBadge.classList.remove('eexplus-unlimited');
      }
    }

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
            <span class="habit-tag ${habit.category}">${habit.category === 'faculdade' ? 'Faculdade' : (habit.category === 'trabalho' ? '💼 Trabalho' : 'Pessoal')}</span>
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
    this._placedStickers = [];

    const modal = document.getElementById('modalMomentCapture');
    const preview = document.getElementById('momentPhotoPreview');
    const placeholder = document.getElementById('momentPlaceholder');
    const captionInput = document.getElementById('momentCaptionInput');
    const fileInput = document.getElementById('momentFileInput');

    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'flex';
    if (captionInput) captionInput.value = '';
    if (fileInput) fileInput.value = '';

    // Adiciona 1 sticker Brave inicial no canto
    this.addStickerToMoment('brave', 60, 60);

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

    if (nameEl) {
      if (this.isMagafusVIP(user)) {
        nameEl.innerHTML = `${user.name} <img src="images/magaficseal.png" style="width:20px;height:20px;vertical-align:middle;margin-left:4px;filter:drop-shadow(1px 1px 0 rgba(0,0,0,0.5));" alt="💜" title="Selo Magáfico 💜">`;
      } else {
        nameEl.textContent = user.name;
      }
    }
    if (eexEl) eexEl.textContent = user.eexEmail;
    if (locInput) locInput.value = user.location || 'Nova Amerit - NA (Nova Arcanis)';

    ThemeManager.setTheme(ThemeManager.current, false);

    // Status do Modo Profissão
    const workStatus = document.getElementById('cfgWorkModeStatus');
    const btnToggleWork = document.getElementById('btnToggleSettingsWorkMode');
    if (workStatus && btnToggleWork) {
      if (user.workMode) {
        workStatus.textContent = 'Ativado';
        workStatus.style.color = '#16a34a';
        btnToggleWork.textContent = 'Desativar';
        btnToggleWork.classList.add('btn-secondary');
      } else {
        workStatus.textContent = 'Desativado';
        workStatus.style.color = '#6b7280';
        btnToggleWork.textContent = 'Ativar';
        btnToggleWork.classList.remove('btn-secondary');
      }
    }

    // Saudação ao Entrar (Coração Magáfico para VIPs / C.E.O. Providente para demais usuários)
    const cardGreeting = document.getElementById('cardSettingsMagaficGreeting');
    if (cardGreeting) {
      cardGreeting.style.display = 'block';
      const isVIP = this.isMagafusVIP(user);
      const titleEl = cardGreeting.querySelector('h3');
      const descEl = cardGreeting.querySelector('p');
      if (titleEl) titleEl.textContent = isVIP ? '💜 Coração Magáfico' : '👑 Saudação da Providente';
      if (descEl) descEl.textContent = isVIP 
        ? 'Exibe o Coraçãozinho Magáfico com som e mensagem de carinho toda vez que você entrar.'
        : 'Exibe a saudação da C.E.O. Providente com efeito sonoro especial ao iniciar seu turno.';

      const greetingStatus = document.getElementById('cfgMagaficGreetingStatus');
      const btnToggleGreeting = document.getElementById('btnToggleMagaficGreeting');
      const isDisabled = localStorage.getItem('eex_magafus_greeting_disabled') === 'true';
      if (greetingStatus && btnToggleGreeting) {
        if (isDisabled) {
          greetingStatus.textContent = 'Desativada';
          greetingStatus.style.color = '#6b7280';
          btnToggleGreeting.textContent = 'Ativar';
          btnToggleGreeting.classList.remove('btn-secondary');
        } else {
          greetingStatus.textContent = 'Ativada';
          greetingStatus.style.color = '#16a34a';
          btnToggleGreeting.textContent = 'Desativar';
          btnToggleGreeting.classList.add('btn-secondary');
        }
      }
    }
  },

  renderEexPlusStatus() {
    const isPrem = typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium();
    const planLabel = isPrem ? EEXPlusManager.getPlanLabel() : null;

    // Botão Pomodoro na Navbar, no Drawer e na Barra Inferior Mobile
    const btnNavPomodoro = document.getElementById('btnNavPomodoro');
    const btnDrawerPomodoro = document.getElementById('btnDrawerPomodoro');
    const btnBottomPomodoro = document.getElementById('btnBottomPomodoro');

    if (btnNavPomodoro) {
      btnNavPomodoro.style.display = 'inline-flex';
      btnNavPomodoro.classList.toggle('eexplus-lustroso', !isPrem);
    }
    if (btnDrawerPomodoro) {
      btnDrawerPomodoro.style.display = 'flex';
      btnDrawerPomodoro.classList.toggle('eexplus-lustroso', !isPrem);
    }
    if (btnBottomPomodoro) {
      btnBottomPomodoro.style.display = 'flex';
      btnBottomPomodoro.classList.toggle('eexplus-lustroso', !isPrem);
    }

    // Se o usuário não for premium, esconde também o balãozinho flutuante e pausa o timer
    const floatingWidget = document.getElementById('pomodoroFloatingWidget');
    if (floatingWidget && !isPrem) {
      floatingWidget.style.display = 'none';
      if (typeof PomodoroManager !== 'undefined' && PomodoroManager._running) {
        PomodoroManager.pause();
      }
    }

    // Botão no Header
    const btnHeaderEexPlus = document.getElementById('btnHeaderEexPlus');
    const headerText = document.getElementById('headerEexPlusText');
    if (btnHeaderEexPlus) {
      btnHeaderEexPlus.classList.toggle('is-active', isPrem);
      btnHeaderEexPlus.classList.toggle('eexplus-lustroso', !isPrem);
      if (headerText) headerText.textContent = isPrem ? 'EEX+ ✨' : 'EEX+';
    }

    // Botão de relatório personalizado: efeito lustroso para free
    const btnCustomDaysReport = document.getElementById('btnCustomDaysReport');
    if (btnCustomDaysReport) {
      btnCustomDaysReport.classList.toggle('eexplus-lustroso', !isPrem);
    }

    // Badge em Configurações
    const statusBadge = document.getElementById('settingsEexPlusStatusBadge');
    if (statusBadge) {
      if (isPrem) {
        statusBadge.textContent = `ASSINANTE ATIVO ✨ (${planLabel})`;
        statusBadge.style.background = '#10b981';
        statusBadge.style.color = '#ffffff';
      } else {
        statusBadge.textContent = 'EM BREVE 🚀';
        statusBadge.style.background = '#f59e0b';
        statusBadge.style.color = '#000000';
      }
    }

    // Exibe apenas os temas que o usuário possui/desbloqueou (temas não adquiridos ficam ocultos das configurações)
    document.querySelectorAll('.theme-pick-card').forEach(card => {
      const themeId = card.dataset.themeId;
      const themeObj = ThemeManager.themes[themeId];
      if (!themeObj) return;

      const isUnlocked = ThemeManager.isThemeUnlocked(themeId);
      if (!isUnlocked) {
        card.style.display = 'none';
      } else {
        card.style.display = 'flex';
        card.classList.remove('theme-locked', 'eexplus-lustroso');
        const lockBadge = card.querySelector('.theme-lock-badge');
        if (lockBadge) lockBadge.style.display = 'none';
      }
    });

    // Atualiza badge de limite de hábitos na rotina
    const routineLimitBadge = document.getElementById('routineLimitBadge');
    if (routineLimitBadge) {
      const habitCount = (typeof HabitManager !== 'undefined') ? HabitManager.habits.length : 0;
      if (isPrem) {
        routineLimitBadge.innerHTML = `Rotinas: <strong>${habitCount} (Ilimitado EEX+ ✨)</strong>`;
        routineLimitBadge.classList.add('eexplus-unlimited');
      } else {
        routineLimitBadge.innerHTML = `Rotinas: <strong>${habitCount}/12 utilizadas</strong>`;
        routineLimitBadge.classList.remove('eexplus-unlimited');
      }
    }

    // Alterna visualização em Configurações: esconde formulário de código/planos quando já for assinante
    const eexplusActiveSubscriberBox = document.getElementById('eexplusActiveSubscriberBox');
    const eexplusNonSubscriberActions = document.getElementById('eexplusNonSubscriberActions');
    if (eexplusActiveSubscriberBox) eexplusActiveSubscriberBox.style.display = isPrem ? 'flex' : 'none';
    if (eexplusNonSubscriberActions) eexplusNonSubscriberActions.style.display = isPrem ? 'none' : 'flex';

    // Alterna visualização no Modal EEX+: esconde planos e código quando já for assinante
    const modalEexPlusActiveSection = document.getElementById('modalEexPlusActiveSection');
    const modalEexPlusGuestSection = document.getElementById('modalEexPlusGuestSection');
    const modalActivePlanDesc = document.getElementById('modalActivePlanDesc');
    if (modalEexPlusActiveSection) modalEexPlusActiveSection.style.display = isPrem ? 'block' : 'none';
    if (modalEexPlusGuestSection) modalEexPlusGuestSection.style.display = isPrem ? 'none' : 'block';
    if (modalActivePlanDesc && isPrem) {
      modalActivePlanDesc.textContent = `Plano Ativo: ${planLabel}. Seu terminal está com todos os privilégios VIP dimensional liberados!`;
    }

    // Botão de teste EEX+: visível EXCLUSIVAMENTE para a conta oficial de testes (kotundashed.express.com)
    // Para todas as outras contas, permanece 100% oculto
    const user = AuthManager.getCurrentUser();
    const isKotun = typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isKotunUser(user);

    const containerEexPlusTestMode = document.getElementById('containerEexPlusTestMode') || (document.getElementById('btnToggleEexPlusTestMode')?.parentElement);
    if (containerEexPlusTestMode) {
      containerEexPlusTestMode.style.setProperty('display', isKotun ? 'block' : 'none', 'important');
    }

    const containerModalEexPlusTestMode = document.getElementById('containerModalEexPlusTestMode') || (document.getElementById('btnModalToggleTestMode')?.parentElement);
    if (containerModalEexPlusTestMode) {
      containerModalEexPlusTestMode.style.setProperty('display', isKotun ? 'block' : 'none', 'important');
    }

    // Badge e controle noturno (Ciclo Dia & Noite / Conforto Ocular EEX+)
    const badgeNightStatus = document.getElementById('badgeNightStatus');
    const btnToggleNightMode = document.getElementById('btnToggleNightMode');
    if (!isPrem) {
      document.documentElement.classList.remove('theme-night');
      if (badgeNightStatus) {
        badgeNightStatus.textContent = '🔒 BLOQUEADO';
        badgeNightStatus.style.background = '#fef2f2';
        badgeNightStatus.style.color = '#ef4444';
      }
      if (btnToggleNightMode) {
        btnToggleNightMode.classList.add('eexplus-lustroso');
      }
    } else {
      if (btnToggleNightMode) {
        btnToggleNightMode.classList.remove('eexplus-lustroso');
      }
      if (badgeNightStatus) {
        const isNight = document.documentElement.classList.contains('theme-night');
        badgeNightStatus.textContent = isNight ? 'ATIVADO' : 'DESLIGADO';
        badgeNightStatus.style.background = isNight ? '#ffd700' : '#e2e8f0';
        badgeNightStatus.style.color = isNight ? '#000' : '#475569';
      }
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
    } else if (this.currentFilter === 'trabalho') {
      tasks = tasks.filter(t => t.category === 'trabalho');
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
            <span class="task-badge ${task.category}">${task.category === 'faculdade' ? 'Faculdade' : (task.category === 'trabalho' ? '💼 Trabalho' : 'Pessoal')}</span>
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

  isMagafusVIP(user) {
    if (!user) return false;
    const nick = (user.nickname || '').toLowerCase();
    const eex = (user.eexEmail || '').toLowerCase();
    const email = (user.email || '').toLowerCase();
    return nick === 'pedrinho' || nick === 'kotundashed' ||
           eex.includes('pedrinho') || eex.includes('kotundashed') ||
           email.includes('pedrinho') || email.includes('kotundashed');
  },

  calculateCareerStats() {
    const user = AuthManager.getCurrentUser();
    const tasks = TaskManager.getAllTasks ? TaskManager.getAllTasks() : (TaskManager.tasks || []);
    const completedTasks = tasks.filter(t => t.completed).length;
    const stats = HabitManager.getTodayStats ? HabitManager.getTodayStats() : { streak: 0 };
    const streak = stats.streak || 0;
    const friendsCount = (FriendsManager.friends || []).length;
    const memories = MemoriesManager.memories || [];
    const bonusXp = (user && typeof user.bonusXp === 'number') ? user.bonusXp : 0;

    // Cálculo consolidado de XP
    const totalXp = bonusXp + (completedTasks * 25) + (streak * 20) + (friendsCount * 30) + (memories.length * 10);

    // Sistema de 100 Níveis (1 a 100)
    const level = Math.min(100, Math.max(1, Math.floor(totalXp / 100) + 1));

    // 10 Tiers a cada 10 patentes até o Nível 100 (O Olho de Providente)
    const tiers = [
      { min: 1,  max: 9,   title: 'Recruta da Rota Express 📦', color: '#a855f7', tierName: 'Bronze', stripClass: 'holo-copper', stripText: '★ EEX RECRUTA ★' },
      { min: 10, max: 19,  title: 'Mensageiro de Asfalto Cósmico ⚡', color: '#06b6d4', tierName: 'Cobre Veloz', stripClass: 'holo-copper', stripText: '⚡ EEX SPEED ⚡' },
      { min: 20, max: 29,  title: 'Piloto de Salto Dimensional 🚀', color: '#3b82f6', tierName: 'Prata Prismática', stripClass: 'holo-silver', stripText: '🚀 EEX DIMENSIONAL 🚀' },
      { min: 30, max: 39,  title: 'Especialista de Carga Estelar 🌌', color: '#6366f1', tierName: 'Aço Meteórico', stripClass: 'holo-steel', stripText: '🌌 EEX STELLAR 🌌' },
      { min: 40, max: 49,  title: 'Inspetor Postal de Nova Amerit 🛡️', color: '#eab308', tierName: 'Ouro Lapidado', stripClass: 'holo-gold', stripText: '🛡️ EEX INSPECTOR 🛡️' },
      { min: 50, max: 59,  title: 'Comandante de Frota EEX 🎖️', color: '#ec4899', tierName: 'Quartzo Rosa', stripClass: 'holo-rose', stripText: '🎖️ EEX COMMANDER 🎖️' },
      { min: 60, max: 69,  title: 'Guardião dos Vórtices de Entrega 🌀', color: '#0ea5e9', tierName: 'Safira Dimensional', stripClass: 'holo-sapphire', stripText: '🌀 EEX VORTEX 🌀' },
      { min: 70, max: 79,  title: 'Marechal de Rotinas Cósmicas 👑', color: '#10b981', tierName: 'Esmeralda Imperial', stripClass: 'holo-emerald', stripText: '👑 EEX MARSHAL 👑' },
      { min: 80, max: 89,  title: 'Arauto da Luz Dourada 🌟', color: '#f59e0b', tierName: 'Rubi Solar', stripClass: 'holo-ruby', stripText: '🌟 EEX HERALD 🌟' },
      { min: 90, max: 99,  title: 'Grão-Mestre da Providência ⚜️', color: '#8b5cf6', tierName: 'Diamante Astral', stripClass: 'holo-diamond', stripText: '⚜️ EEX GRAND MASTER ⚜️' },
      { min: 100, max: 100, title: 'O Olho de Providente 👁️✨', color: '#ffd700', tierName: 'Celestial Supremo', stripClass: 'holo-providente', stripText: '👁️✨ O OLHO DE PROVIDENTE • C.E.O. ✨👁️' }
    ];

    const currentTier = tiers.find(t => level >= t.min && level <= t.max) || tiers[0];

    const currentLevelBaseXp = (level - 1) * 100;
    const nextLevelXp = level >= 100 ? 10000 : level * 100;
    const progressInLevel = level >= 100 ? 100 : (totalXp - currentLevelBaseXp);
    const progressPercent = level >= 100 ? 100 : Math.min(100, Math.max(0, Math.round((progressInLevel / 100) * 100)));

    // Exclusividade EEX+: Tarja arco-íris holográfica com "★ EEX+ • EEX+ • EEX+ ★"
    const isEexPlus = (typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium());
    const finalStripClass = isEexPlus ? 'holo-eexplus' : currentTier.stripClass;
    const finalStripText  = isEexPlus ? '★ EEX+ • EEX+ • EEX+ ★' : currentTier.stripText;

    return {
      totalXp,
      level,
      rankTitle: currentTier.title,
      rankColor: currentTier.color,
      tierName: currentTier.tierName,
      stripClass: finalStripClass,
      stripText: finalStripText,
      isEexPlus,
      nextLevelXp,
      progressPercent
    };
  },

  unlockAchievement(achId) {
    const user = AuthManager.getCurrentUser();
    if (!user) return;
    const list = Array.isArray(user.unlockedAchievements) ? [...user.unlockedAchievements] : [];
    if (!list.includes(achId)) {
      list.push(achId);
      user.unlockedAchievements = list;
      AuthManager.currentUser = user;
      AuthManager.saveCurrent();
      if (typeof FirebaseService !== 'undefined' && FirebaseService.db && user.id) {
        FirebaseService.saveProfileToCloud({ unlockedAchievements: list });
      }
    }
  },

  getAchievements(stats = {}) {
    const user           = AuthManager.getCurrentUser();
    const unlockedList   = (user && Array.isArray(user.unlockedAchievements))
      ? [...user.unlockedAchievements]
      : [];

    const streak         = stats.streak         || 0;
    const completedTasks = stats.completedTasks || 0;
    const friendsCount   = stats.friendsCount   || 0;
    const memoriesCount  = stats.memoriesCount  || 0;
    const radioStatus    = !!stats.radioStatus;
    const shells         = stats.shells         || 0;

    // Conquistas disponíveis (SOS temporariamente removido a pedido do usuário)
    const list = [
      {
        id: 'primeira-missao',
        icon: '🐾',
        title: 'Primeira Missão',
        desc: 'Completou seu primeiro hábito ou encomenda',
        unlocked: unlockedList.includes('primeira-missao') || completedTasks > 0 || streak > 0
      },
      {
        id: 'chama-viva',
        icon: '🔥',
        title: 'Chama Viva',
        desc: 'Manteve 3 ou mais dias de rotina seguida',
        unlocked: unlockedList.includes('chama-viva') || streak >= 3
      },
      {
        id: 'super-sonico',
        icon: '⚡',
        title: 'Super Sônico',
        desc: 'Alcançou 7 dias de streak ininterrupto',
        unlocked: unlockedList.includes('super-sonico') || streak >= 7
      },
      {
        id: 'mestre-frete',
        icon: '📦',
        title: 'Mestre do Frete',
        desc: 'Entregou 5 ou mais encomendas dimensionais',
        unlocked: unlockedList.includes('mestre-frete') || completedTasks >= 5
      },
      {
        id: 'lembre-se',
        icon: '<img src="images/shellcoin.png" class="achievement-shell-img" alt="Conchas">',
        title: 'Lembre-se',
        desc: 'Colete 55 conchas',
        unlocked: unlockedList.includes('lembre-se') || shells >= 55
      },
      {
        id: 'rede-coletiva',
        icon: '🤝',
        title: 'Rede Coletiva',
        desc: 'Conectou-se com pelo menos 1 parceiro EEX',
        unlocked: unlockedList.includes('rede-coletiva') || friendsCount >= 1
      },
      {
        id: 'olho-postal',
        icon: '📸',
        title: 'Olho Postal',
        desc: 'Registrou momentos da rotina com fotos e adesivos',
        unlocked: unlockedList.includes('olho-postal') || memoriesCount >= 1
      },
      {
        id: 'frequencia-aberta',
        icon: '📻',
        title: 'Frequência Aberta',
        desc: 'Transmitiu aviso de status no Rádio Comunicador',
        unlocked: unlockedList.includes('frequencia-aberta') || radioStatus
      },
      {
        id: 'express-total',
        icon: '✨',
        title: '100% Express',
        desc: 'Ativou o EEX+ uma vez — Agente de Elite da Frota!',
        unlocked: unlockedList.includes('express-total'),
        exclusive: true // marca visual EEX+
      }
    ];

    // Persiste no banco de dados do Firebase qualquer conquista que acabou de ser cumprida
    let hasNew = false;
    list.forEach(a => {
      if (a.unlocked && !unlockedList.includes(a.id)) {
        unlockedList.push(a.id);
        hasNew = true;
      }
    });

    if (hasNew && user) {
      user.unlockedAchievements = unlockedList;
      AuthManager.currentUser = user;
      AuthManager.saveCurrent();
      if (typeof FirebaseService !== 'undefined' && FirebaseService.db && user.id) {
        FirebaseService.saveProfileToCloud({ unlockedAchievements: unlockedList });
      }
    }

    return list;
  },


  renderProfileView() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    const wrap = document.getElementById('profilePageWrap');
    if (!wrap) return;

    const tasks = TaskManager.getAllTasks();
    const habits = HabitManager.getAllHabits();
    const completedTasks = tasks.filter(t => t.completed).length;
    const stats = HabitManager.getTodayStats();
    const streak = stats.streak || 0;
    const friendsCount = (FriendsManager.friends || []).length;
    const memories = MemoriesManager.memories || [];

    // Cálculo da Patente Dimensional Expandida (100 Níveis)
    const career = this.calculateCareerStats();

    // Conquistas / Selos Colecionáveis
    const myShells = typeof ShellsManager !== 'undefined' ? ShellsManager.getBalance() : (user.shells || 0);
    const achievements = this.getAchievements({
      streak: streak,
      completedTasks: completedTasks,
      friendsCount: friendsCount,
      memoriesCount: memories.length,
      sosActive: FriendsManager.sosActive,
      radioStatus: FriendsManager.radioStatus,
      shells: myShells
    });

    const isOnline = navigator.onLine !== false;
    const statusDot = isOnline ? '🟢' : '🔴';
    const statusText = isOnline ? 'On-line' : 'Off-line';
    const statusColor = isOnline ? '#16a34a' : '#dc2626';

    // Cálculo da data de membro oficial (evita reset para hoje)
    let memberDateFormatted = '24/09/2026';
    if (user.joinedAt) {
      const d = new Date(user.joinedAt);
      if (!isNaN(d.getTime())) {
        const todayStr = new Date().toLocaleDateString('en-CA');
        const joinedStr = d.toLocaleDateString('en-CA');
        if (joinedStr !== todayStr) {
          memberDateFormatted = d.toLocaleDateString('pt-BR');
        }
      }
    }

    wrap.innerHTML = `
      <div class="grand-profile-container">
        
        <!-- CORDÃO & CLIPE RETRÔ EEX -->
        <div class="lanyard-ribbon-wrap">
          <div class="lanyard-strap">
            <span>ELGALY EXPRESS // AGENTE OFICIAL // 1998 - 2026 // PASSAPORTE DIMENSIONAL</span>
          </div>
          <div class="lanyard-clip"></div>
        </div>

        <!-- SUPER CRACHÁ MASTER (ANOS 2000) -->
        <div class="grand-badge-card ${career.isEexPlus ? 'passport-eexplus' : ''}">
          <div class="grand-badge-header">
            <div class="grand-badge-brand">
              <img src="images/elgalylogo.png" alt="Logo" class="badge-logo-mini">
              <div>
                <span class="badge-org-title">ELGALY EXPRESS // DEPARTAMENTO DE DESPACHO</span>
                <span class="badge-org-sub">Credencial Operacional Oficial - Nova Amerit (NA)</span>
              </div>
            </div>
            <div class="badge-clearance-stamp">OFICIAL</div>
          </div>

          <div class="grand-badge-body">
            <div class="grand-badge-photo-column">
              <div class="grand-badge-photo-box">
                <img src="${user.avatar || 'images/elgalylogo.png'}" alt="Foto" id="grandPassAvatar" class="grand-badge-avatar">
                <button type="button" class="btn-change-photo-badge" id="btnQuickEditPhoto" title="Trocar Foto">✎</button>
                <div class="hologram-strip ${career.stripClass}">${career.stripText}</div>
              </div>
              <div class="badge-barcode">
                <div class="barcode-lines"></div>
                <span class="barcode-text">ID: ${user.id ? user.id.slice(0, 10).toUpperCase() : 'EEX-AGENT'}</span>
              </div>
            </div>

            <div class="grand-badge-info-column">
              <div class="badge-rank-pill" style="border-color: ${career.rankColor}; color: ${career.rankColor};">
                NÍVEL ${career.level} • ${career.rankTitle}
              </div>

              <div class="agent-name-seal-row">
                <h1 class="grand-agent-name">${user.name || 'Agente'}</h1>
                ${this.isMagafusVIP(user) ? `
                  <div class="magafic-seal-container">
                    <button type="button" class="magafic-seal-btn" id="magaficSealBtn" title="Selo Magáfico 💜 (Clique para conversar!)" aria-label="Selo Magáfico">
                      <img src="images/magaficseal.png" alt="Selo Magáfico" class="magafic-seal-img" id="magaficSealImg">
                    </button>
                    <!-- Balão de Diálogo do Coraçãozinho Magáfico -->
                    <div class="magafic-speech-dialog" id="magaficSpeechDialog" style="display: none;">
                      <div class="magafic-bubble-arrow"></div>
                      <div class="magafic-bubble-content">
                        <div class="magafic-bubble-header">
                          <span class="magafic-badge-title">💜 CORAÇÃO MAGÁFICO:</span>
                          <button type="button" class="magafic-bubble-close" id="btnCloseMagaficDialog">✕</button>
                        </div>
                        <p class="magafic-dialog-text" id="magaficDialogText">"Oi, Magafus! 💜"</p>
                      </div>
                    </div>
                  </div>
                ` : ''}
              </div>
              <div class="grand-agent-nick-row">
                <strong class="grand-agent-nick">@${user.eexEmail || (user.nickname + '.express.com')}</strong>
                <button type="button" class="btn-comic btn-copy-mini" id="btnCopyProfileNick" title="Copiar ID">📋</button>
              </div>

              <div class="grand-agent-meta">
                <div class="meta-row">📍 <strong>Setor:</strong> ${user.location || 'Nova Amerit - NA (Nova Arcanis)'}</div>
                <div class="meta-row">${statusDot} <strong>Status:</strong> <span style="font-weight:800;color:${statusColor};">${statusText}</span></div>
                <div class="meta-row">🎖️ <strong>Patente:</strong> Tier ${career.tierName} (Nível ${career.level}/100)</div>
                <div class="meta-row">📅 <strong>Membro desde:</strong> ${memberDateFormatted}</div>
              </div>

              <!-- Barra de XP / Nível com 100 Patentes -->
              <div class="badge-xp-bar-wrap">
                <div class="xp-bar-labels">
                  <span>Pontos de Frota: <strong>${career.totalXp} XP</strong></span>
                  <span>${career.level >= 100 ? '⭐ PATENTE MÁXIMA DA PROVIDENTE!' : `Próximo Nível (${career.level + 1}): <strong>${career.nextLevelXp} XP</strong>`}</span>
                </div>
                <div class="xp-progress-track">
                  <div class="xp-progress-fill" style="width: ${career.progressPercent}%; background: ${career.rankColor};"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Rodapé do Crachá com Ações -->
          <div class="grand-badge-footer">
            <button type="button" class="btn-comic" id="btnOpenEditProfileMain" style="background: var(--yellow-bright); color: var(--black);">
              ✎ Editar Perfil & Foto
            </button>
            <button type="button" class="btn-comic btn-secondary" id="btnShareProfilePass">
              📤 Compartilhar ID Express
            </button>
            <button type="button" class="btn-comic btn-outline" onclick="AuthManager.logout()">
              🚪 Sair da Conta
            </button>
          </div>
        </div>

        <!-- QUADRO DE ESTATÍSTICAS DA CARREIRA -->
        <div class="profile-stats-grid">
          <div class="profile-stat-box">
            <span class="stat-box-icon">📦</span>
            <strong class="stat-box-num">${tasks.length}</strong>
            <span class="stat-box-label">Encomendas Criadas</span>
          </div>
          <div class="profile-stat-box">
            <span class="stat-box-icon">✅</span>
            <strong class="stat-box-num" style="color: #16a34a;">${completedTasks}</strong>
            <span class="stat-box-label">Entregas Feitas</span>
          </div>
          <div class="profile-stat-box">
            <span class="stat-box-icon">🔥</span>
            <strong class="stat-box-num" style="color: #f97316;">${streak}</strong>
            <span class="stat-box-label">Dias de Fogo (Streak)</span>
          </div>
          <div class="profile-stat-box">
            <span class="stat-box-icon">🤝</span>
            <strong class="stat-box-num" style="color: var(--purple-main);">${friendsCount}</strong>
            <span class="stat-box-label">Parceiros Conectados</span>
          </div>
        </div>

        <!-- ARMÁRIO DE CONQUISTAS DA FROTA (INSÍGNIAS) -->
        <div class="profile-achievements-section">
          <div class="section-title-wrap">
            <h3 class="profile-section-heading">🏆 Insígnias & Medalhas da Frota</h3>
            <span class="achievements-counter">${achievements.filter(a => a.unlocked).length} de ${achievements.length} Desbloqueadas</span>
          </div>
          <div class="achievements-grid">
            ${achievements.map(ach => `
              <div class="achievement-card ${ach.unlocked ? 'unlocked' : 'locked'}">
                <div class="achievement-icon-wrap">
                  <span class="achievement-icon">${ach.icon}</span>
                  ${!ach.unlocked ? '<span class="lock-indicator">🔒</span>' : ''}
                </div>
                <div class="achievement-info">
                  <strong>${ach.title}</strong>
                  <p>${ach.desc}</p>
                  <span class="achievement-badge-pill">${ach.unlocked ? '✨ DESBLOQUEADO' : 'BLOQUEADO'}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- MURAL PESSOAL DE MOMENTOS (FOTOS COM STICKERS) -->
        <div class="profile-memories-section">
          <div class="section-title-wrap">
            <h3 class="profile-section-heading">📸 Meu Mural de Momentos Fotográficos</h3>
            <span class="achievements-counter">${memories.length} Registros</span>
          </div>

          ${memories.length === 0 ? `
            <div class="empty-subtab-box" style="background: var(--card-bg); border: 2.5px dashed var(--purple-main); border-radius: 16px; padding: 24px;">
              <span style="font-size: 2.4rem;">📷</span>
              <h4>Nenhuma Foto Registrada Ainda</h4>
              <p>Ao cumprir seus hábitos pelo celular, tire fotos para carimbar adesivos e preencher sua galeria!</p>
            </div>
          ` : `
            <div class="profile-memories-carousel">
              ${memories.slice(0, 10).map(mem => `
                <div class="friend-photo-polaroid">
                  <div class="friend-polaroid-img-wrap">
                    <img src="${mem.photo}" alt="${mem.caption}" class="friend-polaroid-img">
                    <img src="images/${mem.sticker === 'midnight' ? 'midnight.png' : (mem.sticker === 'fire' ? 'fireon.png' : 'brave.png')}" alt="Sticker" class="friend-polaroid-sticker">
                  </div>
                  <div class="friend-polaroid-body">
                    <strong>✨ ${mem.habitTitle || 'Rotina'}</strong>
                    <p>"${mem.caption || ''}"</p>
                    <small>📅 ${mem.date} às ${mem.time}</small>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

      </div>
    `;

    // Eventos do Perfil
    const btnEdit = document.getElementById('btnOpenEditProfileMain');
    const btnQuickPhoto = document.getElementById('btnQuickEditPhoto');
    if (btnEdit) btnEdit.addEventListener('click', () => this.openEditProfileModal());
    if (btnQuickPhoto) btnQuickPhoto.addEventListener('click', () => this.openEditProfileModal());

    const btnCopy = document.getElementById('btnCopyProfileNick');
    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        const text = user.eexEmail || `${user.nickname}.express.com`;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          }
          AppUI.showToast(`📋 ID copiado: ${text}`);
        } catch (e) {
          AppUI.showToast(`ID: ${text}`);
        }
      });
    }

    const btnShare = document.getElementById('btnShareProfilePass');
    if (btnShare) {
      btnShare.addEventListener('click', async () => {
        const text = user.eexEmail || `${user.nickname}.express.com`;
        if (navigator.share) {
          try {
            await navigator.share({
              title: `Passaporte EEX de ${user.name}`,
              text: `Conecte-se comigo no Elgaly Express! Meu ID é: ${text}`,
              url: window.location.href
            });
          } catch (e) {}
        } else {
          try {
            await navigator.clipboard.writeText(text);
            AppUI.showToast(`📋 ID Express copiado para compartilhar: ${text}`);
          } catch (e) {
            AppUI.showToast(`Seu ID Express: ${text}`);
          }
        }
      });
    }

    // Eventos do Selo Magáfico 💜
    const sealBtn = document.getElementById('magaficSealBtn');
    const sealImg = document.getElementById('magaficSealImg');
    const speechDialog = document.getElementById('magaficSpeechDialog');
    const dialogText = document.getElementById('magaficDialogText');
    const btnCloseDialog = document.getElementById('btnCloseMagaficDialog');

    if (sealBtn && speechDialog && dialogText) {
      const magaficPhrases = [
        "Oi, Magafus! 💜",
        "Seu cabelo está cheiroso hoje, hehe! ✨",
        "Não se esqueça! 💌",
        "Você é a pilota mais especial de toda Nova Amerit! 🌸",
        "Passando para deixar um abraço quentinho! 🥰",
        "A Magafus ilumina qualquer rota dimensional! 💜✨",
        "Sorria! O universo conspira ao seu favor hoje! 🌟",
        "Entregando 100% de carinho em alta velocidade! 📦💜",
        "O coração Magáfico bate mais forte por você! 💓",
        "Você é simplesmente maravilhosa, nunca se esqueça disso! 💜"
      ];

      sealBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // 1. Toca som do selo magaficseal.mp3
        try {
          const audio = new Audio('images/magaficseal.mp3');
          audio.currentTime = 0;
          audio.play().catch(err => console.log('Audio play blocked:', err));
        } catch (err) {}

        // 2. Animação de dança do coraçãozinho
        if (sealImg) {
          sealImg.classList.remove('magafic-dance');
          void sealImg.offsetWidth;
          sealImg.classList.add('magafic-dance');
        }

        // 3. Escolhe frase aleatória
        const phrase = magaficPhrases[Math.floor(Math.random() * magaficPhrases.length)];
        dialogText.textContent = `"${phrase}"`;

        // 4. Exibe balão de diálogo animado
        speechDialog.style.display = 'block';
        speechDialog.classList.remove('dialog-pop');
        void speechDialog.offsetWidth;
        speechDialog.classList.add('dialog-pop');

        // Fecha automaticamente após 7 segundos
        if (this._magaficTimeout) clearTimeout(this._magaficTimeout);
        this._magaficTimeout = setTimeout(() => {
          if (speechDialog) speechDialog.style.display = 'none';
        }, 7000);
      });

      if (btnCloseDialog) {
        btnCloseDialog.addEventListener('click', (e) => {
          e.stopPropagation();
          speechDialog.style.display = 'none';
          if (this._magaficTimeout) clearTimeout(this._magaficTimeout);
        });
      }
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

  triggerMagafusLoginGreeting(user) {
    if (!user) return;
    if (this._magafusGreetingDone) return;
    this._magafusGreetingDone = true;

    // Se o usuário desativou a saudação nas configurações:
    if (localStorage.getItem('eex_magafus_greeting_disabled') === 'true') {
      return;
    }

    const overlay = document.getElementById('magaficLoginGreeting');
    const msgEl = document.getElementById('magaficGreetingText');
    const titleEl = document.getElementById('magaficGreetingTitle');
    const imgEl = document.getElementById('magaficGreetingImg');
    if (!overlay) return;

    const isVIP = this.isMagafusVIP(user);
    const isKotun = (user.nickname === 'kotundashed' || (user.eexEmail && user.eexEmail.includes('kotundashed')));

    if (isVIP) {
      if (titleEl) titleEl.textContent = '💜 Coração Magáfico';
      if (imgEl) imgEl.src = 'images/magaficseal.png';
      if (msgEl) {
        if (isKotun) {
          msgEl.textContent = 'Oi, João! Que bom te ver por aqui hoje! 💜✨';
        } else {
          msgEl.textContent = 'Oi, Magafus! Que bom te ver por aqui hoje! 💜✨';
        }
      }

      // Toca som do selo magáfico
      try {
        const audio = new Audio('images/magaficseal.mp3');
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch (err) {}
    } else {
      // Saudação da Providente para usuários comuns!
      const hora = new Date().getHours();
      let momento = 'Bom dia';
      if (hora >= 12 && hora < 18) momento = 'Boa tarde';
      else if (hora >= 18 || hora < 5) momento = 'Boa noite';

      const userName = user.name || user.nickname || 'Agente';
      if (titleEl) titleEl.textContent = '👑 C.E.O. Providente';
      if (imgEl) imgEl.src = 'images/happy_provident.png';
      if (msgEl) {
        msgEl.textContent = `${momento}, ${userName}!`;
      }

      // Toca som crostnotification
      try {
        const audio = new Audio('crostnotification-sound.mp3');
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch (err) {}
    }

    // Animação de dança
    if (imgEl) {
      imgEl.classList.remove('magafic-dance');
      void imgEl.offsetWidth;
      imgEl.classList.add('magafic-dance');
    }

    // Mostra overlay
    overlay.classList.add('active');

    // Desaparece após 5.5 segundos automaticamente
    if (this._greetingTimer) clearTimeout(this._greetingTimer);
    this._greetingTimer = setTimeout(() => {
      overlay.classList.remove('active');
    }, 5500);

    const btnClose = document.getElementById('btnCloseMagaficGreeting');
    if (btnClose) {
      btnClose.onclick = () => {
        overlay.classList.remove('active');
        if (this._greetingTimer) clearTimeout(this._greetingTimer);
      };
    }
  },

  updateWorkModeUI(isActive) {
    const isWorkActive = !!isActive;
    // 1. Atualiza selects de tarefas e hábitos
    document.querySelectorAll('.opt-work-mode').forEach(opt => {
      opt.style.display = isWorkActive ? '' : 'none';
    });

    // 2. Botão de filtro de tarefas
    const filterBtn = document.getElementById('filterBtnTrabalho');
    if (filterBtn) {
      filterBtn.style.display = isWorkActive ? 'inline-flex' : 'none';
      if (!isWorkActive && this.currentFilter === 'trabalho') {
        this.currentFilter = 'todas';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="todas"]')?.classList.add('active');
        this.renderTasks();
      }
    }

    // 3. Status nas Configurações
    const statusEl = document.getElementById('cfgWorkModeStatus');
    const toggleBtn = document.getElementById('btnToggleSettingsWorkMode');
    if (statusEl && toggleBtn) {
      if (isWorkActive) {
        statusEl.textContent = 'Ativado';
        statusEl.style.color = '#16a34a';
        toggleBtn.textContent = 'Desativar';
        toggleBtn.classList.add('btn-secondary');
      } else {
        statusEl.textContent = 'Desativado';
        statusEl.style.color = '#6b7280';
        toggleBtn.textContent = 'Ativar';
        toggleBtn.classList.remove('btn-secondary');
      }
    }
  },

  checkCeoWorkPrompt(user) {
    if (!user || !user.onboardingDone) return;
    if (user.workModePrompted === true) return;
    const modal = document.getElementById('modalCeoWorkPrompt');
    if (modal) {
      modal.classList.add('active');
    }
  },

  _toastQueue: [],
  _toastTimer: null,
  _toastActive: false,

  showToast(message) {
    if (!message) return;
    this._toastQueue.push(message);
    if (!this._toastActive) {
      this._processToastQueue();
    }
  },

  _processToastQueue() {
    if (this._toastQueue.length === 0) {
      this._toastActive = false;
      return;
    }
    this._toastActive = true;
    const msg = this._toastQueue.shift();

    let toast = document.getElementById('eexToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'eexToast';
      toast.className = 'eex-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = msg;
    toast.classList.add('show');

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        this._processToastQueue();
      }, 300);
    }, 2800);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AppUI.init();
});
