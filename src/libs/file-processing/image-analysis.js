import { fetchGPTVisionResponse } from '../api-access/gpt-api-access.js';
import { fetchClaudeVisionResponse } from '../api-access/claude-api-access.js';
import { fetchOpenAiLikeVisionResponse } from '../api-access/open-ai-api-standard-access.js';
import { messages, selectedModel } from '../state-management/state.js';
import { addMessage } from '../conversation-management/message-processing.js';
import { storeFile } from '../utils/indexed-db-utils.js';

// Encode image as base64
async function encodeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Get string after comma
function getStringAfterComma(str) {
  const [_, ...rest] = str.split(',');
  return rest.join(',');
}

// Get string after comma
function filterGPTMessages(conversation) {
  let lastMessageContent = '';
  return conversation.filter((message) => {
    const isGPT = !message.content.trim().toLowerCase().startsWith('image::') && !lastMessageContent.startsWith('image::');
    lastMessageContent = message.content.trim().toLowerCase();
    return isGPT;
  });
}

// Format messages for vision
function formatMessagesForVision(messages) {
  return messages.map((message) => ({
    type: 'text',
    text: message.content,
  }));
}

async function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('UserFilesDB', 5); // Increase the version number

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('userFiles')) {
        const objectStore = db.createObjectStore('userFiles', { keyPath: 'id', autoIncrement: true });
        objectStore.createIndex('fileName', 'fileName', { unique: false });
        objectStore.createIndex('fileSize', 'fileSize', { unique: false });
        objectStore.createIndex('fileType', 'fileType', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

export const storeFileData = async (fileName, fileData, fileSize, fileType) => {
  try {
    const fileId = await storeFile(fileName, fileData, fileSize, fileType);
    console.log(`File stored successfully with ID: ${fileId}`);
    return fileId;
  } catch (error) {
    console.error('Error storing file data:', error);
    throw error;
  }
};

// Analyze image
export async function analyzeImage(file, fileType, messages2, model, localModelName, localModelEndpoint) {
  const base64Image = await encodeImage(file);
  const fileData = base64Image;
  const fileName = file.name;
  // Store the image data in IndexedDB
  await storeFileData(fileName, fileData, file.size, file.type);

  const visionFormattedMessages = messages.value.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const lastMessageText = messages.value[messages.value.length - 1].content[0].text;
  visionFormattedMessages.pop();

  if (model.indexOf('gpt') !== -1 || selectedModel.value.includes('open-ai-format')) {
    visionFormattedMessages.push({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: base64Image },
        },
        {
          type: "text",
          text: lastMessageText
        }
      ],
    });

    messages.value.pop();
    addMessage("user", [
      {
        type: 'image_url',
        image_url: { url: base64Image },
      },
      {
        type: "text",
        text: lastMessageText
      }
    ])

    if (selectedModel.value.includes("gpt")) {
      return await fetchGPTVisionResponse(visionFormattedMessages, localStorage.getItem('gptKey'));
    }
    else {
      return await fetchOpenAiLikeVisionResponse(visionFormattedMessages, localStorage.getItem('localModelKey'), localModelName, localModelEndpoint)
    }
  }

  if (model.indexOf('claude') !== -1) {
    visionFormattedMessages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: fileType,
            data: getStringAfterComma(base64Image),
          },
        },
      ],
    });

    return await fetchClaudeVisionResponse(visionFormattedMessages, localStorage.getItem('claudeKey'), model);
  }

  if (model.indexOf('open-ai-format') !== -1) {
    visionFormattedMessages.push({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: base64Image },
        },
      ],
    });

    return await fetchOpenAiLikeVisionResponse(visionFormattedMessages, localStorage.getItem('localModelKey'), localModelName, localModelEndpoint);
  }

  return 'not implemented for selected model';
}
