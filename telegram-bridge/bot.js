const TelegramBot = require('node-telegram-bot-api');
const { spawn, execSync } = require('child_process');
const path = require('path');

// === НАСТРОЙКИ ===
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = parseInt(process.env.TELEGRAM_OWNER_ID || '0');
if (!BOT_TOKEN) { console.error('Set TELEGRAM_BOT_TOKEN env var'); process.exit(1); }
const PROJECT_DIR = path.resolve(__dirname, '..');
const MAX_MESSAGE_LENGTH = 4000;

// === СОСТОЯНИЕ ===
let isRunning = false;
let currentTask = null;
let queue = [];
let history = [];
let sessionMode = 'new';      // 'new' | 'continue' | 'resume'
let resumeSessionId = null;    // ID сессии для resume
let lastSessionId = null;      // ID последней сессии от бота

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 LeadDrive Telegram Bridge запущен');
console.log(`📂 Рабочая директория: ${PROJECT_DIR}`);

function isOwner(msg) {
  return msg.from.id === OWNER_ID;
}

async function sendLong(chatId, text) {
  if (!text || text.trim() === '') {
    await bot.sendMessage(chatId, '✅ Выполнено (пустой вывод)');
    return;
  }
  text = text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  if (text.length <= MAX_MESSAGE_LENGTH) {
    await bot.sendMessage(chatId, text);
    return;
  }

  const chunks = [];
  for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
    chunks.push(text.substring(i, i + MAX_MESSAGE_LENGTH));
  }
  for (let i = 0; i < Math.min(chunks.length, 5); i++) {
    await bot.sendMessage(chatId, `📄 [${i + 1}/${chunks.length}]\n${chunks[i]}`);
  }
  if (chunks.length > 5) {
    await bot.sendMessage(chatId, `⚠️ Вывод слишком длинный (${chunks.length} частей). Показаны первые 5.`);
  }
}

// Получить список сессий Claude Code
function getClaudeSessions() {
  try {
    const output = execSync('claude sessions list --json 2>/dev/null || claude conversations list --json 2>/dev/null || echo "[]"', {
      cwd: PROJECT_DIR,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 10000
    }).toString().trim();
    return JSON.parse(output || '[]');
  } catch {
    return [];
  }
}

// Запуск Claude Code с разными режимами сессий
function runClaude(task, chatId) {
  return new Promise((resolve) => {
    isRunning = true;
    currentTask = task;

    // Собираем аргументы в зависимости от режима
    let args = ['-p', '--model', 'opus'];

    if (sessionMode === 'continue') {
      args.push('--continue');
    } else if (sessionMode === 'resume' && resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    args.push(task);

    const claude = spawn('claude', args, {
      cwd: PROJECT_DIR,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 600000
    });

    let output = '';
    let errorOutput = '';

    claude.stdout.on('data', (data) => {
      output += data.toString();
    });

    claude.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    claude.on('close', (code) => {
      isRunning = false;
      currentTask = null;

      // После первого сообщения переключаемся на continue
      // чтобы следующие сообщения шли в ту же сессию
      if (sessionMode === 'new') {
        sessionMode = 'continue';
      }

      if (code === 0) {
        resolve({ success: true, output: output || errorOutput });
      } else {
        resolve({ success: false, output: errorOutput || output || `Процесс завершился с кодом ${code}` });
      }
    });

    claude.on('error', (err) => {
      isRunning = false;
      currentTask = null;
      resolve({ success: false, output: `Ошибка запуска: ${err.message}` });
    });
  });
}

async function processQueue(chatId) {
  while (queue.length > 0) {
    const task = queue.shift();
    await bot.sendMessage(chatId, `⏳ Выполняю: "${task}"\n\nОсталось в очереди: ${queue.length}`);
    const result = await runClaude(task, chatId);
    const icon = result.success ? '✅' : '❌';
    history.push({ task, success: result.success, output: result.output, time: Date.now() });
    if (history.length > 10) history.shift();
    await sendLong(chatId, `${icon} Задача: "${task}"\n\n${result.output}`);
  }
}

// === КОМАНДЫ ===

bot.onText(/\/start/, (msg) => {
  if (!isOwner(msg)) return;
  bot.sendMessage(msg.chat.id,
    `🚀 *LeadDrive Dev Bot*\n\n` +
    `Просто напиши задачу — я передам её Claude Code\\.\n\n` +
    `*Режимы сессий:*\n` +
    `/new — новая сессия \\(по умолчанию\\)\n` +
    `/c — продолжить последнюю сессию\n` +
    `/sessions — список сессий на маке\n\n` +
    `*Другие команды:*\n` +
    `/status — текущий статус\n` +
    `/last — последняя задача \\+ результат\n` +
    `/history — список последних 10 задач\n` +
    `/queue — очередь задач\n` +
    `/cancel — отменить очередь`,
    { parse_mode: 'MarkdownV2' }
  );
});

bot.onText(/\/status/, (msg) => {
  if (!isOwner(msg)) return;
  const modeLabel = sessionMode === 'new' ? '🆕 Новая сессия' :
                    sessionMode === 'continue' ? '🔄 Продолжение сессии' :
                    `📌 Сессия: ${resumeSessionId}`;
  if (isRunning) {
    bot.sendMessage(msg.chat.id, `⏳ Работаю над: "${currentTask}"\nРежим: ${modeLabel}\nВ очереди: ${queue.length}`);
  } else {
    bot.sendMessage(msg.chat.id, `😴 Свободен. Жду задачу.\nРежим: ${modeLabel}`);
  }
});

// Новая сессия
bot.onText(/\/new/, (msg) => {
  if (!isOwner(msg)) return;
  sessionMode = 'new';
  resumeSessionId = null;
  bot.sendMessage(msg.chat.id, '🆕 Режим: новая сессия. Следующее сообщение начнёт новую сессию, потом автоматически продолжит её.');
});

// Продолжить последнюю сессию
bot.onText(/\/c$/, (msg) => {
  if (!isOwner(msg)) return;
  sessionMode = 'continue';
  bot.sendMessage(msg.chat.id, '🔄 Режим: продолжение последней сессии Claude Code на маке.\nПросто напиши сообщение.');
});

// Список сессий
bot.onText(/\/sessions/, (msg) => {
  if (!isOwner(msg)) return;
  bot.sendMessage(msg.chat.id, '🔍 Получаю список сессий...');

  try {
    const output = execSync('claude sessions list 2>/dev/null || echo "Команда sessions не поддерживается в этой версии Claude Code. Используй /c для продолжения последней сессии."', {
      cwd: PROJECT_DIR,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 10000
    }).toString().trim().replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    bot.sendMessage(msg.chat.id, `📋 Сессии:\n\n${output}`);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Не удалось получить сессии: ${err.message}`);
  }
});

bot.onText(/\/queue/, (msg) => {
  if (!isOwner(msg)) return;
  if (queue.length === 0) {
    bot.sendMessage(msg.chat.id, '📭 Очередь пуста');
  } else {
    const list = queue.map((t, i) => `${i + 1}. ${t}`).join('\n');
    bot.sendMessage(msg.chat.id, `📋 Очередь:\n${list}`);
  }
});

bot.onText(/\/cancel/, (msg) => {
  if (!isOwner(msg)) return;
  queue = [];
  bot.sendMessage(msg.chat.id, '🛑 Очередь очищена. Текущая задача доработает до конца.');
});

bot.onText(/\/last/, (msg) => {
  if (!isOwner(msg)) return;
  if (history.length === 0) {
    bot.sendMessage(msg.chat.id, '📭 Истории нет. Ещё ни одной задачи не выполнялось.');
    return;
  }
  const last = history[history.length - 1];
  const icon = last.success ? '✅' : '❌';
  const time = new Date(last.time).toLocaleString('ru-RU', { timeZone: 'Asia/Baku' });
  const summary = last.output.length > 2000 ? last.output.substring(0, 2000) + '\n\n... (обрезано)' : last.output;
  bot.sendMessage(msg.chat.id, `${icon} Последняя задача:\n"${last.task}"\n\n🕐 ${time}\n\n${summary}`);
});

bot.onText(/\/history/, (msg) => {
  if (!isOwner(msg)) return;
  if (history.length === 0) {
    bot.sendMessage(msg.chat.id, '📭 Истории нет.');
    return;
  }
  const list = history.map((h, i) => {
    const icon = h.success ? '✅' : '❌';
    const time = new Date(h.time).toLocaleString('ru-RU', { timeZone: 'Asia/Baku' });
    return `${icon} ${i + 1}. "${h.task}" — ${time}`;
  }).join('\n');
  bot.sendMessage(msg.chat.id, `📋 История (последние ${history.length}):\n\n${list}\n\n/last — детали последней задачи`);
});

// === ОСНОВНОЙ ОБРАБОТЧИК ===

bot.on('message', async (msg) => {
  if (!isOwner(msg)) return;
  if (msg.text && msg.text.startsWith('/')) return;
  if (!msg.text) return;

  const task = msg.text.trim();
  if (!task) return;

  if (isRunning) {
    queue.push(task);
    bot.sendMessage(msg.chat.id,
      `📥 Добавлено в очередь (позиция: ${queue.length})\n` +
      `Текущая задача: "${currentTask}"`
    );
    return;
  }

  const modeLabel = sessionMode === 'new' ? '🆕 новая сессия' :
                    sessionMode === 'continue' ? '🔄 продолжение сессии' :
                    `📌 сессия ${resumeSessionId}`;

  await bot.sendMessage(msg.chat.id, `⏳ Принял! (${modeLabel})\nЗадача: "${task}"\n\nЭто может занять несколько минут...`);

  const result = await runClaude(task, msg.chat.id);
  const icon = result.success ? '✅' : '❌';

  history.push({ task, success: result.success, output: result.output, time: Date.now() });
  if (history.length > 10) history.shift();

  await sendLong(msg.chat.id, `${icon} Задача: "${task}"\n\n${result.output}`);

  if (queue.length > 0) {
    await processQueue(msg.chat.id);
  }
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

console.log('✅ Бот слушает сообщения...');
