/**
 * ELGALY EXPRESS - FIREBASE CLOUD FUNCTIONS
 * Dispara notificacoes push via FCM quando eventos ocorrem no Firestore:
 *   - Nova encomenda recebida
 *   - Convite de amizade (Friend Request)
 *   - Buzina (Poke) recebida
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
