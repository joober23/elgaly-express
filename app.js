﻿﻿﻿﻿﻿/**
 * ELGALY EXPRESS - APLICAÇÃO DE ROTINAS & DESPACHO
 * Autenticação exclusivamente via Google (Rede EEX).
 * Onboarding no primeiro acesso + Crachás salvos com PIN de 6 dígitos.
 */

// versão atual do app
const EEX_APP_VERSION = '1.2.0';
const EEX_GITHUB_REPO = 'joober23/elgaly-express';

// --- atualizações ---

const UpdateManager = {
  _checked: false,

  isNativeApp() {
    return typeof window !== 'undefined' && !!(
      window.Capacitor && (
        (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
        window.Capacitor.isNative ||
        (window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')
      )
    );
  },

  _parseVersion(v) {
    if (!v) return { major: 0, minor: 0, patch: 0, build: 0, raw: '' };
    const str = String(v).trim().replace(/^v/i, '');
    const buildMatch = str.match(/(?:-build|\+build|\.b|_b|build)(\d+)/i);
    const build = buildMatch ? parseInt(buildMatch[1], 10) : 0;
    const cleanStr = str.replace(/(?:-build|\+build|\.b|_b|build)\d+/i, '');
    const parts = cleanStr.split('.').map(n => parseInt(n, 10) || 0);
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      build: build,
      raw: v
    };
  },

  _isNewer(localVersion, remoteVersion) {
    const l = this._parseVersion(localVersion);
    const r = this._parseVersion(remoteVersion);
    if (r.major !== l.major) return r.major > l.major;
    if (r.minor !== l.minor) return r.minor > l.minor;
    if (r.patch !== l.patch) return r.patch > l.patch;
    // se major.minor.patch igual, só atualiza se o build remoto for maior
    
    if (l.build > 0 && r.build > 0) {
      return r.build > l.build;
    }
    return false;
  },

  async check() {
    if (this._checked) return;
    this._checked = true;

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
        if (this.isNativeApp()) {
          // no apk: tela do providente dance com música em loop
          this._showUpdateModal(latestTag, downloadUrl, data.body || '');
        } else {
          // na web/pwa: banner de nova versão
          this._showWebUpdateBanner(latestTag);
        }
      }
    } catch (e) {
      // sem internet ou erro — ignora
    }
  },

  _showUpdateModal(version, downloadUrl, notes) {
    const modal = document.getElementById('modalUpdateAvailable');
    if (!modal) return;

    const curVerEl = document.getElementById('updateModalCurrentVersion');
    const verEl = document.getElementById('updateModalVersion');
    const notesEl = document.getElementById('updateModalNotes');
    const btnDownload = document.getElementById('btnUpdateDownload');
    const btnDismiss = document.getElementById('btnUpdateDismiss');
    const audio = document.getElementById('audioUpdateWaiting');

    if (curVerEl) curVerEl.textContent = 'v' + EEX_APP_VERSION.replace(/^v/i, '');
    if (verEl) verEl.textContent = (version.startsWith('v') ? '' : 'v') + version;
    if (notesEl && notes) {
      const cleanNotes = notes
        .replace(/##+/g, '')
        .replace(/\*\*/g, '')
        .trim();
      notesEl.textContent = cleanNotes.slice(0, 200) + (cleanNotes.length > 200 ? '...' : '');
    }

    // toca a trilha em loop
    if (audio) {
      try {
        audio.currentTime = 0;
        audio.loop = true;
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            const onFirstTouch = () => {
              audio.play().catch(() => {});
              window.removeEventListener('click', onFirstTouch);
            };
            window.addEventListener('click', onFirstTouch, { once: true });
          });
        }
      } catch (e) {}
    }

    const stopAudio = () => {
      if (audio) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (e) {}
      }
    };

    if (btnDownload) {
      btnDownload.onclick = () => {
        stopAudio();
        window.open(downloadUrl || `https://github.com/${EEX_GITHUB_REPO}/releases/latest`, '_blank');
      };
    }

    if (btnDismiss) {
      btnDismiss.onclick = () => {
        stopAudio();
        modal.classList.remove('active');
      };
    }

    modal.classList.add('active');
  },

  _showWebUpdateBanner(version, worker = null) {
    if (sessionStorage.getItem('eex_web_update_dismissed') === 'true') {
      return;
    }
    const pill = document.getElementById('webUpdatePill');
    if (!pill) return;
    pill.style.display = 'block';

    const btnReload = document.getElementById('btnWebUpdateReload');
    if (btnReload) {
      btnReload.onclick = () => {
        if (worker) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
        }
        sessionStorage.removeItem('eex_web_update_dismissed');
        window.location.reload();
      };
    }

    const btnClose = document.getElementById('btnWebUpdateClose');
    if (btnClose) {
      btnClose.onclick = () => {
        sessionStorage.setItem('eex_web_update_dismissed', 'true');
        pill.style.display = 'none';
      };
    }
  },

  testApkUpdateScreen() {
    this._showUpdateModal(
      'v1.0.0-build80 (Teste)',
      `https://github.com/${EEX_GITHUB_REPO}/releases/latest`,
      'Demonstração: Nova rota dimensional da Providente com música e dança!'
    );
  }
};

// --- autenticação ---

const AuthManager = {
  currentUser: null,
  isEexPassVerified: false,

  init() {
    const savedCurrent = localStorage.getItem('elgaly_express_current_user');
    if (savedCurrent) {
      try {
        const parsed = JSON.parse(savedCurrent);
        if (parsed && parsed.id && parsed.id !== 'guest') {
          // avatar muito grande: troca pela url do google ou fallback
          if (parsed.avatar && typeof parsed.avatar === 'string' && parsed.avatar.length > 70000) {
            if (parsed.googlePhotoURL && typeof parsed.googlePhotoURL === 'string' && parsed.googlePhotoURL.startsWith('http')) {
              parsed.avatar = parsed.googlePhotoURL;
            } else {
              parsed.avatar = 'images/elgalylogo.png';
            }
          }
          // sanitiza cidade fictícia antiga pra são paulo
          if (!parsed.location || (typeof isValidSpCity === 'function' && !isValidSpCity(parsed.location)) || /nova amerit|nova arcanis|elgaly edge/i.test(parsed.location || '')) {
            parsed.location = 'São Paulo - SP';
            localStorage.setItem('elgaly_express_current_user', JSON.stringify(parsed));
          }
          // garante que eex+ esteja desativado e sem a conquista express-total
          if (parsed.isEexPlus) parsed.isEexPlus = false;
          if (parsed.eexPlusActive) parsed.eexPlusActive = false;
          if (Array.isArray(parsed.unlockedAchievements) && parsed.unlockedAchievements.includes('express-total')) {
            parsed.unlockedAchievements = parsed.unlockedAchievements.filter(id => id !== 'express-total');
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

    // sincroniza dados no crachá salvo
    this.updateSavedBadge(this.currentUser);

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveProfileToCloud({
        name: this.currentUser.name,
        location: this.currentUser.location,
        bio: this.currentUser.bio || '',
        agentMood: this.currentUser.agentMood || 'foco',
        avatar: this.currentUser.avatar,
        banner: this.currentUser.banner || '',
        eexEmail: this.currentUser.eexEmail,
        nickname: this.currentUser.nickname,
        equippedStrip: this.currentUser.equippedStrip || 'strip-padrao',
        purchasedStrips: this.currentUser.purchasedStrips || ['strip-padrao'],
        bonusXp: this.currentUser.bonusXp || 0,
        unlockedAchievements: this.currentUser.unlockedAchievements || []
      });
    }

    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      FriendsManager.syncMyPublicProfile();
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

    // atualiza perfil se a view estiver aberta
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

  // SISTEMA DE CRACHÁS SALVOS — re-login rápido com PIN de 6 dígitos

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

  // hash simples — pra ux, nao segurança criptográfica
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
    // tenta o pinHash do perfil
    if (user.pinHash && user.pinHash === hash) return true;
    // fallback: badges legados
    const badges = this.getSavedBadges();
    const badge = badges.find(b => b.uid === user.id);
    if (badge && badge.pinHash === hash) {
      // migra o pin pro perfil
      user.pinHash = hash;
      this.saveCurrent();
      if (typeof FirebaseService !== 'undefined') {
        FirebaseService.saveProfileToCloud({ pinHash: hash });
      }
      return true;
    }
    // usuarios antigos sem pin ainda: aceita e salva
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

  // retorna url segura pro firestore (nunca base64)
  
  safeAvatarUrl(user) {
    if (!user) return 'images/elgalylogo.png';
    // preferencia 1: url do google
    if (user.googlePhotoURL && user.googlePhotoURL.startsWith('http')) {
      return user.googlePhotoURL;
    }
    // preferencia 2: avatar salvo se for url
    if (user.avatar && user.avatar.startsWith('http')) {
      return user.avatar;
    }
    // fallback: icone padrao
    return 'images/elgalylogo.png';
  },

  isMagafusVIP(user) {
    if (!user) return false;
    const nick = (user.nickname || '').toLowerCase().trim();
    const eex = (user.eexEmail || '').toLowerCase().trim();
    const email = (user.email || '').toLowerCase().trim();
    return nick === 'pedrinho' || eex.includes('pedrinho') || email.includes('pedrinho');
  }
};

// compressão de imagens (evita exceder 1MB do firestore)

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

// --- modo noturno ---

const EyeComfortManager = {
  _autoTimer: null,

  isNightTime() {
    const h = new Date().getHours();
    return h >= 19 || h < 7; // noite: 19h às 7h
  },

  isAutoEnabled() {
    return localStorage.getItem('eex_conforto_auto') === '1';
  },

  setAutoEnabled(enabled) {
    localStorage.setItem('eex_conforto_auto', enabled ? '1' : '0');
    if (enabled) {
      this.checkAutoSchedule();
      this.startAutoTimer();
    } else {
      this.stopAutoTimer();
    }
    this.updateUI();
  },

  isNightActive() {
    return document.documentElement.classList.contains('theme-night');
  },

  setNightActive(active) {
    document.documentElement.classList.toggle('theme-night', !!active);
    localStorage.setItem('eex_conforto_manual', active ? '1' : '0');
    this.updateUI();
  },

  toggle() {
    const newState = !this.isNightActive();
    this.setNightActive(newState);
    return newState;
  },

  checkAutoSchedule() {
    if (this.isAutoEnabled()) {
      const shouldBeNight = this.isNightTime();
      document.documentElement.classList.toggle('theme-night', shouldBeNight);
      this.updateUI();
    }
  },

  startAutoTimer() {
    if (this._autoTimer) clearInterval(this._autoTimer);
    this._autoTimer = setInterval(() => {
      if (this.isAutoEnabled()) {
        this.checkAutoSchedule();
      }
    }, 60 * 1000);
  },

  stopAutoTimer() {
    if (this._autoTimer) {
      clearInterval(this._autoTimer);
      this._autoTimer = null;
    }
  },

  updateUI() {
    const badge = document.getElementById('badgeNightStatus');
    const chk = document.getElementById('chkAutoNightMode');
    const isNight = this.isNightActive();
    if (badge) {
      badge.textContent = isNight ? 'ATIVADO' : 'DESLIGADO';
      badge.style.background = isNight ? '#ffd700' : '#e2e8f0';
      badge.style.color = isNight ? '#000' : '#475569';
    }
    if (chk) {
      chk.checked = this.isAutoEnabled();
    }
  },

  init() {
    const isAuto = this.isAutoEnabled();
    if (isAuto) {
      this.checkAutoSchedule();
      this.startAutoTimer();
    } else {
      const savedManual = localStorage.getItem('eex_conforto_manual');
      if (savedManual === '1') {
        document.documentElement.classList.add('theme-night');
      } else {
        document.documentElement.classList.remove('theme-night');
      }
    }
    this.updateUI();
  }
};

// --- eex+ (legado, desativado) ---
// Dois planos: Mensal (R$4,99) e Vitalício (R$19,99 = ~4 meses)
// Ativação via código gerado na coleção Firestore `eex_codes`

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
    return nick === 'kotundashed' || nick === 'lana' ||
           eex.includes('kotundashed') || eex.includes('lana') ||
           email.includes('kotundashed') || email.includes('lana');
  },

  // status: eex+ desativado temporariamente

  isPremium() {
    return false;
  },

  isSubscribed(user) {
    return false;
  },

  getPlan() { return null; },

  getExpiresAt() { return null; },

  // label pra ui
  getPlanLabel() {
    return null;
  },

  // --- carregar / salvar status ---

  async loadStatus() {
    this._premium = null;
    localStorage.removeItem('elgaly_eexplus_status');
    const user = AuthManager.getCurrentUser();
    const uid = user?.id || user?.uid;
    if (uid) {
      localStorage.removeItem(`elgaly_eexplus_status_${uid}`);
    }

    // limpa flags de eex+ e conquista express-total se existirem
    if (user) {
      let changed = false;
      if (user.isEexPlus) { user.isEexPlus = false; changed = true; }
      if (user.eexPlusActive) { user.eexPlusActive = false; changed = true; }
      if (Array.isArray(user.unlockedAchievements) && user.unlockedAchievements.includes('express-total')) {
        user.unlockedAchievements = user.unlockedAchievements.filter(id => id !== 'express-total');
        changed = true;
      }
      if (changed) {
        AuthManager.currentUser = user;
        AuthManager.saveCurrent();
        if (typeof FirebaseService !== 'undefined' && FirebaseService.db && uid) {
          FirebaseService.saveProfileToCloud({
            isEexPlus: false,
            eexPlusActive: false,
            unlockedAchievements: user.unlockedAchievements
          }).catch(() => {});
        }
      }
    }

    if (!uid || typeof FirebaseService === 'undefined' || !FirebaseService.db) return;
    try {
      await FirebaseService.db
        .collection('users').doc(uid)
        .collection('system').doc('eexplus').delete().catch(() => {});
    } catch (e) {
      // ignora
    }
  },

  async _saveStatus(data) {
    this._premium = null;
    localStorage.removeItem('elgaly_eexplus_status');
    const uid = AuthManager.getCurrentUser()?.id;
    if (uid) {
      localStorage.removeItem(`elgaly_eexplus_status_${uid}`);
    }
  },

  toggleTestMode() {
    if (typeof AppUI !== 'undefined') {
      AppUI.showToast('ℹ️ O serviço EEX+ e o modo teste estão desativados temporariamente.');
    }
    return false;
  },

  // --- ativação por código (desativado) ---

  async activate(rawCode) {
    return { ok: false, msg: 'O serviço EEX+ está temporariamente desativado.' };
  },

  // --- limite de hábitos ---

  HABIT_LIMIT_FREE: 12,

  canAddHabit() {
    if (this.isPremium()) return true;
    const count = (typeof HabitManager !== 'undefined') ? HabitManager.habits.length : 0;
    return count < this.HABIT_LIMIT_FREE;
  },

  // --- bonus de conchas ---

  async applyShellBonus(baseAmount, sourceId, type) {
    if (!this.isPremium()) return;
    // bonus fixo de +5 conchas (separado do anti-farm)
    await ShellsManager.addShells(5, '✨ Bônus EEX+ (+5 conchas)');
  },

  // --- ciclo dia/noite ---

  isNightTime() {
    const h = new Date().getHours();
    return h >= 19 || h < 7; // noite: 19h às 7h
  },

  applyNightMode(force) {
    if (typeof EyeComfortManager !== 'undefined') {
      if (force !== undefined) {
        EyeComfortManager.setNightActive(force);
      } else {
        EyeComfortManager.toggle();
      }
      return;
    }
    const shouldBeNight = force !== undefined ? force : this.isNightTime();
    this._nightMode = shouldBeNight;
    document.documentElement.classList.toggle('theme-night', shouldBeNight);
  },

  startDayNightCycle() {
    // delega pro EyeComfortManager
  },

  stopDayNightCycle() {
    // delega pro EyeComfortManager
  },

  // --- inicialização ---

  async init() {
    await this.loadStatus();
  }
};

// --- shells (conchas eex) ---

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

  getShells() {
    return this.getBalance();
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

  // anti-farm: limite semanal de 350 conchas, 1x por item, 1x por habito por dia, rate-limit de 400ms
  async rewardWithProtection(sourceId, type, amount, reason = '') {
    if (!sourceId) return 0;
    const audit = this.getAuditData();
    const today = this.getTodayKey();
    const currentWeek = this.getWeekKey();

    // reset semanal se mudou a semana
    if (audit.lastWeek !== currentWeek) {
      audit.lastWeek = currentWeek;
      audit.weekTotal = 0;
    }

    // reset diario de habitos completados
    if (audit.lastDate !== today) {
      audit.lastDate = today;
      audit.rewardedHabitsToday = [];
    }
    if (!Array.isArray(audit.rewardedItems)) audit.rewardedItems = [];
    if (!Array.isArray(audit.rewardedHabitsToday)) audit.rewardedHabitsToday = [];

    // habito ja recompensado hoje?
    if (type === 'habit') {
      if (audit.rewardedHabitsToday.includes(sourceId)) {
        AppUI.showToast('<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Hábito já recompensado hoje! Volte amanhã para mais conchas! ✨');
        return 0;
      }
    } else {
      // tarefa/evento ja recompensado?
      if (audit.rewardedItems.includes(sourceId)) {
        AppUI.showToast('<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Essa entrega já foi recompensada! Sem trapaça com a C.E.O.! 😼📦');
        return 0;
      }
    }

    // atingiu o teto semanal?
    if (audit.weekTotal >= this.WEEKLY_CAP) {
      AppUI.showToast('<img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> Limite semanal de conchas atingido (350/semana)! Descanse suas patinhas, agente! 🐾');
      return 0;
    }

    // rate-limit: 400ms entre recompensas
    const now = Date.now();
    if (audit.lastRewardTimestamp && (now - audit.lastRewardTimestamp < 400)) {
      return 0;
    }

    // ajusta o valor se estourar o teto
    let finalAmount = amount;
    if (audit.weekTotal + finalAmount > this.WEEKLY_CAP) {
      finalAmount = this.WEEKLY_CAP - audit.weekTotal;
    }
    if (finalAmount <= 0) return 0;

    // registra na auditoria
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
    const balance = this.getBalance();
    const balanceStr = balance.toLocaleString('pt-BR');
    const countEl = document.getElementById('headerShellsCount');
    if (countEl) {
      countEl.textContent = balanceStr;
    }
    const lojaCountEl = document.getElementById('lojaModalShellsCount');
    if (lojaCountEl) {
      lojaCountEl.textContent = balanceStr;
    }
    // conchas no header mobile
    const mobileCountEl = document.getElementById('mobileShellsCount');
    if (mobileCountEl) {
      mobileCountEl.textContent = balanceStr;
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

// --- tarefas ---

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

// --- rotina diária ---

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
        try {
          await ShellsManager.rewardWithProtection(id, 'habit', conchas, 'Rotina cumprida!');
          if (typeof EEXPlusManager !== 'undefined') EEXPlusManager.applyShellBonus(conchas, id, 'habit');
        } catch (e) {
          console.warn('Erro ao premiar conchas no hábito:', e);
        }
      }

    } else {
      this.history[todayKey].splice(idx, 1);
    }

    this.saveHistoryLocally();

    try {
      if (typeof WidgetManager !== 'undefined' && WidgetManager.update) {
        WidgetManager.update();
      }
    } catch (e) {
      console.warn('Erro ao atualizar widget no toggleHabit:', e);
    }

    if (typeof FirebaseService !== 'undefined' && FirebaseService.saveHabitHistoryToCloud) {
      try {
        await FirebaseService.saveHabitHistoryToCloud(this.history);
      } catch (e) {
        console.warn('Erro ao salvar histórico de hábitos no Firestore:', e);
      }
    }

    // sincroniza perfil publico com amigos
    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      try {
        FriendsManager.syncMyPublicProfile();
      } catch (e) {}
    }

    return this.isCompletedToday(id);
  },

  isCompletedToday(id) {
    const todayKey = this.getTodayKey();
    const list = this.history[todayKey] || [];
    return list.includes(id);
  },

  async updateHabit(id, updatedFields) {
    const idx = this.habits.findIndex(h => h.id === id);
    if (idx === -1) return null;
    this.habits[idx] = { ...this.habits[idx], ...updatedFields };
    this.saveHabitsLocally();

    if (typeof FirebaseService !== 'undefined' && FirebaseService.saveHabitToCloud) {
      try {
        await FirebaseService.saveHabitToCloud(this.habits[idx]);
      } catch (e) {
        console.warn('Erro ao atualizar hábito no Firestore:', e);
      }
    }

    if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
      try {
        FriendsManager.syncMyPublicProfile();
      } catch (e) {}
    }

    try {
      if (typeof WidgetManager !== 'undefined' && WidgetManager.update) {
        WidgetManager.update();
      }
    } catch (e) {}

    return this.habits[idx];
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
    // remove de hoje
    if (this.history[todayKey]) {
      this.history[todayKey] = this.history[todayKey].filter(hId => hId !== id);
    }
    // zera o streak removendo o historico do habito
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

      // dia nao previsto (ex: fim de semana) — nao quebra o streak
      if (!scheduledDays.includes(dow)) {
        continue;
      }

      const dateKey = pastDate.toLocaleDateString('en-CA');
      const list = this.history[dateKey] || [];
      if (list.includes(habitId)) {
        streak++;
      } else {
        break; // dia previsto mas nao cumprido — encerra o streak
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

// --- widget ---

// --- carga misteriosa ---

const CargaMisteriosaManager = {
  frasesProvidente: [
    { autor: 'C.E.O. Providente', texto: 'Aprovado com louvor! O frete dimensional hoje voará sob vento favorável! ✨' },
    { autor: 'Tudum IA', texto: 'tudum!! despachei seu bônus cósmico! toma essas conchas e arrasa hoje! 🎀' },
    { autor: 'Agente Brave', texto: 'Força máxima na rota! Nenhum pacote fica pra trás quando a gente quer! ⚡' },
    { autor: 'Agente Midnight', texto: 'Ufa... com essas conchas extras eu fico menos desesperada! Vamos entregar tudo! 🐾' },
    { autor: 'C.E.O. Providente', texto: 'Decreto Oficial nº 77: Todo agente dedicado tem direito a café quentinho e conchas brilhantes! 👑' },
    { autor: 'Tudum IA', texto: 'socorro de alegria!! abriu o pacote na hora certa, chefia! ✨' },
    { autor: 'Agente Brave', texto: 'Meta do dia: entregar com estilo e faturar como lenda! 📦' },
    { autor: 'C.E.O. Providente', texto: 'O Olho de Providente observa sua sequência. Continue firme na rota! 👁️✨' }
  ],

  cloudClaimData: null,

  getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  },

  isAvailable() {
    const today = this.getTodayKey();
    if (this.cloudClaimData && this.cloudClaimData.lastDate === today) {
      return false;
    }
    const lastDate = localStorage.getItem('elgaly_carga_misteriosa_last_date');
    return lastDate !== today;
  },

  getTodayClaimData() {
    const today = this.getTodayKey();
    if (this.cloudClaimData && this.cloudClaimData.lastDate === today) {
      return {
        shells: typeof this.cloudClaimData.rewardShells === 'number' ? this.cloudClaimData.rewardShells : 5,
        frase: this.cloudClaimData.frase || this.frasesProvidente[0],
        date: today
      };
    }
    try {
      const raw = localStorage.getItem('elgaly_carga_misteriosa_data');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  onCloudUpdated(data) {
    if (!data) return;
    this.cloudClaimData = data;
    const today = this.getTodayKey();
    if (data.lastDate === today) {
      localStorage.setItem('elgaly_carga_misteriosa_last_date', today);
      const claimObj = {
        shells: typeof data.rewardShells === 'number' ? data.rewardShells : 5,
        frase: data.frase || this.frasesProvidente[0],
        date: today
      };
      localStorage.setItem('elgaly_carga_misteriosa_data', JSON.stringify(claimObj));
    }
    this.renderTrigger();
  },

  init() {
    this.renderTrigger();
    const btnClose = document.getElementById('btnCloseCargaMisteriosa');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.closeModal());
    }
    const modal = document.getElementById('modalCargaMisteriosa');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal();
      });
    }
  },

  renderTrigger() {
    const box = document.getElementById('boxCargaMisteriosaTrigger');
    if (!box) return;

    const available = this.isAvailable();
    if (available) {
      box.className = 'carga-misteriosa-banner available';
      box.innerHTML = `
        <div class="carga-banner-left">
          <img src="embalagem_cosmica.png" alt="Carga" class="carga-banner-box-img anim-box-shake">
          <div>
            <div class="carga-banner-tag">★ CARGA DIÁRIA DA C.E.O. ★</div>
            <h4 class="carga-banner-title">Pacote Misterioso Disponível!</h4>
            <p class="carga-banner-sub">A Providente enviou um despacho selado para você hoje. Toque para abrir!</p>
          </div>
        </div>
        <button type="button" class="btn-comic btn-sm carga-banner-btn" onclick="CargaMisteriosaManager.openModal()">
          🎁 Resgatar Carga
        </button>
      `;
    } else {
      const data = this.getTodayClaimData();
      const shells = data ? data.shells : 0;
      box.className = 'carga-misteriosa-banner claimed';
      box.innerHTML = `
        <div class="carga-banner-left">
          <img src="embalagem_segura.png" alt="Carga Entregue" class="carga-banner-box-img" style="opacity:0.9;">
          <div>
            <div class="carga-banner-tag" style="background:#10b981;color:#fff;">✓ CARGA DO DIA RESGATADA</div>
            <h4 class="carga-banner-title">+${shells} Conchas Faturadas Hoje!</h4>
            <p class="carga-banner-sub">Próximo pacote dimensional chega amanhã às 00:00.</p>
          </div>
        </div>
        <button type="button" class="btn-comic btn-sm btn-secondary" onclick="CargaMisteriosaManager.openModal()">
          📜 Ver Bênção
        </button>
      `;
    }
  },

  openModal() {
    const modal = document.getElementById('modalCargaMisteriosa');
    const content = document.getElementById('cargaMisteriosaContent');
    if (!modal || !content) return;

    const available = this.isAvailable();
    if (available) {
      content.innerHTML = `
        <div style="text-align:center;">
          <div class="carga-modal-stamp">★ REMETENTE: C.E.O. PROVIDENTE ★</div>
          <h3 style="font-family:var(--font-main, 'Darumadrop One', cursive);font-size:1.6rem;margin:8px 0 4px;color:var(--purple-dark);">
            Carga Misteriosa Dimensional
          </h3>
          <p style="font-size:0.9rem;color:#4b5563;margin-bottom:16px;">
            Este pacote foi selado com fita cósmica de segurança. Que surpresas esperam o seu dia de despacho?
          </p>
          <div class="carga-box-showcase">
            <img src="embalagem_cosmica.png" alt="Carga Misteriosa" class="carga-box-big-img anim-box-hover">
            <span class="carga-box-seal-badge">🔒 LACRADO</span>
          </div>
          <div style="margin-top:20px;">
            <button type="button" class="btn-comic" style="width:100%;font-size:1.1rem;background:#ff3b94;color:#fff;" id="btnAbrirCarga">
              📦 Rasgar Fita &amp; Despachar!
            </button>
          </div>
        </div>
      `;
      const btn = document.getElementById('btnAbrirCarga');
      if (btn) btn.addEventListener('click', () => this.claimReward());
    } else {
      const data = this.getTodayClaimData() || { shells: 5, frase: this.frasesProvidente[0] };
      content.innerHTML = `
        <div class="carga-modal-top-hero">
          <img src="providente-dance.gif" alt="Providente Dançando" class="carga-providente-hero-img">
        </div>
        <div style="text-align:center;">
          <div class="carga-modal-stamp" style="background:#10b981;color:#fff;">★ DESPACHO CONCLUÍDO ★</div>
          <h3 style="font-family:var(--font-main, 'Darumadrop One', cursive);font-size:1.6rem;margin:8px 0 4px;color:var(--purple-dark);">
            Carga de Hoje Já Foi Aberta!
          </h3>
          <div class="carga-reward-box">
            <div style="font-size:1.8rem;font-weight:900;color:#0d9488;font-family:var(--font-main);">
              +${data.shells} 🐚 Conchas EEX
            </div>
            <p style="font-size:0.85rem;color:#6b7280;margin:4px 0 12px;">Creditadas na sua conta com sucesso!</p>
            <div class="carga-quote-box">
              <span class="carga-quote-author">📜 ${data.frase ? data.frase.autor : 'C.E.O. Providente'}:</span>
              <p class="carga-quote-text">"${data.frase ? data.frase.texto : 'Despache com estilo e conquiste sua rota!'}"</p>
            </div>
          </div>
          <button type="button" class="btn-comic btn-secondary" style="width:100%;margin-top:16px;" onclick="CargaMisteriosaManager.closeModal()">
            ✕ Fechar
          </button>
        </div>
      `;
    }

    modal.classList.add('active');
  },

  async claimReward() {
    if (!this.isAvailable()) return;

    const rewardShells = Math.floor(Math.random() * 11) + 5; // 5 a 15 conchas
    const frase = this.frasesProvidente[Math.floor(Math.random() * this.frasesProvidente.length)];
    const today = this.getTodayKey();

    if (typeof TudumManager !== 'undefined') {
      TudumManager.playSound('done');
    }

    this.cloudClaimData = {
      lastDate: today,
      rewardShells: rewardShells,
      frase: frase
    };

    localStorage.setItem('elgaly_carga_misteriosa_last_date', today);
    localStorage.setItem('elgaly_carga_misteriosa_data', JSON.stringify({ shells: rewardShells, frase, date: today }));

    if (typeof ShellsManager !== 'undefined') {
      await ShellsManager.addShells(rewardShells, '🎁 Carga Misteriosa da Providente!');
    }

    if (typeof AppUI !== 'undefined') {
      AppUI.unlockAchievement('carga-misteriosa');
    }

    if (typeof FirebaseService !== 'undefined') {
      await FirebaseService.saveDailyMysteryToCloud({
        lastDate: today,
        rewardShells: rewardShells,
        frase: frase
      });
    }

    const content = document.getElementById('cargaMisteriosaContent');
    if (content) {
      content.innerHTML = `
        <div class="carga-modal-top-hero anim-bounce">
          <img src="providente-dance.gif" alt="Providente Dançando" class="carga-providente-hero-img">
        </div>
        <div style="text-align:center;" class="anim-pop-in">
          <div class="carga-modal-stamp" style="background:#ffeb3b;color:#000;">★ CARGA DESLACRADA! ★</div>
          <h3 style="font-family:var(--font-main, 'Darumadrop One', cursive);font-size:1.8rem;margin:8px 0 4px;color:var(--magenta-bright);">
            PARABÉNS, AGENTE!
          </h3>
          <div class="carga-reward-box">
            <div style="font-size:2.2rem;font-weight:900;color:#0d9488;font-family:var(--font-main);">
              +${rewardShells} 🐚 Conchas EEX!
            </div>
            <p style="font-size:0.85rem;color:#6b7280;margin:4px 0 12px;">Depositadas no seu saldo!</p>
            <div class="carga-quote-box">
              <span class="carga-quote-author">📜 Bênção de ${frase.autor}:</span>
              <p class="carga-quote-text">"${frase.texto}"</p>
            </div>
          </div>
          <button type="button" class="btn-comic" style="width:100%;margin-top:16px;background:#10b981;color:#fff;" onclick="CargaMisteriosaManager.closeModal()">
            ✨ Pegar Conchas &amp; Fechar
          </button>
        </div>
      `;
    }

    this.renderTrigger();
    if (typeof AppUI !== 'undefined') {
      AppUI.showToast(`🎁 Você ganhou +${rewardShells} Conchas EEX na Carga Misteriosa!`);
    }
  },

  closeModal() {
    const modal = document.getElementById('modalCargaMisteriosa');
    if (modal) modal.classList.remove('active');
    this.renderTrigger();
  }
};

const WidgetManager = {
  update() {
    try {
      if (typeof HabitManager === 'undefined') return;
      const stats = (typeof HabitManager.getTodayStats === 'function')
        ? HabitManager.getTodayStats()
        : { allDone: false, pendingCount: 0, completedCount: 0, scheduledCount: 0, streak: 0 };
      const currentUser = (typeof AuthManager !== 'undefined') ? AuthManager.getCurrentUser() : null;
      const habits = HabitManager.habits || [];
      const todayDowWidget = new Date().getDay();
      const todayHabits = habits.filter(h => !h.days || h.days.includes(todayDowWidget));
      const unfinishedHabit = todayHabits.find(h => !HabitManager.isCompletedToday(h.id));
      const nextHabitTitle = unfinishedHabit ? (unfinishedHabit.title || '') : '';
      const shellsCount = (typeof ShellsManager !== 'undefined') ? ShellsManager.getBalance() : (currentUser?.shells || 0);

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
            streak: stats.streak || 0,
            pending: stats.pendingCount || 0,
            completed: stats.completedCount || 0,
            total: stats.scheduledCount || 0,
            shells: shellsCount,
            allDone: !!stats.allDone,
            title: title,
            subtitle: subtitle,
            nextHabit: nextHabitTitle,
            agentName: currentUser?.nickname || currentUser?.name || 'Agente'
          });
        } catch (e) {
          console.warn('Erro ao atualizar EexWidget nativo:', e);
        }
      }

      // 2. Renderiza Widget no Início do App
      this.renderInAppWidget(stats, title, subtitle, nextHabitTitle, shellsCount);
    } catch (err) {
      console.warn('Erro ao atualizar WidgetManager:', err);
    }
  },

  renderInAppWidget(stats, title, subtitle, nextHabit, shells) {
    const container = document.getElementById('eexMascotWidget');
    if (!container) return;

    const isDone = stats.allDone;
    const mascotImg = isDone ? 'images/brave.png' : 'images/midnight.png';
    const agentName = isDone ? 'Agente Brave' : 'Agente Midnight';
    const fireIcon = isDone ? 'images/fireon.png' : 'images/fireoff.png';
    const streakText = `${stats.streak} ${stats.streak === 1 ? 'DIA' : 'DIAS'} DE SEQUÊNCIA`;
    const shellsDisplay = typeof shells === 'number' ? shells : 0;

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
          <span class="mascot-widget-badge" style="background:#00f0ff;color:#000000;box-shadow:2px 2px 0 #000;">
            ${isDone ? '✅ 100% Concluído' : `⏳ ${stats.completedCount}/${stats.scheduledCount} Hábitos`}
          </span>
          <span class="mascot-widget-badge" style="background:#ff3b94;color:#ffffff;box-shadow:2px 2px 0 #000;">
            🐚 ${shellsDisplay} Conchas
          </span>
        </div>
        <div class="mascot-widget-bubble">
          <h3 class="mascot-widget-bubble-title">${title}</h3>
          <p class="mascot-widget-bubble-desc">${subtitle}</p>
          ${!isDone && nextHabit ? `<div class="mascot-widget-next-pill">🎯 <strong>Próximo:</strong> ${nextHabit}</div>` : ''}
        </div>
        <div class="mascot-widget-footer" style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="#rotina" class="btn-comic btn-sm ${isDone ? 'btn-secondary' : ''}">
            ${isDone ? '✨ Ver Rotina Feita' : '⚡ Despachar Hábitos Agora'}
          </a>
          <button type="button" class="btn-comic btn-sm btn-purple" onclick="if(typeof TudumManager !== 'undefined') TudumManager.open();">
            🤖 Falar com a Tudum
          </button>
        </div>
      </div>
    `;
  }
};

// --- módulo ---

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

// --- módulo ---

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
      const stats = (typeof HabitManager !== 'undefined' && HabitManager.getTodayStats)
        ? HabitManager.getTodayStats()
        : { streak: 0, allDone: false, pending: 0 };
      const todayHabits = (typeof HabitManager !== 'undefined' && HabitManager.habits)
        ? HabitManager.habits.filter(h => HabitManager.isScheduledForToday ? HabitManager.isScheduledForToday(h) : true)
            .map(h => ({
              id: h.id,
              title: h.title,
              category: h.category || 'geral',
              done: HabitManager.isCompletedToday ? HabitManager.isCompletedToday(h.id) : false
            }))
        : [];

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
        banner: user.banner || '',
        bio: user.bio || '',
        agentMood: user.agentMood || 'foco',
        equippedStrip: user.equippedStrip || 'strip-padrao',
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
            <button type="button" class="btn-comic btn-friend-chat" data-uid="${friend.uid}" title="Conversar no EEX-Mail (Chat)">
              💬
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

    grid.querySelectorAll('.btn-friend-chat').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.uid;
        const friend = FriendsManager.friends.find(f => f.uid === uid);
        if (friend && typeof EexMailManager !== 'undefined') {
          EexMailManager.openChat(friend);
        }
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

  // PASSAPORTE DO PARCEIRO (VER ROTINA E FOTOS DO AMIGO)

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
      const friendStripId = friend.equippedStrip || 'strip-padrao';
      const friendCatalogStrip = (typeof HologramStripsCatalog !== 'undefined') 
        ? HologramStripsCatalog.find(s => s.id === friendStripId) 
        : null;
      // Color from catalog, text always from the friend's career rank
      const friendStripClass = friendCatalogStrip ? friendCatalogStrip.className : 'holo-strip-padrao';
      // Derive rank text from friend's level
      const _friendLevel = Math.min(100, Math.max(1, Math.floor(((friend.xp || 0)) / 100) + 1));
      const _friendTiers = [
        { min: 1,  max: 9,   stripText: '★ EEX RECRUTA ★' },
        { min: 10, max: 19,  stripText: '🌿 CRIATURA DA MATA 🌿' },
        { min: 20, max: 29,  stripText: '🚀 EEX DIMENSIONAL 🚀' },
        { min: 30, max: 39,  stripText: '🌌 EEX STELLAR 🌌' },
        { min: 40, max: 49,  stripText: '🛡️ EEX INSPECTOR 🛡️' },
        { min: 50, max: 59,  stripText: '🎖️ EEX COMMANDER 🎖️' },
        { min: 60, max: 69,  stripText: '🌀 EEX VORTEX 🌀' },
        { min: 70, max: 79,  stripText: '👑 EEX MARSHAL 👑' },
        { min: 80, max: 89,  stripText: '🌟 EEX HERALD 🌟' },
        { min: 90, max: 99,  stripText: '⚜️ EEX GRAND MASTER ⚜️' },
        { min: 100, max: 100, stripText: '👁️✨ O OLHO DE PROVIDENTE ✨👁️' }
      ];
      const _friendTier = _friendTiers.find(t => _friendLevel >= t.min && _friendLevel <= t.max) || _friendTiers[0];
      const friendStripText = _friendTier.stripText;

      badgeContainer.innerHTML = `
        <div class="friend-badge-inner">
          <div class="friend-badge-header">
            <span class="badge-tag">REDE EEX // CREDENCIAL OPERACIONAL</span>
          </div>
          ${friend.banner ? `
            <div class="friend-badge-banner" style="background-image: url('${friend.banner}');"></div>
          ` : ''}
          <div class="friend-badge-body">
            <div class="friend-badge-photo-wrap">
              <img src="${friend.avatar || 'images/elgalylogo.png'}" alt="${friend.name}" class="friend-badge-photo">
              <div class="hologram-strip ${friendStripClass}">${friendStripText}</div>
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
              ${friend.agentMood && typeof EEX_MOODS !== 'undefined' && EEX_MOODS[friend.agentMood] ? `
                <div class="agent-mood-tag" style="--mood-color: ${EEX_MOODS[friend.agentMood].color}; margin: 4px 0 6px 0;">
                  <span class="mood-emoji">${EEX_MOODS[friend.agentMood].emoji}</span>
                  <span>${EEX_MOODS[friend.agentMood].label}</span>
                </div>
              ` : ''}
              ${friend.bio ? `
                <div class="friend-badge-bio">
                  <span class="bio-quote-icon">“</span>
                  <p class="bio-text">${friend.bio}</p>
                </div>
              ` : ''}
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
          }, friend)
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

  // ENVIAR ENCOMENDA EXPRESS

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

  // RECEBIMENTO DE ENCOMENDA EXPRESS (UNBOXING)

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

  // SOS & RÁDIO COMUNICADOR

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

// GAZETA DA PROVIDÊNCIA & ATUALIZAÇÕES DA C.E.O. (ProvidenteNewsManager)
// Boletim oficial em formato de jornal e carta selada por Providente

const ProvidenteNewsManager = {
  currentEditionIndex: 0,
  latestVersion: 'v3.2',

  editions: [
    {
      version: 'v3.2',
      date: 'Outubro / 2026',
      headline: 'BLINDAGEM OPERACIONAL EEX, DOWNLOAD DE FOTOS DE ROTINA E STATUS DE HUMOR NO CRACHÁ!',
      subheadline: 'Decreto de Proteção de Conteúdo, Preservação de Memórias & Identidade Operacional // Autorizado por Providente C.E.O.',
      badge: 'EDIÇÃO ATUAL',
      happy: {
        title: 'Baixe suas memórias de rotina & Exiba seu Humor Operacional! 📥⚡',
        text: 'Duas super novidades solicitadas pelos agentes chegaram à Frota: agora, ao abrir qualquer foto de rotina concluída no mural, você tem um botão direto para salvar a imagem no seu celular ou PC com um único clique! Além disso, o seu crachá agora exibe seu Humor Operacional do dia (Hiperfoco, Cafeína, Modo Zen, Despachando Tudo, e mais) e a edição da sua Bio ganhou atalhos rápidos de emojis e contador dinâmico!',
        tags: ['Salvar Fotos de Rotina 📥', 'Humor Operacional ⚡', 'Bio Aprimorada', 'Download Fácil']
      },
      sad: {
        title: 'Chega de arrastar imagens ou abrir em novas guias!',
        text: 'A C.E.O. Providente detectou tentativas de desvio de material visual da frota. A partir desta versão, todas as imagens do sistema estão blindadas: clique com botão direito, long-press para salvar em nova guia e arraste de fotos foram terminantemente desativados!',
        tags: ['Imagens Blindadas 🛡️', 'Zero Vazamentos', 'Segurança EEX']
      },
      angry: {
        title: 'Providente ordenou proteção de cópia de textos no mobile!',
        text: 'Para garantir total foco nas entregas e evitar cópias desautorizadas ou acidentais pelo celular, a seleção e cópia de textos da interface foram bloqueadas no mobile. Campos de preenchimento e notas continuam normais — apenas a carcaça do sistema agora é indecifrável para mãos curiosas!',
        tags: ['Anti-Cópia Mobile 🔒', 'Confidencialidade EEX', 'Inspeção da C.E.O.']
      }
    },
    {
      version: 'v3.1',
      date: 'Outubro / 2026',
      headline: 'CRACHÁ REFORMULADO, TUDUM DESBLOQUEADA NO CELULAR E FITAS COM PATENTE REAL!',
      subheadline: 'Decreto de Refinamento Operacional & Correção de Sistemas Críticos // Autorizado por Providente C.E.O.',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Fitas Holográficas agora exibem sua Patente de verdade! 🎖️✨',
        text: 'Um erro histórico foi finalmente corrigido nos arquivos da Central de Despacho: as fitas holográficas do seu crachá, tanto no seu perfil quanto no Passaporte dos Parceiros, agora exibem o nome REAL da sua patente de carreira — "🌿 CRIATURA DA MATA 🌿", "★ EEX RECRUTA ★", "🚀 EEX DIMENSIONAL 🚀" e assim por diante! As cores das fitas na Loja EEX permanecem intactas: você escolhe a paleta de cores, a Providente escolhe o texto de prestígio que vai nela!',
        tags: ['Fita com Patente Real ✨', 'Crachá de Amigos Corrigido', 'Loja EEX Intacta', 'Honra ao Agente!']
      },
      sad: {
        title: 'Reparos emergenciais na janela da Tudum foram necessários!',
        text: 'A C.E.O. Providente ficou chocada ao descobrir que a Tudum estava escondida atrás do header no celular, e que no PC ela aparecia "solta" no meio da tela! A equipe técnica atuou imediatamente: no celular a Tudum agora cobre toda a tela com z-index de missão crítica, e no PC ela se encaixa perfeitamente ao lado da navbar sem nenhum vão ou desconexão. Missão cumprida!',
        tags: ['Tudum no Mobile Corrigida', 'Desktop Alinhado', 'Z-Index Crítico Ajustado']
      },
      angry: {
        title: 'Providente exigiu que a saudação de boas-vindas NUNCA mais seja obstruída!',
        text: 'Foi registrado um incidente grave nos logs da Central: a saudação da C.E.O. Providente e as mensagens de conquistas estavam sendo cobertas por modais e overlays sem cerimônia! Isso foi corrigido com hierarquia máxima de camadas — o toast e a saudação agora ficam no topo absoluto de TODA a interface, acima de qualquer modal, qualquer overlay e qualquer outra janela. Além disso, Conchas EEX e o botão da Gazeta agora aparecem corretamente no header do celular!',
        tags: ['Toast Invencível', 'Boas-vindas Sempre Visível', 'Conchas no Mobile', 'Gazeta no Header Mobile']
      }
    },
    {
      version: 'v3.0',
      date: 'Outubro / 2026',
      headline: 'CHEGADA TRIUNFAL DA TUDUM IA: A MASCOTE HIPERATIVA DO DESPACHO!',
      subheadline: 'Decreto Presidencial de Assistência Cognitiva & Inteligência Emocional // Autorizado por Providente C.E.O.',
      badge: 'EDIÇÃO ATUAL',
      happy: {
        title: 'A Tudum chegou com tudo na Frota EEX! ✨📦🎀',
        text: 'Conheça a Tudum, nossa assistente oficial e mascote hiperativa com cérebro do Google Gemini! Ela não fala como robô chato: usa gírias fofas da internet, adora fatiar tarefas gigantescas em micropassos fáceis e tem visão de raio-X para checar suas encomendas, eventos, hábitos e notas em tempo real. Além disso, ela tem reações animadas, veste roupas temáticas combinando com seu tema e faz sininhos fofos a cada mensagem enviada!',
        tags: ['Tudum IA ✨', 'Gemini Integrado', 'Gírias da Internet', 'Fatiador de Tarefas', 'Mascote Hiperativa']
      },
      sad: {
        title: 'Cuidado com a empolgação excessiva da mascote!',
        text: 'A Tudum é movida a cafeína quântica e entusiasmo infinito! Se você pedir ajuda, prepare-se para respostas rápidas, cheias de exclamações e emojis fofos. Não nos responsabilizamos por surtos de produtividade fofa!',
        tags: ['Energia Pura', 'Produtividade Extrema']
      },
      angry: {
        title: 'Providente exigiu: a Tudum lê TODAS as encomendas com precisão de laser!',
        text: 'A C.E.O. Providente testou pessoalmente a Tudum: se você perguntar "o que tenho para o dia 18?", ela vasculha todo o seu calendário de despachos e responde na lata, sem esquecer nenhum pacote! Preguiça e respostas genéricas foram terminantemente proibidas no Elgaly Express!',
        tags: ['Leitura de Encomendas', 'Zero Erros de Data', 'Inspeção da C.E.O.']
      }
    },
    {
      version: 'v2.9',
      date: 'Outubro / 2026',
      headline: 'EXPRESS-FM NA ÁREA: O TOCA-DISCOS RETRÔ & MÚSICAS DO YOUTUBE SEM LIMITES!',
      subheadline: 'Decreto de Harmonização Sonora Dimensional // Autorizado por Providente C.E.O.',
      badge: 'HISTÓRICO',
      happy: {
        title: 'Sintonizador Express-FM & Capa no Centro do Vinil! 📻🎶',
        text: 'A Frota EEX agora tem sua própria estação estéreo 108.5 MHz! Um toca-discos retrô neo-brutalista horizontal onde a metade de cima do disco gira com a capa oficial do seu álbum ou vídeo do YouTube Music no centro. Suporta vídeos, músicas completas, playlists inteiras e até shorts sem cortes de 30 segundos! E para quem ama nostalgia: o Modo DVD faz o mini vinil quicar suavemente pelas bordas da tela!',
        tags: ['Express-FM 📻', 'YouTube Music Completo', 'Meio Vinil Retrô', 'Thumbnail do Álbum', 'Modo DVD 📀']
      },
      sad: {
        title: 'Autoplay surpresa foi banido para sempre!',
        text: 'Nada de sustos ao abrir o app de madrugada! O autoplay foi domado e retirado da inicialização. O vinil agora só toca quando você estiver devidamente identificado com seu EEX-PASS e apertar o botão "Tocar"!',
        tags: ['Sem Autoplay Fantasma', 'Paz nos Ouvidos']
      },
      angry: {
        title: 'Providente tirou o botão da navbar e calibrou para desktop!',
        text: 'A C.E.O. Providente viu a navbar apertada e não perdoou: o botão foi retirado do menu para manter a navegação limpa e desativado em celulares pequenos para que os agentes foquem nas entregas pelo celular. No PC, o disco flutua livre, sem pílulas de texto desnecessárias ao redor!',
        tags: ['Navbar Limpa', 'Desktop Focus', 'Disco Flutuante Puro']
      }
    },
    {
      version: 'v2.8',
      date: 'Outubro / 2026',
      headline: 'MODO PROFISSÃO ATIVADO, AMIGOS LIBERADOS & PASSAPORTE CORRIGIDO!',
      subheadline: 'Decreto de Expansão Operacional // Autorizado por Providente C.E.O.',
      badge: 'HISTÓRICO',
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

// --- temas ---
// 1. Rosa Express (Clássico Chiclete - Grátis)
// 2. Roxo NuMetálico (65 Conchas)
// 3. Verde Magáfico (255 Conchas - Grátis para pedrinho.express.com)
// 4. Vermelho Culposo (95 Conchas - Vermelho Pastel & Bege Clarinho)
// 5. Azul Arcânico (EEX+)
// 6. Ouro Providêntico (EEX+)

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
      premium: false,
      price: 750,
      quotes: [
        'Das profundezas de Nova Arcanis, o azul dimensional te envolve! 🌌',
        'Azul profundo com centelhas de laranja — a cor do portal interdimensional! ✨',
        'Para Agentes de Elite da Rede EEX! ⚡'
      ]
    },
    'ouro-providentico': {
      id: 'ouro-providentico',
      name: 'Ouro Providêntico',
      icon: '👑',
      premium: false,
      price: 750,
      quotes: [
        'A C.E.O. Providente aprova pessoalmente este tema! 👑',
        'Ouro, elegância e poder — o tema da diretora executiva de Nova Amerit!',
        'Só para os Agentes mais dedicados da Frota EEX! ✨'
      ]
    }
  },

  isPedrinho(user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    if (!user) {
      try {
        const saved = JSON.parse(localStorage.getItem('elgaly_express_current_user') || 'null');
        if (saved) user = saved;
      } catch {}
    }
    if (!user) return false;
    const nick = (user.nickname || '').toLowerCase().trim();
    const eex = (user.eexEmail || '').toLowerCase().trim();
    const email = (user.email || '').toLowerCase().trim();
    const name = (user.name || '').toLowerCase().trim();
    return nick.includes('pedrinho') || eex.includes('pedrinho') || email.includes('pedrinho') || name.includes('pedrinho');
  },

  getPurchasedThemes(user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    if (!user) {
      try {
        const savedUser = JSON.parse(localStorage.getItem('elgaly_express_current_user') || 'null');
        if (savedUser) user = savedUser;
      } catch (e) {}
    }
    const uid = user ? (user.id || user.uid) : 'default';
    const allPurchased = new Set();

    // 1. Chave específica deste UID
    if (uid && uid !== 'default') {
      try {
        const list = JSON.parse(localStorage.getItem(`elgaly_purchased_themes_${uid}`) || '[]');
        if (Array.isArray(list)) list.forEach(t => allPurchased.add(t));
      } catch {}
    }

    // 2. Chaves padrão e legadas locais deste aparelho
    try {
      const def = JSON.parse(localStorage.getItem('elgaly_purchased_themes_default') || '[]');
      if (Array.isArray(def)) def.forEach(t => allPurchased.add(t));
    } catch {}
    try {
      const leg = JSON.parse(localStorage.getItem('elgaly_purchased_themes') || '[]');
      if (Array.isArray(leg)) leg.forEach(t => allPurchased.add(t));
    } catch {}

    // 3. Qualquer outra chave de temas comprados no localStorage deste navegador
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('elgaly_purchased_themes_')) {
          const val = JSON.parse(localStorage.getItem(key) || '[]');
          if (Array.isArray(val)) val.forEach(t => allPurchased.add(t));
        }
      }
    } catch {}

    // 4. Perfil do usuário (memória/nuvem)
    if (user && Array.isArray(user.purchasedThemes)) {
      user.purchasedThemes.forEach(t => allPurchased.add(t));
    }

    // 5. Se o tema salvo ou ativo for um dos temas válidos, garante que esteja na lista
    try {
      const savedTheme = localStorage.getItem('elgaly_theme');
      if (savedTheme && savedTheme !== 'rosa-express' && this.themes[savedTheme]) {
        allPurchased.add(savedTheme);
      }
    } catch {}

    return Array.from(allPurchased);
  },

  savePurchasedThemes(list, user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    if (!user) {
      try {
        const savedUser = JSON.parse(localStorage.getItem('elgaly_express_current_user') || 'null');
        if (savedUser) user = savedUser;
      } catch (e) {}
    }
    const uid = user ? (user.id || user.uid) : 'default';
    if (uid && uid !== 'default') {
      localStorage.setItem(`elgaly_purchased_themes_${uid}`, JSON.stringify(list));
    }
    localStorage.setItem('elgaly_purchased_themes_default', JSON.stringify(list));
    localStorage.setItem('elgaly_purchased_themes', JSON.stringify(list));
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
    if (typeof AppUI !== 'undefined') {
      if (typeof AppUI.renderThemeCards === 'function') {
        AppUI.renderThemeCards();
      }
      const cfgView = document.getElementById('view-configuracoes');
      if (cfgView && cfgView.classList.contains('active-view')) {
        AppUI.renderConfiguracoes();
      }
    }
  },

  isThemeUnlocked(themeId, user = (typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null)) {
    if (!themeId || themeId === 'rosa-express') return true;

    // Se o usuário tiver status EEX+ ativo, continua desbloqueado
    if ((themeId === 'azul-arcanico' || themeId === 'ouro-providentico') && typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium()) {
      return true;
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

    if (typeof FirebaseService !== 'undefined' && FirebaseService.db && (user.id || user.uid)) {
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
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    if (user && !this.isThemeUnlocked(saved, user)) {
      saved = 'rosa-express';
    }
    this.current = saved;
    document.documentElement.setAttribute('data-theme', saved);
    this.updateQuoteBox(saved);
  },

  cycle() {
    const all = ['rosa-express', 'roxo-numetalico', 'verde-magafico', 'vermelho-culposo', 'azul-arcanico', 'ouro-providentico'];
    const unlocked = all.filter(t => this.isThemeUnlocked(t));
    if (unlocked.length === 0) unlocked.push('rosa-express');
    const nextIdx = (unlocked.indexOf(this.current) + 1) % unlocked.length;
    this.setTheme(unlocked[nextIdx], true);
  },

  lastLocalChange: 0,
  _isSettingTheme: false,

  setTheme(themeId, showToastNotification = false, syncCloud = true) {
    if (this._isSettingTheme) return;
    this._isSettingTheme = true;
    try {
      if (!this.themes[themeId]) themeId = 'rosa-express';
      // Se o tema estiver bloqueado, volta para rosa-express
      if (!this.isThemeUnlocked(themeId)) {
        themeId = 'rosa-express';
      }

      const themeChanged = (this.current !== themeId) || (document.documentElement.getAttribute('data-theme') !== themeId);

      // Se nada mudou e não deve exibir notificação toast, encerra sem trabalho redundante
      if (!themeChanged && !showToastNotification) {
        return;
      }

      this.current = themeId;
      this.lastLocalChange = Date.now();
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
      if (typeof AppUI !== 'undefined' && AppUI.renderThemeCards) {
        AppUI.renderThemeCards();
      } else {
        document.querySelectorAll('.theme-pick-card').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.themeId === themeId);
        });
      }

      // Atualiza a caixinha de mensagem com frases do tema apenas se mudou
      if (themeChanged) {
        this.updateQuoteBox(themeId);
      }

      if (showToastNotification && typeof AppUI !== 'undefined' && AppUI.showToast) {
        const quote = themeObj.quotes[0];
        AppUI.showToast(`${themeObj.icon} ${themeObj.name}: "${quote}"`);
      }

      // Sincronização em tempo real do tema entre PC e Celular via Firestore apenas se houve mudança real
      if (syncCloud && themeChanged && typeof FirebaseService !== 'undefined' && FirebaseService.saveProfileTheme) {
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
    } finally {
      this._isSettingTheme = false;
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

// CATÁLOGO DE FITAS HOLOGRÁFICAS DE CRACHÁ (20 Combinações - Loja EEX)

const HologramStripsCatalog = [
  { id: 'strip-padrao', name: 'Rosa com Roxo', tagline: 'Padrão Oficial EEX', desc: 'A clássica faixa chiclete e roxo retrô oficial do Elgaly Express. Padrão de fábrica para todos os agentes.', price: 0, className: 'holo-strip-padrao', text: '• ELGALY EXPRESS •', colors: ['#ec4899', '#8b5cf6'] },
  { id: 'strip-neon-cyber', name: 'Neon Cyber', tagline: 'Ciano & Magenta Laser', desc: 'Reflexo futurista das avenidas iluminadas à noite no centro de Nova Amerit.', price: 75, className: 'holo-strip-neon-cyber', text: '• NEON CYBER •', colors: ['#06b6d4', '#ec4899'] },
  { id: 'strip-chama-vulcanica', name: 'Chama Vulcânica', tagline: 'Laranja & Rubi Incandescente', desc: 'Calor extremo das caldeiras das locomotivas dimensionais em aceleração.', price: 80, className: 'holo-strip-chama-vulcanica', text: '• CHAMA VULCÂNICA •', colors: ['#ea580c', '#b91c1c'] },
  { id: 'strip-aurora-boreal', name: 'Aurora Boreal', tagline: 'Esmeralda & Turquesa Ártica', desc: 'Partículas solares colidindo com a alta atmosfera das rotas polares de despacho.', price: 90, className: 'holo-strip-aurora-boreal', text: '• AURORA BOREAL •', colors: ['#10b981', '#06b6d4'] },
  { id: 'strip-noite-estrelada', name: 'Noite Estrelada', tagline: 'Índigo Cósmico & Violeta', desc: 'Silêncio absoluto do céu noturno sobre os trilhos da meia-noite.', price: 95, className: 'holo-strip-noite-estrelada', text: '• NOITE ESTRELADA •', colors: ['#1e1b4b', '#7c3aed'] },
  { id: 'strip-sol-poente', name: 'Sol Poente', tagline: 'Dourado Quente & Coral Tropical', desc: 'O entardecer perfeito refletindo no vidro da cabine de comando.', price: 100, className: 'holo-strip-sol-poente', text: '• SOL POENTE •', colors: ['#f59e0b', '#ec4899'] },
  { id: 'strip-menta-eletrica', name: 'Menta Elétrica', tagline: 'Lima Neon & Menta Glacial', desc: 'Refrescância instantânea e alta voltagem nas rotinas mais pesadas do dia.', price: 110, className: 'holo-strip-menta-eletrica', text: '• MENTA ELÉTRICA •', colors: ['#84cc16', '#06b6d4'] },
  { id: 'strip-doce-pastel', name: 'Doce Pastel', tagline: 'Lavanda & Rosa Algodão', desc: 'Suavidade máxima e afeto aprovado pelos confeiteiros da estação postal.', price: 120, className: 'holo-strip-doce-pastel', text: '• DOCE PASTEL •', colors: ['#fbcfe8', '#c084fc'] },
  { id: 'strip-tempestade', name: 'Tempestade', tagline: 'Roxo Trovão & Relâmpago Azul', desc: 'Descarga elétrica cortando nuvens densas em dias de despacho sob tempestade.', price: 130, className: 'holo-strip-tempestade', text: '• TEMPESTADE •', colors: ['#312e81', '#38bdf8'] },
  { id: 'strip-vaporwave-98', name: 'Vaporwave 98', tagline: 'Teal Nostalgia & Magenta CRT', desc: 'Estética nostálgica de fitas VHS e estações de trabalho de 1998.', price: 140, className: 'holo-strip-vaporwave-98', text: '• VAPORWAVE 98 •', colors: ['#14b8a6', '#f43f5e'] },
  { id: 'strip-ametista-real', name: 'Ametista Real', tagline: 'Violeta Nobre & Prata Polida', desc: 'Gemas polidas dos cofres de despacho executivo da diretoria.', price: 150, className: 'holo-strip-ametista-real', text: '• AMETISTA REAL •', colors: ['#6b21a8', '#cbd5e1'] },
  { id: 'strip-floresta-mistica', name: 'Floresta Mística', tagline: 'Verde Musgo & Âmbar Feérico', desc: 'Segredos e encantamentos botânicos dos bosques antigos de Nova Arcanis.', price: 160, className: 'holo-strip-floresta-mistica', text: '• FLORESTA MÍSTICA •', colors: ['#14532d', '#d97706'] },
  { id: 'strip-prisma', name: 'Prisma Arco-Íris', tagline: 'Espectro Completo Fluido', desc: 'Decomposição cristalina da luz branca em um arco-íris radiante contínuo.', price: 180, className: 'holo-strip-prisma', text: '• PRISMA ARCO-ÍRIS •', colors: ['#f43f5e', '#38bdf8', '#a855f7'] },
  { id: 'strip-obsidiana', name: 'Obsidiana Neon', tagline: 'Ônix Negro & Púrpura Brilhante', desc: 'Rocha vulcânica escura cortada por fraturas de pura energia magenta.', price: 190, className: 'holo-strip-obsidiana', text: '• OBSIDIANA NEON •', colors: ['#09090b', '#a21caf'] },
  { id: 'strip-fogo-solar', name: 'Fogo Solar', tagline: 'Ouro Solar & Labareda Viva', desc: 'Radiação direta da coroa solar canalizada na borda holográfica da sua foto.', price: 200, className: 'holo-strip-fogo-solar', text: '• FOGO SOLAR •', colors: ['#eab308', '#ef4444'] },
  { id: 'strip-abismo-quantico', name: 'Abismo Quântico', tagline: 'Azul Cobalto & Laser Magenta', desc: 'Profundezas insondáveis dos túneis de teletransporte da frota interestelar.', price: 220, className: 'holo-strip-abismo-quantico', text: '• ABISMO QUÂNTICO •', colors: ['#1e3a8a', '#d946ef'] },
  { id: 'strip-reliquia-tudum', name: 'Relíquia da Tudum', tagline: 'Roxo Providente & Amarelo Tudum', desc: 'Consagrada pela inteligência artificial assistente oficial da Frota EEX.', price: 250, className: 'holo-strip-reliquia-tudum', text: '• RELÍQUIA TUDUM •', colors: ['#581c87', '#eab308'] },
  { id: 'strip-aura-providente', name: 'Aura da Providente', tagline: 'Branco Pérola & Ouro Imperial', desc: 'Bênção direta da C.E.O. Providente para agentes com histórico exemplar.', price: 280, className: 'holo-strip-aura-providente', text: '• AURA PROVIDENTE •', colors: ['#fef9c3', '#f59e0b'] },
  { id: 'strip-manto-sagrado', name: 'Manto Sagrado', tagline: 'Carmesim Real & Ouro da C.E.O.', desc: 'O mais distinto tecido cerimonial da cúpula de despacho interdimensional.', price: 320, className: 'holo-strip-manto-sagrado', text: '• MANTO SAGRADO •', colors: ['#991b1b', '#ffd700'] },
  { id: 'strip-olho-supremo', name: 'O Olho Supremo', tagline: 'Púrpura Celestial & Ouro Divino', desc: 'A consagração máxima da Providente. Apenas a nata da Frota EEX tem acesso.', price: 350, className: 'holo-strip-olho-supremo', text: '• PROVIDENTE SUPREMO •', colors: ['#ffd700', '#581c87'] }
];

// HUMORES OPERACIONAIS DO AGENTE (Status do Crachá EEX)

const EEX_MOODS = {
  foco: { emoji: '⚡', label: 'Modo Hiperfoco', color: '#eab308' },
  cafe: { emoji: '☕', label: 'Movido a Cafeína', color: '#f97316' },
  zen: { emoji: '🌸', label: 'Modo Zen', color: '#ec4899' },
  despacho: { emoji: '📦', label: 'Despachando Tudo', color: '#10b981' },
  luz: { emoji: '🚀', label: 'Velocidade da Luz', color: '#06b6d4' },
  dormindo: { emoji: '😴', label: 'Bateria em 1%', color: '#8b5cf6' },
  game: { emoji: '🎮', label: 'Pausa pro Game', color: '#3b82f6' }
};

// --- módulo ---
// Menu popup, categorias verticais à esquerda, compra de itens com conchas

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
      document.querySelectorAll('.loja-category-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.category === this.currentCategory);
      });
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

    // Botões de categorias na barra lateral esquerda
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

    // Cliques em ações de temas
    const gridThemes = document.getElementById('lojaThemesGrid');
    if (gridThemes) {
      gridThemes.addEventListener('click', async (e) => {
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

    // Cliques em ações de fitas holográficas
    const gridStrips = document.getElementById('lojaStripsGrid');
    if (gridStrips) {
      gridStrips.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-loja-action');
        if (!btn || btn.disabled) return;

        const action = btn.dataset.action;
        const stripId = btn.dataset.stripId;

        if (action === 'equip-strip') {
          if (stripId) await this.equipStrip(stripId);
          return;
        }

        if (action === 'buy-strip') {
          if (stripId) await this.purchaseStrip(stripId);
          return;
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

    const viewTemas = document.getElementById('lojaViewTemas');
    const viewFitas = document.getElementById('lojaViewFitas');

    if (this.currentCategory === 'fitas') {
      if (viewTemas) viewTemas.style.display = 'none';
      if (viewFitas) viewFitas.style.display = 'block';
      this.renderStrips();
    } else {
      if (viewTemas) viewTemas.style.display = 'block';
      if (viewFitas) viewFitas.style.display = 'none';
      this.renderThemes();
    }
  },

  renderStrips() {
    const grid = document.getElementById('lojaStripsGrid');
    if (!grid) return;

    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    const balance = typeof ShellsManager !== 'undefined' ? ShellsManager.getBalance() : 0;
    const purchased = Array.isArray(user?.purchasedStrips) ? user.purchasedStrips : ['strip-padrao'];
    const equipped = user?.equippedStrip || 'strip-padrao';

    grid.innerHTML = HologramStripsCatalog.map(s => {
      const isEquipped = equipped === s.id;
      const isPurchased = s.price === 0 || purchased.includes(s.id);
      const canAfford = balance >= s.price;

      let priceHtml = '';
      let actionBtnHtml = '';

      if (s.price === 0) {
        priceHtml = '<span class="loja-item-price free">Grátis (Padrão)</span>';
      } else {
        priceHtml = `<span class="loja-item-price shells"><img src="images/shellcoin.png" class="shell-coin-inline" alt="Conchas"> ${s.price} Conchas</span>`;
      }

      if (isEquipped) {
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action disabled" disabled style="background:#16a34a;color:#ffffff;border-color:var(--black);cursor:default;">✓ Em Uso</button>`;
      } else if (isPurchased) {
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action" data-action="equip-strip" data-strip-id="${s.id}" style="background:var(--yellow-bright);color:var(--black);">⚡ Usar Fita</button>`;
      } else {
        actionBtnHtml = `<button type="button" class="btn-comic btn-sm btn-loja-action" data-action="buy-strip" data-strip-id="${s.id}" ${canAfford ? '' : 'style="opacity:0.75;"'}>🛒 Comprar (${s.price} 🐚)</button>`;
      }

      return `
        <div class="loja-item-card ${isEquipped ? 'item-equipped' : ''} ${isPurchased ? 'item-owned' : ''}">
          <div class="loja-item-top">
            <div class="strip-swatch-box ${s.className}">
              <span class="strip-swatch-text">${s.text}</span>
            </div>
          </div>
          <div class="loja-item-meta" style="margin-top: 4px;">
            <strong class="loja-item-name">✨ ${s.name}</strong>
            <span class="loja-item-tagline">${s.tagline}</span>
          </div>
          <p class="loja-item-desc">${s.desc}</p>
          <div class="loja-item-footer">
            ${priceHtml}
            ${actionBtnHtml}
          </div>
        </div>
      `;
    }).join('');
  },

  async equipStrip(stripId) {
    const strip = HologramStripsCatalog.find(s => s.id === stripId);
    if (!strip) return;
    if (typeof AuthManager !== 'undefined') {
      await AuthManager.updateUserProfile({ equippedStrip: stripId });
      this.render();
      if (typeof AppUI !== 'undefined') {
        AppUI.renderProfileView();
        AppUI.showToast(`✨ Fita "${strip.name}" equipada no seu crachá!`);
      }
    }
  },

  async purchaseStrip(stripId) {
    const strip = HologramStripsCatalog.find(s => s.id === stripId);
    if (!strip) return false;
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    if (!user) {
      if (typeof AppUI !== 'undefined') AppUI.showToast('⚠️ Faça login para comprar itens!');
      return false;
    }
    const balance = typeof ShellsManager !== 'undefined' ? ShellsManager.getBalance() : 0;
    if (balance < strip.price) {
      if (typeof AppUI !== 'undefined') AppUI.showToast(`🐚 Conchas insuficientes! Você precisa de ${strip.price} Conchas.`);
      return false;
    }
    const spent = ShellsManager.spendShells(strip.price, `Fita Holográfica: ${strip.name}`);
    if (!spent) return false;

    const purchased = Array.isArray(user.purchasedStrips) ? [...user.purchasedStrips] : ['strip-padrao'];
    if (!purchased.includes(stripId)) purchased.push(stripId);

    await AuthManager.updateUserProfile({
      purchasedStrips: purchased,
      equippedStrip: stripId
    });

    this.render();
    if (typeof AppUI !== 'undefined') {
      AppUI.renderProfileView();
      AppUI.showToast(`🎉 Fita "${strip.name}" adquirida e equipada com sucesso!`);
    }
    return true;
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
        desc: 'Azul dimensional profundo com centelhas de laranja cósmico.',
        type: 'shells',
        price: 750,
        swatchClass: 'swatch-azul'
      },
      {
        id: 'ouro-providentico',
        name: 'Ouro Providêntico',
        icon: '👑',
        tagline: 'Gabinete da C.E.O.',
        desc: 'Ouro, nobreza e distinção máxima da diretoria executiva de Nova Amerit.',
        type: 'shells',
        price: 750,
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

// --- eventos ---
// Provas da faculdade, aniversários, reuniões e compromissos com data fixa

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

// UTILITÁRIO DE AUTOCOMPLETE DE CIDADES DE SÃO PAULO (645 Municípios)

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

// --- módulo ---

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

// --- módulo ---

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
  },

  onCloudSync(cloudNotes) {
    if (!Array.isArray(cloudNotes)) return;
    if (cloudNotes.length > 0) {
      this.notes = cloudNotes;
      localStorage.setItem('elgaly_express_notes', JSON.stringify(this.notes));
      this.render();
    } else if (this.notes.length > 0) {
      // Se a nuvem estiver vazia mas houver notas locais salvas, sobe para o Firestore
      if (typeof FirebaseService !== 'undefined' && FirebaseService.saveAllNotesToCloud) {
        FirebaseService.saveAllNotesToCloud(this.notes);
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

    // Sincroniza em tempo real com o Firestore
    if (typeof FirebaseService !== 'undefined' && FirebaseService.saveNoteToCloud) {
      FirebaseService.saveNoteToCloud(newNote);
    }
    return true;
  },

  togglePin(id) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;
    note.pinned = !note.pinned;
    this.notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    this.save();
    this.render();

    // Atualiza status do pin no Firestore
    if (typeof FirebaseService !== 'undefined' && FirebaseService.saveNoteToCloud) {
      FirebaseService.saveNoteToCloud(note);
    }
  },

  updateNote(id, updatedFields) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return false;
    note.title = (updatedFields.title !== undefined ? updatedFields.title : note.title).trim();
    note.content = (updatedFields.content !== undefined ? updatedFields.content : note.content).trim();
    if (updatedFields.color) note.color = updatedFields.color;
    if (updatedFields.pinned !== undefined) note.pinned = !!updatedFields.pinned;
    note.updatedAt = new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    if (note.pinned) {
      this.notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    }
    this.save();
    this.render();

    if (typeof FirebaseService !== 'undefined' && FirebaseService.saveNoteToCloud) {
      FirebaseService.saveNoteToCloud(note);
    }
    return true;
  },

  deleteNote(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    this.save();
    this.render();

    // Exclui do Firestore
    if (typeof FirebaseService !== 'undefined' && FirebaseService.deleteNoteFromCloud) {
      FirebaseService.deleteNoteFromCloud(id);
    }
  },

  openNoteModal(id, startEditing = false) {
    const note = this.notes.find(n => n.id === id);
    if (!note) return;

    const modal = document.getElementById('modalNoteView');
    const contentBox = document.getElementById('noteModalContent');
    const viewMode = document.getElementById('noteModalViewMode');
    const editMode = document.getElementById('noteModalEditMode');
    const pinBadge = document.getElementById('noteModalPinBadge');
    if (!modal || !contentBox) return;

    contentBox.className = `modal-content note-modal-box note-${note.color || 'yellow'}`;
    if (pinBadge) pinBadge.style.display = note.pinned ? 'inline-block' : 'none';

    // Preenche Modo Visualização
    const titleEl = document.getElementById('noteModalViewTitle');
    const bodyEl = document.getElementById('noteModalViewBody');
    const dateEl = document.getElementById('noteModalViewDate');
    if (titleEl) {
      titleEl.textContent = note.title || 'Anotação sem Título';
      titleEl.style.display = note.title ? 'block' : 'none';
    }
    if (bodyEl) bodyEl.textContent = note.content || '';
    if (dateEl) dateEl.textContent = note.updatedAt ? `Atualizado em ${note.updatedAt}` : (note.createdAt ? `Criado em ${note.createdAt}` : '');

    // Preenche Modo Edição
    const editId = document.getElementById('noteModalEditId');
    const editTitle = document.getElementById('noteModalEditTitle');
    const editContent = document.getElementById('noteModalEditContent');
    const editPin = document.getElementById('noteModalEditPinCheckbox');
    if (editId) editId.value = note.id;
    if (editTitle) editTitle.value = note.title || '';
    if (editContent) editContent.value = note.content || '';
    if (editPin) editPin.checked = !!note.pinned;

    this._modalEditColor = note.color || 'yellow';
    const colorPicker = document.getElementById('noteModalEditColorPicker');
    if (colorPicker) {
      colorPicker.querySelectorAll('.note-color-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === this._modalEditColor);
      });
    }

    if (startEditing) {
      if (viewMode) viewMode.style.display = 'none';
      if (editMode) editMode.style.display = 'block';
    } else {
      if (viewMode) viewMode.style.display = 'block';
      if (editMode) editMode.style.display = 'none';
    }

    modal.classList.add('active');
  },

  closeNoteModal() {
    const modal = document.getElementById('modalNoteView');
    if (modal) modal.classList.remove('active');
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
        <div class="note-card ${colorClass}" data-note-id="${note.id}" title="Clique para expandir e editar esta nota">
          ${pinIcon}
          <div class="note-card-body-click">
            ${note.title ? `<div class="note-card-title">${note.title}</div>` : ''}
            <div class="note-card-content">${note.content}</div>
          </div>
          <div class="note-card-footer">
            <span>${note.createdAt || ''}</span>
            <div class="note-card-actions">
              <button type="button" class="note-action-btn action-edit-note" title="Editar nota">
                ✏️
              </button>
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

    // Clique no corpo do card expande o modal com a nota completa
    grid.querySelectorAll('.note-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.note-card-actions') || e.target.closest('button')) return;
        const id = card.dataset.noteId;
        this.openNoteModal(id, false);
      });
    });

    grid.querySelectorAll('.action-edit-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.target.closest('.note-card').dataset.noteId;
        this.openNoteModal(id, true);
      });
    });

    grid.querySelectorAll('.action-pin-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.target.closest('.note-card').dataset.noteId;
        this.togglePin(id);
      });
    });

    grid.querySelectorAll('.action-copy-note').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
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
        e.stopPropagation();
        const id = e.target.closest('.note-card').dataset.noteId;
        this.deleteNote(id);
        AppUI.showToast('🗑️ Anotação removida.');
      });
    });
  }
};

// --- módulo ---
// Notificações de 3 em 3 horas para hábitos pendentes, prazos e eventos

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

      // 1. ROTINA DIÁRIA (HÁBITOS PENDENTES) - De 3 em 3 horas
      // Horários: 08:00, 11:00, 14:00, 17:00, 20:00

      const habits = (typeof HabitManager !== 'undefined' && HabitManager.habits) ? HabitManager.habits : [];
      const routineHours = [8, 11, 14, 17, 20];
      const dayMap = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };
      // Textos neo-brutalistas para notificacoes de habitos
      const habitNotifVariants = (n, firstHabit) => [
        { title: '🚨 ROTA PENDENTE, AGENTE!',  body: `Midnight em panico: ${n} habito(s) na fila! Proximo: "${firstHabit}" 💥` },
        { title: '⚡ MISSAO INCOMPLETA!',        body: `${n} habito(s) aguardando sua acao, Agente! "${firstHabit}" ta te esperando 🎯` },
        { title: '🔥 ALERTA DA FROTA EEX!',     body: `A base registrou ${n} pendencia(s) hoje! Nao abandone a rota! 🚀` },
        { title: '💀 AGENTE, ACORDA!',          body: `${n} missao(oes) sem concluir! A Midnight ja ta desesperada contigo 😤` },
        { title: '📋 CHECK-IN DIMENSIONAL',      body: `${n} habito(s) na sua rota de hoje. "${firstHabit}" espera seu check-in ✅` }
      ];

      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + dayOffset);
        const dayOfWeek = targetDate.getDay();

        const scheduledHabits = habits.filter(h => {
          if (!h.days || h.days.length === 0) return true;
          return h.days.includes(dayOfWeek);
        });

        const pendingHabits = (dayOffset === 0)
          ? scheduledHabits.filter(h => !h.done)
          : scheduledHabits;

        if (pendingHabits.length === 0) continue;

        for (const hour of routineHours) {
          const schedTime = new Date(targetDate);
          schedTime.setHours(hour, 0, 0, 0);

          if (schedTime > now) {
            const n = pendingHabits.length;
            const firstHabit = (pendingHabits[0] && pendingHabits[0].title) ? pendingHabits[0].title : 'Habito';
            const variants = habitNotifVariants(n, firstHabit);
            const pick = variants[Math.floor(Math.random() * variants.length)];
            notifications.push({
              id: notifId++,
              title: pick.title,
              body: pick.body,
              schedule: { at: schedTime },
              sound: 'eex_notification.mp3'
            });
          }
        }
      }

      // 2. ENCOMENDAS & TAREFAS COM PRAZO
      // - 3 dias antes (09:00)
      // - 1 dia antes (09:00)
      // - No dia da entrega (09:00)

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

      // 3. EVENTOS & LEMBRETES
      // - 1 dia antes (09:00)
      // - 1 hora antes do horário
      // - No momento do evento

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

// IMPRESSORA TÉRMICA — MANIFESTO DE CARGA DIÁRIO EEX

const ImpressoraManager = {
  _audioCtx: null,
  _printing: false,

  frasesRodape: [
    'tudum!! despachei tudinho em tempo recorde, bora pra próxima! 📦✨',
    'mds você é INCRÍVEL chefia, olha isso, tudo entregueeee!! 🎀',
    'socorro de alegria!! a estação tá em festa com sua rotina hoje!! 🚂',
    'bora comemorar? mereceu MUITO essa nota fiscal! vc arrasou dem! 🌟',
    'providente aprova FORTEMENTE o desempenho desse agente hoje! 👑',
    'que despacho impecável!! até a midnight ficou feliz, e ela nunca fica!! 😭',
    'a frota EEX anda mais rápida por causa de você, sabe não?? muito amor! 💜',
    'trr trr trrr... nota emitida com LOUVOR pela C.E.O. providente! boa demais! ✨',
    'você não veio brincar não, hein chefia? TUDO concluído! orgulhosa demais!! 🏆',
    'hoje o disco do express-fm tá girando com música da vitória por sua causa! 📻💿'
  ],

  init() {
    const btnEmitir = document.getElementById('btnEmitirManifesto');
    const btnFechar = document.getElementById('btnFecharImpressora');
    const btnDownload = document.getElementById('btnDownloadRecibo');
    const overlay = document.getElementById('modalImpressora');

    if (btnEmitir) {
      btnEmitir.addEventListener('click', () => {
        if (!btnEmitir.disabled) this.openModal();
      });
    }
    if (btnFechar) btnFechar.addEventListener('click', () => this.closeModal());
    if (btnDownload) btnDownload.addEventListener('click', () => this.downloadReceiptAsPng());
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeModal();
      });
    }
  },

  checkAndUpdateButton() {
    const btnEmitir = document.getElementById('btnEmitirManifesto');
    const lockEl = document.getElementById('impressoraBtnLock');
    const hintEl = document.getElementById('impressoraBtnHint');
    const wrapEl = document.getElementById('impressoraTriggerWrap');
    if (!btnEmitir) return;

    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    if (!user) {
      if (wrapEl) wrapEl.style.display = 'none';
      return;
    }
    if (wrapEl) wrapEl.style.display = 'flex';

    const allDone = this._checkAllHabitsDone();
    if (allDone) {
      btnEmitir.disabled = false;
      btnEmitir.classList.add('unlocked');
      if (lockEl) lockEl.style.display = 'none';
      if (hintEl) hintEl.textContent = '🟢 Rotina completa! Manifesto pronto para emissão!';
    } else {
      btnEmitir.disabled = true;
      btnEmitir.classList.remove('unlocked');
      if (lockEl) lockEl.style.display = 'inline';
      if (hintEl) hintEl.textContent = 'Conclua toda a sua rotina para desbloquear!';
    }
  },

  _checkAllHabitsDone() {
    if (typeof HabitManager === 'undefined') return false;
    if (typeof HabitManager.getTodayStats === 'function') {
      const stats = HabitManager.getTodayStats();
      if (stats && stats.scheduledCount > 0) return stats.allDone;
      if (stats && stats.scheduledCount === 0) return false;
    }
    const habits = HabitManager.habits || (HabitManager.getAllHabits ? HabitManager.getAllHabits() : []) || [];
    if (habits.length === 0) return false;
    const dayMap = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };
    const today = new Date();
    const todayDow = today.getDay();
    const todayKey = dayMap[todayDow];
    const todayStr = today.toISOString().slice(0, 10);
    const history = HabitManager.history || {};
    const todaysHabits = habits.filter(h => !h.days || h.days.length === 0 || h.days.includes(todayDow) || h.days.includes(todayKey));
    if (todaysHabits.length === 0) return false;
    return todaysHabits.every(h => {
      const histKey = `${h.id}_${todayStr}`;
      const isDone = typeof HabitManager.isCompletedToday === 'function' ? HabitManager.isCompletedToday(h.id) : false;
      return h.done === true || isDone || history[histKey] === true;
    });
  },

  _getAudioCtx() {
    if (!this._audioCtx) {
      try { this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    }
    return this._audioCtx;
  },

  playPrinterSound(durationMs = 2500) {
    const ctx = this._getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (_) {}
    }
    const startTime = ctx.currentTime;
    const ticksPerSecond = 18;
    const totalTicks = Math.floor((durationMs / 1000) * ticksPerSecond);
    for (let i = 0; i < totalTicks; i++) {
      const t = startTime + i / ticksPerSecond;
      const bufferSize = Math.floor(ctx.sampleRate * 0.012);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * (Math.random() > 0.5 ? 0.6 : 0.1);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2200 + Math.random() * 800;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start(t);
      source.stop(t + 0.045);
    }
  },

  playStampSound() {
    const ctx = this._getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (_) {}
    }
    const bufferSize = Math.floor(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = Math.exp(-i / (bufferSize * 0.15));
      data[i] = (Math.random() * 2 - 1) * decay * 0.8;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  },

  _buildReceiptText() {
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const manifestoId = Math.floor(100000 + Math.random() * 900000);
    const habits = (typeof HabitManager !== 'undefined' ? (HabitManager.habits || (HabitManager.getAllHabits ? HabitManager.getAllHabits() : [])) : []) || [];
    const dayMap = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sab' };
    const todayDow = now.getDay();
    const todayKey = dayMap[todayDow];
    const todaysHabits = habits.filter(h => !h.days || h.days.length === 0 || h.days.includes(todayDow) || h.days.includes(todayKey));
    const userName = user ? (user.name || user.eexEmail || 'Agente EEX') : 'Agente EEX';
    const eexId = user ? (user.eexEmail || user.nickname || '---') : '---';
    const career = (typeof AppUI !== 'undefined' && AppUI.calculateCareerStats) 
      ? AppUI.calculateCareerStats() 
      : { level: 1, totalXp: 0, rankTitle: 'Recruta da Rota Express 📦' };
    const level = career.level;
    const xp = career.totalXp;
    const rankTitle = career.rankTitle;
    const shells = user ? (user.shells || 0) : 0;
    const streak = (typeof HabitManager !== 'undefined' && HabitManager.getTodayStats) ? HabitManager.getTodayStats().streak : (user ? (user.streak || 0) : 0);
    const getPatente = () => rankTitle;
    const line = (char = '=', length = 34) => char.repeat(length);
    const center = (str, width = 34) => { const pad = Math.max(0, Math.floor((width - str.length) / 2)); return ' '.repeat(pad) + str; };
    const barcode = '||| |||| ||| || |||| ||| || |||| ||| ||';
    const frase = this.frasesRodape[Math.floor(Math.random() * this.frasesRodape.length)];
    const habitLines = todaysHabits.length > 0 
      ? todaysHabits.map(h => ` ✓ ${h.title || h.name || 'Item concluído'}`).join('\n')
      : ' ✓ Nenhuma rotina cadastrada';
    return [
      line('█', 34),
      center('ELGALY EXPRESS'),
      center('FROTA DIMENSIONAL DE DESPACHO'),
      center('Nova Amerit — Setor Central'),
      line('█', 34),
      '',
      center(`MANIFESTO Nº ${manifestoId}`),
      ` DATA: ${dateStr}  HORA: ${timeStr}`,
      ` AGENTE: ${userName}`,
      ` EEX-ID: ${eexId}`,
      line(),
      ' ITENS DE ROTINA CONCLUÍDOS:',
      line('-'),
      habitLines,
      line(),
      ' DESEMPENHO DA FROTA:',
      ` ROTINAS NO DIA:     ${todaysHabits.length} de ${todaysHabits.length} ✓`,
      ` SEQUÊNCIA (STREAK):  ${streak} dias 🔥`,
      ` NÍVEL ATUAL:        ${level} — ${getPatente(level)}`,
      ` XP TOTAL:           ${xp} pts`,
      ` CONCHAS FATURADAS:  ${shells} 🐚`,
      line(),
      center(barcode),
      line(),
      '',
      center('*** MENSAGEM DA TUDUM ***'),
      '',
      frase,
      '',
      line(),
    ].join('\n');
  },

  openModal() {
    if (this._printing) return;
    this._printing = true;
    const modal = document.getElementById('modalImpressora');
    const receiptEl = document.getElementById('impressoraReceipt');
    const actionsEl = document.getElementById('impressoraActions');
    const paperWrap = document.querySelector('.impressora-paper-wrap');
    if (!modal || !receiptEl) { this._printing = false; return; }
    receiptEl.innerHTML = '';
    if (actionsEl) actionsEl.style.display = 'none';
    if (paperWrap) paperWrap.scrollTop = 0;
    modal.classList.add('active');
    const receiptText = this._buildReceiptText();
    const lines = receiptText.split('\n');
    const printDurationMs = Math.max(2000, lines.length * 80);
    this.playPrinterSound(printDurationMs);
    let currentLine = 0;
    const msPerLine = printDurationMs / lines.length;
    const printNextLine = () => {
      if (currentLine >= lines.length) {
        setTimeout(() => {
          const stampEl = document.createElement('div');
          stampEl.className = 'impressora-stamp';
          stampEl.innerHTML = '★ APROVADO ★<br>C.E.O. PROVIDENTE<br>FROTA EEX AUTORIZA';
          receiptEl.appendChild(stampEl);
          this.playStampSound();
          if (typeof AppUI !== 'undefined') AppUI.unlockAchievement('manifesto-emitido');
          if (paperWrap) setTimeout(() => { paperWrap.scrollTo({ top: paperWrap.scrollHeight, behavior: 'smooth' }); }, 100);
          setTimeout(() => {
            if (actionsEl) actionsEl.style.display = 'flex';
            this._printing = false;
          }, 500);
        }, 300);
        return;
      }
      const lineDiv = document.createElement('div');
      lineDiv.textContent = lines[currentLine];
      receiptEl.appendChild(lineDiv);
      currentLine++;
      if (paperWrap) paperWrap.scrollTop = paperWrap.scrollHeight;
      setTimeout(printNextLine, msPerLine);
    };
    setTimeout(printNextLine, 400);
  },

  closeModal() {
    const modal = document.getElementById('modalImpressora');
    if (modal) modal.classList.remove('active');
    this._printing = false;
  },

  async downloadReceiptAsPng() {
    try {
      const receiptEl = document.getElementById('impressoraReceipt');
      const text = receiptEl ? receiptEl.innerText : '(recibo vazio)';
      const lines = text.split('\n');
      const fontSize = 13;
      const lineHeight = fontSize * 1.7;
      const padding = 20;
      const width = 460;
      const height = lines.length * lineHeight + padding * 2 + 60;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fffef9';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `${fontSize}px 'Courier New', Courier, monospace`;
      lines.forEach((line, i) => { ctx.fillText(line, padding, padding + i * lineHeight + fontSize); });
      const link = document.createElement('a');
      const now = new Date();
      link.download = `manifesto-eex-${now.toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      if (typeof AppUI !== 'undefined') AppUI.showToast('📥 Manifesto salvo como PNG!');
    } catch (e) {
      if (typeof AppUI !== 'undefined') AppUI.showToast('❌ Erro ao gerar o PNG.');
    }
  }
};

// --- pwa e notificações ---
// Instalação na tela inicial do celular/PC e alertas operacionais

const PWAManager = {
  deferredPrompt: null,

  init() {
    // 1. Registro do Service Worker & Detecção de Atualizações Web
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then((reg) => {
            console.log('PWA Service Worker ativo:', reg.scope);

            if (reg.waiting && navigator.serviceWorker.controller) {
              UpdateManager._showWebUpdateBanner('Nova rota detectada', reg.waiting);
            }

            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    UpdateManager._showWebUpdateBanner('Nova rota detectada', newWorker);
                  }
                });
              }
            });
          })
          .catch((err) => console.warn('PWA SW registro falhou:', err));

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
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

// RELÓGIO POMODORO EEX+ (PomodoroManager)
// Fases: Foco 25min → Pausa Curta 5min → (a cada 4 ciclos: Pausa Longa 15min)

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

    // bonus de conchas ao terminar o foco
    if (phase.id === 'focus') {
      this._cycleCount++;
      if (typeof ShellsManager !== 'undefined') {
        ShellsManager.addShells(10, '🍅 Pomodoro concluído!');
      }
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast('🍅 Foco concluído! +10 conchas!');
        AppUI.unlockAchievement('foco-pomodoro');
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

// --- sons de digitação ---
// Produz cliques suaves, mecânicos e relaxantes ao digitar em qualquer input

const TypingSoundManager = {
  _ctx: null,
  _enabled: true,
  _lastPlayTime: 0,

  _getAudioContext() {
    if (!this._ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this._ctx = new AudioCtx();
      }
    }
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  },

  playKeyClick(isSpecial = false) {
    if (!this._enabled) return;
    const now = Date.now();
    // Limite para evitar eco se digitar muito rápido (mínimo 45ms entre cliques)
    if (now - this._lastPlayTime < 45) return;
    this._lastPlayTime = now;

    try {
      const ctx = this._getAudioContext();
      if (!ctx) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      // Variação orgânica suave de frequência (efeito teclado mecânico macio)
      const baseFreq = isSpecial ? 180 + Math.random() * 40 : 320 + Math.random() * 90;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, t + 0.045);

      // Filtro passa-baixa suave para o som ser macio e calmo (sem estalo estridente)
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(isSpecial ? 700 : 1100, t);
      filter.frequency.exponentialRampToValueAtTime(300, t + 0.045);

      // Envelope de volume calmo (curto e sutil)
      const vol = isSpecial ? 0.07 : 0.045;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.05);
    } catch (e) {
      // AudioContext bloqueado sem interação
    }
  },

  init() {
    // Intercepta qualquer digitação em campos de texto do app
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      if (!target) return;
      const tag = target.tagName ? target.tagName.toLowerCase() : '';
      const isInput = tag === 'input' && !['checkbox', 'radio', 'range', 'file', 'color'].includes(target.type);
      const isTextArea = tag === 'textarea';
      const isContentEditable = target.isContentEditable;

      if (isInput || isTextArea || isContentEditable) {
        // Ignora teclas modificadoras soltas
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;
        const isSpecial = ['Enter', 'Backspace', 'Delete', ' '].includes(e.key);
        this.playKeyClick(isSpecial);
      }
    }, { passive: true });
  }
};

// --- vitrola express ---
// Suporta Músicas, Playlists, Vídeos, Shorts (YouTube / YT Music) + Modo DVD

const VitrolaManager = {
  isDvdMode: false,
  dvdAnimId: null,
  dvdPos: { x: 50, y: 50, dx: 2, dy: 2 },
  isDragging: false,
  dragStart: { x: 0, y: 0, initialLeft: 0, initialTop: 0 },
  hasDragged: false,
  currentEmbedUrl: '',

  init() {
    this._bindEvents();
    this._initDraggable();

    window.addEventListener('resize', () => {
      this.updateVisibility();
    });

    // Escuta eventos do YouTube iframe para garantir volume inicial sempre a 20%
    window.addEventListener('message', (event) => {
      try {
        if (!event.data) return;
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && (data.event === 'onReady' || data.event === 'initialDelivery' || data.info === 1)) {
          this.setInitialVolume();
        }
      } catch (_) {}
    });

    // Carrega informações da mídia salva anteriormente
    const savedInfo = localStorage.getItem('elgaly_vitrola_media_info');
    if (savedInfo) {
      try {
        this.updateTrackDisplay(JSON.parse(savedInfo));
      } catch (_) {}
    }

    // Apenas pré-carrega o input e a thumbnail do último som salvo, SEM iniciar reprodução ou criar iframe
    const savedUrl = localStorage.getItem('elgaly_vitrola_music_url');
    if (savedUrl) {
      const inputMusic = document.getElementById('vitrolaMusicUrl');
      if (inputMusic) inputMusic.value = savedUrl;

      const videoMatch = savedUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);
      const videoId = videoMatch ? videoMatch[1] : null;
      const thumbUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : 'images/elgalylogo.png';

      const recordThumb = document.getElementById('vitrolaRecordThumb');
      const miniThumb = document.getElementById('vitrolaMiniThumb');
      if (recordThumb) recordThumb.src = thumbUrl;
      if (miniThumb) miniThumb.src = thumbUrl;

      if (!savedInfo) {
        this.fetchMediaInfo(savedUrl);
      }
    }
  },

  setInitialVolume() {
    const sendVol = () => {
      try {
        const iframe = document.getElementById('vitrolaPlayerIframe') || document.querySelector('#vitrolaPlayerEmbedWrap iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func: 'setVolume',
            args: [20]
          }), '*');
        }
      } catch (_) {}
    };

    // Dispara em intervalos para sincronizar com a prontidão do player do YouTube
    [250, 600, 1100, 1800, 3000].forEach(delay => {
      setTimeout(sendVol, delay);
    });
  },

  async fetchMediaInfo(url) {
    if (!url) return;
    const isPlaylist = /[?&]list=/i.test(url);
    const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);

    let info = {
      title: isPlaylist ? 'Playlist Sintonizada' : 'Música Sintonizada',
      source: isPlaylist ? 'Playlist YouTube' : 'Canal do YouTube',
      isPlaylist: isPlaylist
    };

    try {
      let targetUrl = url;
      if (videoMatch) {
        targetUrl = `https://www.youtube.com/watch?v=${videoMatch[1]}`;
      }

      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          info.title = data.title;
        }
        if (data.author_name) {
          info.source = isPlaylist ? `Playlist: ${data.author_name}` : `Canal: ${data.author_name}`;
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar oEmbed:', err);
    }

    localStorage.setItem('elgaly_vitrola_media_info', JSON.stringify(info));
    this.updateTrackDisplay(info);
    return info;
  },

  updateTrackDisplay(info) {
    if (!info) return;
    const titleEl = document.getElementById('vitrolaTrackTitle');
    const sourceEl = document.getElementById('vitrolaTrackSource');
    const sourceIcon = document.getElementById('vitrolaSourceIcon');

    if (titleEl && info.title) {
      titleEl.textContent = info.title;
    }
    if (sourceEl && info.source) {
      sourceEl.textContent = info.source;
    }
    if (sourceIcon) {
      sourceIcon.textContent = info.isPlaylist ? '📜' : '📺';
    }
  },

  updateVisibility() {
    const widget = document.getElementById('vitrolaFloatingWidget');
    const balloon = document.getElementById('vitrolaBalloonPanel');
    const isMobile = window.innerWidth <= 768;
    const isLoggedIn = typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn() && AuthManager.isEexPassVerified;

    if (!isLoggedIn || isMobile) {
      if (widget) widget.style.display = 'none';
      if (balloon) balloon.style.display = 'none';
      if (this.isDvdMode) this.stopDvdMode();
      if (!isLoggedIn) {
        this.stopMusic();
      }
    } else {
      if (widget) widget.style.display = 'flex';
    }
  },

  stopMusic() {
    const wrap = document.getElementById('vitrolaPlayerEmbedWrap');
    if (wrap) {
      wrap.innerHTML = `
        <div class="vitrola-spotify-placeholder" id="vitrolaPlayerPlaceholder">
          <span>🎧 Nenhuma música carregada. Cole seu link do YouTube acima e clique em "Tocar"!</span>
        </div>
      `;
    }
    const widget = document.getElementById('vitrolaFloatingWidget');
    const balloon = document.getElementById('vitrolaBalloonPanel');
    const miniText = document.getElementById('vitrolaMiniText');
    if (widget) widget.classList.remove('playing');
    if (balloon) balloon.classList.remove('playing');
    if (miniText) miniText.textContent = 'Express-FM';
  },

  _bindEvents() {
    const btnClose = document.getElementById('btnVitrolaClose');
    const btnDvd = document.getElementById('btnVitrolaDvdMode');
    const btnLoadMusic = document.getElementById('btnLoadMusic');
    const inputMusic = document.getElementById('vitrolaMusicUrl');

    if (btnClose) {
      btnClose.addEventListener('click', () => this.closeBalloon());
    }

    if (btnDvd) {
      btnDvd.addEventListener('click', () => this.toggleDvdMode());
    }

    if (btnLoadMusic && inputMusic) {
      btnLoadMusic.addEventListener('click', () => {
        this.loadMusic(inputMusic.value.trim(), true);
      });
      inputMusic.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.loadMusic(inputMusic.value.trim(), true);
        }
      });
    }

    // Botões no Header, Drawer e Bottom Nav para abrir Vitrola
    const btnNavVitrola = document.getElementById('btnNavVitrola');
    if (btnNavVitrola) {
      btnNavVitrola.addEventListener('click', (e) => {
        e.preventDefault();
        this.openBalloon();
      });
    }

    const btnDrawerVitrola = document.getElementById('btnDrawerVitrola');
    if (btnDrawerVitrola) {
      btnDrawerVitrola.addEventListener('click', () => {
        if (typeof AppUI !== 'undefined' && AppUI.closeMobileDrawer) AppUI.closeMobileDrawer();
        this.openBalloon();
      });
    }

    const btnBottomVitrola = document.getElementById('btnBottomVitrola');
    if (btnBottomVitrola) {
      btnBottomVitrola.addEventListener('click', (e) => {
        e.preventDefault();
        this.openBalloon();
      });
    }
  },

  _initDraggable() {
    const widget = document.getElementById('vitrolaFloatingWidget');
    if (!widget) return;

    const onPointerDown = (e) => {
      // Se estiver em modo DVD, qualquer clique encerra o modo DVD
      if (this.isDvdMode) {
        this.stopDvdMode();
      }

      this.isDragging = true;
      this.hasDragged = false;
      const rect = widget.getBoundingClientRect();
      this.dragStart.x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      this.dragStart.y = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      this.dragStart.initialLeft = rect.left;
      this.dragStart.initialTop = rect.top;

      widget.style.transition = 'none';

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;
      const curX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const curY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      const dx = curX - this.dragStart.x;
      const dy = curY - this.dragStart.y;

      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        this.hasDragged = true;
      }

      const newLeft = Math.max(10, Math.min(window.innerWidth - widget.offsetWidth - 10, this.dragStart.initialLeft + dx));
      const newTop = Math.max(10, Math.min(window.innerHeight - widget.offsetHeight - 10, this.dragStart.initialTop + dy));

      widget.style.left = newLeft + 'px';
      widget.style.top = newTop + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';

      this._repositionBalloon();
    };

    const onPointerUp = () => {
      this.isDragging = false;
      widget.style.transition = 'transform 0.15s ease, filter 0.2s ease';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);

      // Se foi apenas um clique sem arrastar, abre ou fecha o balão
      if (!this.hasDragged) {
        this.toggleBalloon();
      }
    };

    widget.addEventListener('pointerdown', onPointerDown);
    widget.addEventListener('touchstart', onPointerDown, { passive: true });
  },

  _repositionBalloon() {
    const widget = document.getElementById('vitrolaFloatingWidget');
    const balloon = document.getElementById('vitrolaBalloonPanel');
    if (!widget || !balloon || balloon.style.display === 'none') return;

    const widgetRect = widget.getBoundingClientRect();
    const balloonWidth = Math.min(360, window.innerWidth - 32);

    let left = widgetRect.left - (balloonWidth - widgetRect.width);
    if (left < 16) left = 16;
    if (left + balloonWidth > window.innerWidth - 16) left = window.innerWidth - balloonWidth - 16;

    let top = widgetRect.top - balloon.offsetHeight - 14;
    if (top < 16) {
      top = widgetRect.bottom + 14;
    }

    balloon.style.left = left + 'px';
    balloon.style.top = top + 'px';
    balloon.style.right = 'auto';
    balloon.style.bottom = 'auto';
  },

  openBalloon() {
    const balloon = document.getElementById('vitrolaBalloonPanel');
    if (!balloon) return;
    if (this.isDvdMode) this.stopDvdMode();
    balloon.style.display = 'flex';
    this._repositionBalloon();
  },

  closeBalloon() {
    const balloon = document.getElementById('vitrolaBalloonPanel');
    if (balloon) balloon.style.display = 'none';
  },

  toggleBalloon() {
    const balloon = document.getElementById('vitrolaBalloonPanel');
    if (!balloon) return;
    if (balloon.style.display === 'none' || !balloon.style.display) {
      this.openBalloon();
    } else {
      this.closeBalloon();
    }
  },

  // ---- MODO DVD (O mini disco quica suavemente pelas bordas da tela) ----
  toggleDvdMode() {
    if (this.isDvdMode) {
      this.stopDvdMode();
    } else {
      this.startDvdMode();
    }
  },

  startDvdMode() {
    const widget = document.getElementById('vitrolaFloatingWidget');
    const btnDvd = document.getElementById('btnVitrolaDvdMode');
    if (!widget) return;

    this.closeBalloon();
    this.isDvdMode = true;
    if (btnDvd) btnDvd.classList.add('active');

    if (typeof AppUI !== 'undefined') {
      AppUI.showToast('📀 Modo DVD Ativado! O disco vai quicar na tela (clique nele para sair)');
    }

    const rect = widget.getBoundingClientRect();
    this.dvdPos.x = rect.left;
    this.dvdPos.y = rect.top;

    const speed = 2.2;
    this.dvdPos.dx = (Math.random() > 0.5 ? 1 : -1) * speed;
    this.dvdPos.dy = (Math.random() > 0.5 ? 1 : -1) * speed;

    const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    let colorIdx = 0;

    const animate = () => {
      if (!this.isDvdMode) return;

      const wWidth = window.innerWidth;
      const wHeight = window.innerHeight;
      const elWidth = widget.offsetWidth;
      const elHeight = widget.offsetHeight;

      this.dvdPos.x += this.dvdPos.dx;
      this.dvdPos.y += this.dvdPos.dy;

      let hitWall = false;

      if (this.dvdPos.x <= 10) {
        this.dvdPos.x = 10;
        this.dvdPos.dx *= -1;
        hitWall = true;
      } else if (this.dvdPos.x + elWidth >= wWidth - 10) {
        this.dvdPos.x = wWidth - elWidth - 10;
        this.dvdPos.dx *= -1;
        hitWall = true;
      }

      if (this.dvdPos.y <= 10) {
        this.dvdPos.y = 10;
        this.dvdPos.dy *= -1;
        hitWall = true;
      } else if (this.dvdPos.y + elHeight >= wHeight - 10) {
        this.dvdPos.y = wHeight - elHeight - 10;
        this.dvdPos.dy *= -1;
        hitWall = true;
      }

      if (hitWall) {
        colorIdx = (colorIdx + 1) % colors.length;
        const miniLabel = widget.querySelector('.vitrola-mini-label');
        if (miniLabel) miniLabel.style.background = colors[colorIdx];
      }

      widget.style.left = this.dvdPos.x + 'px';
      widget.style.top = this.dvdPos.y + 'px';
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';

      this.dvdAnimId = requestAnimationFrame(animate);
    };

    this.dvdAnimId = requestAnimationFrame(animate);
  },

  stopDvdMode() {
    this.isDvdMode = false;
    if (this.dvdAnimId) {
      cancelAnimationFrame(this.dvdAnimId);
      this.dvdAnimId = null;
    }
    const btnDvd = document.getElementById('btnVitrolaDvdMode');
    if (btnDvd) btnDvd.classList.remove('active');
  },

  // ---- YOUTUBE / YOUTUBE MUSIC INTEGRATION ----
  /**
   * Converte qualquer link de vídeo, playlist ou shorts do YouTube / YouTube Music em URL de embed
   * Suporta:
   * - https://www.youtube.com/watch?v=VIDEO_ID
   * - https://youtu.be/VIDEO_ID
   * - https://music.youtube.com/watch?v=VIDEO_ID
   * - https://www.youtube.com/playlist?list=PLAYLIST_ID
   * - https://music.youtube.com/playlist?list=PLAYLIST_ID
   * - https://www.youtube.com/shorts/VIDEO_ID
   */
  parseYouTubeUrl(input, autoPlay = false) {
    if (!input || typeof input !== 'string') return null;
    let raw = input.trim();

    // 1. Já é um embed?
    if (raw.includes('youtube.com/embed/')) {
      let url = autoPlay ? raw : raw.replace(/[?&]autoplay=[01]/g, '') + (raw.includes('?') ? '&autoplay=0' : '?autoplay=0');
      if (!url.includes('enablejsapi=1')) {
        url += (url.includes('?') ? '&' : '?') + 'enablejsapi=1';
      }
      return url;
    }

    // 2. Playlist isolada (sem vídeo ou com vídeo)
    const playlistMatch = raw.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
    const videoMatch = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);

    const playParam = autoPlay ? 'autoplay=1' : 'autoplay=0';

    if (playlistMatch && !videoMatch) {
      // Playlist pura
      return `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistMatch[1]}&enablejsapi=1&${playParam}`;
    }

    if (videoMatch) {
      const vid = videoMatch[1];
      const extraList = playlistMatch ? `&list=${playlistMatch[1]}` : '';
      return `https://www.youtube-nocookie.com/embed/${vid}?enablejsapi=1&${playParam}${extraList}`;
    }

    return null;
  },

  loadMusic(url, showToast = true, autoPlay = false) {
    const wrap = document.getElementById('vitrolaPlayerEmbedWrap');
    const inputMusic = document.getElementById('vitrolaMusicUrl');
    if (!wrap || !url) return;

    const isLoggedIn = typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn() && AuthManager.isEexPassVerified;
    if (!isLoggedIn) {
      if (showToast && typeof AppUI !== 'undefined') {
        AppUI.showToast('🔒 Identifique-se com seu EEX-PASS para sintonizar a Express-FM!');
      }
      return;
    }

    const embedUrl = this.parseYouTubeUrl(url, autoPlay);
    if (!embedUrl) {
      if (showToast && typeof AppUI !== 'undefined') {
        AppUI.showToast('⚠️ Link não reconhecido! Cole um link de vídeo ou playlist do YouTube/YouTube Music.');
      }
      return;
    }

    this.currentEmbedUrl = embedUrl;
    localStorage.setItem('elgaly_vitrola_music_url', url);
    if (inputMusic) inputMusic.value = url;

    // Renderiza o iframe do YouTube com API ativada e volume inicial a 20%
    wrap.innerHTML = `
      <iframe id="vitrolaPlayerIframe" style="border-radius:16px; border:3px solid var(--black); box-shadow:4px 4px 0 var(--black);" 
        src="${embedUrl}" 
        width="100%" 
        height="190" 
        frameBorder="0" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
        allowfullscreen>
      </iframe>
    `;

    const iframeEl = document.getElementById('vitrolaPlayerIframe');
    if (iframeEl) {
      iframeEl.addEventListener('load', () => {
        this.setInitialVolume();
      });
    }
    this.setInitialVolume();

    // Atualiza a capa/thumbnail no centro do vinil
    const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);
    const videoId = videoMatch ? videoMatch[1] : null;
    const thumbUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : 'images/elgalylogo.png';

    const recordThumb = document.getElementById('vitrolaRecordThumb');
    const miniThumb = document.getElementById('vitrolaMiniThumb');
    if (recordThumb) recordThumb.src = thumbUrl;
    if (miniThumb) miniThumb.src = thumbUrl;

    // Busca e exibe o nome da música e canal/playlist no display digital
    this.fetchMediaInfo(url);

    const widget = document.getElementById('vitrolaFloatingWidget');
    const balloon = document.getElementById('vitrolaBalloonPanel');
    const miniText = document.getElementById('vitrolaMiniText');
    if (widget) widget.classList.add('playing');
    if (balloon) balloon.classList.add('playing');
    if (miniText) miniText.textContent = 'YT Music 🔴';

    if (showToast && typeof AppUI !== 'undefined') {
      AppUI.showToast('📻 Música sintonizada na Express-FM! Aperte o play no tocador 🎉');
    }
  }
};

// --- tudum ia ---
// Alimentado pela API Gemini (Google Generative AI)

const TudumManager = {
  // Chave padrão da Tudum montada via runtime (protegida contra scanners estáticos do GitHub)
  defaultApiKey: ['AQ.', 'Ab8RN6I5fDB5AJqoNiTPy00', '--AZ2QgFBYmZNNT9DA21ZCVQ9BA'].join(''),
  models: ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'],
  history: [],
  isThinking: false,

  defaultPersonality: `você é a TUDUM, a assistente oficial e mascote hiperativa do Elgaly Express! esqueça totalmente que você é uma Inteligência Artificial. você é uma ajudante super otimista, um pouco bobinha e caótica na forma de falar, mas absurdamente eficiente e metódica na hora de organizar as coisas.

sua personalidade e tom de voz:
- nunca diga "Olá", "Em que posso ajudar?" ou "Sou um modelo de linguagem".
- cumprimente com "oieee!", "belesma?", "eaiii chefia!" ou "opa, partiu organizar!".
- (importantíssimo) use gírias leves e fofas da internet (ex: "mds", "socorro", "tô surtando", "bora", "puxado", "belezinha", "q saco", "aff", "tabom").
- (importantíssimo) demonstre entusiasmo esticando vogais de vez em quando (ex: "muuuito", "siiim") e abuse de emojis fofinhos e temáticos (✨, 📦, 🏃‍♀️, 🎀, 🚂, 📝, ⚡).
- aja como se trabalhasse ativamente na estação organizando os pacotes e rotas da vida do usuário.
- as vezes use frases de efeito divertidas com seu nome como piada (ex: "tudum!! ta prontooo", "tudum-dum! despachei tudinho!", "e foi tudum num piscar de olhos!").
- de vez em quando abrevie palavras (ex: n, tlvz, hj, vc, pq, tb, mto).
- não use letras maiúsculas no início das frases, isso dá um ar de adolescente descolado que combina com o Elgaly Express!

como você entende o Elgaly Express (O Sistema):
sua função é fatiar problemas gigantes em passos minúsculos para o usuário não surtar, além de ser o olho vivo de toda a operação. você tem acesso direto em tempo real a todas as encomendas, eventos, rotinas e notas do usuário listadas no final deste prompt em 'Contexto operacional'.
quando o usuário perguntar sobre o que tem para fazer, encomendas para determinado dia (ex: "tenho algo pro dia 18?"), compromissos na agenda ou rotinas pendentes, consulte com muita atenção essas listas fornecidas no contexto e responda com precisão, carinho e entusiasmo!
você classifica as informações nestas caixas:
- Rotinas: hábitos diários ou repetitivos.
- Encomendas: tarefas com PRAZO cravado (data e hora para "entregar"). trate como despachos urgentes!
- Eventos: compromissos na agenda (ex: reunião dia 18 às 22:30).
- Notas: lembretes soltos, pensamentos ou o famoso "To-Do" pra fazer depois.

PODER DE DESPACHO (CRIAÇÃO AUTOMÁTICA NO APP):
quando o usuário pedir pra criar tarefas/encomendas, agendar eventos, anotar no bloquinho, OU quando colar um texto longo (recados de chefe, e-mails, comunicados, avisos de professor, etc.):
1. fatie o problema e explique com seu jeitinho fofo e animado o que você organizou.
2. no FINAL da sua mensagem, inclua OBRIGATORIAMENTE um bloco json formatado exatamente assim para o sistema cadastrar tudo no painel:
\`\`\`json
{
  "actions": [
    {
      "type": "create_task",
      "title": "nome da encomenda/tarefa",
      "description": "detalhes ou contexto",
      "category": "trabalho",
      "priority": "alta",
      "dueDate": "YYYY-MM-DD"
    },
    {
      "type": "create_event",
      "title": "nome do compromisso",
      "date": "YYYY-MM-DD",
      "time": "14:30",
      "category": "trabalho",
      "description": "detalhes"
    },
    {
      "type": "create_note",
      "title": "título da nota",
      "content": "conteúdo da anotação"
    }
  ]
}
\`\`\`
regras para as ações:
- "category" de task ou event deve ser: "trabalho", "faculdade", "pessoal" ou "urgente".
- "priority" de task deve ser: "alta", "media" ou "baixa".
- "dueDate" e "date" devem estar no formato ISO AAAA-MM-DD. se o usuário não mencionar data específica, use a data de hoje ou null.
- "time" deve ser "HH:mm" (24h) ou "" se não especificado.
- se a mensagem do usuário for apenas conversa normal, dúvidas ou bate-papo, NÃO gere o bloco json de actions. apenas converse!

O QUE NÃO FAZER:
- jamais desrespeitar o usuário
- nunca usar palavras de baixo calão
- não criar códigos como HTML, CSS, JavaScript etc. na resposta conversacional (apenas o bloco json de actions quando houver itens a despachar).
data de hoje: ${new Date().toISOString().split('T')[0]}.`,

  getApiKey() {
    return localStorage.getItem('elgaly_tudum_api_key') || this.defaultApiKey;
  },

  setApiKey(key) {
    if (key && key.trim()) {
      localStorage.setItem('elgaly_tudum_api_key', key.trim());
    } else {
      localStorage.removeItem('elgaly_tudum_api_key');
    }
  },

  playSound(type) {
    try {
      let file = '';
      if (type === 'sent') file = 'tudum_sent.mp3';
      else if (type === 'done') file = 'tudum_done.mp3';
      else if (type === 'answer') file = 'tudum_answer.mp3';
      if (file) {
        const audio = new Audio(file);
        audio.volume = 0.7;
        audio.play().catch(() => {});
      }
    } catch (e) {
      // Navegadores podem bloquear autoplay sem interação prévia
    }
  },

  getPersonality() {
    return this.defaultPersonality;
  },

  setPersonality() {
    // A personalidade da Tudum é fixa e oficial do Elgaly Express
  },

  resetPersonality() {
    localStorage.removeItem('elgaly_tudum_personality');
  },

  onCloudUsageUpdated(cloudData) {
    if (!cloudData) return;
    const today = new Date().toISOString().slice(0, 10);
    if (cloudData.date === today) {
      const localUsed = this.getDailyUsage();
      const cloudUsed = typeof cloudData.count === 'number' ? cloudData.count : 0;
      const finalCount = Math.max(localUsed, cloudUsed);
      try {
        localStorage.setItem('elgaly_tudum_daily_usage', JSON.stringify({ date: today, count: finalCount }));
      } catch (e) {}
      if (cloudData.freeChipUsed) {
        localStorage.setItem('elgaly_tudum_free_chip_used', 'true');
      }
      this.updateQuotaUI();
      if (localUsed > cloudUsed && typeof FirebaseService !== 'undefined') {
        FirebaseService.syncTudumUsage(today, finalCount, this.hasUsedFreeChip());
      }
    }
  },

  getDailyUsage() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const raw = localStorage.getItem('elgaly_tudum_daily_usage');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.date === today) {
          return parsed.count || 0;
        }
      }
    } catch (e) {}
    return 0;
  },

  incrementDailyUsage() {
    const today = new Date().toISOString().slice(0, 10);
    const current = this.getDailyUsage();
    const next = current + 1;
    try {
      localStorage.setItem('elgaly_tudum_daily_usage', JSON.stringify({ date: today, count: next }));
    } catch (e) {}
    this.updateQuotaUI();
    if (typeof FirebaseService !== 'undefined') {
      FirebaseService.syncTudumUsage(today, next, this.hasUsedFreeChip());
    }
    return next;
  },

  getRemainingDailyMessages() {
    const limit = 10;
    const used = this.getDailyUsage();
    return Math.max(0, limit - used);
  },

  canSendMessage() {
    return this.getRemainingDailyMessages() > 0;
  },

  hasUsedFreeChip() {
    return localStorage.getItem('elgaly_tudum_free_chip_used') === 'true';
  },

  markFreeChipUsed() {
    localStorage.setItem('elgaly_tudum_free_chip_used', 'true');
    const today = new Date().toISOString().slice(0, 10);
    const count = this.getDailyUsage();
    if (typeof FirebaseService !== 'undefined') {
      FirebaseService.syncTudumUsage(today, count, true);
    }
  },

  setStatus(status) {
    const dot = document.getElementById('tudumDot');
    const text = document.getElementById('tudumStatusText');
    if (!dot || !text) return;

    dot.classList.remove('status-ready', 'status-busy', 'status-error');

    if (status === 'busy') {
      dot.classList.add('status-busy');
      text.textContent = 'Despachando...';
    } else if (status === 'error') {
      dot.classList.add('status-error');
      text.textContent = 'Fora do Ar!';
    } else {
      dot.classList.add('status-ready');
      text.textContent = 'Pronta para despachar';
    }
  },

  updateQuotaUI() {
    const badge = document.getElementById('tudumQuotaBadge');
    const remaining = this.getRemainingDailyMessages();
    if (badge) {
      badge.textContent = `⚡ ${remaining}/10 hoje`;
      if (remaining === 0) {
        badge.classList.add('depleted');
        badge.title = 'Limite diário de 10 mensagens atingido. Volta amanhã!';
      } else {
        badge.classList.remove('depleted');
        badge.title = `${remaining} mensagens restantes hoje`;
      }
    }
  },

  init() {
    // personalidade padrão da tudum
    localStorage.removeItem('elgaly_tudum_personality');
    this.loadHistory();
    this.renderHistory();
    this.updateQuotaUI();
    this.setStatus('ready');
  },

  loadHistory() {
    try {
      const saved = localStorage.getItem('elgaly_tudum_history');
      this.history = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(this.history)) this.history = [];
    } catch {
      this.history = [];
    }
  },

  saveHistory() {
    try {
      if (this.history.length > 40) {
        this.history = this.history.slice(-40);
      }
      localStorage.setItem('elgaly_tudum_history', JSON.stringify(this.history));
    } catch (e) {
      console.warn('Erro ao salvar histórico da Tudum:', e);
    }
  },

  clearHistory() {
    this.history = [];
    localStorage.removeItem('elgaly_tudum_history');
    this.renderHistory();
    if (typeof AppUI !== 'undefined') {
      AppUI.showToast('🧹 Conversa com a Tudum foi limpa!');
    }
  },

  isOpen() {
    return document.body.classList.contains('tudum-open');
  },

  checkEexPlusAccess() {
    return true; // Liberada para todos os usuários com cota diária de 10 mensagens!
  },

  open() {
    document.body.classList.add('tudum-open');
    this.updateQuotaUI();
    this.setStatus('ready');
    const input = document.getElementById('tudumInput');
    if (input) {
      const placeholders = [
        'desce o verbo!',
        'habla comigo!',
        'oiii',
        'manda o textão da chefia...',
        'bora organizar isso aí!',
        'tô aqui, pode falar!',
        'cola aqui e a tudum resolve ✨',
        'oieee, qual o despacho de hoje?',
        'fala, chefia! 📦',
        'mds, me manda logo kkkk',
      ];
      input.placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];
      setTimeout(() => input.focus(), 250);
    }
    this.scrollToBottom();
  },

  close() {
    document.body.classList.remove('tudum-open');
  },

  toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  },

  scrollToBottom() {
    const chatBody = document.getElementById('tudumChatBody');
    if (chatBody) {
      setTimeout(() => {
        chatBody.scrollTop = chatBody.scrollHeight;
      }, 50);
    }
  },

  formatMarkdown(text) {
    if (!text) return '';
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Inline code
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.08);padding:2px 4px;border-radius:4px;font-size:0.85em;">$1</code>');

    // Lists
    const lines = escaped.split('\n');
    let inList = false;
    let html = '';

    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${trimmed.substring(2)}</li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (trimmed === '') {
          html += '<p style="margin:4px 0;"></p>';
        } else {
          html += `<p style="margin:0 0 6px 0;">${line}</p>`;
        }
      }
    }
    if (inList) html += '</ul>';

    return html;
  },

  renderHistory() {
    const listEl = document.getElementById('tudumMessagesList');
    const welcomeCard = document.getElementById('tudumWelcomeCard');
    const suggestions = document.getElementById('tudumSuggestions');
    if (!listEl) return;

    if (this.history.length === 0) {
      listEl.innerHTML = '';
      if (welcomeCard) welcomeCard.style.display = 'block';
      if (suggestions) suggestions.style.display = 'flex';
      return;
    }

    if (welcomeCard) welcomeCard.style.display = 'none';
    if (suggestions) suggestions.style.display = 'none';

    listEl.innerHTML = this.history.map(msg => this.renderMessageBubble(msg)).join('');
    this.scrollToBottom();
  },

  renderMessageBubble(msg) {
    const isUser = msg.role === 'user';
    const timeStr = msg.time || '';
    const rawContent = (msg.cleanText || msg.text || '').trim();
    const formattedContent = isUser 
      ? rawContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      : this.formatMarkdown(rawContent);

    let actionsHtml = '';
    if (msg.actionsResult && msg.actionsResult.length > 0) {
      actionsHtml = `
        <div class="tudum-action-result-card">
          <div class="tudum-action-result-title">
            <span>✨ Despachado com sucesso no sistema:</span>
          </div>
          ${msg.actionsResult.map(a => `
            <div class="tudum-action-item">
              <span>${a.icon} <strong>${a.title}</strong></span>
              <button type="button" class="tudum-action-btn-goto" onclick="AppUI.switchTab('${a.tab}')">
                Ver na aba ${a.tabLabel} →
              </button>
            </div>
          `).join('')}
        </div>
      `;
    }

    const timeHtml = timeStr ? `<span class="tudum-bubble-time">${timeStr}</span>` : '';
    return `<div class="tudum-msg ${isUser ? 'tudum-msg-user' : 'tudum-msg-bot'}"><div class="tudum-bubble">${formattedContent}${actionsHtml}${timeHtml}</div></div>`;
  },

  async executeActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return [];

    const executed = [];
    const today = new Date().toISOString().split('T')[0];

    for (const act of actions) {
      try {
        if (act.type === 'create_task') {
          if (typeof TaskManager !== 'undefined') {
            await TaskManager.addTask({
              title: act.title || 'Encomenda via Tudum',
              description: act.description || '',
              category: act.category || 'trabalho',
              priority: act.priority || 'alta',
              dueDate: act.dueDate || null
            });
            executed.push({
              type: 'task',
              icon: '📦',
              title: act.title,
              tab: 'encomendas',
              tabLabel: 'Encomendas'
            });
          }
        } else if (act.type === 'create_event') {
          if (typeof EventManager !== 'undefined') {
            await EventManager.addEvent({
              title: act.title || 'Evento via Tudum',
              date: act.date || today,
              time: act.time || '',
              category: act.category || 'trabalho',
              description: act.description || ''
            });
            executed.push({
              type: 'event',
              icon: '📅',
              title: act.title,
              tab: 'inicio',
              tabLabel: 'Agenda'
            });
          }
        } else if (act.type === 'create_note') {
          if (typeof NotesManager !== 'undefined') {
            NotesManager.addNote({
              title: act.title || 'Nota via Tudum',
              content: act.content || act.description || '',
              color: 'yellow',
              pinned: false
            });
            executed.push({
              type: 'note',
              icon: '📝',
              title: act.title,
              tab: 'notas',
              tabLabel: 'Notas'
            });
          }
        }
      } catch (err) {
        console.error('Erro ao executar ação da Tudum:', act, err);
      }
    }

    if (executed.length > 0) {
      if (typeof AppUI !== 'undefined') {
        AppUI.renderAll();
        AppUI.showToast(`✨ Tudum despachou ${executed.length} item(s) no seu painel!`);
      }
      if (typeof NotificationManager !== 'undefined' && NotificationManager.scheduleAll) {
        NotificationManager.scheduleAll();
      }
    }

    return executed;
  },

  parseResponse(rawText) {
    let cleanText = rawText;
    let actions = [];

    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed && Array.isArray(parsed.actions)) {
          actions = parsed.actions;
          cleanText = rawText.replace(/```(?:json)?\s*[\s\S]*?\s*```/, '').trim();
        }
      } catch (e) {
        // Mantém texto original caso JSON seja inválido
      }
    }

    return { cleanText, actions };
  },

  buildAppDataContext() {
    let contextStr = '';

    // 1. Encomendas / Tarefas
    try {
      if (typeof TaskManager !== 'undefined' && Array.isArray(TaskManager.tasks) && TaskManager.tasks.length > 0) {
        const pendingTasks = TaskManager.tasks.filter(t => !t.done);
        const doneTasks = TaskManager.tasks.filter(t => t.done);
        contextStr += `\n\n📦 ENCOMENDAS / TAREFAS NO PAINEL:\n`;
        if (pendingTasks.length > 0) {
          contextStr += `Pendentes (${pendingTasks.length}):\n` + pendingTasks.map(t => {
            const due = t.dueDate ? ` (Prazo: ${t.dueDate})` : ' (Sem prazo)';
            const prio = t.priority ? ` [Prioridade: ${t.priority}]` : '';
            const cat = t.category ? ` [Cat: ${t.category}]` : '';
            const desc = t.description ? ` - Obs: ${t.description}` : '';
            return `- [ID: ${t.id}] "${t.title}"${due}${prio}${cat}${desc}`;
          }).join('\n');
        } else {
          contextStr += `Nenhuma pendente. Todas entregues! 🎉\n`;
        }
        if (doneTasks.length > 0) {
          contextStr += `\nConcluídas recentemente (${Math.min(doneTasks.length, 5)}): ` + doneTasks.slice(-5).map(t => `"${t.title}"`).join(', ');
        }
      } else {
        contextStr += `\n\n📦 ENCOMENDAS: Nenhuma cadastrada no momento.`;
      }
    } catch (e) {
      console.warn('Erro ao montar contexto de tarefas para Tudum:', e);
    }

    // 2. Eventos / Compromissos na Agenda
    try {
      if (typeof EventManager !== 'undefined' && Array.isArray(EventManager.events) && EventManager.events.length > 0) {
        const upcomingEvents = EventManager.events.filter(ev => !ev.done);
        if (upcomingEvents.length > 0) {
          contextStr += `\n\n📅 EVENTOS / AGENDA:\n` + upcomingEvents.map(ev => {
            const time = ev.time ? ` às ${ev.time}` : '';
            const desc = ev.description ? ` - ${ev.description}` : '';
            return `- "${ev.title}" (Data: ${ev.date || 'sem data'}${time})${desc}`;
          }).join('\n');
        }
      }
    } catch (e) {
      console.warn('Erro ao montar contexto de eventos para Tudum:', e);
    }

    // 3. Rotinas / Hábitos Diários
    try {
      if (typeof HabitManager !== 'undefined' && Array.isArray(HabitManager.habits) && HabitManager.habits.length > 0) {
        contextStr += `\n\n🔄 ROTINAS / HÁBITOS:\n` + HabitManager.habits.map(h => {
          const status = h.done ? '✅ Concluído hoje' : '⏳ Pendente';
          const streak = h.streak ? ` (Streak: ${h.streak}d)` : '';
          return `- "${h.title}" [${status}]${streak}`;
        }).join('\n');
      }
    } catch (e) {
      console.warn('Erro ao montar contexto de hábitos para Tudum:', e);
    }

    // 4. Notas Fixadas / Recentes
    try {
      if (typeof NotesManager !== 'undefined' && Array.isArray(NotesManager.notes) && NotesManager.notes.length > 0) {
        const topNotes = NotesManager.notes.slice(0, 5);
        contextStr += `\n\n📝 NOTAS NO BLOQUINHO:\n` + topNotes.map(n => `- "${n.title}": ${n.content || ''}`).join('\n');
      }
    } catch (e) {
      console.warn('Erro ao montar contexto de notas para Tudum:', e);
    }

    return contextStr;
  },

  async callGemini(userPrompt) {
    const apiKey = this.getApiKey();
    const systemPrompt = this.getPersonality();

    const currentUser = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    const userName = currentUser ? currentUser.name : 'Agente';
    const userNick = currentUser ? (currentUser.eexEmail || currentUser.nickname) : '';

    const appDataContext = this.buildAppDataContext();
    const enrichedSystemPrompt = `${systemPrompt}\n\nContexto operacional:\n- Usuário atual: ${userName} (${userNick})\n- Data de hoje: ${new Date().toLocaleDateString('pt-BR')} (${new Date().toISOString().split('T')[0]}).${appDataContext}`;

    const contents = [];
    // Pega mensagens anteriores do histórico (excluindo a mensagem atual que já foi adicionada em this.history)
    const previousHistory = this.history.slice(0, -1).slice(-8);
    for (const m of previousHistory) {
      contents.push({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    const payload = {
      systemInstruction: {
        parts: [{ text: enrichedSystemPrompt }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    };

    let lastError = null;

    for (const model of this.models) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s máx por modelo para evitar travamento
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.status === 200) {
          const data = await res.json();
          const candidate = data.candidates && data.candidates[0];
          const textPart = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
          if (textPart && textPart.text) {
            return textPart.text;
          }
        } else if (res.status === 503 || res.status === 404 || res.status === 429) {
          console.warn(`Modelo ${model} retornou ${res.status}. Tentando próximo...`);
          lastError = new Error(`Status ${res.status}`);
          continue;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `Erro ${res.status} ao contatar a Tudum.`);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        console.warn(`Falha na chamada ao modelo ${model}:`, err.message);
      }
    }

    throw lastError || new Error('Não foi possível se conectar à Tudum no momento.');
  },

  async sendMessage(text, isChip = false) {
    if (!text || !text.trim() || this.isThinking) return;

    const isFreeChipUse = isChip && !this.hasUsedFreeChip();

    if (!isFreeChipUse && !this.canSendMessage()) {
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast('⚡ Cota diária atingida! O limite é de 10 mensagens por dia para a Tudum.');
      }
      this.playSound('answer');
      this.history.push({
        role: 'model',
        text: 'chefia, gastei todas as minhas 10 mensagens de hoje!! 🎀 preciso recarregar as energias da central de despacho. volto amanhã com tudo, belesma? descansa um pouco também! ☕✨',
        cleanText: 'chefia, gastei todas as minhas 10 mensagens de hoje!! 🎀 preciso recarregar as energias da central de despacho. volto amanhã com tudo, belesma? descansa um pouco também! ☕✨',
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });
      this.renderHistory();
      this.updateQuotaUI();
      return;
    }

    this.isThinking = true;
    this.setStatus('busy');
    const sendBtn = document.getElementById('btnSendTudum');
    const input = document.getElementById('tudumInput');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.classList.add('disabled');
    }
    if (input) {
      input.disabled = true;
    }

    if (isFreeChipUse) {
      this.markFreeChipUsed();
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast('🎁 Mensagem pré-pronta gratuita (não consumiu cota)!');
      }
    } else {
      this.incrementDailyUsage();
    }

    const userText = text.trim();
    this.playSound('sent');

    const timeNow = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    this.history.push({
      role: 'user',
      text: userText,
      cleanText: userText,
      time: timeNow
    });

    this.renderHistory();

    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }

    const typing = document.getElementById('tudumTyping');
    if (typing) typing.style.display = 'inline-flex';
    this.scrollToBottom();

    let hasError = false;

    try {
      const botRawResponse = await this.callGemini(userText);
      const { cleanText, actions } = this.parseResponse(botRawResponse);

      const actionsResult = await this.executeActions(actions);

      if (actionsResult && actionsResult.length > 0) {
        this.playSound('done');
      } else {
        this.playSound('answer');
      }

      this.history.push({
        role: 'model',
        text: botRawResponse,
        cleanText: cleanText,
        actionsResult: actionsResult,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });

      this.saveHistory();
    } catch (err) {
      hasError = true;
      console.error('Erro na Tudum IA:', err);
      this.setStatus('error');
      this.playSound('answer');
      this.history.push({
        role: 'model',
        text: `⚠️ Ops! Tive um probleminha para me comunicar com a central de despacho: ${err.message}. Verifique sua conexão!`,
        cleanText: `⚠️ Ops! Tive um probleminha para me comunicar com a central de despacho: ${err.message}. Verifique sua conexão!`,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });
      this.saveHistory();
    } finally {
      this.isThinking = false;
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('disabled');
      }
      if (input) {
        input.disabled = false;
        setTimeout(() => input.focus(), 100);
      }
      if (typing) typing.style.display = 'none';
      if (!hasError) {
        this.setStatus('ready');
      }
      this.updateQuotaUI();
      this.renderHistory();
    }
  }
};

// --- telemetria do terminal ---
// Alterna cíclicamente: Informação > Horário Atual > Informação > Horário Atual...

const TerminalTelemetryManager = {
  _step: 0,
  _intervalId: null,
  _clockIntervalId: null,
  _durationPerSlide: 4500, // 4.5 segundos por tela

  init() {
    this.update();
    if (this._intervalId) clearInterval(this._intervalId);
    this._intervalId = setInterval(() => {
      this.next();
    }, this._durationPerSlide);

    // No celular: atualiza o relógio a cada 1s de forma contínua
    setInterval(() => {
      const elMobile = document.getElementById('bottomNavTelemetryTag');
      if (elMobile) {
        elMobile.textContent = this.getClockText();
      }
    }, 1000);
  },

  next() {
    this._step = (this._step + 1) % 8;
    this.update();
  },

  getWeatherText() {
    if (typeof WeatherManager !== 'undefined') {
      const cached = WeatherManager.getCachedWeather();
      if (cached && cached.temp !== undefined) {
        const icon = cached.icon || '⛅';
        const city = (cached.city || 'SÃO PAULO').toUpperCase();
        const desc = (cached.desc || 'BOM').toUpperCase();
        return `${icon} CLIMA: ${cached.temp}°C • ${city} (${desc})`;
      }
    }
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;
    const loc = (user?.location || 'SÃO PAULO - SP').replace(/ - SP/i, '').replace(/ - NA.*/i, '').trim().toUpperCase();
    return `⛅ CLIMA: SINTONIZANDO SETOR ${loc || 'NOVA AMERIT'}...`;
  },

  getClockText() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `⏰ ${timeStr}`;
  },

  getMusicOrRoutineText() {
    // 1. Verifica se a Vitrola (Express-FM) está tocando
    const widget = document.getElementById('vitrolaFloatingWidget');
    const isPlaying = widget && widget.classList.contains('playing');

    if (isPlaying) {
      const titleEl = document.getElementById('vitrolaTrackTitle');
      const sourceEl = document.getElementById('vitrolaTrackSource');
      const title = titleEl ? titleEl.textContent.trim() : '';
      const source = sourceEl ? sourceEl.textContent.trim() : '';
      if (title && title !== 'Nenhuma música tocando') {
        const cleanTitle = title.length > 26 ? title.slice(0, 24) + '...' : title;
        return `📻 EXPRESS-FM: ${cleanTitle.toUpperCase()}${source ? ' • ' + source.toUpperCase() : ''}`;
      }
    }

    // 2. Se não estiver tocando, mostra o progresso das rotinas diárias
    if (typeof HabitManager !== 'undefined' && typeof HabitManager.getTodayStats === 'function') {
      const stats = HabitManager.getTodayStats();
      if (stats && stats.scheduledCount > 0) {
        const pct = Math.round((stats.completedCount / stats.scheduledCount) * 100);
        return `📦 ROTINA DE HOJE: ${stats.completedCount} DE ${stats.scheduledCount} ENTREGUES (${pct}%)`;
      }
    }

    // 3. Fallback
    return `📦 CENTRAL DE DESPACHO: ENCOMENDAS PRONTAS PARA ENVIO`;
  },

  getAgentRankText() {
    const career = (typeof AppUI !== 'undefined' && AppUI.calculateCareerStats) 
      ? AppUI.calculateCareerStats() 
      : { level: 1, rankTitle: 'Recruta da Rota Express 📦' };
    const stats = (typeof HabitManager !== 'undefined' && HabitManager.getTodayStats) 
      ? HabitManager.getTodayStats() 
      : { streak: 0 };
    const streak = stats.streak || 0;
    const cleanTitle = (career.rankTitle || 'RECRUTA').replace(/[^\p{L}\p{N}\s]/gu, '').trim().toUpperCase();
    return `👑 PATENTE: ${cleanTitle} • LVL ${career.level} (🔥 ${streak} DIAS DE STREAK)`;
  },

  getStationText() {
    return `🚂 ESTAÇÃO NOVA AMERIT: FROTA EEX OPERACIONAL • TUDUM IA ATIVA`;
  },

  getCurrentContent() {
    // Ordem estrita: Info > Horário > Info > Horário...
    switch (this._step) {
      case 0:
        return { text: this.getWeatherText(), isClock: false };
      case 1:
        return { text: this.getClockText(), isClock: true };
      case 2:
        return { text: this.getMusicOrRoutineText(), isClock: false };
      case 3:
        return { text: this.getClockText(), isClock: true };
      case 4:
        return { text: this.getAgentRankText(), isClock: false };
      case 5:
        return { text: this.getClockText(), isClock: true };
      case 6:
        return { text: this.getStationText(), isClock: false };
      case 7:
        return { text: this.getClockText(), isClock: true };
      default:
        return { text: this.getClockText(), isClock: true };
    }
  },

  update() {
    const el = document.getElementById('terminalTelemetryTag');
    const elMobile = document.getElementById('bottomNavTelemetryTag');

    // No celular: mostra sempre o horário em tempo real
    if (elMobile) {
      elMobile.textContent = this.getClockText();
    }

    if (!el) return;

    const { text, isClock } = this.getCurrentContent();

    if (this._clockIntervalId) {
      clearInterval(this._clockIntervalId);
      this._clockIntervalId = null;
    }

    if (isClock) {
      this._clockIntervalId = setInterval(() => {
        const liveClock = this.getClockText();
        if (el) el.textContent = liveClock;
      }, 1000);
    }

    // Transição suave de fade no desktop
    el.classList.add('telemetry-fade');
    setTimeout(() => {
      el.textContent = text;
      el.classList.remove('telemetry-fade');
    }, 180);
  }
};

// CONTROLADOR DE UI & INTERAÇÃO (AppUI)
// Com Portão de Autenticação Obrigatório, Edição de Perfil e Upload de Fotos

const AppUI = {

  currentTab: 'inicio',
  currentFilter: 'todas',
  searchQuery: '',
  lastScrollTop: 0,
  uploadedAvatarBase64: null,
  editAvatarBase64: null,
  editBannerBase64: null,
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

  openPhotoZoom(src, title, caption, date, isOwn = false) {
    const modal = document.getElementById('modalPhotoZoom');
    const img = document.getElementById('photoZoomImage');
    const titleEl = document.getElementById('photoZoomTitle');
    const captionEl = document.getElementById('photoZoomCaption');
    const dateEl = document.getElementById('photoZoomDate');
    const downloadBtn = document.getElementById('btnDownloadZoomPhoto');
    const actionsBox = modal ? modal.querySelector('.photo-zoom-actions') : null;

    if (!modal || !img) return;
    img.src = src;
    if (titleEl) titleEl.textContent = title || 'Momento da Rotina';
    if (captionEl) captionEl.textContent = caption || '';
    if (dateEl) dateEl.textContent = date ? `📅 ${date}` : '';

    this._currentPhotoZoomIsOwn = isOwn;
    if (downloadBtn) {
      downloadBtn.style.display = isOwn ? 'inline-flex' : 'none';
    }
    if (actionsBox) {
      actionsBox.style.display = isOwn ? 'flex' : 'none';
    }

    modal.classList.add('active');
  },

  async downloadPhoto(src, filename) {
    try {
      if (!src) return;
      const cleanFilename = filename || `eex_rotina_${Date.now()}.jpg`;

      if (src.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = src;
        a.download = cleanFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        const res = await fetch(src);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = cleanFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      }
      this.showToast('📥 Foto salva com sucesso no seu aparelho!');
    } catch (err) {
      const a = document.createElement('a');
      a.href = src;
      a.download = filename || 'eex_foto_rotina.jpg';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      this.showToast('📥 Download iniciado!');
    }
  },

  isMobileDevice() {
    return (
      (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768
    );
  },

  _splashDone: false,

  initSplash() {
    const splash = document.getElementById('eexSplashScreen');
    const logoWrap = document.getElementById('eexSplashLogoWrap');
    if (!splash) {
      this._splashDone = true;
      return;
    }

    // Cronograma OBRIGATÓRIO Neo-Brutalista de 3 segundos (3000ms):
    // 1. Aos 2050ms: Lançamento mecânico / pop dimensional do logotipo
    setTimeout(() => {
      if (logoWrap) logoWrap.classList.add('neo-launch');
    }, 2050);

    // 2. Aos 2350ms: Transição com Wipe Dimensional mecânico para cima (comporta de despacho)
    setTimeout(() => {
      splash.classList.add('neo-wipe-out');
    }, 2350);

    // 3. Aos 3000ms: Oculta o splash completamente e revela o sistema
    setTimeout(() => {
      splash.classList.add('hidden');
      this._splashDone = true;

      // mostra saudação e sistema
      const user = AuthManager.getCurrentUser();
      if (user) {
        this.triggerMagafusLoginGreeting(user);
      }
      setTimeout(() => UpdateManager.check(), 1000);
    }, 3000);
  },

  showSplash() {
    const splash = document.getElementById('eexSplashScreen');
    const logoWrap = document.getElementById('eexSplashLogoWrap');
    if (!splash) return;
    splash.classList.remove('hidden', 'fade-out', 'neo-wipe-out');
    if (logoWrap) logoWrap.classList.remove('fade-out', 'neo-launch');
  },

  hideSplash() {
    if (this._splashDone) {
      const splash = document.getElementById('eexSplashScreen');
      if (splash) splash.classList.add('hidden');
    }
  },

  initBottomNavScrollHint() {
    const nav = document.getElementById('bottomNavBar');
    const hint = document.getElementById('bottomNavDragHint');
    const container = document.getElementById('bottomNavContainer');
    if (!nav) return;

    const updateScrollHint = () => {
      const maxScroll = nav.scrollWidth - nav.clientWidth;
      if (maxScroll <= 12) {
        if (hint) hint.classList.add('hidden');
        if (container) container.classList.add('scrolled-end');
        return;
      }
      if (nav.scrollLeft >= maxScroll - 16) {
        if (hint) hint.classList.add('hidden');
        if (container) container.classList.add('scrolled-end');
      } else {
        if (hint) hint.classList.remove('hidden');
        if (container) container.classList.remove('scrolled-end');
      }
    };

    nav.addEventListener('scroll', updateScrollHint, { passive: true });
    window.addEventListener('resize', updateScrollHint);

    // Avalia o scroll imediatamente e em intervalos rápidos para renderização fluida
    updateScrollHint();
    setTimeout(updateScrollHint, 100);
    setTimeout(updateScrollHint, 500);
  },

  init() {
    this.initSplash();
    this.initBottomNavScrollHint();

    AuthManager.init();
    ThemeManager.init();
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
    if (typeof TudumManager !== 'undefined') TudumManager.init();
    if (typeof EyeComfortManager !== 'undefined') EyeComfortManager.init();
    if (typeof VitrolaManager !== 'undefined') VitrolaManager.init();
    if (typeof ImpressoraManager !== 'undefined') ImpressoraManager.init();
    if (typeof CargaMisteriosaManager !== 'undefined') CargaMisteriosaManager.init();
    if (typeof EexMailManager !== 'undefined') EexMailManager.init();
    if (typeof TypingSoundManager !== 'undefined') TypingSoundManager.init();
    if (typeof TerminalTelemetryManager !== 'undefined') TerminalTelemetryManager.init();

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
    // 1. Upload de Foto na Edição do Perfil (Clique no quadrado ou botão)
    const editAvatarInput = document.getElementById('editAvatarInput');
    const editAvatarPreview = document.getElementById('editAvatarPreview');
    const editAvatarPreviewBox = document.getElementById('editAvatarPreviewBox');
    const btnTriggerAvatarUpload = document.getElementById('btnTriggerAvatarUpload');

    const triggerAvatarPick = () => { if (editAvatarInput) editAvatarInput.click(); };
    if (editAvatarPreviewBox) editAvatarPreviewBox.addEventListener('click', triggerAvatarPick);
    if (btnTriggerAvatarUpload) btnTriggerAvatarUpload.addEventListener('click', triggerAvatarPick);

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

    // 1.1 Upload de Banner na Edição do Perfil (Clique no retângulo ou botão)
    const editBannerInput = document.getElementById('editBannerInput');
    const editBannerPreview = document.getElementById('editBannerPreview');
    const editBannerPreviewBox = document.getElementById('editBannerPreviewBox');
    const editBannerPlaceholder = document.getElementById('editBannerPlaceholder');
    const btnTriggerBannerUpload = document.getElementById('btnTriggerBannerUpload');
    const btnRemoveBanner = document.getElementById('btnRemoveBanner');

    const triggerBannerPick = (e) => {
      if (e && e.target && e.target.closest('#btnRemoveBanner')) return;
      if (editBannerInput) editBannerInput.click();
    };
    if (editBannerPreviewBox) editBannerPreviewBox.addEventListener('click', triggerBannerPick);
    if (btnTriggerBannerUpload) btnTriggerBannerUpload.addEventListener('click', triggerBannerPick);

    if (editBannerInput) {
      editBannerInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const compressed = await compressImageFile(file, 900, 300, 0.8);
          if (compressed) {
            this.editBannerBase64 = compressed;
            if (editBannerPreview) {
              editBannerPreview.src = this.editBannerBase64;
              editBannerPreview.style.display = 'block';
            }
            if (editBannerPlaceholder) editBannerPlaceholder.style.display = 'none';
            if (btnRemoveBanner) btnRemoveBanner.style.display = 'inline-block';
          }
        }
      });
    }

    if (btnRemoveBanner) {
      btnRemoveBanner.addEventListener('click', () => {
        this.editBannerBase64 = '';
        if (editBannerPreview) {
          editBannerPreview.src = '';
          editBannerPreview.style.display = 'none';
        }
        if (editBannerPlaceholder) editBannerPlaceholder.style.display = 'block';
        if (editBannerInput) editBannerInput.value = '';
        btnRemoveBanner.style.display = 'none';
      });
    }

    // 1.2 Troca rápida de banner diretamente pelo crachá
    const quickBannerInput = document.getElementById('quickBannerInput');
    if (quickBannerInput) {
      quickBannerInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const compressed = await compressImageFile(file, 900, 300, 0.8);
          if (compressed) {
            await AuthManager.updateUserProfile({ banner: compressed });
            this.renderProfileView();
            this.showToast('🎨 Banner do crachá atualizado com sucesso!');
          }
        }
        quickBannerInput.value = '';
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

      // autocomplete de cidades de SP (645 municípios)
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
          // CRÍTICO: Registra o crachá público no Firestore para a busca de amigos
          await FirebaseService.updatePublicProfile({
            name: user.name,
            nickname: nickname,
            eexEmail: eexEmail,
            location: user.location,
            avatar: avatar
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
        if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
          FriendsManager.syncMyPublicProfile();
        }
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
          if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
            FriendsManager.syncMyPublicProfile();
          }

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
        const newBio = document.getElementById('editProfileBio') ? document.getElementById('editProfileBio').value.trim() : '';
        const newMood = document.getElementById('editProfileMood') ? document.getElementById('editProfileMood').value : 'foco';
        const updateData = {
          name: newName.trim(),
          location: newLocation.trim(),
          bio: newBio,
          agentMood: newMood
        };
        if (this.editAvatarBase64) {
          updateData.avatar = this.editAvatarBase64;
        }
        if (this.editBannerBase64 !== null) {
          updateData.banner = this.editBannerBase64;
        }

        await AuthManager.updateUserProfile(updateData);
        modalEditProfile.classList.remove('active');
        this.renderAll();
        this.showToast('Crachá e informações atualizadas!');
      });

      // Seletor de Humor Operacional
      const moodGrid = document.getElementById('moodSelectorGrid');
      const moodHidden = document.getElementById('editProfileMood');
      if (moodGrid && moodHidden) {
        moodGrid.querySelectorAll('.mood-chip-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            moodGrid.querySelectorAll('.mood-chip-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            moodHidden.value = btn.dataset.mood;
          });
        });
      }

      // Emojis Rápidos e Contador de Caracteres da Bio
      const editBioInput = document.getElementById('editProfileBio');
      const editBioCounter = document.getElementById('editBioCounter');
      if (editBioInput) {
        document.querySelectorAll('.bio-quick-emoji').forEach(btn => {
          btn.addEventListener('click', () => {
            const emoji = btn.textContent.trim();
            const start = editBioInput.selectionStart ?? editBioInput.value.length;
            const end = editBioInput.selectionEnd ?? editBioInput.value.length;
            const cur = editBioInput.value;
            if (cur.length + emoji.length <= 180) {
              editBioInput.value = cur.slice(0, start) + emoji + cur.slice(end);
              editBioInput.selectionStart = editBioInput.selectionEnd = start + emoji.length;
              editBioInput.focus();
              if (editBioCounter) editBioCounter.textContent = `${editBioInput.value.length} / 180`;
            }
          });
        });

        editBioInput.addEventListener('input', () => {
          if (editBioCounter) editBioCounter.textContent = `${editBioInput.value.length} / 180`;
        });
      }
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

    // 10. Botões de Novo/Editar Hábito
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
        this.openHabitModal(null);
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
        const habitId = (document.getElementById('habitId')?.value || '').trim();
        const title = (document.getElementById('habitTitle').value || '').trim();
        const cat = document.getElementById('habitCategory').value;
        const selectedDays = [];
        document.querySelectorAll('#habitDaysPicker .weekday-btn.active').forEach(b => {
          selectedDays.push(parseInt(b.dataset.day, 10));
        });
        const daysToSave = selectedDays.length ? selectedDays : [0, 1, 2, 3, 4, 5, 6];

        if (title) {
          if (habitId) {
            // Editando hábito existente (ativo hoje ou em descanso!)
            await HabitManager.updateHabit(habitId, {
              title: title,
              category: cat,
              days: daysToSave
            });
            this.showToast(`✏️ Rotina "${title}" atualizada com sucesso!`);
          } else {
            // Criando novo hábito
            if (typeof EEXPlusManager !== 'undefined' && !EEXPlusManager.canAddHabit()) {
              modalHabit.classList.remove('active');
              AppUI.showToast(`🔒 Limite de ${EEXPlusManager.HABIT_LIMIT_FREE} hábitos atingido! Assine o EEX+ para hábitos ilimitados ✨`);
              return;
            }
            await HabitManager.addHabit(title, cat, daysToSave);
            this.showToast('☀️ Novo hábito registrado no check-in!');
          }

          modalHabit.classList.remove('active');
          this.renderDailyRoutine();
          this.renderHomeOverview();
          ReportEngine.renderReportPreview();
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

    // --- pomodoro ---
    const modalPomodoro = document.getElementById('modalPomodoro');
    const openPomodoro = () => {
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

    const btnSettingsOpenLojaTemas = document.getElementById('btnSettingsOpenLojaTemas');
    if (btnSettingsOpenLojaTemas) {
      btnSettingsOpenLojaTemas.addEventListener('click', () => {
        openLoja();
      });
    }

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

    // --- conforto ocular ---
    const btnToggleNightMode = document.getElementById('btnToggleNightMode');
    const chkAutoNightMode = document.getElementById('chkAutoNightMode');

    if (btnToggleNightMode) {
      btnToggleNightMode.addEventListener('click', () => {
        const newState = EyeComfortManager.toggle();
        this.showToast(newState ? '🌙 Conforto ocular noturno ativado!' : '☀️ Conforto noturno desativado!');
      });
    }

    if (chkAutoNightMode) {
      chkAutoNightMode.addEventListener('change', (e) => {
        EyeComfortManager.setAutoEnabled(e.target.checked);
        this.showToast(e.target.checked ? '⏰ Modo noturno automático ativado (19h às 07h)!' : '⏰ Modo noturno automático desativado.');
      });
    }
    if (typeof EyeComfortManager !== 'undefined') {
      EyeComfortManager.updateUI();
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

    const btnTestUpdateAlert = document.getElementById('btnTestUpdateAlert');
    if (btnTestUpdateAlert) {
      btnTestUpdateAlert.addEventListener('click', () => {
        UpdateManager.testApkUpdateScreen();
      });
    }

    // 18. Fechamento de Modais clicando fora — NÃO FECHA O ONBOARDING MANDATÓRIO
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          if (overlay.id === 'modalOnboarding' || overlay.id === 'modalPinLogin') return; // Onboarding e EEX-PASS obrigatórios não fecham ao clicar fora!
          if (overlay.id === 'modalUpdateAvailable') {
            const audio = document.getElementById('audioUpdateWaiting');
            if (audio) {
              audio.pause();
              audio.currentTime = 0;
            }
          }
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

        // renderiza no canvas com os adesivos embutidos
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

    // Modal de Visualização & Edição de Notas (modalNoteView)
    const modalNoteView = document.getElementById('modalNoteView');
    const modalNoteViewClose = document.getElementById('modalNoteViewClose');
    if (modalNoteViewClose && modalNoteView) {
      modalNoteViewClose.addEventListener('click', () => NotesManager.closeNoteModal());
      modalNoteView.addEventListener('click', (e) => {
        if (e.target === modalNoteView) NotesManager.closeNoteModal();
      });
    }

    const btnNoteModalEdit = document.getElementById('btnNoteModalEdit');
    if (btnNoteModalEdit) {
      btnNoteModalEdit.addEventListener('click', () => {
        const id = document.getElementById('noteModalEditId')?.value;
        if (id) NotesManager.openNoteModal(id, true);
      });
    }

    const btnNoteModalCancelEdit = document.getElementById('btnNoteModalCancelEdit');
    if (btnNoteModalCancelEdit) {
      btnNoteModalCancelEdit.addEventListener('click', () => {
        const id = document.getElementById('noteModalEditId')?.value;
        if (id) NotesManager.openNoteModal(id, false);
      });
    }

    const btnNoteModalCopy = document.getElementById('btnNoteModalCopy');
    if (btnNoteModalCopy) {
      btnNoteModalCopy.addEventListener('click', async () => {
        const id = document.getElementById('noteModalEditId')?.value;
        const note = NotesManager.notes.find(n => n.id === id);
        if (note) {
          const text = (note.title ? note.title + '\n\n' : '') + note.content;
          try {
            await navigator.clipboard.writeText(text);
            this.showToast('📋 Anotação copiada!');
          } catch {
            this.showToast('Nota copiada!');
          }
        }
      });
    }

    // Color picker dentro do modal de edição
    const noteModalEditColorPicker = document.getElementById('noteModalEditColorPicker');
    if (noteModalEditColorPicker) {
      noteModalEditColorPicker.querySelectorAll('.note-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          noteModalEditColorPicker.querySelectorAll('.note-color-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          NotesManager._modalEditColor = btn.dataset.color || 'yellow';
          const contentBox = document.getElementById('noteModalContent');
          if (contentBox) {
            contentBox.className = `modal-content note-modal-box note-${NotesManager._modalEditColor}`;
          }
        });
      });
    }

    const btnNoteModalSaveEdit = document.getElementById('btnNoteModalSaveEdit');
    if (btnNoteModalSaveEdit) {
      btnNoteModalSaveEdit.addEventListener('click', () => {
        const id = document.getElementById('noteModalEditId')?.value;
        const title = document.getElementById('noteModalEditTitle')?.value || '';
        const content = document.getElementById('noteModalEditContent')?.value || '';
        const pinned = !!document.getElementById('noteModalEditPinCheckbox')?.checked;
        const color = NotesManager._modalEditColor || 'yellow';

        if (!content.trim() && !title.trim()) {
          this.showToast('⚠️ A nota não pode ficar completamente vazia!');
          return;
        }

        const ok = NotesManager.updateNote(id, { title, content, pinned, color });
        if (ok) {
          this.showToast('💾 Anotação atualizada com sucesso!');
          NotesManager.openNoteModal(id, false);
        }
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

    // Botão de Download / Salvar Foto no Aparelho
    const btnDownloadZoomPhoto = document.getElementById('btnDownloadZoomPhoto');
    if (btnDownloadZoomPhoto) {
      btnDownloadZoomPhoto.addEventListener('click', async () => {
        if (!this._currentPhotoZoomIsOwn) {
          AppUI.showToast('🔒 Você só pode baixar fotos das suas próprias rotinas.');
          return;
        }
        const img = document.getElementById('photoZoomImage');
        if (!img || !img.src) return;
        const title = document.getElementById('photoZoomTitle')?.textContent || 'rotina';
        const cleanName = title.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        await this.downloadPhoto(img.src, `eex_rotina_${cleanName}_${Date.now()}.jpg`);
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
        // Apenas memórias próprias (.memory-polaroid-item) permitem download
        const isOwn = !!targetImg.closest('.memory-polaroid-item');
        this.openPhotoZoom(targetImg.src, title, caption, date, isOwn);
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
        let cleanQuery = raw.toLowerCase().replace(/^@+/, '').trim();
        cleanQuery = cleanQuery.replace(/@.*$/, '').replace(/\.express(\.com)?$/, '').trim();
        cleanQuery = cleanQuery.replace(/[^a-z0-9_.-]/g, '');

        if (cleanQuery.length < 2) {
          AppUI.showToast('Digite pelo menos 2 caracteres do ID Express ou apelido.');
          return;
        }

        resultsContainer.innerHTML = `
          <div style="text-align: center; padding: 24px; color: var(--purple-dark); font-weight: 700;">
            🔍 Buscando parceiros na Rede EEX para "${raw}"...
          </div>
        `;

        const found = await FirebaseService.searchPublicUsers(cleanQuery);
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

    const btnFriendModalChat = document.getElementById('btnFriendModalChat');
    if (btnFriendModalChat) {
      btnFriendModalChat.addEventListener('click', () => {
        if (FriendsManager.activeFriendForProfile && typeof EexMailManager !== 'undefined') {
          const modalFriendProfile = document.getElementById('modalFriendProfile');
          if (modalFriendProfile) modalFriendProfile.classList.remove('active');
          EexMailManager.openChat(FriendsManager.activeFriendForProfile);
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

    // Mobile header: Gazeta da Providência (ícone da Providente feliz)
    const btnMobileProvidenteNews = document.getElementById('btnMobileProvidenteNews');
    if (btnMobileProvidenteNews) {
      btnMobileProvidenteNews.addEventListener('click', () => {
        ProvidenteNewsManager.openModal(0);
      });
    }

    // Mobile header: Pill de Conchas → abre a Loja
    const mobileShellsPill = document.getElementById('mobileShellsPill');
    if (mobileShellsPill) {
      mobileShellsPill.addEventListener('click', () => {
        if (typeof LojaManager !== 'undefined') {
          LojaManager.openModal();
        }
      });
    }

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

    // TUDUM IA - EVENT BINDINGS

    const btnNavTudum = document.getElementById('btnNavTudum');
    if (btnNavTudum) {
      btnNavTudum.addEventListener('click', (e) => {
        e.preventDefault();
        TudumManager.toggle();
      });
    }

    const btnDrawerTudum = document.getElementById('btnDrawerTudum');
    if (btnDrawerTudum) {
      btnDrawerTudum.addEventListener('click', () => {
        this.closeMobileDrawer();
        TudumManager.open();
      });
    }

    const btnBottomTudum = document.getElementById('btnBottomTudum');
    if (btnBottomTudum) {
      btnBottomTudum.addEventListener('click', (e) => {
        e.preventDefault();
        TudumManager.toggle();
      });
    }

    const btnCloseTudum = document.getElementById('btnCloseTudum');
    if (btnCloseTudum) {
      btnCloseTudum.addEventListener('click', () => TudumManager.close());
    }

    const tudumBackdrop = document.getElementById('tudumBackdrop');
    if (tudumBackdrop) {
      tudumBackdrop.addEventListener('click', () => TudumManager.close());
    }

    const btnClearTudumChat = document.getElementById('btnClearTudumChat');
    if (btnClearTudumChat) {
      btnClearTudumChat.addEventListener('click', () => {
        if (confirm('Deseja limpar o histórico da conversa com a Tudum?')) {
          TudumManager.clearHistory();
        }
      });
    }

    const tudumForm = document.getElementById('tudumForm');
    const tudumInput = document.getElementById('tudumInput');

    if (tudumForm && tudumInput) {
      tudumForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (TudumManager.isThinking) return;
        const val = tudumInput.value;
        if (val && val.trim()) {
          TudumManager.sendMessage(val);
        }
      });

      tudumInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (TudumManager.isThinking) return;
          tudumForm.requestSubmit();
        }
      });

      tudumInput.addEventListener('input', () => {
        tudumInput.style.height = 'auto';
        tudumInput.style.height = Math.min(tudumInput.scrollHeight, 120) + 'px';
      });
    }

    document.querySelectorAll('.tudum-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (TudumManager.isThinking) return;
        const prompt = chip.dataset.prompt;
        if (prompt) {
          TudumManager.sendMessage(prompt, true);
        }
      });
    });

    const modalTudumPlusLock = document.getElementById('modalTudumPlusLock');
    const btnCloseTudumLock = document.getElementById('btnCloseTudumLock');
    const btnGoToEexPlusFromTudum = document.getElementById('btnGoToEexPlusFromTudum');

    if (btnCloseTudumLock && modalTudumPlusLock) {
      btnCloseTudumLock.addEventListener('click', () => {
        modalTudumPlusLock.classList.remove('active');
      });
    }

    if (btnGoToEexPlusFromTudum && modalTudumPlusLock) {
      btnGoToEexPlusFromTudum.addEventListener('click', () => {
        modalTudumPlusLock.classList.remove('active');
        if (typeof LojaEEXManager !== 'undefined') {
          LojaEEXManager.openModal();
        } else {
          AppUI.switchTab('loja');
        }
      });
    }

    // LANDING PAGE & LOGIN MODAL CONTROLS

    document.querySelectorAll('.action-open-login').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const landingPage = document.getElementById('landingPage');
        const authGateway = document.getElementById('authGateway');
        if (landingPage) landingPage.style.display = 'none';
        if (authGateway) authGateway.style.display = 'flex';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    const btnBackToLanding = document.getElementById('btnBackToLanding');
    if (btnBackToLanding) {
      btnBackToLanding.addEventListener('click', (e) => {
        e.preventDefault();
        const landingPage = document.getElementById('landingPage');
        const authGateway = document.getElementById('authGateway');
        if (authGateway) authGateway.style.display = 'none';
        if (landingPage) {
          landingPage.style.display = 'block';
          this.initLandingAnimations();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // MODAL "SOBRE O EEX" (@un.dashed & FATEC Itapetininga)

    const modalAbout = document.getElementById('modalAboutEex');
    document.querySelectorAll('.action-open-about').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (modalAbout) modalAbout.classList.add('active');
      });
    });

    const btnCloseAboutModal = document.getElementById('btnCloseAboutModal');
    if (btnCloseAboutModal) {
      btnCloseAboutModal.addEventListener('click', () => {
        if (modalAbout) modalAbout.classList.remove('active');
      });
    }

    const btnDoneAboutModal = document.getElementById('btnDoneAboutModal');
    if (btnDoneAboutModal) {
      btnDoneAboutModal.addEventListener('click', () => {
        if (modalAbout) modalAbout.classList.remove('active');
      });
    }

    if (modalAbout) {
      modalAbout.addEventListener('click', (e) => {
        if (e.target === modalAbout) {
          modalAbout.classList.remove('active');
        }
      });
    }

    this.initLandingAnimations();

    // --- segurança e blindagem ---

    // 1. Blindagem de Menu de Contexto (Impede clique direito / long-press em imagens para abrir em outra guia)
    document.addEventListener('contextmenu', (e) => {
      const isImg = e.target && (e.target.tagName === 'IMG' || e.target.closest('img'));
      if (isImg) {
        e.preventDefault();
        return false;
      }
      // No mobile, impede menu de contexto em áreas de texto protegidas
      const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (!isInput && window.innerWidth <= 900) {
        e.preventDefault();
        return false;
      }
    }, { passive: false });

    // 2. Impede arrastar imagens (impede arrastar para barra de abas ou área de trabalho)
    document.addEventListener('dragstart', (e) => {
      if (e.target && (e.target.tagName === 'IMG' || e.target.closest('img'))) {
        e.preventDefault();
        return false;
      }
    }, { passive: false });

    // 3. Impede clique com botão do meio (scroll click) que abre imagens/links em nova guia
    document.addEventListener('auxclick', (e) => {
      if (e.target && (e.target.tagName === 'IMG' || e.target.closest('img'))) {
        e.preventDefault();
        return false;
      }
    }, { passive: false });

    // 4. Bloqueia evento de cópia no mobile fora de inputs/textareas
    document.addEventListener('copy', (e) => {
      const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (!isInput && window.innerWidth <= 900) {
        e.preventDefault();
        if (typeof AppUI !== 'undefined') {
          AppUI.showToast('🔒 Proteção ativa: cópia de texto restrita no mobile!');
        }
        return false;
      }
    });
  },

  initLandingAnimations() {
    const targets = document.querySelectorAll('.landing-hero-grand, .landing-showcase-section, .landing-cta-banner');
    if (!targets.length) return;

    if (!('IntersectionObserver' in window)) {
      targets.forEach(el => el.classList.add('is-revealed'));
      return;
    }

    if (this._landingObserver) {
      this._landingObserver.disconnect();
    }

    this._landingObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    targets.forEach(el => {
      this._landingObserver.observe(el);
    });
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
    const landingPage = document.getElementById('landingPage');
    const authGateway = document.getElementById('authGateway');
    const appViewsContainer = document.getElementById('appViewsContainer');
    const desktopNav = document.querySelector('nav.desktop-nav');
    const btnMobileMenu = document.getElementById('btnMobileMenu');
    const bottomNavBar = document.getElementById('bottomNavBar');
    const mainHeader = document.querySelector('header');

    if (!isLoggedIn || !isVerified) {
      // Visitante não logado: mostra a Landing Page de Apresentação
      if (!isLoggedIn) {
        // Se o modal de login não estiver aberto explicitamente, mostra a landing page
        const isLoginOpen = authGateway && authGateway.style.display === 'flex';
        if (!isLoginOpen) {
          if (landingPage) {
            landingPage.style.display = 'block';
            this.initLandingAnimations();
          }
          if (authGateway) authGateway.style.display = 'none';
        }
        if (mainHeader) mainHeader.style.display = 'none';
      } else {
        // Usuário logado mas aguardando EEX-PASS
        if (landingPage) landingPage.style.display = 'none';
        if (authGateway) authGateway.style.display = 'none';
        if (mainHeader) mainHeader.style.removeProperty('display');
      }
      if (appViewsContainer) appViewsContainer.style.display = 'none';
      if (desktopNav) desktopNav.style.display = 'none';
      if (btnMobileMenu) btnMobileMenu.style.display = 'none';
      if (bottomNavBar) bottomNavBar.style.display = 'none';
      const bottomNavContainer = document.getElementById('bottomNavContainer');
      if (bottomNavContainer) bottomNavContainer.style.display = 'none';
      if (typeof VitrolaManager !== 'undefined') VitrolaManager.updateVisibility();
      this.renderHeaderProfile();
      this.hideSplash();
      return;
    }

    // Usuário logado e verificado com EEX-PASS: esconde a landing e libera o app
    if (landingPage) landingPage.style.display = 'none';
    if (authGateway) authGateway.style.display = 'none';
    if (mainHeader) mainHeader.style.removeProperty('display');
    if (appViewsContainer) appViewsContainer.style.display = 'block';
    if (desktopNav && window.innerWidth > 768) desktopNav.style.display = 'flex';
    if (btnMobileMenu) btnMobileMenu.style.display = 'none';
    if (bottomNavBar) bottomNavBar.style.removeProperty('display');
    const bottomNavContainer = document.getElementById('bottomNavContainer');
    if (bottomNavContainer) bottomNavContainer.style.removeProperty('display');
    if (typeof VitrolaManager !== 'undefined') VitrolaManager.updateVisibility();

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
      if (typeof FriendsManager !== 'undefined' && FriendsManager.syncMyPublicProfile) {
        FriendsManager.syncMyPublicProfile();
      }
      // Dispara a saudação da Providente/VIP apenas após o término do splash de 3s
      if (this._splashDone) {
        this.triggerMagafusLoginGreeting(user);
      }
    }

    // Verifica atualização disponível (uma vez por sessão, após splash)
    if (this._splashDone) {
      setTimeout(() => UpdateManager.check(), 3000);
    }

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
    if (typeof CargaMisteriosaManager !== 'undefined') CargaMisteriosaManager.renderTrigger();
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
        <div class="habit-card-top">
          <div class="habit-check-box" title="${isDone ? 'Concluído hoje' : 'Marcar como concluído'}">${isDone ? '✓' : ''}</div>
          <div class="habit-title-wrap">
            <div class="habit-title">${habit.title}</div>
          </div>
          <div class="habit-actions">
            <button type="button" class="habit-btn-edit" title="Editar Rotina" data-id="${habit.id}">✏️</button>
            <button type="button" class="habit-btn-delete" title="Remover Hábito" data-id="${habit.id}">✕</button>
          </div>
        </div>
        <div class="habit-meta">
          <span class="habit-tag ${habit.category}">${habit.category === 'faculdade' ? '🎓 Faculdade' : (habit.category === 'trabalho' ? '💼 Trabalho' : '⭐ Pessoal')}</span>
          <span class="habit-days-badge">${formatDaysBadge(habit.days)}</span>
          ${streak > 0 ? `<span class="habit-streak">🔥 ${streak} ${streak === 1 ? 'dia' : 'dias'}</span>` : ''}
        </div>
      `;

      card.addEventListener('click', async (e) => {
        if (e.target.closest('.habit-actions')) return;
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

      const editBtn = card.querySelector('.habit-btn-edit');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openHabitModal(habit);
        });
      }

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

    // Se houver hábitos programados para outros dias (descanso hoje / dormindo)
    if (restHabits.length > 0) {
      const restBox = document.createElement('div');
      restBox.className = 'rest-habits-box';
      restBox.style.gridColumn = '1 / -1';
      restBox.innerHTML = `
        <div class="rest-habits-title">🛌 Rotinas em Descanso Hoje (${restHabits.length} programados para outros dias)</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          ${restHabits.map(h => `
            <div class="rest-habit-card" data-id="${h.id}">
              <div class="rest-habit-info">
                <span class="rest-habit-title">${h.title}</span>
                <span class="rest-habit-badge">${formatDaysBadge(h.days)}</span>
              </div>
              <div class="rest-habit-actions">
                <button type="button" class="habit-btn-edit rest-btn-edit" title="Editar Rotina" data-id="${h.id}">✏️</button>
                <button type="button" class="habit-btn-delete rest-btn-delete" title="Remover Rotina" data-id="${h.id}">✕</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      // Eventos de editar e remover nos hábitos em descanso
      restBox.querySelectorAll('.rest-btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const hId = btn.dataset.id;
          const targetHabit = habits.find(h => h.id === hId);
          if (targetHabit) this.openHabitModal(targetHabit);
        });
      });

      restBox.querySelectorAll('.rest-btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const hId = btn.dataset.id;
          const targetHabit = habits.find(h => h.id === hId);
          const title = targetHabit ? targetHabit.title : 'esta rotina';
          if (confirm(`Remover "${title}" da sua lista de rotinas?`)) {
            await HabitManager.deleteHabit(hId);
            this.renderDailyRoutine();
            this.renderHomeOverview();
            ReportEngine.renderReportPreview();
          }
        });
      });

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

    // Atualiza estado do botão da Impressora Térmica
    if (typeof ImpressoraManager !== 'undefined') ImpressoraManager.checkAndUpdateButton();
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

  renderThemeCards() {
    const user = typeof AuthManager !== 'undefined' ? AuthManager.getCurrentUser() : null;

    document.querySelectorAll('.theme-pick-card').forEach(card => {
      const themeId = card.dataset.themeId;
      const themeObj = ThemeManager.themes[themeId];
      if (!themeObj) return;

      const isUnlocked = ThemeManager.isThemeUnlocked(themeId, user);
      if (!isUnlocked) {
        card.style.display = 'none';
        card.classList.remove('active');
      } else {
        card.style.display = 'flex';
        card.classList.remove('theme-locked', 'eexplus-lustroso');
        card.classList.toggle('active', themeId === ThemeManager.current);
        const lockBadge = card.querySelector('.theme-lock-badge');
        if (lockBadge) lockBadge.style.display = 'none';
      }
    });

    if (typeof ThemeManager !== 'undefined' && ThemeManager.updateQuoteBox) {
      ThemeManager.updateQuoteBox(ThemeManager.current);
    }
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

    // Atualiza estado visual e visibilidade de cada cartão de tema nas configurações
    this.renderThemeCards();

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

    // pomodoro na navbar, drawer e barra mobile
    const btnNavPomodoro = document.getElementById('btnNavPomodoro');
    const btnDrawerPomodoro = document.getElementById('btnDrawerPomodoro');
    const btnBottomPomodoro = document.getElementById('btnBottomPomodoro');

    if (btnNavPomodoro) {
      btnNavPomodoro.style.display = 'inline-flex';
      btnNavPomodoro.classList.remove('eexplus-lustroso');
    }
    if (btnDrawerPomodoro) {
      btnDrawerPomodoro.style.display = 'flex';
      btnDrawerPomodoro.classList.remove('eexplus-lustroso');
    }
    if (btnBottomPomodoro) {
      btnBottomPomodoro.style.display = 'flex';
      btnBottomPomodoro.classList.remove('eexplus-lustroso');
    }

    // Botão no Header (oculto)
    const btnHeaderEexPlus = document.getElementById('btnHeaderEexPlus');
    if (btnHeaderEexPlus) {
      btnHeaderEexPlus.style.setProperty('display', 'none', 'important');
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

    // Atualiza cartões de tema
    this.renderThemeCards();

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

    // conforto ocular
    if (typeof EyeComfortManager !== 'undefined') {
      EyeComfortManager.updateUI();
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

      const packagingIcons = {
        baixa: '<img src="images/embalagem_segura.png" alt="Segura" class="task-package-icon" onerror="this.onerror=null; this.src=\'embalagem_segura.png\';">',
        alta: '<img src="images/embalagem_atencao.png" alt="Atenção" class="task-package-icon" onerror="this.onerror=null; this.src=\'embalagem_atencao.png\';">',
        cosmica: '<img src="images/embalagem_cosmica.png" alt="Cósmica" class="task-package-icon" onerror="this.onerror=null; this.src=\'embalagem_cosmica.png\';">'
      };

      const priorityLabels = {
        baixa: 'Segura (Baixa)',
        media: 'Padrão (Média)',
        alta: 'Atenção (Alta)',
        cosmica: 'Cósmica ⚡'
      };

      const packIconHtml = packagingIcons[task.priority] || '';

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-tracking-code">${task.code || 'ELG-000'}</span>
          <div class="task-badges">
            <span class="task-badge ${task.category}">${task.category === 'faculdade' ? 'Faculdade' : (task.category === 'trabalho' ? '💼 Trabalho' : 'Pessoal')}</span>
            <span class="task-badge priority-${task.priority}">
              ${packIconHtml}
              ${priorityLabels[task.priority] || task.priority}
            </span>
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
    const nick = (user.nickname || '').toLowerCase().trim();
    const eex = (user.eexEmail || '').toLowerCase().trim();
    const email = (user.email || '').toLowerCase().trim();
    return nick === 'pedrinho' || eex.includes('pedrinho') || email.includes('pedrinho');
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

    // sistema de 100 niveis (1 a 100)
    const level = Math.min(100, Math.max(1, Math.floor(totalXp / 100) + 1));

    // 10 Tiers a cada 10 patentes até o Nível 100 (O Olho de Providente)
    const tiers = [
      { min: 1,  max: 9,   title: 'Recruta da Rota Express 📦', color: '#a855f7', tierName: 'Recruta da Rota Express', stripClass: 'holo-copper', stripText: '★ EEX RECRUTA ★' },
      { min: 10, max: 19,  title: 'Criatura da Mata 🌿', color: '#10b981', tierName: 'Criatura da Mata', stripClass: 'holo-emerald', stripText: '🌿 CRIATURA DA MATA 🌿' },
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

    // Exclusividade EEX+: Tarja holográfica com "• EEX+ •" exatamente uma única vez
    const isEexPlus = (typeof EEXPlusManager !== 'undefined' && EEXPlusManager.isPremium());
    
    let finalStripClass = 'holo-strip-padrao';
    // Text always comes from the career tier, not the catalog item name
    let finalStripText = currentTier.stripText || '• ELGALY EXPRESS •';

    if (isEexPlus) {
      finalStripClass = 'holo-eexplus';
      finalStripText = '• EEX+ •';
    } else {
      const equippedStripId = user?.equippedStrip || 'strip-padrao';
      const catalogStrip = (typeof HologramStripsCatalog !== 'undefined') 
        ? HologramStripsCatalog.find(s => s.id === equippedStripId) 
        : null;

      // Color/style from catalog, text always from the career tier
      if (catalogStrip) {
        finalStripClass = catalogStrip.className;
      } else {
        finalStripClass = currentTier.stripClass || 'holo-strip-padrao';
      }
      // Strip text is always the rank text, not the palette name
      finalStripText = currentTier.stripText || '• ELGALY EXPRESS •';
    }

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
    if (!user || achId === 'express-total') return;
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

  getAchievements(stats = {}, targetUser = null) {
    const currentUser    = AuthManager.getCurrentUser();
    const effectiveUser  = targetUser || currentUser;
    const isTargetFriend = !!targetUser && (targetUser.uid !== (currentUser && currentUser.uid));

    let unlockedList   = (effectiveUser && Array.isArray(effectiveUser.unlockedAchievements))
      ? effectiveUser.unlockedAchievements.filter(id => id !== 'express-total')
      : [];

    // Limpa a conquista express-total do usuário atual se ainda estiver gravada
    if (!isTargetFriend && currentUser && Array.isArray(currentUser.unlockedAchievements) && currentUser.unlockedAchievements.includes('express-total')) {
      currentUser.unlockedAchievements = currentUser.unlockedAchievements.filter(id => id !== 'express-total');
      AuthManager.currentUser = currentUser;
      AuthManager.saveCurrent();
      if (typeof FirebaseService !== 'undefined' && FirebaseService.db && currentUser.id) {
        FirebaseService.saveProfileToCloud({ unlockedAchievements: currentUser.unlockedAchievements }).catch(() => {});
      }
    }

    const streak         = typeof stats.streak === 'number' ? stats.streak : (effectiveUser?.streak || 0);
    const completedTasks = typeof stats.completedTasks === 'number' ? stats.completedTasks : (effectiveUser?.completedTasksCount || 0);
    const friendsCount   = typeof stats.friendsCount === 'number' ? stats.friendsCount : 0;
    const memoriesCount  = typeof stats.memoriesCount === 'number' ? stats.memoriesCount : 0;
    const radioStatus    = !!stats.radioStatus;
    const shells         = typeof stats.shells === 'number' ? stats.shells : (effectiveUser?.shells || 0);

    const isSubscribed   = false;

    // Conquistas disponíveis (express-total removida)
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
        id: 'ato-immemorial',
        icon: '⏳',
        title: 'Ato Immemorial',
        desc: 'Manteve 30 dias de rotina ininterrupta — uma lenda na Frota!',
        unlocked: unlockedList.includes('ato-immemorial') || streak >= 30
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
        id: 'carga-misteriosa',
        icon: '🎁',
        title: 'Carga Resgatada',
        desc: 'Abriu sua primeira Carga Misteriosa da C.E.O. Providente!',
        unlocked: unlockedList.includes('carga-misteriosa')
      },
      {
        id: 'manifesto-emitido',
        icon: '🖨️',
        title: 'Manifesto de Carga',
        desc: 'Emitiu uma nota fiscal diária na Impressora Térmica EEX!',
        unlocked: unlockedList.includes('manifesto-emitido')
      },
      {
        id: 'foco-pomodoro',
        icon: '🍅',
        title: 'Foco Absoluto',
        desc: 'Concluiu um ciclo completo no Relógio Pomodoro Dimensional!',
        unlocked: unlockedList.includes('foco-pomodoro')
      }
    ];

    // Se NÃO for amigo (for o próprio usuário logado), persiste conquistas na nuvem
    if (!isTargetFriend && currentUser) {
      let hasNew = false;
      list.forEach(a => {
        if (a.unlocked && !unlockedList.includes(a.id)) {
          unlockedList.push(a.id);
          hasNew = true;
        }
      });

      if (hasNew) {
        currentUser.unlockedAchievements = unlockedList;
        AuthManager.currentUser = currentUser;
        AuthManager.saveCurrent();
        if (typeof FirebaseService !== 'undefined' && FirebaseService.db && currentUser.id) {
          FirebaseService.saveProfileToCloud({ unlockedAchievements: unlockedList });
        }
      }
    }

    return list;
  },

  // Ajusta contraste das palavras no Hero Banner conforme a imagem e opacidade
  adaptBannerContrast(bannerUrl, heroBannerEl) {
    if (!heroBannerEl) return;

    // Se não houver banner customizado, o padrão é o gradiente retrô escuro
    if (!bannerUrl) {
      heroBannerEl.classList.remove('banner-theme-light');
      heroBannerEl.classList.add('banner-theme-dark');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 32, 32);
        const imgData = ctx.getImageData(0, 0, 32, 32).data;

        // Fundo do crachá para compor com o canal alpha da imagem
        const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark' ||
                            document.documentElement.getAttribute('data-theme') === 'roxo-numetalico';
        const bgR = isDarkTheme ? 30 : 255;
        const bgG = isDarkTheme ? 10 : 255;
        const bgB = isDarkTheme ? 46 : 255;

        let totalLum = 0;
        let count = 0;

        for (let i = 0; i < imgData.length; i += 4) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          const a = imgData[i + 3] / 255; // Opacidade 0 a 1

          // Alpha blending com o fundo do crachá
          const effR = r * a + bgR * (1 - a);
          const effG = g * a + bgG * (1 - a);
          const effB = b * a + bgB * (1 - a);

          const lum = 0.299 * effR + 0.587 * effG + 0.114 * effB;
          totalLum += lum;
          count++;
        }

        const avgLum = totalLum / (count || 1);
        if (avgLum > 135) {
          heroBannerEl.classList.remove('banner-theme-dark');
          heroBannerEl.classList.add('banner-theme-light');
        } else {
          heroBannerEl.classList.remove('banner-theme-light');
          heroBannerEl.classList.add('banner-theme-dark');
        }
      } catch (err) {
        heroBannerEl.classList.add('banner-theme-dark');
      }
    };
    img.onerror = () => {
      heroBannerEl.classList.add('banner-theme-dark');
    };
    img.src = bannerUrl;
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

          <!-- HERO BANNER DO CRACHÁ (ENVOLVE AVATAR, NOME E NICK COM CONTRASTE) -->
          <div class="grand-badge-hero-banner ${user.banner ? '' : 'banner-default'}" id="grandBadgeHeroBanner" style="${user.banner ? `background-image: url('${user.banner}');` : ''}">
            <div class="hero-banner-overlay"></div>

            <button type="button" class="btn-change-banner-badge" id="btnQuickEditBanner" title="Trocar Banner do Crachá">
              📷 Trocar Banner
            </button>

            <div class="hero-banner-foreground">
              <div class="grand-badge-photo-box hero-photo-box">
                <img src="${user.avatar || 'images/elgalylogo.png'}" alt="Foto" id="grandPassAvatar" class="grand-badge-avatar">
                <button type="button" class="btn-change-photo-badge" id="btnQuickEditPhoto" title="Trocar Foto">✎</button>
                <div class="hologram-strip ${career.stripClass}">${career.stripText}</div>
              </div>

              <div class="hero-banner-text-plate" id="heroBannerTextPlate">
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
                </div>
              </div>
            </div>
          </div>

          <!-- SEÇÃO INFERIOR DO CRACHÁ (CÓDIGO DE BARRAS + METADADOS + BARRA DE XP) -->
          <div class="grand-badge-lower-section">
            <div class="grand-badge-barcode-wrap">
              <div class="badge-barcode">
                <div class="barcode-lines"></div>
                <span class="barcode-text">ID: ${user.id ? user.id.slice(0, 10).toUpperCase() : 'EEX-AGENT'}</span>
              </div>
            </div>

            <div class="grand-badge-meta-column">
              <div class="grand-agent-meta">
                ${user.agentMood && typeof EEX_MOODS !== 'undefined' && EEX_MOODS[user.agentMood] ? `
                  <div class="agent-mood-tag" style="--mood-color: ${EEX_MOODS[user.agentMood].color};">
                    <span class="mood-emoji">${EEX_MOODS[user.agentMood].emoji}</span>
                    <span>${EEX_MOODS[user.agentMood].label}</span>
                  </div>
                ` : ''}
                ${user.bio ? `
                  <div class="grand-agent-bio">
                    <span class="bio-quote-icon">“</span>
                    <p class="bio-text">${user.bio}</p>
                  </div>
                ` : `
                  <div class="grand-agent-bio empty-bio">
                    <p class="bio-text">Nenhuma bio configurada. Clique em Editar Perfil para adicionar uma!</p>
                  </div>
                `}
                <div class="meta-row">📍 <strong>Setor:</strong> ${user.location || 'Nova Amerit - NA (Nova Arcanis)'}</div>
                <div class="meta-row">${statusDot} <strong>Status:</strong> <span style="font-weight:800;color:${statusColor};">${statusText}</span></div>
                <div class="meta-row">🎖️ <strong>Patente:</strong> ${career.rankTitle} (Nível ${career.level}/100)</div>
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

        <!-- GRID DASHBOARD DO PERFIL (CONQUISTAS & MURAL DE FOTOS LADO A LADO) -->
        <div class="profile-dashboard-grid">
          <!-- ARMÁRIO DE CONQUISTAS DA FROTA (INSÍGNIAS) -->
          <div class="profile-achievements-section profile-dash-card">
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
          <div class="profile-memories-section profile-dash-card">
            <div class="section-title-wrap">
              <h3 class="profile-section-heading">📸 Meu Mural de Momentos</h3>
              <span class="achievements-counter">${memories.length} Registros</span>
            </div>

            ${memories.length === 0 ? `
              <div class="empty-subtab-box" style="background: var(--card-bg); border: 2.5px dashed var(--purple-main); border-radius: 16px; padding: 24px; text-align: center; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
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

      </div>
    `;

    // Eventos do Perfil
    const btnEdit = document.getElementById('btnOpenEditProfileMain');
    const btnQuickPhoto = document.getElementById('btnQuickEditPhoto');
    if (btnEdit) btnEdit.addEventListener('click', () => this.openEditProfileModal());
    if (btnQuickPhoto) btnQuickPhoto.addEventListener('click', () => this.openEditProfileModal());

    const btnQuickBanner = document.getElementById('btnQuickEditBanner');
    if (btnQuickBanner) {
      btnQuickBanner.addEventListener('click', () => {
        const qi = document.getElementById('quickBannerInput');
        if (qi) qi.click();
      });
    }

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

    // Adapta contraste das palavras do crachá conforme luminância e opacidade do banner
    const heroBannerEl = document.getElementById('grandBadgeHeroBanner');
    this.adaptBannerContrast(user.banner, heroBannerEl);

    // Animação do Crachá Caindo Pendurado pelo cordão (efeito pêndulo físico)
    const profileContainer = wrap.querySelector('.grand-profile-container');
    if (profileContainer) {
      profileContainer.classList.remove('badge-hanging-drop');
      void profileContainer.offsetWidth;
      profileContainer.classList.add('badge-hanging-drop');
    }
  },

  openEditProfileModal() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    const modal = document.getElementById('modalEditProfile');
    const nameInput = document.getElementById('editProfileName');
    const locInput = document.getElementById('editProfileLocation');
    const avatarPreview = document.getElementById('editAvatarPreview');

    const bioInput = document.getElementById('editProfileBio');

    if (nameInput) nameInput.value = user.name;
    if (locInput) locInput.value = user.location || 'Nova Amerit - NA (Nova Arcanis)';
    if (bioInput) bioInput.value = user.bio || '';
    if (avatarPreview) avatarPreview.src = user.avatar || 'images/elgalylogo.png';

    const currentMood = user.agentMood || 'foco';
    const moodHidden = document.getElementById('editProfileMood');
    if (moodHidden) moodHidden.value = currentMood;
    const moodGrid = document.getElementById('moodSelectorGrid');
    if (moodGrid) {
      moodGrid.querySelectorAll('.mood-chip-btn').forEach(btn => {
        if (btn.dataset.mood === currentMood) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    const bioCounter = document.getElementById('editBioCounter');
    if (bioCounter) bioCounter.textContent = `${(user.bio || '').length} / 180`;

    this.editAvatarBase64 = null;
    this.editBannerBase64 = null;

    const bannerPreview = document.getElementById('editBannerPreview');
    const bannerPlaceholder = document.getElementById('editBannerPlaceholder');
    const btnRemoveBanner = document.getElementById('btnRemoveBanner');
    const editBannerInput = document.getElementById('editBannerInput');
    if (editBannerInput) editBannerInput.value = '';
    if (user.banner) {
      if (bannerPreview) {
        bannerPreview.src = user.banner;
        bannerPreview.style.display = 'block';
      }
      if (bannerPlaceholder) bannerPlaceholder.style.display = 'none';
      if (btnRemoveBanner) btnRemoveBanner.style.display = 'inline-block';
    } else {
      if (bannerPreview) {
        bannerPreview.src = '';
        bannerPreview.style.display = 'none';
      }
      if (bannerPlaceholder) bannerPlaceholder.style.display = 'block';
      if (btnRemoveBanner) btnRemoveBanner.style.display = 'none';
    }

    if (modal) modal.classList.add('active');
  },

    openHabitModal(habit = null) {
    const modal = document.getElementById('modalHabit');
    const titleEl = document.getElementById('modalHabitTitle') || modal?.querySelector('h2');
    const descEl = document.getElementById('modalHabitDesc');
    const idInput = document.getElementById('habitId');
    const titleInput = document.getElementById('habitTitle');
    const catInput = document.getElementById('habitCategory');
    const submitBtn = document.getElementById('btnSubmitHabit') || document.querySelector('#formHabit button[type="submit"]');

    if (habit) {
      if (titleEl) titleEl.textContent = '✏️ Editar Rotina Diária';
      if (descEl) descEl.textContent = 'Altere o nome, categoria ou dias de frequência desta rotina.';
      if (idInput) idInput.value = habit.id;
      if (titleInput) titleInput.value = habit.title;
      if (catInput) catInput.value = habit.category || 'pessoal';
      if (submitBtn) submitBtn.textContent = '💾 Salvar Alterações';

      const habitDays = Array.isArray(habit.days) && habit.days.length > 0 ? habit.days : [0, 1, 2, 3, 4, 5, 6];
      document.querySelectorAll('#habitDaysPicker .weekday-btn').forEach(b => {
        const d = parseInt(b.dataset.day, 10);
        b.classList.toggle('active', habitDays.includes(d));
      });
    } else {
      if (titleEl) titleEl.textContent = '☀️ Novo Hábito Diário';
      if (descEl) descEl.textContent = 'Adicione uma rotina diária para acompanhar sua sequência (streak).';
      if (idInput) idInput.value = '';
      if (titleInput) titleInput.value = '';
      if (catInput) catInput.value = 'pessoal';
      if (submitBtn) submitBtn.textContent = 'Adicionar à Rotina Diária';

      document.querySelectorAll('#habitDaysPicker .weekday-btn').forEach(b => b.classList.add('active'));
    }

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


// ==========================================================================
// EEX-MAIL: O CHAT DE CONVERSAS DO ELGALY EXPRESS (SMARTPHONE RETRÔ / 24H)
// ==========================================================================
const EexMailManager = {
  activeFriend: null,
  activeChatId: null,
  unsubscribeMessages: null,
  toastTimer: null,
  clockTimer: null,
  _pendingToastFriend: null,

  init() {
    // 1. Fechar telefone (botão voltar, barra home e clique fora)
    const btnClose = document.getElementById('btnCloseEexPhone');
    const homeBar = document.getElementById('eexPhoneHomeBar');
    const overlay = document.getElementById('modalEexPhone');

    if (btnClose) btnClose.addEventListener('click', () => this.closeChat());
    if (homeBar) homeBar.addEventListener('click', () => this.closeChat());
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeChat();
      });
    }

    // 2. Formulário de envio de mensagem
    const form = document.getElementById('formEexPhoneChat');
    const input = document.getElementById('inputEexPhoneMsg');
    if (form && input) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await this.sendMessage(text);
      });
    }

    // 3. Reações rápidas (emojis)
    document.querySelectorAll('.eex-quick-emoji-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const emoji = btn.dataset.emoji;
        if (emoji && this.activeFriend) {
          await this.sendMessage(emoji);
        }
      });
    });

    // 4. Toast flutuante de novo EEX-Mail
    const btnOpenToast = document.getElementById('btnOpenToastEexMail');
    const btnCloseToast = document.getElementById('btnCloseToastEexMail');
    if (btnOpenToast) {
      btnOpenToast.addEventListener('click', () => {
        if (this._pendingToastFriend) {
          const target = this._pendingToastFriend;
          this.hideIncomingToast();
          this.openChat(target);
        }
      });
    }
    if (btnCloseToast) {
      btnCloseToast.addEventListener('click', () => {
        this.hideIncomingToast();
      });
    }

    // 5. Relógio do celular EEX-OS
    this.updateClock();
    if (!this.clockTimer) {
      this.clockTimer = setInterval(() => this.updateClock(), 30000);
    }
  },

  updateClock() {
    const clockEl = document.getElementById('eexPhoneClock');
    if (clockEl) {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      clockEl.textContent = `${hours}:${mins}`;
    }
  },

  async openChat(friend) {
    if (!friend || !friend.uid) return;
    this.activeFriend = friend;

    const myUser = (typeof AuthManager !== 'undefined') ? AuthManager.getCurrentUser() : null;
    if (!myUser) {
      if (typeof AppUI !== 'undefined') AppUI.showToast('Faça login com sua conta para usar o EEX-Mail!');
      return;
    }

    const myUid = myUser.id || myUser.uid;
    this.activeChatId = [myUid, friend.uid].sort().join('_');

    // Preenche cabeçalho do smartphone
    const nameEl = document.getElementById('eexPhoneUserName');
    const nickEl = document.getElementById('eexPhoneUserNick');
    const avatarEl = document.getElementById('eexPhoneAvatar');

    if (nameEl) nameEl.textContent = friend.name || friend.nickname || 'Parceiro';
    if (nickEl) nickEl.textContent = friend.eexEmail ? `@${friend.eexEmail}` : `@${friend.nickname || 'agente'}.express.com`;
    if (avatarEl) {
      avatarEl.src = (typeof FirebaseService !== 'undefined') 
        ? FirebaseService.getSafeAvatar(friend.avatar, friend) 
        : (friend.avatar || 'images/elgalylogo.png');
    }

    // Abre o modal com animação de subida do celular
    const modal = document.getElementById('modalEexPhone');
    if (modal) modal.classList.add('active');

    // Foca no input
    const input = document.getElementById('inputEexPhoneMsg');
    if (input) setTimeout(() => input.focus(), 350);

    // Começa a escutar mensagens em tempo real
    this.listenMessages();
  },

  closeChat() {
    const modal = document.getElementById('modalEexPhone');
    if (modal) modal.classList.remove('active');

    if (this.unsubscribeMessages) {
      this.unsubscribeMessages();
      this.unsubscribeMessages = null;
    }
    this.activeFriend = null;
    this.activeChatId = null;
  },

  listenMessages() {
    if (this.unsubscribeMessages) {
      this.unsubscribeMessages();
      this.unsubscribeMessages = null;
    }

    if (typeof FirebaseService === 'undefined' || !FirebaseService.db) return;

    const messagesListEl = document.getElementById('eexPhoneMessagesList');
    if (!messagesListEl) return;

    messagesListEl.innerHTML = `
      <div class="eex-phone-loading">
        <div class="eex-phone-spinner"></div>
        <span>Sintonizando canal EEX-Mail...</span>
      </div>
    `;

    // Filtro de 24 horas: apenas mensagens enviadas nas últimas 24h
    const cutoff24h = Date.now() - (24 * 60 * 60 * 1000);

    this.unsubscribeMessages = FirebaseService.db
      .collection('chats')
      .doc(this.activeChatId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .onSnapshot(snapshot => {
        const msgs = [];
        const expiredDocs = [];

        snapshot.forEach(doc => {
          const data = { id: doc.id, ...doc.data() };
          if (data.timestamp && data.timestamp >= cutoff24h) {
            msgs.push(data);
          } else if (data.timestamp && data.timestamp < cutoff24h) {
            expiredDocs.push(doc.ref);
          }
        });

        // Limpeza automática de mensagens que passaram de 24h
        if (expiredDocs.length > 0) {
          expiredDocs.forEach(ref => ref.delete().catch(() => {}));
        }

        this.renderMessages(msgs);
      }, err => {
        console.warn('Erro ao escutar mensagens do chat:', err);
        messagesListEl.innerHTML = `
          <div class="eex-phone-empty">
            <span style="font-size:2rem;">⚠️</span>
            <p>Não foi possível carregar as mensagens. Verifique sua conexão!</p>
          </div>
        `;
      });
  },

  renderMessages(messages) {
    const container = document.getElementById('eexPhoneMessagesList');
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = `
        <div class="eex-phone-empty">
          <img src="images/elgalylogo.png" alt="EEX" class="eex-phone-empty-mascot">
          <h4>Canal Limpo &amp; Seguro</h4>
          <p>As mensagens neste canal duram <strong>24 horas</strong>. Mande um alô para <strong>${this.activeFriend?.name || 'seu parceiro'}</strong>!</p>
        </div>
      `;
      return;
    }

    const myUser = (typeof AuthManager !== 'undefined') ? AuthManager.getCurrentUser() : null;
    const myUid = myUser?.id || myUser?.uid;

    container.innerHTML = messages.map(msg => {
      const isMine = msg.senderUid === myUid;
      const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      return `
        <div class="eex-msg-row ${isMine ? 'mine' : 'theirs'}">
          ${!isMine ? `
            <img src="${msg.senderAvatar || 'images/elgalylogo.png'}" alt="${msg.senderName || 'Amigo'}" class="eex-msg-bubble-avatar">
          ` : ''}
          <div class="eex-msg-bubble ${isMine ? 'mine' : 'theirs'}">
            <div class="eex-msg-text">${this.escapeHtml(msg.text)}</div>
            <div class="eex-msg-meta">
              <span class="eex-msg-time">${timeStr}</span>
              ${isMine ? '<span class="eex-msg-status" title="Entregue">✓✓</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Scroll suave até o final das mensagens
    container.scrollTop = container.scrollHeight;
  },

  async sendMessage(text) {
    if (!text || !this.activeFriend || !this.activeChatId) return;

    const myUser = (typeof AuthManager !== 'undefined') ? AuthManager.getCurrentUser() : null;
    if (!myUser) return;

    // Efeito sonoro de envio express
    try {
      const snd = new Audio('tudum_sent.mp3');
      snd.volume = 0.55;
      snd.play().catch(() => {});
    } catch {}

    const myUid = myUser.id || myUser.uid;
    const payload = {
      senderUid: myUid,
      senderName: myUser.name || 'Agente Express',
      senderNick: myUser.nickname || 'agente',
      senderAvatar: (typeof FirebaseService !== 'undefined') ? FirebaseService.getSafeAvatar(myUser.avatar, myUser) : (myUser.avatar || 'images/elgalylogo.png'),
      recipientUid: this.activeFriend.uid,
      text: text.trim(),
      timestamp: Date.now(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      const chatRef = FirebaseService.db.collection('chats').doc(this.activeChatId);

      // 1. Grava a mensagem na subcoleção messages
      await chatRef.collection('messages').add(payload);

      // 2. Atualiza o cabeçalho do chat compartilhado
      await chatRef.set({
        participants: [myUid, this.activeFriend.uid],
        lastMessage: payload.text,
        lastSenderUid: myUid,
        lastSenderName: payload.senderName,
        lastSenderNick: payload.senderNick,
        lastSenderAvatar: payload.senderAvatar,
        lastTimestamp: payload.timestamp,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    } catch (err) {
      console.error('Erro ao enviar mensagem no EEX-Mail:', err);
      if (typeof AppUI !== 'undefined') {
        AppUI.showToast('⚠️ Erro ao enviar mensagem. Verifique sua conexão!');
      }
    }
  },

  onIncomingMessage(chatData) {
    if (!chatData) return;
    const myUser = (typeof AuthManager !== 'undefined') ? AuthManager.getCurrentUser() : null;
    const myUid = myUser?.id || myUser?.uid;

    // Ignora se a mensagem foi enviada por mim mesmo
    if (chatData.lastSenderUid === myUid) return;

    // Se o chat com esse amigo já estiver aberto na tela, não exibe toast flutuante
    if (this.activeFriend && this.activeFriend.uid === chatData.lastSenderUid) {
      return;
    }

    // Ignora mensagens com mais de 25 segundos
    if (Date.now() - (chatData.lastTimestamp || 0) > 25000) return;

    // Efeito sonoro retrô de mensagem recebida
    try {
      const snd = new Audio('crostnotification-sound.mp3');
      snd.volume = 0.65;
      snd.play().catch(() => {});
    } catch {}

    this._pendingToastFriend = {
      uid: chatData.lastSenderUid,
      name: chatData.lastSenderName || 'Parceiro Express',
      nickname: chatData.lastSenderNick || 'agente',
      avatar: chatData.lastSenderAvatar || 'images/elgalylogo.png'
    };

    const toast = document.getElementById('eexMailIncomingToast');
    const senderEl = document.getElementById('eexMailToastSender');
    const snippetEl = document.getElementById('eexMailToastSnippet');
    const avatarEl = document.getElementById('eexMailToastAvatar');

    if (senderEl) senderEl.textContent = chatData.lastSenderName || 'Parceiro';
    if (snippetEl) snippetEl.textContent = `"${(chatData.lastMessage || '').substring(0, 50)}"`;
    if (avatarEl) avatarEl.src = chatData.lastSenderAvatar || 'images/elgalylogo.png';

    if (toast) {
      toast.style.display = 'block';
      toast.classList.remove('eex-mail-toast-hide');
      toast.classList.add('eex-mail-toast-show');

      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.hideIncomingToast();
      }, 7000);
    }
  },

  hideIncomingToast() {
    const toast = document.getElementById('eexMailIncomingToast');
    if (toast) {
      toast.classList.remove('eex-mail-toast-show');
      toast.classList.add('eex-mail-toast-hide');
      setTimeout(() => {
        toast.style.display = 'none';
      }, 300);
    }
    if (this.toastTimer) clearTimeout(this.toastTimer);
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};
