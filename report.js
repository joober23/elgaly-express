/**
 * ELGALY EXPRESS - MOTOR DE RELATORIOS & GERADOR DE PDF
 * Analisa desempenho em 7, 15 ou 30 dias.
 * NOTA: jsPDF usa Helvetica padrao que nao suporta emoji Unicode.
 * Todos os textos do PDF devem usar apenas ASCII + Latin-1.
 */

const ReportEngine = {
  currentTimeframe: 7,
  cachedLogoBase64: null,
  cachedProvidenteBase64: null,

  init() {
    this._preloadImage('images/elgalylogo_arrow.png', b64 => { this.cachedLogoBase64 = b64; });
    this._preloadImage('images/happy_provident.png',  b64 => { this.cachedProvidenteBase64 = b64; });
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
        console.warn('Falha ao carregar imagem para PDF (' + src + '):', e);
      }
    };
    img.onerror = () => console.warn('Nao encontrou imagem: ' + src);
    img.src = src;
  },

  setTimeframe(days) {
    this.currentTimeframe = parseInt(days, 10);
    this.renderReportPreview();
  },

  getAnalyticsData(days) {
    if (days === undefined) days = this.currentTimeframe;
    const tasks        = TaskManager.getAllTasks();
    const habits       = HabitManager.getAllHabits();
    const habitHistory = HabitManager.getHistory();
    const currentUser  = AuthManager.getCurrentUser();

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const relevantTasks = tasks.filter(function(task) {
      const createdAt   = new Date(task.createdAt);
      const dueDate     = task.dueDate     ? new Date(task.dueDate)     : null;
      const completedAt = task.completedAt ? new Date(task.completedAt) : null;
      return createdAt >= startDate ||
             (completedAt && completedAt >= startDate) ||
             (dueDate     && dueDate     >= startDate);
    });

    var totalTasks = relevantTasks.length;
    var completedCount = 0, onTimeCount = 0, fastCount = 0, lateCount = 0;
    var pendingOnTime  = 0, pendingOverdue = 0;
    var faculTotal = 0, faculCompleted = 0, faculOnTime = 0;
    var pessoalTotal= 0, pessoalCompleted= 0, pessoalOnTime= 0;
    var workTotal   = 0, workCompleted  = 0, workOnTime  = 0;
    var taskManifest = [];

    relevantTasks.forEach(function(task) {
      var cat = task.category || 'pessoal';
      if      (cat === 'faculdade') faculTotal++;
      else if (cat === 'trabalho')  workTotal++;
      else                          pessoalTotal++;

      var speedStatus = 'Pendente';
      var speedClass  = 'status-ontime';

      if (task.completed) {
        completedCount++;
        if      (cat === 'faculdade') faculCompleted++;
        else if (cat === 'trabalho')  workCompleted++;
        else                          pessoalCompleted++;

        if (task.dueDate && task.completedAt) {
          var due  = new Date(task.dueDate).getTime();
          var comp = new Date(task.completedAt).getTime();
          var diffH = (due - comp) / (1000 * 60 * 60);

          if (diffH >= 0) {
            onTimeCount++;
            if (cat === 'faculdade') faculOnTime++;
            else if (cat === 'trabalho') workOnTime++;
            else pessoalOnTime++;

            if (diffH >= 12) {
              fastCount++;
              var dEarly = Math.round(diffH / 24);
              speedStatus = 'Rapido (' + (dEarly > 0 ? dEarly + 'd' : Math.round(diffH) + 'h') + ' antes)';
              speedClass  = 'speed-fast';
            } else {
              speedStatus = 'No Prazo (' + Math.round(diffH) + 'h antes)';
              speedClass  = 'speed-ontime';
            }
          } else {
            lateCount++;
            var lH = Math.abs(Math.round(diffH));
            speedStatus = 'Atrasado (' + (lH > 24 ? Math.round(lH/24) + 'd' : lH + 'h') + ')';
            speedClass  = 'speed-late';
          }
        } else {
          onTimeCount++;
          if (cat === 'faculdade') faculOnTime++;
          else if (cat === 'trabalho') workOnTime++;
          else pessoalOnTime++;
          speedStatus = 'Concluido';
        }
      } else {
        if (task.dueDate) {
          var dueTs  = new Date(task.dueDate).getTime();
          var currTs = now.getTime();
          if (currTs > dueTs) {
            pendingOverdue++;
            var ovH = Math.round((currTs - dueTs) / (1000 * 60 * 60));
            speedStatus = 'Atrasado (' + (ovH > 24 ? Math.round(ovH/24) + 'd' : ovH + 'h') + ')';
            speedClass  = 'status-late';
          } else {
            pendingOnTime++;
            speedStatus = 'Em Rota';
          }
        } else {
          pendingOnTime++;
          speedStatus = 'Em Rota';
        }
      }

      taskManifest.push({
        code:      task.code || ('ELG-' + task.id.slice(-3).toUpperCase()),
        title:     task.title,
        category:  cat,
        dueDate:   task.dueDate     ? new Date(task.dueDate).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : 'Sem prazo',
        completedAt: task.completedAt ? new Date(task.completedAt).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}) : '-',
        speedStatus: speedStatus,
        speedClass:  speedClass,
        completed:   task.completed
      });
    });

    // Habitos
    var totalExpectedHabits = habits.length * days;
    var completedHabitsCount = 0, perfectDays = 0;
    for (var i = 0; i < days; i++) {
      var d = new Date();
      d.setDate(now.getDate() - i);
      var dateKey   = d.toLocaleDateString('en-CA');
      var dayRecord = habitHistory[dateKey] || [];
      completedHabitsCount += dayRecord.length;
      if (habits.length > 0 && dayRecord.length >= habits.length) perfectDays++;
    }

    var habitSuccessRate   = totalExpectedHabits > 0
      ? Math.min(100, Math.round((completedHabitsCount / totalExpectedHabits) * 100)) : 100;
    var taskCompletionRate = totalTasks    > 0 ? Math.round((completedCount / totalTasks)    * 100) : 100;
    var taskOnTimeRate     = completedCount > 0 ? Math.round((onTimeCount   / completedCount)* 100) : (pendingOverdue > 0 ? 50 : 100);
    var finalScore = Math.round((taskCompletionRate * 0.40) + (taskOnTimeRate * 0.40) + (habitSuccessRate * 0.20));

    // Rank
    var rank = 'Rank S', rankTitle = 'Lenda Interdimensional do Frete Rapido';
    var rankDesc  = 'Desempenho espetacular! Entregas impecaveis e rotina diaria no auge!';
    var rankColor = '#ffeb3b';

    if (totalTasks === 0 && habits.length === 0) {
      rank = 'Recruta EEX'; rankTitle = 'Novo Entregador de Nova Amerit';
      rankDesc  = 'Cadastre suas primeiras encomendas e habitos para conquistar seus ranks!';
      rankColor = '#ffeb3b';
    } else if (finalScore < 60 || pendingOverdue >= 3) {
      rank = 'Rank C'; rankTitle = 'Sobrevivente do Vortice Dimensional';
      rankDesc  = 'Atencao aos prazos! Algumas entregas atrasaram e a rotina precisa de folego.';
      rankColor = '#f87171';
    } else if (finalScore < 78) {
      rank = 'Rank B'; rankTitle = 'Mensageiro Confiavel de Elgaly Edge';
      rankDesc  = 'Bom ritmo de entregas. Reduza os atrasos pontuais para alcancar o topo!';
      rankColor = '#60a5fa';
    } else if (finalScore < 92) {
      rank = 'Rank A'; rankTitle = 'Piloto Oficial Elgaly Express';
      rankDesc  = 'Excelente pontualidade e agilidade em ritmo constante!';
      rankColor = '#4ade80';
    }

    // Conchas & Conquistas
    var shells = (typeof ShellsManager !== 'undefined') ? ShellsManager.getBalance() : 0;
    var achievements = (typeof AppUI !== 'undefined' && AppUI.getAchievements)
      ? AppUI.getAchievements({ completedTasksCount: completedCount, shells: shells })
      : [];
    var unlockedAch  = achievements.filter(function(a) { return a.unlocked; });

    // Amigos
    var friendCount = (typeof FriendsManager !== 'undefined' && FriendsManager.friends)
      ? FriendsManager.friends.length : 0;

    // Modo trabalho
    var workMode = (currentUser && currentUser.workMode) ? true : false;

    return {
      days: days, currentUser: currentUser,
      startDate: startDate.toLocaleDateString('pt-BR'), endDate: now.toLocaleDateString('pt-BR'),
      totalTasks: totalTasks, completedCount: completedCount, onTimeCount: onTimeCount,
      fastCount: fastCount, lateCount: lateCount, pendingOnTime: pendingOnTime, pendingOverdue: pendingOverdue,
      taskCompletionRate: taskCompletionRate, taskOnTimeRate: taskOnTimeRate,
      faculTotal: faculTotal, faculCompleted: faculCompleted, faculOnTime: faculOnTime,
      pessoalTotal: pessoalTotal, pessoalCompleted: pessoalCompleted, pessoalOnTime: pessoalOnTime,
      workTotal: workTotal, workCompleted: workCompleted, workOnTime: workOnTime, workMode: workMode,
      totalExpectedHabits: totalExpectedHabits, completedHabitsCount: completedHabitsCount,
      perfectDays: perfectDays, habitSuccessRate: habitSuccessRate,
      finalScore: finalScore, rank: rank, rankTitle: rankTitle, rankDesc: rankDesc, rankColor: rankColor,
      taskManifest: taskManifest, shells: shells, unlockedAch: unlockedAch, friendCount: friendCount,
      habits: habits
    };
  },

  renderReportPreview() {
    var data = this.getAnalyticsData();

    document.querySelectorAll('.timeframe-btn').forEach(function(btn) {
      btn.classList.toggle('active', parseInt(btn.dataset.days, 10) === ReportEngine.currentTimeframe);
    });

    var rankStamp = document.getElementById('reportRankStamp');
    var rankTitle = document.getElementById('reportRankTitle');
    var rankDesc  = document.getElementById('reportRankDesc');
    if (rankStamp) { rankStamp.textContent = data.rank; rankStamp.style.background = data.rankColor; }
    if (rankTitle) rankTitle.textContent = data.rank + ': ' + data.rankTitle;
    if (rankDesc)  rankDesc.textContent  = data.rankDesc + ' (Pontuacao Geral: ' + data.finalScore + '/100)';

    var elTotal  = document.getElementById('reportStatTotal');
    var elOnTime = document.getElementById('reportStatOnTime');
    var elSpeed  = document.getElementById('reportStatSpeed');
    var elHabits = document.getElementById('reportStatHabits');
    if (elTotal)  elTotal.textContent  = data.completedCount + '/' + data.totalTasks;
    if (elOnTime) elOnTime.textContent = data.taskOnTimeRate + '%';
    if (elSpeed)  elSpeed.textContent  = data.fastCount + ' Antecipadas';
    if (elHabits) elHabits.textContent = data.perfectDays + ' dias 100%';

    var barFast   = document.getElementById('speedBarFast');
    var barOntime = document.getElementById('speedBarOntime');
    var barLate   = document.getElementById('speedBarLate');
    var total = Math.max(1, data.fastCount + (data.onTimeCount - data.fastCount) + data.lateCount + data.pendingOverdue);
    var pctFast   = Math.round((data.fastCount / total) * 100);
    var pctNormal = Math.round(((data.onTimeCount - data.fastCount) / total) * 100);
    var pctLate   = Math.round(((data.lateCount + data.pendingOverdue) / total) * 100);
    if (barFast)   barFast.style.width   = pctFast + '%';
    if (barOntime) barOntime.style.width = pctNormal + '%';
    if (barLate)   barLate.style.width   = pctLate + '%';

    var txtFast   = document.getElementById('speedTxtFast');
    var txtOntime = document.getElementById('speedTxtOntime');
    var txtLate   = document.getElementById('speedTxtLate');
    if (txtFast)   txtFast.textContent   = data.fastCount + ' encomendas (' + pctFast + '%)';
    if (txtOntime) txtOntime.textContent = Math.max(0, data.onTimeCount - data.fastCount) + ' encomendas (' + pctNormal + '%)';
    if (txtLate)   txtLate.textContent   = (data.lateCount + data.pendingOverdue) + ' encomendas (' + pctLate + '%)';

    var faculStats = document.getElementById('reportFaculStats');
    if (faculStats) faculStats.innerHTML =
      '<li><span>Total:</span> <strong>' + data.faculTotal + '</strong></li>' +
      '<li><span>Concluidas:</span> <strong>' + data.faculCompleted + '</strong></li>' +
      '<li><span>No Prazo:</span> <strong>' + (data.faculCompleted > 0 ? Math.round((data.faculOnTime/data.faculCompleted)*100) : 100) + '%</strong></li>';

    var pessoalStats = document.getElementById('reportPessoalStats');
    if (pessoalStats) pessoalStats.innerHTML =
      '<li><span>Total:</span> <strong>' + data.pessoalTotal + '</strong></li>' +
      '<li><span>Concluidas:</span> <strong>' + data.pessoalCompleted + '</strong></li>' +
      '<li><span>No Prazo:</span> <strong>' + (data.pessoalCompleted > 0 ? Math.round((data.pessoalOnTime/data.pessoalCompleted)*100) : 100) + '%</strong></li>';
  },

  // Helper: cabecalho de secao colorido
  _sectionHeader(doc, y, PW, title, bgR, bgG, bgB) {
    if (bgR === undefined) bgR = 58;
    if (bgG === undefined) bgG = 21;
    if (bgB === undefined) bgB = 77;
    doc.setFillColor(bgR, bgG, bgB);
    doc.rect(15, y, PW - 30, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(title, 19, y + 5);
    return y + 9;
  },

  // Helper: mini card
  _miniCard(doc, x, y, w, h, val, label, r, g, b) {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(0.7);
    doc.roundedRect(x, y, w, h, 2, 2, 'FD');
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

  // Helper: hex -> [r,g,b]
  _hexToRgb(hex) {
    if (!hex) return null;
    var r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : null;
  },

  async exportPDF() {
    var data = this.getAnalyticsData();
    var jsPDFModule = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
    if (!jsPDFModule) {
      alert('Biblioteca de PDF ainda carregando. Tente em instantes.');
      return;
    }

    var doc = new jsPDFModule({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var PW  = doc.internal.pageSize.getWidth();
    var PH  = doc.internal.pageSize.getHeight();
    var Y   = 0;

    var agentNick = data.currentUser ? data.currentUser.eexEmail : 'agente.express.com';
    var agentName = data.currentUser ? (data.currentUser.name || '') : '';

    // ============================================================
    // PAGINA 1
    // ============================================================

    // Cabecalho roxo
    doc.setFillColor(26, 8, 38);
    doc.rect(0, 0, PW, 48, 'F');
    doc.setFillColor(230, 43, 126);
    doc.rect(0, 46, PW, 3, 'F');
    doc.setFillColor(255, 215, 0);
    doc.rect(0, 46, 6, 3, 'F');

    // Logo proporcional (sem esticamento)
    if (this.cachedLogoBase64) {
      try {
        var logoImg = new Image();
        logoImg.src = this.cachedLogoBase64;
        var lW = logoImg.naturalWidth  || 200;
        var lH = logoImg.naturalHeight || 200;
        var ratio = lW / lH;
        var maxH = 26, maxW = 30;
        var drawH = maxH, drawW = maxH * ratio;
        if (drawW > maxW) { drawW = maxW; drawH = maxW / ratio; }
        var logoY = (46 - drawH) / 2;
        doc.addImage(this.cachedLogoBase64, 'PNG', 13, logoY, drawW, drawH);
      } catch (e) { console.warn('Erro logo PDF:', e); }
    }

    var TX = 50;
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('ELGALY EXPRESS', TX, 14);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    doc.text('RELATORIO OFICIAL DE DESPACHO OPERACIONAL & ROTINA', TX, 21);

    doc.setTextColor(247, 168, 202);
    doc.setFontSize(8.5);
    if (agentName) doc.text('Agente: ' + agentName + ' | ' + agentNick, TX, 28);
    else            doc.text('Agente: ' + agentNick, TX, 28);
    doc.text('Periodo: ' + data.startDate + ' a ' + data.endDate + '  (' + data.days + ' dias)', TX, 34);

    doc.setTextColor(180, 180, 210);
    doc.setFontSize(7);
    doc.text('Emitido em: ' + new Date().toLocaleString('pt-BR'), TX, 40);

    // Saldo de conchas no canto direito do cabecalho
    doc.setFillColor(255, 215, 0);
    doc.roundedRect(PW - 42, 10, 30, 14, 2, 2, 'F');
    doc.setTextColor(26, 8, 38);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(String(data.shells), PW - 27, 19.5, { align: 'center' });
    doc.setFontSize(5.5);
    doc.text('CONCHAS EEX', PW - 27, 23, { align: 'center' });

    Y = 54;

    // Card de Rank
    var rankRgb = this._hexToRgb(data.rankColor) || [255,235,59];
    doc.setFillColor(245, 235, 255);
    doc.setDrawColor(rankRgb[0], rankRgb[1], rankRgb[2]);
    doc.setLineWidth(1.2);
    doc.roundedRect(15, Y, PW - 30, 28, 4, 4, 'FD');
    doc.setFillColor(rankRgb[0], rankRgb[1], rankRgb[2]);
    doc.roundedRect(15, Y, 6, 28, 4, 4, 'F');
    doc.rect(18, Y, 3, 28, 'F');

    doc.setFillColor(rankRgb[0], rankRgb[1], rankRgb[2]);
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
    var descLines = doc.splitTextToSize(data.rankDesc, PW - 75);
    doc.text(descLines, 60, Y + 17);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(230, 43, 126);
    doc.text('Pontuacao: ' + data.finalScore + '/100  |  Pontualidade: ' + data.taskOnTimeRate + '%  |  Rotina: ' + data.habitSuccessRate + '%', 60, Y + 25.5);

    Y += 34;

    // 4 Mini-cards de indicadores
    var cW = (PW - 30 - 9) / 4;
    var cH = 20;
    this._miniCard(doc, 15,             Y, cW, cH, data.completedCount + '/' + data.totalTasks, 'TOTAL ENTREGAS',    230, 43, 126);
    this._miniCard(doc, 15 + cW + 3,   Y, cW, cH, data.taskOnTimeRate + '%',                   'NO PRAZO',          16, 185, 129);
    this._miniCard(doc, 15 + (cW+3)*2, Y, cW, cH, String(data.fastCount),                      'ANTECIPADAS (FAST)',59, 130, 246);
    this._miniCard(doc, 15 + (cW+3)*3, Y, cW, cH, data.perfectDays + ' dias',                  'DIAS ROTINA 100%', 245, 158, 11);
    Y += cH + 5;

    // 3 Mini-cards extras
    var cW2 = (PW - 30 - 6) / 3;
    this._miniCard(doc, 15,            Y, cW2, cH, String(data.shells),         'CONCHAS EEX',       180, 140, 0);
    this._miniCard(doc, 15 + cW2 + 3, Y, cW2, cH, String(data.unlockedAch.length), 'CONQUISTAS',    100, 60, 200);
    this._miniCard(doc, 15+(cW2+3)*2, Y, cW2, cH, String(data.friendCount),    'EEX-FRIENDS',       20, 150, 180);
    Y += cH + 5;

    // Diagnostico de velocidade
    Y = this._sectionHeader(doc, Y, PW, 'DIAGNOSTICO DE VELOCIDADE & PONTUALIDADE');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(26, 8, 38);
    var diag = [
      '> Entregas Antecipadas (mais de 12h antes): ' + data.fastCount + ' encomenda(s)',
      '> Entregas no Prazo Regular: ' + Math.max(0, data.onTimeCount - data.fastCount) + ' encomenda(s)',
      '> Entregas com Atraso: ' + data.lateCount + ' concluidas + ' + data.pendingOverdue + ' pendentes vencidas',
      '> Rotina Diaria: ' + data.completedHabitsCount + ' check-ins em ' + data.days + ' dias (consistencia: ' + data.habitSuccessRate + '%)',
      '> Dias com Rotina Perfeita (100%): ' + data.perfectDays + '   |   Habitos cadastrados: ' + data.habits.length
    ];
    diag.forEach(function(line) {
      doc.text(line, 19, Y);
      Y += 4.8;
    });
    Y += 3;

    // Setores de operacao
    Y = this._sectionHeader(doc, Y, PW, 'ANALISE POR SETOR DE OPERACOES');
    var numSetores = data.workMode ? 3 : 2;
    var sW = (PW - 30 - (numSetores - 1) * 4) / numSetores;
    var setores = [
      { label: 'ACADEMICO (FACULDADE)', total: data.faculTotal, done: data.faculCompleted, onTime: data.faculOnTime, r: 59, g: 130, b: 246 },
      { label: 'PESSOAL & PROJETOS',    total: data.pessoalTotal, done: data.pessoalCompleted, onTime: data.pessoalOnTime, r: 245, g: 158, b: 11 }
    ];
    if (data.workMode) setores.push({ label: 'MODO PROFISSAO', total: data.workTotal, done: data.workCompleted, onTime: data.workOnTime, r: 16, g: 185, b: 129 });

    setores.forEach(function(s, idx) {
      var sx = 15 + idx * (sW + 4);
      var bgArr = [s.r * 0.9, s.g * 0.9, s.b * 0.9];
      doc.setFillColor(245, 245, 255);
      doc.setDrawColor(s.r, s.g, s.b);
      doc.setLineWidth(0.7);
      doc.roundedRect(sx, Y, sW, 18, 2, 2, 'FD');
      doc.setFillColor(s.r, s.g, s.b);
      doc.rect(sx, Y, sW, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(26, 8, 38);
      doc.text(s.label, sx + sW / 2, Y + 9, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(50, 50, 50);
      var pct = s.done > 0 ? Math.round((s.onTime / s.done) * 100) : 100;
      doc.text('Total: ' + s.total + '   Concluidas: ' + s.done + '   Pontualidade: ' + pct + '%', sx + sW / 2, Y + 14.5, { align: 'center' });
    });
    Y += 24;

    // Conquistas desbloqueadas
    if (data.unlockedAch.length > 0) {
      Y = this._sectionHeader(doc, Y, PW, 'CONQUISTAS DESBLOQUEADAS  (' + data.unlockedAch.length + ')', 100, 60, 200);
      var achPerRow = 5;
      var achW = (PW - 30 - (achPerRow - 1) * 3) / achPerRow;
      var achX = 15, achY = Y;
      data.unlockedAch.forEach(function(ach, i) {
        doc.setFillColor(245, 240, 255);
        doc.setDrawColor(130, 80, 220);
        doc.setLineWidth(0.5);
        doc.roundedRect(achX, achY, achW, 13, 2, 2, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(70, 40, 120);
        var achName = doc.splitTextToSize(ach.name || '', achW - 2);
        doc.text(achName, achX + achW / 2, achY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.setTextColor(100, 60, 160);
        var achDesc = doc.splitTextToSize(ach.desc || '', achW - 2);
        doc.text(achDesc, achX + achW / 2, achY + 9.5, { align: 'center' });
        achX += achW + 3;
        if ((i + 1) % achPerRow === 0) { achX = 15; achY += 16; }
      });
      Y = achY + (data.unlockedAch.length % achPerRow !== 0 ? 16 : 2);
    }

    // Manifesto de Encomendas
    if (Y > PH - 70) { doc.addPage(); Y = 18; }
    Y = this._sectionHeader(doc, Y, PW, 'MANIFESTO DE ENCOMENDAS REGISTRADAS');

    doc.setFillColor(240, 235, 248);
    doc.rect(15, Y, PW - 30, 5.5, 'F');
    doc.setTextColor(26, 8, 38); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.text('CODIGO', 18, Y + 3.8);
    doc.text('MISSAO / DESCRICAO', 42, Y + 3.8);
    doc.text('SETOR',  108, Y + 3.8);
    doc.text('PRAZO',  132, Y + 3.8);
    doc.text('STATUS', 165, Y + 3.8);
    Y += 6.5;

    if (data.taskManifest.length === 0) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120,120,120);
      doc.text('Nenhuma encomenda registrada neste periodo.', 18, Y + 4);
      Y += 10;
    } else {
      var maxRows = 20;
      data.taskManifest.slice(0, maxRows).forEach(function(t, i) {
        if (Y > PH - 28) {
          doc.addPage(); Y = 18;
          Y = ReportEngine._sectionHeader(doc, Y, PW, 'MANIFESTO (continuacao)');
          doc.setFillColor(240, 235, 248);
          doc.rect(15, Y, PW - 30, 5.5, 'F');
          doc.setTextColor(26,8,38); doc.setFont('helvetica','bold'); doc.setFontSize(7);
          doc.text('CODIGO',18,Y+3.8); doc.text('MISSAO',42,Y+3.8);
          doc.text('SETOR',108,Y+3.8); doc.text('PRAZO',132,Y+3.8); doc.text('STATUS',165,Y+3.8);
          Y += 6.5;
        }
        if (i % 2 === 1) {
          doc.setFillColor(250, 246, 255);
          doc.rect(15, Y - 1, PW - 30, 5.5, 'F');
        }
        doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(26,8,38);
        doc.text(t.code, 18, Y + 2.8);
        doc.setFont('helvetica','normal');
        var safeTitle = t.title.length > 33 ? t.title.substring(0, 31) + '...' : t.title;
        doc.text(safeTitle, 42, Y + 2.8);
        var catLabel = t.category === 'faculdade' ? 'Faculdade' : (t.category === 'trabalho' ? 'Trabalho' : 'Pessoal');
        doc.text(catLabel, 108, Y + 2.8);
        doc.text(t.dueDate, 132, Y + 2.8);
        if      (t.speedStatus.indexOf('Rapido') >= 0)   doc.setTextColor(5, 150, 105);
        else if (t.speedStatus.indexOf('Atrasado') >= 0) doc.setTextColor(220, 38, 38);
        else                                              doc.setTextColor(80, 80, 80);
        doc.setFont('helvetica','bold');
        doc.text(t.speedStatus, 165, Y + 2.8);
        Y += 5.5;
      });
      if (data.taskManifest.length > maxRows) {
        doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(120,120,120);
        doc.text('* E mais ' + (data.taskManifest.length - maxRows) + ' encomendas no sistema EEX...', 18, Y + 3);
        Y += 7;
      }
    }

    // ============================================================
    // PAGINA FINAL — Assinatura da Providente
    // ============================================================
    doc.addPage();
    Y = 0;

    // Fundo escuro estrelado
    doc.setFillColor(26, 8, 38);
    doc.rect(0, 0, PW, PH, 'F');

    // Estrelinhas decorativas (circulos pequenos)
    doc.setFillColor(255, 215, 0);
    [[20,15],[55,8],[100,20],[160,10],[190,30],[10,60],[205,55],[30,120],
     [200,110],[15,170],[195,160],[50,200],[160,190],[100,240],[30,260],[180,250]
    ].forEach(function(p) {
      doc.circle(p[0], p[1], 0.6, 'F');
    });
    doc.setFillColor(255, 180, 200);
    [[80,40],[140,70],[170,140],[25,200],[190,220]].forEach(function(p) {
      doc.circle(p[0], p[1], 0.4, 'F');
    });

    // Caixa central com borda dourada
    doc.setFillColor(40, 15, 60);
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(1.5);
    doc.roundedRect(20, 15, PW - 40, PH - 30, 6, 6, 'FD');

    Y = 28;

    // Imagem da Providente (centrada, proporcional)
    if (this.cachedProvidenteBase64) {
      try {
        var pvImg = new Image();
        pvImg.src = this.cachedProvidenteBase64;
        var pvW = pvImg.naturalWidth  || 100;
        var pvH = pvImg.naturalHeight || 100;
        var pvRatio = pvW / pvH;
        var pvDrawH = 42, pvDrawW = pvDrawH * pvRatio;
        if (pvDrawW > 70) { pvDrawW = 70; pvDrawH = pvDrawW / pvRatio; }
        doc.addImage(this.cachedProvidenteBase64, 'PNG', PW/2 - pvDrawW/2, Y, pvDrawW, pvDrawH);
        Y += pvDrawH + 6;
      } catch(e) { Y += 10; }
    } else {
      Y += 10;
    }

    // Titulo C.E.O. Providente
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('C.E.O. PROVIDENTE', PW / 2, Y, { align: 'center' });
    Y += 6;
    doc.setFontSize(9);
    doc.setTextColor(230, 43, 126);
    doc.text('Diretora Executiva  ---  Elgaly Express, Nova Amerit - NA', PW / 2, Y, { align: 'center' });
    Y += 10;

    // Linha divisoria dourada
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(0.8);
    doc.line(40, Y, PW - 40, Y);
    Y += 10;

    // Mensagem da Providente baseada no rank (sem emojis)
    var provMsgs = {
      'Rank S': [
        'Agente, voce e simplesmente extraordinario!',
        'Cada entrega realizada com maestria, cada habito cumprido com disciplina.',
        'A Frota EEX tem muito orgulho do seu desempenho!',
        'Continue assim -- Nova Amerit conta com voce!'
      ],
      'Rank A': [
        'Excelente trabalho, Agente!',
        'Sua pontualidade e dedicacao estao acima da media da Frota.',
        'Poucos passos separam voce do posto de Lenda Interdimensional.',
        'Mantenha o ritmo -- a excelencia te aguarda!'
      ],
      'Rank B': [
        'Bom trabalho, Agente! Estou satisfeita com seu progresso.',
        'Voce esta no caminho certo, mas ha espaco para crescer.',
        'Reduza os atrasos e mantenha a rotina diaria.',
        'A Frota EEX acredita no seu potencial!'
      ],
      'Rank C': [
        'Atencao, Agente! Precisamos conversar...',
        'Seu relatorio indica alguns prazos comprometidos.',
        'Mas nao desanime -- cada dia e uma nova chance de melhorar.',
        'Organize-se e mostre do que voce e capaz!'
      ],
      'Recruta EEX': [
        'Bem-vindo a Rede EEX, Agente!',
        'Voce acabou de ingressar na maior frota dimensional de Nova Amerit.',
        'Cadastre suas primeiras encomendas e habitos para comecar',
        'sua jornada rumo as estrelas!'
      ]
    };
    var msgs = provMsgs[data.rank] || provMsgs['Rank B'];

    doc.setTextColor(240, 230, 255);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    msgs.forEach(function(line) {
      doc.text(line, PW / 2, Y, { align: 'center' });
      Y += 7.5;
    });

    Y += 6;
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(0.5);
    doc.line(40, Y, PW - 40, Y);
    Y += 9;

    // Estatisticas resumidas
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 215, 0);
    var summaryLine = 'Relatorio de ' + data.days + ' dias  |  Agente: ' + agentNick + '  |  Pontuacao: ' + data.finalScore + '/100  |  Conchas: ' + data.shells;
    doc.text(summaryLine, PW / 2, Y, { align: 'center' });
    Y += 5.5;
    doc.setTextColor(200, 180, 220);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(data.completedCount + ' encomendas entregues  |  ' + data.unlockedAch.length + ' conquistas  |  ' + data.friendCount + ' agentes EEX-Friends', PW / 2, Y, { align: 'center' });

    Y += 14;

    // Linha de assinatura
    doc.setDrawColor(255, 215, 0);
    doc.setLineWidth(0.7);
    doc.line(PW/2 - 40, Y, PW/2 + 40, Y);
    Y += 4;
    doc.setTextColor(255, 215, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Providente', PW / 2, Y, { align: 'center' });
    Y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(200, 180, 220);
    doc.text('Diretora Executiva & C.E.O.  ---  Elgaly Express', PW / 2, Y, { align: 'center' });

    // Rodape em todas as paginas
    var totalPages = doc.internal.getNumberOfPages();
    for (var pg = 1; pg <= totalPages; pg++) {
      doc.setPage(pg);
      doc.setFillColor(26, 8, 38);
      doc.rect(0, PH - 12, PW, 12, 'F');
      doc.setFillColor(230, 43, 126);
      doc.rect(0, PH - 12, PW, 1, 'F');
      doc.setTextColor(255, 215, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.text('(c) 1998-2026 Elgaly Express | Servicos de Entrega Dimensional', PW / 2, PH - 7, { align: 'center' });
      doc.setTextColor(200, 180, 220);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.text('Av. Tennant Rockstead, 67 -- Nova Amerit, NA (Nova Arcanis)  |  Pag. ' + pg + '/' + totalPages, PW / 2, PH - 3, { align: 'center' });
    }

    // Download
    var safeNick = (data.currentUser ? data.currentUser.nickname : 'agente').replace(/[^a-z0-9]/gi, '_');
    doc.save('Relatorio_EEX_' + safeNick + '_' + data.days + 'dias_' + new Date().toISOString().split('T')[0] + '.pdf');

    if (typeof confetti === 'function' && data.finalScore >= 75) {
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
    }
  }
};

document.addEventListener('DOMContentLoaded', function() {
  ReportEngine.init();
});
