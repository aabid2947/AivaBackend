// src/services/aiva.service.js
// This file acts as a facade, exporting all the necessary functions from the refactored modules.

import * as chatService from './aiva/chatService.js';
import * as conversationService from './aiva/conversationService.js';
import * as summarizationService from './aiva/summarizationService.js';

// Export all functions so the controller can access them from one place.
export const {
    createNewChat,
    deleteChat,
    listUserChats,
    getChatHistory,
    addMessageToHistory
} = chatService;

export const {
    handleUserMessage,
    getConversationState,
    updateConversationState
} = conversationService;

export const {
    performSummarization,
    performPdfSummarization,
    performImageSummarization
} = summarizationService;
