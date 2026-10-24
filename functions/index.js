/**
 * ELGALY EXPRESS - FIREBASE CLOUD FUNCTIONS
 * Dispara notificacoes push via FCM quando eventos ocorrem no Firestore:
 *   - Nova encomenda recebida
 *   - Convite de amizade (Friend Request)
 *   - Buzina (Poke) recebida
 *   - Lembretes de habitos pendentes (a cada 3h: 08, 11, 14, 17, 20 BRT)
 */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ============================================================
// HELPER: busca o token FCM do usuario e envia a notificacao
// ============================================================
async function sendFcmToUser(toUid, title, body, data) {
  try {
    const userDoc = await db.collection('users').doc(toUid).get();
    if (!userDoc.exists) return;

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) {
      console.log('Sem fcmToken para uid:', toUid);
      return;
    }

    const message = {
      token: fcmToken,
      notification: { title: title, body: body },
      data: data || {},
      android: {
        notification: {
          icon:  'ic_launcher_foreground',
          color: '#3a154d',
          sound: 'default'
        },
        priority: 'high'
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 }
        }
      },
      webpush: {
        notification: {
          icon: '/images/icon-192.png',
          badge: '/images/icon-192.png'
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('Notificacao enviada com sucesso:', response);
  } catch (err) {
    // Token invalido ou expirado — remove do usuario
    if (err.code === 'messaging/registration-token-not-registered' ||
        err.code === 'messaging/invalid-registration-token') {
      console.warn('Token FCM invalido, removendo para uid:', toUid);
      await db.collection('users').doc(toUid).update({ fcmToken: admin.firestore.FieldValue.delete() });
    } else {
      console.error('Erro ao enviar FCM:', err);
    }
  }
}

// ============================================================
// TRIGGER 1: Nova encomenda recebida
// users/{recipientUid}/packages/{packageId}
// ============================================================
exports.onPackageReceived = functions
  .region('southamerica-east1')
  .firestore
  .document('users/{recipientUid}/packages/{packageId}')
  .onCreate(async (snap, context) => {
    const pkg          = snap.data();
    const recipientUid = context.params.recipientUid;

    // Nao notifica se o remetente e o proprio destinatario
    if (pkg.fromUid === recipientUid) return null;

    const senderName = pkg.fromName || 'Um agente da Frota';
    const boxLabel   = pkg.boxType === 'envelope-confidencial' ? 'envelope confidencial'
                     : pkg.boxType === 'pacote-fita'           ? 'presente'
                     : 'encomenda';
    const title = 'Nova encomenda EEX chegou!';
    const body  = senderName + ' enviou um ' + boxLabel + ' para voce: "' +
                  ((pkg.message || '').substring(0, 80)) + '"';

    await sendFcmToUser(recipientUid, title, body, {
      type:    'package',
      fromUid: pkg.fromUid || ''
    });
    return null;
  });

// ============================================================
// TRIGGER 2: Convite de amizade recebido
// friend_requests/{toUid}/incoming/{fromUid}
// ============================================================
exports.onFriendRequestReceived = functions
  .region('southamerica-east1')
  .firestore
  .document('friend_requests/{toUid}/incoming/{fromUid}')
  .onCreate(async (snap, context) => {
    const req   = snap.data();
    const toUid = context.params.toUid;

    const senderNick = req.fromEexEmail || req.fromNick || 'Um agente';
    const title = 'Pedido de amizade EEX!';
    const body  = senderNick + ' quer se juntar a sua Frota de Agentes!';

    await sendFcmToUser(toUid, title, body, {
      type:    'friend_request',
      fromUid: req.fromUid || context.params.fromUid
    });
    return null;
  });

// ============================================================
// TRIGGER 3: Buzina (Poke) recebida
// users/{recipientUid}/pokes/{pokeId}
// ============================================================
exports.onPokeReceived = functions
  .region('southamerica-east1')
  .firestore
  .document('users/{recipientUid}/pokes/{pokeId}')
  .onCreate(async (snap, context) => {
    const poke         = snap.data();
    const recipientUid = context.params.recipientUid;

    if (poke.fromUid === recipientUid) return null;

    const senderNick = poke.fromNick || poke.fromName || 'Um agente';
    const title = 'Voce recebeu uma forca!';
    const body  = senderNick + ' te deu uma forca para continuar a rotina! (+10 XP para quem buzinou)';

    await sendFcmToUser(recipientUid, title, body, {
      type:    'poke',
      fromUid: poke.fromUid || ''
    });
    return null;
  });

// ============================================================
// SCHEDULED FUNCTION: Lembretes de habitos pendentes
// Roda a cada hora nos horarios 08, 11, 14, 17, 20 (BRT)
// Notifica usuarios com habitos pendentes no dia via FCM
// ============================================================
exports.sendHabitReminders = functions
  .region('southamerica-east1')
  .pubsub
  .schedule('0 8,11,14,17,20 * * *')
  .timeZone('America/Sao_Paulo')
  .onRun(async (context) => {
    // Data de hoje no fuso America/Sao_Paulo (UTC-3)
    const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const todayStr = nowBRT.toISOString().substring(0, 10); // YYYY-MM-DD
    const dayOfWeek = nowBRT.getUTCDay(); // 0=Dom ... 6=Sab

    console.log(`[sendHabitReminders] rodando para ${todayStr}, dia ${dayOfWeek}`);

    // Textos neo-brutalistas para o push
    const NOTIF_VARIANTS = [
      {
        title: '\uD83D\uDEA8 ROTA PENDENTE, AGENTE!',
        body:  (count, nextHabit) => `Midnight em panico: ${count} habito(s) pendente(s)! Proximo: "${nextHabit}" \uD83D\uDCA5`
      },
      {
        title: '\u26A1 MISSAO INCOMPLETA!',
        body:  (count, nextHabit) => `${count} habito(s) aguardando sua acao, Agente! "${nextHabit}" ta te esperando \uD83C\uDFAF`
      },
      {
        title: '\uD83D\uDD25 ALERTA DA FROTA EEX!',
        body:  (count, nextHabit) => `A base registrou ${count} pendencia(s) hoje! Nao abandone a rota! \uD83D\uDE80`
      },
      {
        title: '\uD83D\uDC80 AGENTE, ACORDA!',
        body:  (count) => `${count} missao(oes) sem concluir! A Midnight ja ta desesperada contigo \uD83D\uDE24`
      },
      {
        title: '\uD83D\uDCCB CHECK-IN DIMENSIONAL',
        body:  (count, nextHabit) => `${count} habito(s) na sua rota de hoje. "${nextHabit}" espera seu check-in \u2705`
      }
    ];

    // Busca usuarios com fcmToken (limite 500)
    const usersSnap = await db.collection('users')
      .where('fcmToken', '!=', null)
      .limit(500)
      .get();

    if (usersSnap.empty) {
      console.log('Nenhum usuario com fcmToken encontrado.');
      return null;
    }

    const tokens   = [];
    const tokenMap = {}; // token -> uid para tratamento de erros

    await Promise.all(usersSnap.docs.map(async (userDoc) => {
      const uid      = userDoc.id;
      const fcmToken = userDoc.data().fcmToken;
      if (!fcmToken) return;

      // Busca habitos do dia (days array contendo o numero dayOfWeek)
      const habitsSnap = await db.collection('users').doc(uid).collection('habits').get();
      if (habitsSnap.empty) return;

      const pendingHabits = habitsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(h => {
          // Filtra pelo dia da semana
          if (!h.days || h.days.length === 0) return true;
          if (!h.days.includes(dayOfWeek)) return false;
          // Verifica se ja foi concluido hoje via completedDates
          if (Array.isArray(h.completedDates) && h.completedDates.includes(todayStr)) return false;
          return true;
        });

      if (pendingHabits.length === 0) return;

      const count     = pendingHabits.length;
      const nextHabit = (pendingHabits[0] && pendingHabits[0].title) ? pendingHabits[0].title : 'Habito';
      const variant   = NOTIF_VARIANTS[Math.floor(Math.random() * NOTIF_VARIANTS.length)];
      const bodyText  = variant.body(count, nextHabit);

      tokens.push({
        token:     fcmToken,
        uid:       uid,
        title:     variant.title,
        body:      bodyText,
        count:     count
      });
      tokenMap[fcmToken] = uid;
    }));

    if (tokens.length === 0) {
      console.log('Nenhum usuario com habitos pendentes hoje.');
      return null;
    }

    console.log(`Enviando lembretes para ${tokens.length} usuarios.`);

    // Envia em lote via sendEachForMulticast (max 500 tokens)
    const messages = tokens.map(t => ({
      token: t.token,
      notification: { title: t.title, body: t.body },
      data: { type: 'habit_reminder', count: String(t.count) },
      android: {
        notification: {
          icon:      'ic_launcher_foreground',
          color:     '#FFDD00',
          sound:     'default',
          channelId: 'eex_habits'
        },
        priority: 'high'
      },
      webpush: {
        notification: {
          icon:   '/images/icon-192.png',
          badge:  '/images/icon-192.png',
          vibrate: [200, 100, 200]
        },
        headers: { Urgency: 'high' }
      }
    }));

    // sendEachForMulticast aceita array de mensagens individuais (cada uma com token)
    const response = await admin.messaging().sendEach(messages);
    console.log(`sendEach: ${response.successCount} ok, ${response.failureCount} erros.`);

    // Trata tokens invalidos
    const deleteOps = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const errCode = res.error && res.error.code;
        if (
          errCode === 'messaging/registration-token-not-registered' ||
          errCode === 'messaging/invalid-registration-token'
        ) {
          const uid = tokens[idx].uid;
          console.warn(`Token invalido para uid ${uid}, removendo.`);
          deleteOps.push(
            db.collection('users').doc(uid).update({ fcmToken: admin.firestore.FieldValue.delete() })
          );
        } else {
          console.error(`Erro ao enviar para uid ${tokens[idx].uid}:`, res.error);
        }
      }
    });

    if (deleteOps.length > 0) await Promise.all(deleteOps);

    return null;
  });
