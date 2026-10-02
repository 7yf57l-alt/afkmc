const https = require('https');

const GROQ_API_KEY = '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';
const GROQ_MODEL = 'qwen/qwen3.8-27b';

// Matches pappuchan, papuchan, pappu, papu, pappuchann, etc.
const NAME_REGEX = /\b(pappuchann?|papuchann?|pappu|papu)\b/i;

let lastReplyTime = 0;
const REPLY_COOLDOWN_MS = 10000; // 10-second cooldown so Ash Guard never complains about speed

let lastSentText = '';

/**
 * Extracts a clean player username from server formatted strings like "☀ | [rank] Username"
 */
function extractCleanPlayerName(senderStr) {
  if (!senderStr) return '';
  const tokens = senderStr.replace(/[^a-zA-Z0-9_.]/g, ' ').trim().split(/\s+/);
  return tokens[tokens.length - 1] || '';
}

/**
 * Parses out the sender and the actual message content from server chat format
 * E.g.: "☀ | [rank] username » message"
 */
function parseChatMessage(rawText) {
  let sender = '';
  let content = rawText;

  if (rawText.includes('»')) {
    const parts = rawText.split('»');
    sender = parts[0].trim();
    content = parts.slice(1).join('»').trim();
  } else if (rawText.includes(':')) {
    const parts = rawText.split(':');
    sender = parts[0].trim();
    content = parts.slice(1).join(':').trim();
  } else if (rawText.startsWith('<') && rawText.includes('>')) {
    const end = rawText.indexOf('>');
    sender = rawText.slice(1, end).trim();
    content = rawText.slice(end + 1).trim();
  }

  return { sender, cleanName: extractCleanPlayerName(sender), content };
}

/**
 * Checks if another player mentioned pappuchan in the message content
 * @param {string} rawText 
 * @param {string} botUsername 
 * @returns {boolean}
 */
function isMentioned(rawText, botUsername = 'pappuchan') {
  if (!rawText || typeof rawText !== 'string') return false;

  const { sender, content } = parseChatMessage(rawText);

  // If the message is from our own bot, NEVER trigger!
  if (sender.toLowerCase().includes(botUsername.toLowerCase())) {
    return false;
  }

  // Only check if our name is mentioned in the actual MESSAGE CONTENT (not sender rank/name)
  return NAME_REGEX.test(content);
}

/**
 * Generates a cute, unique, heartbroken reply addressing the player
 * @param {string} messageText 
 * @returns {Promise<string>}
 */
function generateDryReply(messageText) {
  const now = Date.now();
  if (now - lastReplyTime < REPLY_COOLDOWN_MS) {
    return Promise.resolve(null);
  }
  lastReplyTime = now;

  const { cleanName, content } = parseChatMessage(messageText);
  const targetTag = cleanName ? `@${cleanName} ` : '';

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are pappuchan on a Minecraft server. When another player talks to you, reply in a very cute, innocent, emotional Hinglish tone. You are heartbroken because you miss her (uski bohot yaad aa rahi hai). Express how sad you are and how much you miss her, and naturally add a plug to subscribe to @papppuchan. Never repeat the exact same sentence. Keep it strictly under 14 words. Do not include emojis.'
        },
        {
          role: 'user',
          content: `${cleanName || 'Player'}: ${content || messageText}`
        }
      ],
      max_tokens: 50,
      temperature: 0.9 // Higher temperature for high response diversity
    });

    const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let reply = json.choices[0].message.content.trim().replace(/[\r\n]+/g, ' ').replace(/"/g, '');
          
          if (!reply.includes('@papppuchan')) {
            reply += ' subscribe to @papppuchan';
          }

          // Prepend target player's name so message is 100% unique and never blocked by Ash Guard
          let fullReply = `${targetTag}${reply}`.trim();

          // Anti-duplicate protection: if identical to last, add cute punctuation
          if (fullReply === lastSentText) {
            fullReply += ' ~';
          }
          lastSentText = fullReply;

          resolve(fullReply);
        } catch {
          const fallback = `${targetTag}mujhe uski bohot yaad aa rahi h yar... isi baat pe subscribe to @papppuchan please`;
          resolve(fallback);
        }
      });
    });

    req.on('error', () => {
      resolve(`${targetTag}uski yaad aa rahi h yar... @papppuchan subscribe kar do please`);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(`${targetTag}uski bohot yaad aati h, subscribe to @papppuchan`);
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  extractCleanPlayerName,
  parseChatMessage,
  isMentioned,
  generateDryReply
};
