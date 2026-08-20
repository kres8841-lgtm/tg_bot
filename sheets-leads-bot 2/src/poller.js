const { readSheet, writeCell, colLetter } = require('./sheets');
const { getClients } = require('./config');

const MARKER_HEADER = 'tg_sent';

// {A} / {AB} -> индекс колонки по букве
function letterToIdx(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Рендер шаблона. Плейсхолдеры:
//   {Имя}    — значение из колонки с заголовком "Имя"
//   {A} {B}  — значение из колонки по букве, как в таблице
//   {время} / {time} — текущие дата и время (Киев)
// \n в шаблоне превращается в перенос строки.
// Пустой шаблон -> все непустые поля списком "Заголовок: значение"
function renderLead(template, headers, row, markerIdx) {
  if (template) {
    return template.replace(/\\n/g, '\n').replace(/\{([^}]+)\}/g, (_, name) => {
      const key = name.trim();
      const low = key.toLowerCase();
      if (['время', 'time', 'час', 'дата'].includes(low)) {
        return new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
      }
      const i = headers.findIndex(
        (h) => String(h).trim().toLowerCase() === low
      );
      if (i >= 0) return String(row[i] ?? '');
      if (/^[A-Z]{1,2}$/i.test(key)) {
        return String(row[letterToIdx(key.toUpperCase())] ?? '');
      }
      return '';
    });
  }
  const lines = [];
  headers.forEach((h, i) => {
    if (i === markerIdx) return;
    const val = row[i];
    if (h && val !== undefined && String(val).trim() !== '') {
      lines.push(`<b>${escapeHtml(String(h))}:</b> ${escapeHtml(String(val))}`);
    }
  });
  return lines.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Обрабатывает одну таблицу клиента: находит строки без отметки, шлёт, ставит отметку
async function processClient(bot, client) {
  const rows = await readSheet(client.spreadsheetId, client.sheetName);
  if (rows.length < 1) return;

  const headers = rows[0];
  let markerIdx = headers.findIndex(
    (h) => String(h).trim().toLowerCase() === MARKER_HEADER
  );

  // Служебной колонки нет — создаём заголовок в первой свободной колонке
  if (markerIdx === -1) {
    markerIdx = headers.length;
    await writeCell(
      client.spreadsheetId,
      client.sheetName,
      `${colLetter(markerIdx)}1`,
      MARKER_HEADER
    );
    headers[markerIdx] = MARKER_HEADER;
    // Помечаем все существующие строки как отправленные, чтобы при первом
    // подключении не вывалить в группу всю историю. Убери этот блок, если
    // наоборот нужно выгрузить всё что есть.
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i].some((v) => String(v || '').trim() !== '')) {
        await writeCell(
          client.spreadsheetId,
          client.sheetName,
          `${colLetter(markerIdx)}${i + 1}`,
          'init'
        );
      }
    }
    return;
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const hasData = row.some((v, idx) => idx !== markerIdx && String(v || '').trim() !== '');
    const alreadySent = String(row[markerIdx] || '').trim() !== '';
    if (!hasData || alreadySent) continue;

    const text = renderLead(client.template, headers, row, markerIdx);
    if (!text.trim()) continue;

    try {
      await bot.api.sendMessage(client.chatId, `🔥 <b>Новая заявка</b>\n\n${text}`, {
        parse_mode: 'HTML',
      });
      await writeCell(
        client.spreadsheetId,
        client.sheetName,
        `${colLetter(markerIdx)}${i + 1}`,
        new Date().toISOString()
      );
    } catch (err) {
      console.error(`[${client.label}] send failed:`, err.message);
      // отметку не ставим — попробует снова на следующем цикле
    }
  }
}

function startPolling(bot) {
  const interval = (Number(process.env.POLL_INTERVAL) || 45) * 1000;
  let running = false;

  setInterval(async () => {
    if (running) return; // не наслаиваем циклы
    running = true;
    for (const client of getClients()) {
      if (!client.enabled || !client.chatId) continue;
      try {
        await processClient(bot, client);
      } catch (err) {
        console.error(`[${client.label}] poll error:`, err.message);
      }
    }
    running = false;
  }, interval);

  console.log(`Polling started, every ${interval / 1000}s`);
}

module.exports = { startPolling, renderLead, MARKER_HEADER };
