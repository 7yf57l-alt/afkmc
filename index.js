const mineflayer = require('mineflayer');
const readline = require('readline');
const http = require('http');
const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const ChatMessage = require('prismarine-chat')('1.20.4');
const { cleanChat } = require('./filter');
const { isMentioned, generateDryReply } = require('./aiResponder');
const JOKES = require('./jokes.json');

const PROMOS = [
  "subscribe me on youtube -> @papppuchan",
  "bhai log youtube pe @papppuchan search karke subscribe kar lo please <3",
  "dil se request hai, youtube pe @papppuchan subscribe kar dena dosto :)",
  "agar thode maze aaye ho toh yt: @papppuchan subscribe zaroor karna!",
  "chota sa YouTuber hoon, please subscribe kar do yt -> @papppuchan",
  "bhai ki thodi help kar do, youtube pe @papppuchan subscribe maar do!",
  "youtube channel: @papppuchan | ek subscribe toh banta hai yaaro",
  "support me on youtube guys -> @papppuchan (dil se shukriya)"
];

const CONFIG = {
  host: 'play.ashsmp.in',
  port: 25565,
  username: 'pappuchan',
  version: '1.20.4',
  brand: 'vanilla',
  auth: 'offline',
  viewDistance: 'far',
  actionDelay: 3000,
  jokeInterval: 65000, // 65 seconds between jokes (safe from Ash Guard spam checks)
  promoDelay: 10000, // 10 seconds after joke (prevents "Please slow down!" filter)
  defaultReconnectDelay: 25000,
  restartReconnectDelay: 45000,
  deniedReconnectDelay: 240000
};

let rl = null;
let reconnectTimer = null;
let jokeTimeout = null;
let promoTimeout = null;
let jokeIndex = 0;
let promoIndex = 0;
let currentBot = null;

// Global bot state for monitoring & cloud hosting
const botState = {
  status: 'Starting',
  connected: false,
  hasLoggedIn: false,
  hasSentLifesteal: false,
  inLifesteal: false,
  hasWarpedAfk: false,
  jokesSent: 0,
  aiRepliesSent: 0,
  lastKickReason: null,
  reconnectCount: 0
};

// Rolling in-memory log buffer for live web console
const chatLogs = [];
function addLog(type, text) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  chatLogs.push({ time: timestamp, type, text });
  if (chatLogs.length > 250) chatLogs.shift();
}

addLog('SYSTEM', 'Bot system initialized. Ready to connect.');

// ----------------------------------------------------
// Built-in Web Dashboard & Status Server
// Accessible at http://localhost:3000 & https://pappuchan-afk.onrender.com
// ----------------------------------------------------
let dashboardHtml = '';
try {
  dashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
} catch (e) {
  dashboardHtml = '<h1>pappuchan live dashboard</h1>';
}

const server = http.createServer((req, res) => {
  // 1. Live Web Console Dashboard
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(dashboardHtml);
  }

  // 2. Real-time Status & Chat Logs API
  if (req.method === 'GET' && req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      service: 'Minecraft AFK Bot',
      bot: CONFIG.username,
      server: CONFIG.host,
      totalJokesAvailable: JOKES.length,
      uptimeSeconds: Math.floor(process.uptime()),
      logs: chatLogs,
      ...botState
    }));
  }

  // 3. Send in-game command or chat from the web browser!
  if (req.method === 'POST' && req.url === '/api/send') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        if (message && currentBot && currentBot.player) {
          currentBot.chat(message);
          addLog('SENT', message);
          console.log(`[Web Sent] ${message}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Web Dashboard] Live web console running at http://localhost:${PORT}`);
});

function setupConsoleInput(bot) {
  if (rl) rl.close();

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });

  rl.on('line', (line) => {
    const text = line.trim();
    if (text.length > 0 && bot && bot.player) {
      bot.chat(text);
      addLog('SENT', text);
      console.log(`[Sent] ${text}`);
    }
  });
}

function parseText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') {
    try {
      const json = JSON.parse(obj);
      return String(new ChatMessage(json).toString());
    } catch {
      return String(obj);
    }
  }
  try {
    const simplified = nbt.simplify(obj);
    return String(new ChatMessage(simplified).toString());
  } catch {
    if (obj.text) return String(obj.text);
    return typeof obj === 'object' ? JSON.stringify(obj) : String(obj);
  }
}

// ----------------------------------------------------
// Joke & YouTube Promo Broadcaster (Safe Pacing)
// ----------------------------------------------------
function stopJokeLoop() {
  if (jokeTimeout) {
    clearTimeout(jokeTimeout);
    jokeTimeout = null;
  }
  if (promoTimeout) {
    clearTimeout(promoTimeout);
    promoTimeout = null;
  }
}

function startJokeLoop(bot) {
  stopJokeLoop();
  console.log(`\n[Joke Broadcaster] Activated! Jokes every ${CONFIG.jokeInterval / 1000}s, promo after ${CONFIG.promoDelay / 1000}s.`);
  addLog('SYSTEM', `Joke broadcaster started. Broadcasting every ${CONFIG.jokeInterval / 1000}s.`);

  function scheduleNextJoke() {
    jokeTimeout = setTimeout(() => {
      if (!bot || !bot.player || !botState.connected) return;

      const joke = JOKES[jokeIndex % JOKES.length];
      jokeIndex++;
      botState.jokesSent = jokeIndex;

      console.log(`\n[Joke #${jokeIndex}/${JOKES.length}] ${joke}`);
      addLog('JOKE', joke);
      bot.chat(joke);

      // Wait 10 seconds (safe from Ash Guard speed limit), then send varied promo
      promoTimeout = setTimeout(() => {
        if (!bot || !bot.player || !botState.connected) return;
        const promo = PROMOS[promoIndex % PROMOS.length];
        promoIndex++;
        console.log(`[Promo] ${promo}\n`);
        addLog('PROMO', promo);
        bot.chat(promo);

        // Schedule next joke after safe interval
        scheduleNextJoke();
      }, CONFIG.promoDelay);

    }, CONFIG.jokeInterval);
  }

  // First joke 15s after settling in AFK zone
  jokeTimeout = setTimeout(() => {
    scheduleNextJoke();
  }, 15000);
}

function startBot() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  stopJokeLoop();

  // Reset state machine flags for every fresh connection
  botState.connected = false;
  botState.hasLoggedIn = false;
  botState.hasSentLifesteal = false;
  botState.inLifesteal = false;
  botState.hasWarpedAfk = false;
  botState.status = 'Connecting';

  console.log(`\n==================================================`);
  console.log(`[Bot] Connecting to ${CONFIG.host} as ${CONFIG.username}...`);
  console.log(`==================================================\n`);
  addLog('SYSTEM', `Connecting to ${CONFIG.host} as ${CONFIG.username}...`);

  const bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    brand: CONFIG.brand,
    auth: CONFIG.auth,
    viewDistance: CONFIG.viewDistance,
    skinParts: {
      showCape: true,
      showJacket: true,
      showLeftSleeve: true,
      showRightSleeve: true,
      showLeftPants: true,
      showRightPants: true,
      showHat: true
    },
    hideErrors: false
  });

  currentBot = bot;
  setupConsoleInput(bot);

  // Automatic Resource Pack Handling (Crucial for Lifesteal ItemsAdder plugin)
  bot._client.on('packet', (data, meta) => {
    if (meta.name === 'add_resource_pack') {
      try {
        bot._client.write('resource_pack_receive', {
          uuid: data.uuid,
          result: 3 // Accepted
        });
        bot._client.write('resource_pack_receive', {
          uuid: data.uuid,
          result: 0 // Successfully Loaded
        });
        console.log(`[Bot] Server requested resource pack: Accepted & Loaded.`);
        addLog('SYSTEM', 'Resource pack accepted & loaded successfully.');
      } catch (e) {
        console.error(`[Bot] Resource pack response error:`, e.message);
      }
    }
  });

  bot.on('resourcePack', () => {
    bot.acceptResourcePack();
  });

  let nextReconnectDelay = CONFIG.defaultReconnectDelay;

  bot.on('login', () => {
    botState.connected = true;
    botState.status = 'Proxy Connected';
    console.log(`[Bot] Logged into server proxy. Waiting for spawn...`);
    addLog('SYSTEM', 'Logged into server proxy. Waiting for spawn...');
  });

  bot.on('spawn', () => {
    botState.status = botState.inLifesteal ? 'In Lifesteal' : 'In Hub';
    console.log(`[Bot] Spawned in world at: ${bot.entity.position}`);
    addLog('SYSTEM', `Spawned in world at: ${bot.entity.position}`);
    bot.physicsEnabled = true;

    // Trigger /warp afkzone ONLY after confirmed spawn in Lifesteal
    if (botState.inLifesteal && !botState.hasWarpedAfk) {
      console.log(`[Bot] Lifesteal world fully loaded! Waiting 3s before /warp afkzone...`);
      addLog('SYSTEM', 'Lifesteal world loaded. Warping to afkzone in 3s...');
      setTimeout(() => {
        if (!botState.hasWarpedAfk) {
          botState.hasWarpedAfk = true;
          botState.status = 'AFK in AFK Zone';
          console.log(`[Bot] Executing: /warp afkzone`);
          bot.chat('/warp afkzone');
          console.log(`[Bot] AFK zone reached! Staying completely still.`);
          addLog('SYSTEM', 'AFK zone reached. Staying completely still.');
          startJokeLoop(bot);
        }
      }, CONFIG.actionDelay);
    }
  });

  // Display server titles/action bars cleanly
  bot.on('title', (title) => {
    try {
      const text = String(parseText(title) || '').trim();
      if (text.length > 0) {
        const cleaned = cleanChat(text);
        console.log(`[Server Title] ${cleaned}`);
        addLog('TITLE', cleaned);
      }
    } catch {}
  });

  // Handle server chat, sequence triggers, bad-words filter, and Groq AI replies
  bot.on('message', async (jsonMsg) => {
    try {
      const raw = jsonMsg.toString();
      const filtered = cleanChat(raw);
      console.log(`[Chat] ${filtered}`);
      addLog('CHAT', filtered);

      // 1. Auto-login when prompted
      if (!botState.hasLoggedIn && (raw.includes('/login') || raw.toLowerCase().includes('login using'))) {
        botState.hasLoggedIn = true;
        console.log(`[Bot] Login prompt detected. Waiting 3s before /login ggstime...`);
        addLog('SYSTEM', 'Login prompt detected. Executing: /login ggstime');
        setTimeout(() => {
          bot.chat('/login ggstime');
        }, CONFIG.actionDelay);
      }

      // 2. Switch to lifesteal after successful login or welcome message in hub
      if (!botState.hasSentLifesteal && (raw.toLowerCase().includes('successfully logged in') || raw.includes('Welcome pappuchan'))) {
        botState.hasLoggedIn = true;
        botState.hasSentLifesteal = true;
        console.log(`[Bot] Login confirmed! Waiting 3s before /lifesteal...`);
        addLog('SYSTEM', 'Login confirmed! Switching to /lifesteal in 3s...');
        setTimeout(() => {
          console.log(`[Bot] Executing: /lifesteal`);
          bot.chat('/lifesteal');
        }, CONFIG.actionDelay);
      }

      // 3. Mark that we are transitioning into Lifesteal
      if (raw.includes('Connecting to lifesteal') || raw.includes('ItemsAdder') || raw.includes('Lifesteal')) {
        botState.inLifesteal = true;
      }

      // 4. If server announces AFK Zone entry
      if (raw.includes('entered the AFK Zone') || raw.includes('AFK Zone')) {
        if (!botState.hasWarpedAfk) {
          botState.hasWarpedAfk = true;
          botState.status = 'AFK in AFK Zone';
          console.log(`[Bot] Verified: You are currently in the AFK Zone! No movement active.`);
          addLog('SYSTEM', 'Verified in AFK Zone. Joke broadcaster starting.');
          startJokeLoop(bot);
        }
      }

      // 5. Groq AI: Cute, heartbroken replies with player name tag and anti-duplicate check
      if (botState.connected && isMentioned(raw, CONFIG.username)) {
        console.log(`\n[Mention Detected] Someone mentioned you: "${filtered}"`);
        addLog('SYSTEM', `Mention detected: "${filtered}"`);
        const reply = await generateDryReply(raw);
        if (reply && bot && bot.player) {
          // 3s human typing delay
          setTimeout(() => {
            if (bot && bot.player) {
              console.log(`[Groq AI Reply] ${reply}\n`);
              addLog('AI', reply);
              bot.chat(reply);
              botState.aiRepliesSent++;
            }
          }, 3000);
        }
      }

    } catch (e) {
      console.log(`[Chat Error]`, e.message);
    }
  });

  bot.on('kicked', (reason) => {
    stopJokeLoop();
    const kickText = String(parseText(reason) || '').trim();
    botState.lastKickReason = kickText;
    console.log(`\n[Bot] Kicked from server.`);
    console.log(`----------------------------------------`);
    console.log(kickText);
    console.log(`----------------------------------------\n`);
    addLog('SYSTEM', `Kicked from server: ${kickText}`);

    const lower = kickText.toLowerCase();

    // 1. Anti-Bot First Join Challenge: "Connection verified. Please rejoin to continue."
    if (lower.includes('connection verified') || lower.includes('please rejoin') || lower.includes('rejoin to continue')) {
      nextReconnectDelay = 3000; // Rejoin immediately in 3 seconds to complete verification!
      console.log(`[Verification Challenge] Server requested immediate rejoin to complete verification! Reconnecting in 3s...`);
      addLog('SYSTEM', 'Verification challenge passed! Rejoining in 3s...');
    }
    // 2. Short wait requested: "Please wait a few seconds before trying to verify again"
    else if (lower.includes('few seconds')) {
      nextReconnectDelay = 12000; // 12 seconds
      console.log(`[ASH GUARD Challenge] Waiting 12 seconds before re-verifying...`);
      addLog('SYSTEM', 'Waiting 12 seconds before re-verifying...');
    }
    // 3. Server restart / reboot
    else if (lower.includes('restart') || lower.includes('reboot') || lower.includes('server closed')) {
      nextReconnectDelay = CONFIG.restartReconnectDelay;
      console.log(`[Server Restart Detected] Server is rebooting. Waiting 45s for it to finish booting up...`);
      addLog('SYSTEM', 'Server reboot detected. Waiting 45s...');
    }
    // 4. IP Denied
    else if (lower.includes('denied from entering') || lower.includes('few minutes')) {
      nextReconnectDelay = CONFIG.deniedReconnectDelay;
      console.log(`[ASH GUARD Active] Temporary rate limit. Pausing ${CONFIG.deniedReconnectDelay / 60000} mins.`);
      addLog('SYSTEM', `Ash Guard active. Pausing ${CONFIG.deniedReconnectDelay / 60000} mins.`);
    } else {
      nextReconnectDelay = CONFIG.defaultReconnectDelay;
    }
  });

  bot.on('error', (err) => {
    stopJokeLoop();
    console.error(`\n[Bot] Connection error:`, err.message || err);
    addLog('SYSTEM', `Error: ${err.message || err}`);
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      nextReconnectDelay = CONFIG.restartReconnectDelay;
      console.log(`[Server Offline] Server port unreachable. It may be restarting. Waiting 45s...`);
    }
  });

  bot.on('end', () => {
    stopJokeLoop();
    botState.connected = false;
    botState.status = 'Disconnected';
    botState.reconnectCount++;

    const waitSeconds = Math.round(nextReconnectDelay / 1000);
    console.log(`\n[Bot] Disconnected. Reconnecting in ${waitSeconds}s (Total reconnects: ${botState.reconnectCount})...`);
    addLog('SYSTEM', `Disconnected. Reconnecting in ${waitSeconds}s...`);

    let remaining = waitSeconds;
    const countdown = setInterval(() => {
      remaining -= 5;
      if (remaining > 0) {
        console.log(`[Bot] Reconnecting in ${remaining}s...`);
      } else {
        clearInterval(countdown);
      }
    }, 5000);

    reconnectTimer = setTimeout(() => {
      clearInterval(countdown);
      startBot();
    }, nextReconnectDelay);
  });
}

// Global process error catch
process.on('uncaughtException', (err) => {
  console.error('[Process Error]', err.message);
});

startBot();
