/**
 * ELGALY EXPRESS - MOTOR DE RELATÓRIOS & GERADOR DE PDF
 * Analisa desempenho em 7, 15 ou 30 dias.
 * Inclui logo proporcional, Providente, conchas, conquistas e amigos.
 */

const ReportEngine = {
  currentTimeframe: 7,
  cachedLogoBase64: null,
  cachedProvidenteBase64: null,
  cachedSealBase64: null,

  init() {
    this._preloadImage('images/elgalylogo_arrow.png', b64 => { this.cachedLogoBase64 = b64; });
    this._preloadImage('images/happy_provident.png',  b64 => { this.cachedProvidenteBase64 = b64; });
    this._preloadImage('magaficseal.png',              b64 => { this.cachedSealBase64 = b64; });
  },

  _preloadImage(src, callback) {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth  || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        callback(canvas.toDataURL('image/png'));
      } catch (e) {
        console.warn(`Falha ao carregar imagem para PDF (${src}):`, e);
      }
    };
    img.onerror = () => console.warn(`Não encontrou imagem: ${src}`);
    img.src = src;
  },

  setTimeframe(days) {
    this.currentTimeframe = parseInt(days, 10);
    this.renderReportPreview();
  },

  getAnalyticsData(days = this.currentTimeframe) {
    const tasks       = TaskManager.getAllTasks();
    const habits      = HabitManager.getAllHabits();
    const habitHistory= HabitManager.getHistory();
    const currentUser = AuthManager.getCurrentUser();

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const relevantTasks = tasks.filter(task => {
      const createdAt   = new Date(task.createdAt);
      const dueDate     = task.dueDate     ? new Date(task.dueDate)     : null;
      const completedAt = task.completedAt ? new Date(task.completedAt) : null;
      return createdAt >= startDate ||
             (completedAt && completedAt >= startDate) ||
             (dueDate     && dueDate     >= startDate);
    });

    let totalTasks = relevantTasks.length;
    let completedCount = 0, onTimeCount = 0, fastCount = 0, lateCount = 0;
    let pendingOnTime  = 0, pendingOverdue = 0;
    let faculTotal = 0, faculCompleted = 0, faculOnTime = 0;
    let pessoalTotal= 0, pessoalCompleted= 0, pessoalOnTime= 0;
    let workTotal   = 0, workCompleted  = 0, workOnTime  = 0;
    const taskManifest = [];

    relevantTasks.forEach(task => {
      const cat = task.category || 'pessoal';
      if      (cat === 'faculdade') faculTotal++;
      else if (cat === 'trabalho')  workTotal++;
      else                          pessoalTotal++;

      let speedStatus = 'Pendente';
      let speedClass  = 'status-ontime';

      if (task.completed) {
        completedCount++;
        if      (cat === 'faculdade') faculCompleted++;
        else if (cat === 'trabalho')  workCompleted++;
        else                          pessoalCompleted++;

        if (task.dueDate && task.completedAt) {
          const due  = new Date(task.dueDate).getTime();
          const comp = new Date(task.completedAt).getTime();
          const diffH = (due - comp) / (1000 * 60 * 60);

          if (diffH >= 0) {
            onTimeCount++;
            if (cat === 'faculdade') faculOnTime++;
            else if (cat === 'trabalho') workOnTime++;
            else pessoalOnTime++;

            if (diffH >= 12) {
              fastCount++;
              const dEarly = Math.round(diffH / 24);
              speedStatus = `⚡ Rápido (${dEarly > 0 ? dEarly + 'd' : Math.round(diffH) + 'h'} antes)`;
              speedClass  = 'speed-fast';
            } else {
              speedStatus = `✅ No Prazo (${Math.round(diffH)}h antes)`;
              speedClass  = 'speed-ontime';
            }
          } else {
            lateCount++;
            const lH = Math.abs(Math.round(diffH));
            speedStatus = `🐢 Atrasado (${lH > 24 ? Math.round(lH/24)+'d' : lH+'h'})`;
            speedClass  = 'speed-late';
          }
        } else {
          onTimeCount++;
          if (cat === 'faculdade') faculOnTime++;
          else if (cat === 'trabalho') workOnTime++;
          else pessoalOnTime++;
          speedStatus = '✅ Concluído';
        }
      } else {
        if (task.dueDate) {
          const due  = new Date(task.dueDate).getTime();
          const curr = now.getTime();
          if (curr > due) {
            pendingOverdue++;
            const ovH = Math.round((curr - due) / (1000 * 60 * 60));
            speedStatus = `⚠️ Atrasado (${ovH > 24 ? Math.round(ovH/24)+'d' : ovH+'h'})`;
            speedClass  = 'status-late';
          } else {
            pendingOnTime++;
            speedStatus = '⏳ Em Rota';
          }
        } else {
          pendingOnTime++;
          speedStatus = '⏳ Em Rota';
        }
      }

      taskManifest.push({
        code:      task.code || `ELG-${task.id.slice(-3).toUpperCase()}`,
        title:     task.title,
        category:  cat,
        dueDate:   task.dueDate     ? new Date(task.dueDate).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : 'Sem prazo',
        completedAt: task.completedAt ? new Date(task.completedAt).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : '—',
        speedStatus,
        speedClass,
        completed: task.completed
      });
    });

    // Hábitos
    let totalExpectedHabits = habits.length * days;
    let completedHabitsCount = 0, perfectDays = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateKey   = d.toLocaleDateString('en-CA');
      const dayRecord = habitHistory[dateKey] || [];
      completedHabitsCount += dayRecord.length;
      if (habits.length > 0 && dayRecord.length >= habits.length) perfectDays++;
    }

    const habitSuccessRate    = totalExpectedHabits > 0
      ? Math.min(100, Math.round((completedHabitsCount / totalExpectedHabits) * 100)) : 100;
    const taskCompletionRate  = totalTasks   > 0 ? Math.round((completedCount / totalTasks)   * 100) : 100;
    const taskOnTimeRate      = completedCount > 0 ? Math.round((onTimeCount   / completedCount)* 100) : (pendingOverdue > 0 ? 50 : 100);
    const finalScore = Math.round((taskCompletionRate * 0.40) + (taskOnTimeRate * 0.40) + (habitSuccessRate * 0.20));

    // Rank
    let rank = 'Rank S', rankTitle = 'Lenda Interdimensional do Frete Rápido';
    let rankDesc  = 'Desempenho espetacular! Entregas impecáveis e rotina diária no auge!';
    let rankColor = '#ffeb3b';

    if (totalTasks === 0 && habits.length === 0) {
      rank = 'Recruta EEX'; rankTitle = 'Novo Entregador de Nova Amerit';
      rankDesc  = 'Cadastre suas primeiras encomendas e hábitos para conquistar seus ranks!';
      rankColor = '#ffeb3b';
    } else if (finalScore < 60 || pendingOverdue >= 3) {
      rank = 'Rank C'; rankTitle = 'Sobrevivente do Vórtice Dimensional';
      rankDesc  = 'Atenção aos prazos! Algumas entregas atrasaram e a rotina precisa de fôlego.';
      rankColor = '#f87171';
    } else if (finalScore < 78) {
      rank = 'Rank B'; rankTitle = 'Mensageiro Confiável de Elgaly Edge';
      rankDesc  = 'Bom ritmo de entregas. Reduza os atrasos pontuais para alcançar o topo!';
      rankColor = '#60a5fa';
    } else if (finalScore < 92) {
      rank = 'Rank A'; rankTitle = 'Piloto Oficial Elgaly Express';
      rankDesc  = 'Excelente pontualidade e agilidade em ritmo constante!';
      rankColor = '#4ade80';
    }

    // Conchas & Conquistas
    const shells       = (typeof ShellsManager !== 'undefined') ? ShellsManager.getBalance() : 0;
    const achievements = (typeof AppUI !== 'undefined' && AppUI.getAchievements)
      ? AppUI.getAchievements({ completedTasksCount: completedCount, shells })
      : [];
    const unlockedAch  = achievements.filter(a => a.unlocked);

    // Amigos
    const friendCount = (typeof FriendsManager !== 'undefined' && FriendsManager.friends)
      ? FriendsManager.friends.length : 0;

    // Modo trabalho
    const workMode = currentUser?.workMode || false;

    return {
      days, currentUser, startDate: startDate.toLocaleDateString('pt-BR'), endDate: now.toLocaleDateString('pt-BR'),
      totalTasks, completedCount, onTimeCount, fastCount, lateCount, pendingOnTime, pendingOverdue,
      taskCompletionRate, taskOnTimeRate,
      faculTotal, faculCompleted, faculOnTime,
      pessoalTotal, pessoalCompleted, pessoalOnTime,
      workTotal, workCompleted, workOnTime, workMode,
      totalExpectedHabits, completedHabitsCount, perfectDays, habitSuccessRate,
      finalScore, rank, rankTitle, rankDesc, rankColor,
      taskManifest, shells, unlockedAch, friendCount,
      habits
    };
  },

  renderReportPreview() {
    const data = this.getAnalyticsData();

    document.querySelectorAll('.timeframe-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.days, 10) === this.currentTimeframe);
    });

    const rankStamp = document.getElementById('reportRankStamp');
    const rankTitle = document.getElementById('reportRankTitle');
    const rankDesc  = document.getElementById('reportRankDesc');
    if (rankStamp) { rankStamp.textContent = data.rank; rankStamp.style.background = data.rankColor; }
    if (rankTitle) rankTitle.textContent = `${data.rank}: ${data.rankTitle}`;
    if (rankDesc)  rankDesc.textContent  = `${data.rankDesc} (Pontuação Geral: ${data.finalScore}/100)`;

    const elTotal  = document.getElementById('reportStatTotal');
    const elOnTime = document.getElementById('reportStatOnTime');
    const elSpeed  = document.getElementById('reportStatSpeed');
    const elHabits = document.getElementById('reportStatHabits');
    if (elTotal)  elTotal.textContent  = `${data.completedCount}/${data.totalTasks}`;
    if (elOnTime) elOnTime.textContent = `${data.taskOnTimeRate}%`;
    if (elSpeed)  elSpeed.textContent  = `${data.fastCount} Antecipadas`;
    if (elHabits) elHabits.textContent = `${data.perfectDays} dias 100%`;

    const barFast   = document.getElementById('speedBarFast');
    const barOntime = document.getElementById('speedBarOntime');
    const barLate   = document.getElementById('speedBarLate');
    const total = Math.max(1, data.fastCount + (data.onTimeCount - data.fastCount) + data.lateCount + data.pendingOverdue);
    const pctFast   = Math.round((data.fastCount / total) * 100);
    const pctNormal = Math.round(((data.onTimeCount - data.fastCount) / total) * 100);
    const pctLate   = Math.round(((data.lateCount + data.pendingOverdue) / total) * 100);
    if (barFast)   barFast.style.width   = `${pctFast}%`;
    if (barOntime) barOntime.style.width = `${pctNormal}%`;
    if (barLate)   barLate.style.width   = `${pctLate}%`;

    const txtFast   = document.getElementById('speedTxtFast');
    const txtOntime = document.getElementById('speedTxtOntime');
    const txtLate   = document.getElementById('speedTxtLate');
    if (txtFast)   txtFast.textContent   = `${data.fastCount} encomendas (${pctFast}%)`;
    if (txtOntime) txtOntime.textContent = `${Math.max(0, data.onTimeCount - data.fastCount)} encomendas (${pctNormal}%)`;
    if (txtLate)   txtLate.textContent   = `${data.lateCount + data.pendingOverdue} encomendas (${pctLate}%)`;

    const faculStats = document.getElementById('reportFaculStats');
    if (faculStats) faculStats.innerHTML = `
      <li><span>Total:</span> <strong>${data.faculTotal}</strong></li>
      <li><span>Concluídas:</span> <strong>${data.faculCompleted}</strong></li>
      <li><span>No Prazo:</span> <strong>${data.faculCompleted > 0 ? Math.round((data.faculOnTime/data.faculCompleted)*100) : 100}%</strong></li>
    `;
    const pessoalStats = document.getElementById('reportPessoalStats');
    if (pessoalStats) pessoalStats.innerHTML = `
      <li><span>Total:</span> <strong>${data.pessoalTotal}</strong></li>
      <li><span>Concluídas:</span> <strong>${data.pessoalCompleted}</strong></li>
      <li><span>No Prazo:</span> <strong>${data.pessoalCompleted > 0 ? Math.round((data.pessoalOnTime/data.pessoalCompleted)*100) : 100}%</strong></li>
    `;
  },

  // ============================================================
  // HELPER — desenha linha horizontal decorativa no PDF
  // ============================================================
  _divider(doc, y, pageWidth, r=200, g=200, b=200) {
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.3);
    doc.line(15, y, pageWidth - 15, y);
  },

  // ============================================================
  // HELPER — cabeçalho de seção com fundo
  // ============================================================
  _sectionHeader(doc, y, pageWidth, title, bgR=58, bgG=21, bgB=77) {
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(15, y, pageWidth - 30, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(title, 19, y + 5);
    return y + 9;
  },

  // ============================================================
  // HELPER — mini card colorido
  // ============================================================
  _miniCard(doc, x, y, w, h, val, label, r, g, b) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.7);
    doc.roundedRect(x, y, w, h, 2, 2, 'FD');
    // Linha de cor no topo
    doc.setFillColor(r, g, b);
    doc.rect(x, y, w, 1.5, 'F');
    doc.setTextColor(r, g, b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(String(val), x + w / 2, y + h * 0.58, { align: 'center' });
    doc.setTextColor(90, 90, 90);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(label, x + w / 2, y + h - 2.5, { align: 'center' });
  },

  async exportPDF() {
    const data = this.getAnalyticsData();

    const jsPDFModule = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
    if (!jsPDFModule) {
      alert('Biblioteca de PDF ainda carregando. Tente em instantes.');
      return;
    }

    const doc = new jsPDFModule({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW  = doc.internal.pageSize.getWidth();
    const PH  = doc.internal.pageSize.getHeight();
    let Y = 0;

    // ===========================================================
    // PÁGINA 1
    // ===========================================================

    // --- Cabeçalho principal ---
    doc.setFillColor(26, 8, 38);
    doc.rect(0, 0, PW, 48, 'F');
    // Faixa magenta inferior
    doc.setFillColor(230, 43, 126);
    doc.rect(0, 46, PW, 3, 'F');
    // Acento amarelo
    doc.setFillColor(255, 215, 0);
    doc.rect(0, 46, 6, 3, 'F');

    // Logo proporcional (mantém aspect ratio)
    if (this.cachedLogoBase64) {
      try {
        // Tamanho máximo preservando proporção: 30x30 caixa
        const logoImg = new Image();
        logoImg.src = this.cachedLogoBase64;
        const logoW = logoImg.naturalWidth  || 100;
        const logoH = logoImg.naturalHeight || 100;
        const ratio = logoW / logoH;
        const maxH = 26, maxW = 30;
        let drawW = maxW, drawH = maxW / ratio;
        if (drawH > maxH) { drawH = maxH; drawW = maxH * ratio; }
        const logoX = 13;
        const logoY = (46 - drawH) / 2;
        doc.addImage(this.cachedLogoBase64, 'PNG', logoX, logoY, drawW, drawH);
      } catch (e) {
        console.warn('Erro ao inserir logo:', e);
      }
    }

    const TX = 50; // Início do texto do cabeçalho
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('ELGALY EXPRESS', TX, 14);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text('RELATÓRIO OFICIAL DE DESPACHO OPERACIONAL & ROTINA', TX, 21);

    doc.setTextColor(247, 168, 202);
    doc.setFontSize(8.5);
    const agentNick = data.currentUser ? data.currentUser.eexEmail : 'agente.express.com';
    const agentName = data.currentUser ? data.currentUser.name     : '';
    doc.text(`Agente: ${agentName ? agentName + ' | ' : ''}${agentNick}`, TX, 28);
    doc.text(`Período: ${data.startDate} a ${data.endDate}  (${data.days} dias)`, TX, 34);

    doc.setTextColor(180, 180, 210);
    doc.setFontSize(7);
    doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, TX, 40);

    // Saldo de Conchas no cabeçalho (canto direito)
    doc.setFillColor(255, 215, 0);
    doc.roundedRect(PW - 42, 10, 30, 13, 2, 2, 'F');
    doc.setTextColor(26, 8, 38);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(`🐚 ${data.shells}`, PW - 27, 19, { align: 'center' });
    doc.setFontSize(6);
    doc.text('CONCHAS EEX', PW - 27, 22.5, { align: 'center' });

    Y = 54;

    // --- Card de Rank ---
    const rankBg = this._hexToRgb(data.rankColor) || [255,235,59];
    doc.setFillColor(rankBg[0], rankBg[1], rankBg[2], 0.15);
    doc.setFillColor(245, 235, 255);
    doc.setDrawColor(rankBg[0], rankBg[1], rankBg[2]);
    doc.setLineWidth(1.2);
    doc.roundedRect(15, Y, PW - 30, 28, 4, 4, 'FD');

    // Faixa colorida lateral do rank
    doc.setFillColor(rankBg[0], rankBg[1], rankBg[2]);
    doc.roundedRect(15, Y, 6, 28, 4, 4, 'F');
    doc.rect(18, Y, 3, 28, 'F');

    // Emblema do rank
    doc.setFillColor(rankBg[0], rankBg[1], rankBg[2]);
    doc.roundedRect(26, Y + 4, 28, 20, 3, 3, 'F');
    doc.setTextColor(26, 8, 38);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(data.rank.length > 8 ? 7 : 9);
    doc.text(data.rank, 40, Y + 16, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(58, 21, 77);
    doc.text(data.rankTitle, 60, Y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    const descLines = doc.splitTextToSize(data.rankDesc, PW - 75);
    doc.text(descLines, 60, Y + 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(230, 43, 126);
    doc.text(`Pontuação: ${data.finalScore}/100  |  Pontualidade: ${data.taskOnTimeRate}%  |  Rotina: ${data.habitSuccessRate}%`, 60, Y + 25.5);

    Y += 34;

    // --- 4 Mini-cards de indicadores ---
    const cW = (PW - 30 - 9) / 4;
    const cH = 20;
    this._miniCard(doc, 15,             Y, cW, cH, `${data.completedCount}/${data.totalTasks}`, 'TOTAL ENTREGAS',       230, 43, 126);
    this._miniCard(doc, 15 + cW + 3,   Y, cW, cH, `${data.taskOnTimeRate}%`,                   'NO PRAZO',             16, 185, 129);
    this._miniCard(doc, 15 + (cW+3)*2, Y, cW, cH, `${data.fastCount}`,                         'ANTECIPADAS (FAST)',   59, 130, 246);
    this._miniCard(doc, 15 + (cW+3)*3, Y, cW, cH, `${data.perfectDays} dias`,                  'DIAS ROTINA 100%',    245, 158, 11);
    Y += cH + 6;

    // --- 3 Mini-cards extras ---
    const cW2 = (PW - 30 - 6) / 3;
    this._miniCard(doc, 15,            Y, cW2, cH, `🐚 ${data.shells}`,      'SALDO DE CONCHAS',      180, 130, 0);
    this._miniCard(doc, 15 + cW2 + 3, Y, cW2, cH, `${data.unlockedAch.length}`,                 'CONQUISTAS',          100, 60, 200);
    this._miniCard(doc, 15+(cW2+3)*2, Y, cW2, cH, `${data.friendCount}`,                        'AGENTES EEX-FRIENDS', 20, 150, 180);
    Y += cH + 6;

    // --- Diagnóstico de velocidade ---
    Y = this._sectionHeader(doc, Y, PW, 'DIAGNÓSTICO DE VELOCIDADE & PONTUALIDADE');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(26, 8, 38);
    const diag = [
      `• Entregas Antecipadas (>12h antes): ${data.fastCount} encomendas`,
      `• Entregas no Prazo Regular: ${Math.max(0, data.onTimeCount - data.fastCount)} encomendas`,
      `• Entregas com Atraso: ${data.lateCount} concluídas + ${data.pendingOverdue} pendentes vencidas`,
      `• Rotina Diária: ${data.completedHabitsCount} check-ins em ${data.days} dias (consistência: ${data.habitSuccessRate}%)`,
      `• Dias com Rotina Perfeita (100%): ${data.perfectDays} dia(s) — Hábitos cadastrados: ${data.habits.length}`
    ];
    diag.forEach(line => {
      doc.text(line, 19, Y);
      Y += 4.8;
    });
    Y += 2;

    // --- Setores ---
    Y = this._sectionHeader(doc, Y, PW, 'ANÁLISE POR SETOR DE OPERAÇÕES');
    const sW = data.workMode ? (PW - 30 - 6) / 3 : (PW - 30 - 3) / 2;

    // Setor Acadêmico
    doc.setFillColor(240, 245, 255);
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.6);
    doc.roundedRect(15, Y, sW, 18, 2, 2, 'FD');
    doc.setFillColor(59, 130, 246);
    doc.rect(15, Y, sW, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(30, 58, 138);
    doc.text('🎓 ACADÊMICO (FACULDADE)', 19, Y + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50,50,50);
    doc.text(`Total: ${data.faculTotal}  |  Concluídas: ${data.faculCompleted}  |  Pontualidade: ${data.faculCompleted > 0 ? Math.round((data.faculOnTime/data.faculCompleted)*100) : 100}%`, 19, Y + 14);

    // Setor Pessoal
    doc.setFillColor(255, 245, 235);
    doc.setDrawColor(245, 158, 11);
    doc.roundedRect(15 + sW + 3, Y, sW, 18, 2, 2, 'FD');
    doc.setFillColor(245, 158, 11);
    doc.rect(15 + sW + 3, Y, sW, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(120, 53, 15);
    doc.text('🏠 PESSOAL & PROJETOS', 19 + sW + 3, Y + 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50,50,50);
    doc.text(`Total: ${data.pessoalTotal}  |  Concluídas: ${data.pessoalCompleted}  |  Pontualidade: ${data.pessoalCompleted > 0 ? Math.round((data.pessoalOnTime/data.pessoalCompleted)*100) : 100}%`, 19 + sW + 3, Y + 14);

    // Setor Trabalho (se ativo)
    if (data.workMode) {
      doc.setFillColor(240, 255, 245);
      doc.setDrawColor(16, 185, 129);
      doc.roundedRect(15 + (sW+3)*2, Y, sW, 18, 2, 2, 'FD');
      doc.setFillColor(16, 185, 129);
      doc.rect(15 + (sW+3)*2, Y, sW, 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(6, 78, 59);
      doc.text('💼 MODO PROFISSÃO', 19 + (sW+3)*2, Y + 8);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50,50,50);
      doc.text(`Total: ${data.workTotal}  |  Concluídas: ${data.workCompleted}  |  Pontualidade: ${data.workCompleted > 0 ? Math.round((data.workOnTime/data.workCompleted)*100) : 100}%`, 19 + (sW+3)*2, Y + 14);
    }
    Y += 24;

    // --- Conquistas desbloqueadas ---
    if (data.unlockedAch.length > 0) {
      Y = this._sectionHeader(doc, Y, PW, `CONQUISTAS DESBLOQUEADAS  (${data.unlockedAch.length} de ${data.unlockedAch.length + (data.unlockedAch.length > 0 ? 0 : 0)} total)`, 100, 60, 200);
      const achPerRow = 4;
      const achW = (PW - 30 - (achPerRow - 1) * 3) / achPerRow;
      let achX = 15, achY = Y;
      data.unlockedAch.forEach((ach, i) => {
        doc.setFillColor(245, 240, 255);
        doc.setDrawColor(130, 80, 220);
        doc.setLineWidth(0.5);
        doc.roundedRect(achX, achY, achW, 14, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
        doc.setTextColor(26, 8, 38);
        doc.text(ach.icon || '🏆', achX + achW / 2, achY + 7, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
        doc.setTextColor(70, 40, 120);
        const achName = doc.splitTextToSize(ach.name || '', achW - 2);
        doc.text(achName, achX + achW / 2, achY + 11.5, { align: 'center' });
        achX += achW + 3;
        if ((i + 1) % achPerRow === 0) { achX = 15; achY += 17; }
      });
      Y = achY + (data.unlockedAch.length % achPerRow !== 0 ? 17 : 2);
    }

    // --- Manifesto de Encomendas ---
    // Se não couber na página, adiciona nova
    if (Y > PH - 70) {
      doc.addPage();
      Y = 18;
    }

    Y = this._sectionHeader(doc, Y, PW, 'MANIFESTO DE ENCOMENDAS REGISTRADAS');

    // Cabeçalho da tabela
    doc.setFillColor(240, 235, 248);
    doc.rect(15, Y, PW - 30, 5.5, 'F');
    doc.setTextColor(26, 8, 38); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text('CÓDIGO',  18,       Y + 3.8);
    doc.text('MISSÃO',  40,       Y + 3.8);
    doc.text('SETOR',   108,      Y + 3.8);
    doc.text('PRAZO',   132,      Y + 3.8);
    doc.text('STATUS',  165,      Y + 3.8);
    Y += 6.5;

    if (data.taskManifest.length === 0) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120,120,120);
      doc.text('Nenhuma encomenda registrada neste período.', 18, Y + 4);
      Y += 10;
    } else {
      const maxRows = 18;
      const display = data.taskManifest.slice(0, maxRows);
      display.forEach((t, i) => {
        if (Y > PH - 30) {
          doc.addPage();
          Y = 18;
          Y = this._sectionHeader(doc, Y, PW, 'MANIFESTO (continuação)');
          doc.setFillColor(240, 235, 248);
          doc.rect(15, Y, PW - 30, 5.5, 'F');
          doc.setTextColor(26,8,38); doc.setFont('helvetica','bold'); doc.setFontSize(7);
          doc.text('CÓDIGO', 18, Y+3.8); doc.text('MISSÃO', 40, Y+3.8);
          doc.text('SETOR', 108, Y+3.8); doc.text('PRAZO', 132, Y+3.8); doc.text('STATUS', 165, Y+3.8);
          Y += 6.5;
        }
        if (i % 2 === 1) {
          doc.setFillColor(250, 246, 255);
          doc.rect(15, Y - 1, PW - 30, 5.5, 'F');
        }
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(26,8,38);
        doc.text(t.code, 18, Y + 2.8);
        doc.setFont('helvetica','normal');
        const safeTitle = t.title.length > 34 ? t.title.substring(0, 32) + '...' : t.title;
        doc.text(safeTitle, 40, Y + 2.8);
        const catLabel = t.category === 'faculdade' ? 'Faculdade' : (t.category === 'trabalho' ? 'Trabalho' : 'Pessoal');
        doc.text(catLabel, 108, Y + 2.8);
        doc.text(t.dueDate, 132, Y + 2.8);
        if      (t.speedStatus.includes('Rápido'))  doc.setTextColor(5,150,105);
        else if (t.speedStatus.includes('Atrasado'))doc.setTextColor(220,38,38);
        else                                         doc.setTextColor(80,80,80);
        doc.setFont('helvetica','bold');
        doc.text(t.speedStatus.replace(/[⚡✅🐢⏳⚠️]/g,'').trim(), 165, Y + 2.8);
        Y += 5.5;
      });
      if (data.taskManifest.length > maxRows) {
        doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(120,120,120);
        doc.text(`* E mais ${data.taskManifest.length - maxRows} encomendas no sistema EEX...`, 18, Y + 3);
        Y += 7;
      }
    }

    // ===========================================================
    // ÚLTIMA PÁGINA — Assinatura da Providente
    // ===========================================================
    doc.addPage();
    Y = 20;

    // Fundo decorativo página da Providente
    doc.setFillColor(26, 8, 38);
    doc.rect(0, 0, PW, PH, 'F');

    // Estrelas decorativas (círculos pequenos)
    const starPositions = [
      [20,15],[55,8],[100,20],[160,10],[190,30],[10,60],[205,55],[30,120],[200,110],[15,170],[195,160],[50,200],[160,190],[100,240],[30,260],[180,250]
    ];
    doc.setFillColor(255,215,0);
    starPositions.forEach(([sx,sy]) => {
      doc.circle(sx, sy, Math.random() > 0.5 ? 0.8 : 0.4, 'F');
    });

    // Caixa central
    doc.setFillColor(40, 15, 60);
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(1.5);
    doc.roundedRect(25, Y, PW - 50, PH - 40, 6, 6, 'FD');

    Y += 12;

    // Imagem da Providente
    if (this.cachedProvidenteBase64) {
      try {
        const prvImg = new Image();
        prvImg.src = this.cachedProvidenteBase64;
        const pH = prvImg.naturalHeight || 100;
        const pW = prvImg.naturalWidth  || 100;
        const ratio = pW / pH;
        const drawH = 40, drawW = drawH * ratio;
        doc.addImage(this.cachedProvidenteBase64, 'PNG', PW/2 - drawW/2, Y, drawW, drawH);
        Y += drawH + 4;
      } catch(e) { Y += 10; }
    }

    // Título
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('C.E.O. PROVIDENTE', PW / 2, Y, { align: 'center' });
    Y += 6;
    doc.setFontSize(9);
    doc.setTextColor(230, 43, 126);
    doc.text('Diretora Executiva — Elgaly Express, Nova Amerit - NA', PW / 2, Y, { align: 'center' });
    Y += 10;

    // Linha divisória dourada
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(0.8);
    doc.line(45, Y, PW - 45, Y);
    Y += 8;

    // Mensagem da Providente baseada no rank
    const provMessages = {
      'Rank S': [
        'Agente, você é simplesmente extraordinário! 🌟',
        'Cada entrega realizada com maestria, cada hábito cumprido com',
        'disciplina. A Frota EEX tem muito orgulho do seu desempenho!',
        'Continue assim — Nova Amerit conta com você!'
      ],
      'Rank A': [
        'Excelente trabalho, Agente! 🚀',
        'Sua pontualidade e dedicação estão acima da média da Frota.',
        'Poucos passos separam você do posto de Lenda Interdimensional.',
        'Mantenha o ritmo — a excelência te aguarda!'
      ],
      'Rank B': [
        'Bom trabalho, Agente! Estou satisfeita com seu progresso. 📦',
        'Você está no caminho certo, mas há espaço para crescer.',
        'Reduza os atrasos e mantenha a rotina diária.',
        'A Frota EEX acredita no seu potencial!'
      ],
      'Rank C': [
        'Atenção, Agente! Precisamos conversar... 🔔',
        'Seu relatório indica alguns prazos comprometidos.',
        'Mas não desanime — cada dia é uma nova chance de melhorar.',
        'Organize-se e mostre do que você é capaz!'
      ],
      'Recruta EEX': [
        'Bem-vindo à Rede EEX, Agente! 🎉',
        'Você acabou de ingressar na maior frota dimensional de Nova Amerit.',
        'Cadastre suas primeiras encomendas e hábitos para começar',
        'sua jornada rumo às estrelas!'
      ]
    };
    const msgs = provMessages[data.rank] || provMessages['Rank B'];

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    msgs.forEach(line => {
      doc.text(line, PW / 2, Y, { align: 'center' });
      Y += 7;
    });

    Y += 8;
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(0.5);
    doc.line(45, Y, PW - 45, Y);
    Y += 10;

    // Estatísticas resumidas
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 215, 0);
    doc.text(`Relatório de ${data.days} Dias  •  Agente: ${agentNick}  •  Pontuação: ${data.finalScore}/100  •  Conchas: 🐚 ${data.shells}`, PW / 2, Y, { align: 'center' });
    Y += 6;
    doc.setTextColor(200, 180, 220);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`${data.completedCount} encomendas entregues  •  ${data.unlockedAch.length} conquistas  •  ${data.friendCount} agentes EEX-Friends`, PW / 2, Y, { align: 'center' });

    Y += 14;

    // Linha de assinatura
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(0.7);
    const sigX = PW / 2;
    doc.line(sigX - 35, Y, sigX + 35, Y);
    Y += 4;
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Providente', sigX, Y, { align: 'center' });
    Y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(200, 180, 220);
    doc.text('Diretora Executiva & C.E.O. — Elgaly Express', sigX, Y, { align: 'center' });

    // Selo Magáfico no canto
    if (this.cachedSealBase64) {
      try {
        doc.addImage(this.cachedSealBase64, 'PNG', PW - 60, PH - 60, 32, 32);
      } catch(e) {}
    }

    // Rodapé em todas as páginas
    const totalPages = doc.internal.getNumberOfPages();
    for (let pg = 1; pg <= totalPages; pg++) {
      doc.setPage(pg);
      doc.setFillColor(26, 8, 38);
      doc.rect(0, PH - 12, PW, 12, 'F');
      doc.setFillColor(230, 43, 126);
      doc.rect(0, PH - 12, PW, 1, 'F');
      doc.setTextColor(255, 215, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text('© 1998–2026 Elgaly Express | Serviços de Entrega Dimensional', PW / 2, PH - 7, { align: 'center' });
      doc.setTextColor(200, 180, 220);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.text(`Av. Tennant Rockstead, 67 — Nova Amerit, NA (Nova Arcanis)  |  Pág. ${pg}/${totalPages}`, PW / 2, PH - 3, { align: 'center' });
    }

    // Download
    const safeNick = (data.currentUser ? data.currentUser.nickname : 'agente').replace(/[^a-z0-9]/gi, '_');
    doc.save(`Relatorio_EEX_${safeNick}_${data.days}dias_${new Date().toISOString().split('T')[0]}.pdf`);

    if (typeof confetti === 'function' && data.finalScore >= 75) {
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
    }
  },

  // Helper: converte cor hex #rrggbb para [r,g,b]
  _hexToRgb(hex) {
    if (!hex) return null;
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : null;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  ReportEngine.init();
});
