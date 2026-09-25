/**
 * ELGALY EXPRESS - MOTOR DE RELATÓRIOS & GERADOR DE PDF
 * Analisa desempenho em 7, 15 ou 30 dias (pontualidade, velocidade, hábitos)
 * Inclui o logotipo oficial e dados do Agente EEX no PDF!
 */

const ReportEngine = {
  currentTimeframe: 7, // 7, 15 ou 30 dias
  cachedLogoBase64: null,

  init() {
    this.preloadLogo();
  },

  /**
   * Converte a imagem do logotipo em Base64 para inclusão direta no PDF
   */
  preloadLogo() {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        this.cachedLogoBase64 = canvas.toDataURL('image/png');
      } catch (e) {
        console.warn('Não foi possível carregar base64 do logo para o PDF:', e);
      }
    };
    img.src = 'images/elgalylogo.png';
  },

  setTimeframe(days) {
    this.currentTimeframe = parseInt(days, 10);
    this.renderReportPreview();
  },

  /**
   * Coleta dados das tarefas e rotinas filtrando pela janela de tempo selecionada
   */
  getAnalyticsData(days = this.currentTimeframe) {
    const tasks = TaskManager.getAllTasks();
    const habits = HabitManager.getAllHabits();
    const habitHistory = HabitManager.getHistory();
    const currentUser = AuthManager.getCurrentUser();

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Filtrar tarefas relevantes no período
    const relevantTasks = tasks.filter(task => {
      const createdAt = new Date(task.createdAt);
      const dueDate = task.dueDate ? new Date(task.dueDate) : null;
      const completedAt = task.completedAt ? new Date(task.completedAt) : null;

      const inCreatedRange = createdAt >= startDate;
      const inCompletedRange = completedAt && completedAt >= startDate;
      const inDueRange = dueDate && dueDate >= startDate;

      return inCreatedRange || inCompletedRange || inDueRange;
    });

    let totalTasks = relevantTasks.length;
    let completedCount = 0;
    let onTimeCount = 0;
    let fastCount = 0;
    let lateCount = 0;
    let pendingOnTime = 0;
    let pendingOverdue = 0;

    let faculTotal = 0;
    let faculCompleted = 0;
    let faculOnTime = 0;

    let pessoalTotal = 0;
    let pessoalCompleted = 0;
    let pessoalOnTime = 0;

    const taskManifest = [];

    relevantTasks.forEach(task => {
      const isFacul = task.category === 'faculdade';
      if (isFacul) faculTotal++; else pessoalTotal++;

      let speedStatus = 'Pendente';
      let speedClass = 'status-ontime';
      let diffHours = null;

      if (task.completed) {
        completedCount++;
        if (isFacul) faculCompleted++; else pessoalCompleted++;

        if (task.dueDate && task.completedAt) {
          const due = new Date(task.dueDate).getTime();
          const comp = new Date(task.completedAt).getTime();
          diffHours = (due - comp) / (1000 * 60 * 60);

          if (diffHours >= 0) {
            onTimeCount++;
            if (isFacul) faculOnTime++; else pessoalOnTime++;

            if (diffHours >= 12) {
              fastCount++;
              const dEarly = Math.round(diffHours / 24);
              speedStatus = `⚡ Rápido (${dEarly > 0 ? dEarly + 'd' : Math.round(diffHours) + 'h'} antes)`;
              speedClass = 'speed-fast';
            } else {
              speedStatus = `✅ No Prazo (${Math.round(diffHours)}h antes)`;
              speedClass = 'speed-ontime';
            }
          } else {
            lateCount++;
            const lateHours = Math.abs(Math.round(diffHours));
            speedStatus = `🐢 Atrasado (${lateHours > 24 ? Math.round(lateHours / 24) + 'd' : lateHours + 'h'})`;
            speedClass = 'speed-late';
          }
        } else {
          onTimeCount++;
          if (isFacul) faculOnTime++; else pessoalOnTime++;
          speedStatus = '✅ Concluído';
        }
      } else {
        if (task.dueDate) {
          const due = new Date(task.dueDate).getTime();
          const curr = now.getTime();
          if (curr > due) {
            pendingOverdue++;
            const overdueH = Math.round((curr - due) / (1000 * 60 * 60));
            speedStatus = `⚠️ Atrasado (${overdueH > 24 ? Math.round(overdueH / 24) + 'd' : overdueH + 'h'})`;
            speedClass = 'status-late';
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
        id: task.id,
        code: task.code || `ELG-${task.id.slice(-3)}`,
        title: task.title,
        category: task.category,
        dueDate: task.dueDate ? new Date(task.dueDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Sem prazo',
        completedAt: task.completedAt ? new Date(task.completedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—',
        speedStatus,
        speedClass,
        completed: task.completed
      });
    });

    // Hábitos diários
    let totalExpectedHabits = habits.length * days;
    let completedHabitsCount = 0;
    let perfectDays = 0;

    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const dayRecord = habitHistory[dateKey] || [];
      completedHabitsCount += dayRecord.length;
      if (habits.length > 0 && dayRecord.length >= habits.length) {
        perfectDays++;
      }
    }

    const habitSuccessRate = totalExpectedHabits > 0 
      ? Math.min(100, Math.round((completedHabitsCount / totalExpectedHabits) * 100)) 
      : 100;

    const taskCompletionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 100;
    const taskOnTimeRate = completedCount > 0 ? Math.round((onTimeCount / completedCount) * 100) : (pendingOverdue > 0 ? 50 : 100);

    const finalScore = Math.round(
      (taskCompletionRate * 0.40) + 
      (taskOnTimeRate * 0.40) + 
      (habitSuccessRate * 0.20)
    );

    // Rank do Entregador
    let rank = 'Rank S';
    let rankTitle = 'Lenda Interdimensional do Frete Rápido';
    let rankDesc = 'Desempenho espetacular! Entregas impecáveis e rotina diária no auge!';
    let rankColor = '#ffeb3b';

    if (totalTasks === 0 && habits.length === 0) {
      rank = 'Recruta EEX';
      rankTitle = 'Novo Entregador de Nova Amerit';
      rankDesc = 'Cadastre suas primeiras encomendas e hábitos para conquistar seus ranks!';
      rankColor = '#ffeb3b';
    } else if (finalScore < 60 || pendingOverdue >= 3) {
      rank = 'Rank C';
      rankTitle = 'Sobrevivente do Vórtice Dimensional';
      rankDesc = 'Atenção aos prazos! Algumas entregas atrasaram e a rotina precisa de fôlego.';
      rankColor = '#f87171';
    } else if (finalScore < 78) {
      rank = 'Rank B';
      rankTitle = 'Mensageiro Confiável de Elgaly Edge';
      rankDesc = 'Bom ritmo de entregas. Reduza os atrasos pontuais para alcançar o topo!';
      rankColor = '#60a5fa';
    } else if (finalScore < 92) {
      rank = 'Rank A';
      rankTitle = 'Piloto Oficial Elgaly Express';
      rankDesc = 'Excelente pontualidade e agilidade em ritmo constante!';
      rankColor = '#4ade80';
    }

    return {
      days,
      currentUser,
      startDate: startDate.toLocaleDateString('pt-BR'),
      endDate: now.toLocaleDateString('pt-BR'),
      totalTasks,
      completedCount,
      onTimeCount,
      fastCount,
      lateCount,
      pendingOnTime,
      pendingOverdue,
      taskCompletionRate,
      taskOnTimeRate,
      faculTotal,
      faculCompleted,
      faculOnTime,
      pessoalTotal,
      pessoalCompleted,
      pessoalOnTime,
      totalExpectedHabits,
      completedHabitsCount,
      perfectDays,
      habitSuccessRate,
      finalScore,
      rank,
      rankTitle,
      rankDesc,
      rankColor,
      taskManifest
    };
  },

  /**
   * Renderiza a pré-visualização das estatísticas no HTML
   */
  renderReportPreview() {
    const data = this.getAnalyticsData();

    document.querySelectorAll('.timeframe-btn').forEach(btn => {
      const days = parseInt(btn.dataset.days, 10);
      btn.classList.toggle('active', days === this.currentTimeframe);
    });

    const rankStamp = document.getElementById('reportRankStamp');
    const rankTitle = document.getElementById('reportRankTitle');
    const rankDesc = document.getElementById('reportRankDesc');

    if (rankStamp) {
      rankStamp.textContent = data.rank;
      rankStamp.style.background = data.rankColor;
    }
    if (rankTitle) rankTitle.textContent = `${data.rank}: ${data.rankTitle}`;
    if (rankDesc) rankDesc.textContent = `${data.rankDesc} (Pontuação Geral: ${data.finalScore}/100)`;

    const elTotal = document.getElementById('reportStatTotal');
    const elOnTime = document.getElementById('reportStatOnTime');
    const elSpeed = document.getElementById('reportStatSpeed');
    const elHabits = document.getElementById('reportStatHabits');

    if (elTotal) elTotal.textContent = `${data.completedCount}/${data.totalTasks}`;
    if (elOnTime) elOnTime.textContent = `${data.taskOnTimeRate}%`;
    if (elSpeed) elSpeed.textContent = `${data.fastCount} Antecipadas`;
    if (elHabits) elHabits.textContent = `${data.perfectDays} dias 100%`;

    // Barra de velocidade
    const barFast = document.getElementById('speedBarFast');
    const barOntime = document.getElementById('speedBarOntime');
    const barLate = document.getElementById('speedBarLate');

    const totalCalculable = Math.max(1, (data.fastCount + (data.onTimeCount - data.fastCount) + data.lateCount + data.pendingOverdue));
    const pctFast = Math.round((data.fastCount / totalCalculable) * 100);
    const pctNormal = Math.round(((data.onTimeCount - data.fastCount) / totalCalculable) * 100);
    const pctLate = Math.round(((data.lateCount + data.pendingOverdue) / totalCalculable) * 100);

    if (barFast) barFast.style.width = `${pctFast}%`;
    if (barOntime) barOntime.style.width = `${pctNormal}%`;
    if (barLate) barLate.style.width = `${pctLate}%`;

    const txtFast = document.getElementById('speedTxtFast');
    const txtOntime = document.getElementById('speedTxtOntime');
    const txtLate = document.getElementById('speedTxtLate');

    if (txtFast) txtFast.textContent = `${data.fastCount} encomendas (${pctFast}%)`;
    if (txtOntime) txtOntime.textContent = `${Math.max(0, data.onTimeCount - data.fastCount)} encomendas (${pctNormal}%)`;
    if (txtLate) txtLate.textContent = `${data.lateCount + data.pendingOverdue} encomendas (${pctLate}%)`;

    const faculStats = document.getElementById('reportFaculStats');
    if (faculStats) {
      faculStats.innerHTML = `
        <li><span>Total de Entregas:</span> <strong>${data.faculTotal}</strong></li>
        <li><span>Concluídas:</span> <strong>${data.faculCompleted}</strong></li>
        <li><span>Pontualidade:</span> <strong>${data.faculCompleted > 0 ? Math.round((data.faculOnTime / data.faculCompleted) * 100) : 100}%</strong></li>
      `;
    }

    const pessoalStats = document.getElementById('reportPessoalStats');
    if (pessoalStats) {
      pessoalStats.innerHTML = `
        <li><span>Total de Entregas:</span> <strong>${data.pessoalTotal}</strong></li>
        <li><span>Concluídas:</span> <strong>${data.pessoalCompleted}</strong></li>
        <li><span>Pontualidade:</span> <strong>${data.pessoalCompleted > 0 ? Math.round((data.pessoalOnTime / data.pessoalCompleted) * 100) : 100}%</strong></li>
      `;
    }
  },

  /**
   * Gera o arquivo PDF oficial com o Logotipo Elgaly Express incluído!
   */
  async exportPDF() {
    const data = this.getAnalyticsData();

    const jsPDFModule = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
    if (!jsPDFModule) {
      alert('A biblioteca de geração de PDF está carregando. Tente novamente em instantes.');
      return;
    }

    const doc = new jsPDFModule({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let currentY = 14;

    // ==========================================
    // 1. CABEÇALHO DO DOCUMENTO COM LOGO
    // ==========================================
    // Barra superior roxo escuro (#3a154d)
    doc.setFillColor(58, 21, 77);
    doc.rect(0, 0, pageWidth, 42, 'F');

    // Linha de borda magenta inferior (#e62b7e)
    doc.setFillColor(230, 43, 126);
    doc.rect(0, 42, pageWidth, 4, 'F');

    // Inserção do Logotipo no cabeçalho
    if (this.cachedLogoBase64) {
      try {
        // Logo na esquerda/topo do cabeçalho
        doc.addImage(this.cachedLogoBase64, 'PNG', 15, 8, 48, 24);
      } catch (err) {
        console.warn('Erro ao inserir imagem no PDF:', err);
      }
    }

    // Título Principal e Agente
    const textStartX = this.cachedLogoBase64 ? 68 : pageWidth / 2;
    const textAlignment = this.cachedLogoBase64 ? 'left' : 'center';

    doc.setTextColor(255, 235, 59); // Amarelo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('ELGALY EXPRESS', textStartX, 16, { align: textAlignment });

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('RELATÓRIO OFICIAL DE DESPACHO OPERACIONAL & ROTINA', textStartX, 23, { align: textAlignment });

    // Informação do Agente EEX
    doc.setTextColor(247, 168, 202);
    doc.setFontSize(9);
    const agentNick = data.currentUser ? data.currentUser.eexEmail : 'agente.express.com';
    doc.text(`Agente: ${agentNick} | Período: ${data.startDate} a ${data.endDate} (${data.days} Dias)`, textStartX, 30, { align: textAlignment });

    doc.setTextColor(200, 200, 200);
    doc.setFontSize(7.5);
    doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, textStartX, 36, { align: textAlignment });

    currentY = 53;

    // ==========================================
    // 2. QUADRO DE RANKING & DESEMPENHO
    // ==========================================
    doc.setFillColor(255, 228, 240);
    doc.setDrawColor(26, 8, 38);
    doc.setLineWidth(0.8);
    doc.roundedRect(15, currentY, pageWidth - 30, 26, 4, 4, 'FD');

    // Selo do Rank
    doc.setFillColor(255, 235, 59);
    doc.roundedRect(20, currentY + 3.5, 34, 19, 3, 3, 'FD');
    doc.setTextColor(26, 8, 38);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(data.rank, 37, currentY + 14.5, { align: 'center' });

    // Informações textuais do Rank
    doc.setFontSize(12);
    doc.setTextColor(58, 21, 77);
    doc.text(data.rankTitle, 60, currentY + 10);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(70, 70, 70);
    doc.text(data.rankDesc, 60, currentY + 16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(230, 43, 126);
    doc.text(`Pontuação Operacional: ${data.finalScore}/100 | Pontualidade de Entregas: ${data.taskOnTimeRate}%`, 60, currentY + 22);

    currentY += 33;

    // ==========================================
    // 3. INDICADORES CHAVE
    // ==========================================
    const cardWidth = (pageWidth - 30 - 9) / 4;
    const cardHeight = 18;

    const stats = [
      { label: 'TOTAL ENTREGAS', val: `${data.completedCount}/${data.totalTasks}`, color: [230, 43, 126] },
      { label: 'NO PRAZO', val: `${data.taskOnTimeRate}%`, color: [16, 185, 129] },
      { label: 'ANTECIPADAS (FAST)', val: `${data.fastCount}`, color: [59, 130, 246] },
      { label: 'ROTINA 100%', val: `${data.perfectDays} dias`, color: [245, 158, 11] },
    ];

    stats.forEach((st, idx) => {
      const cardX = 15 + idx * (cardWidth + 3);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(26, 8, 38);
      doc.setLineWidth(0.6);
      doc.roundedRect(cardX, currentY, cardWidth, cardHeight, 2, 2, 'FD');

      doc.setTextColor(st.color[0], st.color[1], st.color[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(st.val, cardX + cardWidth / 2, currentY + 8.5, { align: 'center' });

      doc.setTextColor(90, 90, 90);
      doc.setFontSize(7);
      doc.text(st.label, cardX + cardWidth / 2, currentY + 14.5, { align: 'center' });
    });

    currentY += 25;

    // ==========================================
    // 4. DIAGNÓSTICO DE AGILIDADE
    // ==========================================
    doc.setFillColor(58, 21, 77);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.rect(15, currentY, pageWidth - 30, 6.5, 'F');
    doc.text('DIAGNÓSTICO DE VELOCIDADE & PONTUALIDADE', 18, currentY + 4.8);

    currentY += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(26, 8, 38);

    const speedDiagnosis = [
      `• Entregas Antecipadas / Ultra Rápidas: ${data.fastCount} encomendas entregues com mais de 12h de antecedência.`,
      `• Entregues no Prazo Regular: ${Math.max(0, data.onTimeCount - data.fastCount)} encomendas concluídas dentro do tempo estipulado.`,
      `• Entregas com Atraso: ${data.lateCount} concluídas após o prazo | ${data.pendingOverdue} pendentes que já estouraram a data.`,
      `• Hábitos da Rotina Diária: ${data.completedHabitsCount} check-ins cumpridos (Consistência: ${data.habitSuccessRate}%).`
    ];

    speedDiagnosis.forEach(line => {
      doc.text(line, 18, currentY);
      currentY += 4.5;
    });

    currentY += 3;

    // ==========================================
    // 5. DIVISÃO: FACULDADE VS PESSOAL
    // ==========================================
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(26, 8, 38);
    doc.setLineWidth(0.6);
    const halfWidth = (pageWidth - 30 - 6) / 2;

    doc.roundedRect(15, currentY, halfWidth, 16, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(9);
    doc.text('SETOR ACADÊMICO (FACULDADE)', 20, currentY + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(50, 50, 50);
    doc.text(`Total: ${data.faculTotal} | Concluídas: ${data.faculCompleted} | No Prazo: ${data.faculOnTime}`, 20, currentY + 11.5);

    doc.roundedRect(15 + halfWidth + 6, currentY, halfWidth, 16, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 53, 15);
    doc.setFontSize(9);
    doc.text('SETOR PESSOAL & PROJETOS', 20 + halfWidth + 6, currentY + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(50, 50, 50);
    doc.text(`Total: ${data.pessoalTotal} | Concluídas: ${data.pessoalCompleted} | No Prazo: ${data.pessoalOnTime}`, 20 + halfWidth + 6, currentY + 11.5);

    currentY += 22;

    // ==========================================
    // 6. MANIFESTO DE ENCOMENDAS
    // ==========================================
    doc.setFillColor(58, 21, 77);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.rect(15, currentY, pageWidth - 30, 6.5, 'F');
    doc.text('MANIFESTO DE ENCOMENDAS REGISTRADAS', 18, currentY + 4.8);

    currentY += 8.5;

    doc.setFillColor(243, 244, 246);
    doc.setDrawColor(200, 200, 200);
    doc.rect(15, currentY, pageWidth - 30, 5.5, 'FD');
    doc.setTextColor(26, 8, 38);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('CÓDIGO', 18, currentY + 3.8);
    doc.text('ENCOMENDA / MISSÃO', 42, currentY + 3.8);
    doc.text('SETOR', 110, currentY + 3.8);
    doc.text('PRAZO LIMITE', 135, currentY + 3.8);
    doc.text('STATUS / VELOCIDADE', 170, currentY + 3.8);

    currentY += 6.5;

    if (data.taskManifest.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text('Nenhuma encomenda registrada neste período.', 18, currentY + 4);
      currentY += 10;
    } else {
      const displayList = data.taskManifest.slice(0, 13);
      displayList.forEach((t, i) => {
        if (i % 2 === 1) {
          doc.setFillColor(250, 245, 255);
          doc.rect(15, currentY - 1, pageWidth - 30, 5.5, 'F');
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(26, 8, 38);
        doc.text(t.code, 18, currentY + 2.8);

        doc.setFont('helvetica', 'normal');
        const safeTitle = t.title.length > 36 ? t.title.substring(0, 34) + '...' : t.title;
        doc.text(safeTitle, 42, currentY + 2.8);

        doc.text(t.category === 'faculdade' ? 'Faculdade' : 'Pessoal', 110, currentY + 2.8);
        doc.text(t.dueDate, 135, currentY + 2.8);

        if (t.speedStatus.includes('Rápido')) {
          doc.setTextColor(5, 150, 105);
        } else if (t.speedStatus.includes('Atrasado')) {
          doc.setTextColor(220, 38, 38);
        } else {
          doc.setTextColor(80, 80, 80);
        }
        doc.setFont('helvetica', 'bold');
        doc.text(t.speedStatus, 170, currentY + 2.8);

        currentY += 5.5;
      });

      if (data.taskManifest.length > 13) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(120, 120, 120);
        doc.text(`* E mais ${data.taskManifest.length - 13} encomendas registradas no sistema...`, 18, currentY + 2.8);
        currentY += 6;
      }
    }

    // ==========================================
    // 7. RODAPÉ OFICIAL (COM ENDEREÇO DA HQ)
    // ==========================================
    doc.setFillColor(58, 21, 77);
    doc.rect(0, pageHeight - 16, pageWidth, 16, 'F');

    doc.setTextColor(255, 235, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('© 1998 - 2026 | Elgaly Express: Serviços de Entrega', pageWidth / 2, pageHeight - 10, { align: 'center' });

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('Avenida Tennant Rockstead, 67, Nova Amerit - NA (Nova Arcanis)', pageWidth / 2, pageHeight - 5, { align: 'center' });

    // Download do arquivo PDF
    const safeNick = (data.currentUser ? data.currentUser.nickname : 'entregador').replace(/[^a-z0-9]/gi, '_');
    const filename = `Relatorio_ElgalyExpress_${safeNick}_${data.days}dias_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    if (typeof confetti === 'function' && data.finalScore >= 75) {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }
};

// Inicializa pré-carregamento do logo
document.addEventListener('DOMContentLoaded', () => {
  ReportEngine.init();
});
