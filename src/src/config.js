const { readSheet, appendRow, writeCell, colLetter } = require('./sheets');

const CONFIG_ID = () => process.env.CONFIG_SPREADSHEET_ID;
const CONFIG_SHEET = 'config';

// Колонки мастер-таблицы (лист "config"), строка 1 — заголовки:
// spreadsheet_id | sheet_name | chat_id | label | template | enabled
//
// label    — название клиента, для /status и логов
// template — текст сообщения с плейсхолдерами {Заголовок колонки}. Пусто = все поля подряд
// enabled  — TRUE/FALSE (или 1/0, да/нет)

let cache = [];

function isEnabled(v) {
  const s = String(v || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'да', 'y', 'on'].includes(s);
}

async function loadConfig() {
  const rows = await readSheet(CONFIG_ID(), CONFIG_SHEET);
  if (!rows.length) {
    cache = [];
    return cache;
  }
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const idx = (name) => headers.indexOf(name);

  const clients = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[idx('spreadsheet_id')]) continue;
    clients.push({
      rowNumber: i + 1, // строка в конфиг-таблице (1-based)
      spreadsheetId: String(r[idx('spreadsheet_id')]).trim(),
      sheetName: String(r[idx('sheet_name')] || 'Sheet1').trim(),
      chatId: String(r[idx('chat_id')] || '').trim(),
      label: String(r[idx('label')] || `client ${i}`).trim(),
      template: String(r[idx('template')] || '').trim(),
      enabled: isEnabled(r[idx('enabled')]),
    });
  }
  cache = clients;
  return cache;
}

function getClients() {
  return cache;
}

function findByChatId(chatId) {
  return cache.find((c) => String(c.chatId) === String(chatId));
}

// Добавить клиента из /bind — дописывает строку в конфиг-таблицу
async function addClient({ spreadsheetId, sheetName, chatId, label }) {
  await appendRow(CONFIG_ID(), CONFIG_SHEET, [
    spreadsheetId,
    sheetName,
    String(chatId),
    label || '',
    '',
    'TRUE',
  ]);
  await loadConfig();
}

// Выключить клиента из /unbind — ставит enabled = FALSE
async function disableClientByChatId(chatId) {
  const client = findByChatId(chatId);
  if (!client) return false;
  // enabled — 6-я колонка (F) при стандартной раскладке
  const rows = await readSheet(CONFIG_ID(), CONFIG_SHEET);
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const enabledCol = headers.indexOf('enabled');
  if (enabledCol === -1) return false;
  await writeCell(
    CONFIG_ID(),
    CONFIG_SHEET,
    `${colLetter(enabledCol)}${client.rowNumber}`,
    'FALSE'
  );
  await loadConfig();
  return true;
}

// Изменить шаблон сообщения для группы — пишет в колонку template конфиг-таблицы
async function setTemplateByChatId(chatId, template) {
  const client = findByChatId(chatId);
  if (!client) return false;
  const rows = await readSheet(CONFIG_ID(), CONFIG_SHEET);
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const tplCol = headers.indexOf('template');
  if (tplCol === -1) return false;
  await writeCell(
    CONFIG_ID(),
    CONFIG_SHEET,
    `${colLetter(tplCol)}${client.rowNumber}`,
    template
  );
  await loadConfig();
  return true;
}

module.exports = { loadConfig, getClients, findByChatId, addClient, disableClientByChatId, setTemplateByChatId };
