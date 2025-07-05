// src/services/aiva/chat.service.js
import { db } from '../../config/firebaseAdmin.js';
import { v4 as uuidv4 } from 'uuid';
import { AIVA_INITIAL_GREETING, ConversationStates } from './constants.js';

async function deleteCollection(collectionPath, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve) {
  const snapshot = await query.get();
  if (snapshot.size === 0) {
    resolve();
    return;
  }
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

export async function addMessageToHistory(userId, chatId, role, content, stateWhenSent = null, intentContext = null) {
  const messageData = {
    userId,
    chatId,
    role,
    content,
    timestamp: new Date().toISOString(),
    stateWhenSent,
    ...(intentContext && { intentContext })
  };
  const messageRef = await db.collection('users').doc(userId).collection('aivaChats').doc(chatId).collection('messages').add(messageData);
  console.log(`chat.service: Added message to history for user ${userId}, chat ${chatId}, role: ${role}`);
  return messageRef;
}

export async function createNewChat(userId, chatName = "New Chat") {
  if (!db) throw new Error('Database not initialized.');
  const chatId = uuidv4();
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);

  const initialChatState = {
    chatId,
    userId,
    chatName,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    lastProposedIntent: null,
    lastAivaMessageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appointmentDetails: {}
  };
  await chatRef.set(initialChatState);

  const initialMessage = {
    role: 'assistant',
    content: AIVA_INITIAL_GREETING,
    timestamp: new Date().toISOString(),
  };
  const initialMessageRef = await addMessageToHistory(userId, chatId, initialMessage.role, initialMessage.content, ConversationStates.AWAITING_USER_REQUEST);
  await chatRef.update({ lastAivaMessageId: initialMessageRef.id, updatedAt: new Date().toISOString() });

  console.log(`chat.service: New chat created for user ${userId} with chatId ${chatId}`);
  return {
    chatId,
    chatName,
    initialMessage: {
      id: initialMessageRef.id,
      text: initialMessage.content,
      sender: 'ai',
      timestamp: initialMessage.timestamp
    },
    currentState: initialChatState.currentState,
  };
}

export async function deleteChat(userId, chatId) {
  if (!db) throw new Error('Database not initialized.');
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);
  const messagesPath = `users/${userId}/aivaChats/${chatId}/messages`;

  await deleteCollection(messagesPath);
  await chatRef.delete();
  console.log(`chat.service: Chat ${chatId} deleted successfully for user ${userId}.`);
  return { message: `Chat ${chatId} deleted successfully.` };
}

export async function listUserChats(userId) {
  if (!db) throw new Error('Database not initialized.');
  if (!userId) throw new Error('User ID is required to list chats.');
  
  const chatsRef = db.collection('users').doc(userId).collection('aivaChats');
  const snapshot = await chatsRef.orderBy('createdAt', 'desc').get();
  if (snapshot.empty) {
    return [];
  }
  const chats = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  return chats;
}

export async function getChatHistory(userId, chatId, limit = 20) {
  const messagesRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId).collection('messages');
  const snapshot = await messagesRef.orderBy('timestamp', 'desc').limit(limit).get();
  if (snapshot.empty) return [];
  const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return history.reverse();
}
