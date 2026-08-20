require('dotenv').config();
const { createBot } = require('./bot');
const { loadConfig } = require('./config');
const { startPolling } = require('./poller');

async function main() {
  const required = [
    'BOT_TOKEN',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'CONFIG_SPREADSHEET_ID',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Не заданы переменные окружения:', missing.join(', '));
    process.exit(1);
  }

  const clients = await loadConfig();
  console.log(`Конфиг загружен: ${clients.length} клиент(ов)`);

  const bot = createBot();
  startPolling(bot);

  bot.catch((err) => console.error('Bot error:', err.error?.message || err));
  await bot.start();
}

main();
