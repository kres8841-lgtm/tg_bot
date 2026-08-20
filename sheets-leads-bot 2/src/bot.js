const { Bot } = require('grammy');
const { readSheet } = require('./sheets');
const {
  loadConfig,
  getClients,
  findByChatId,
  addClient,
  disableClientByChatId,
  setTemplateByChatId,
} = require('./config');
const { renderLead, MARKER_HEADER } = require('./poller');

function isAdmin(ctx) {
  const admins = String(process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim());
  return admins.includes(String(ctx.from?.id));
}

function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN);

  // /bind <spreadsheet_id> <имя листа> [название клиента]
  // Пишется прямо в группе клиента — chat_id берётся из неё
  bot.command('bind', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.match.trim().split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply(
        'Формат: /bind <spreadsheet_id> <имя_листа> [название]\n' +
          'Пример: /bind 1AbC...xyz Лист1 Клиент_Киев'
      );
    }
    const [spreadsheetId, sheetName, ...labelParts] = parts;
    const label = labelParts.join(' ') || ctx.chat.title || '';

    // Проверяем доступ к таблице сразу
    try {
      await readSheet(spreadsheetId, sheetName);
    } catch (err) {
      return ctx.reply(
        `Не могу прочитать таблицу: ${err.message}\n` +
          `Проверь, что таблица расшарена на ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} и имя листа верное.`
      );
    }

    await addClient({ spreadsheetId, sheetName, chatId: ctx.chat.id, label });
    await ctx.reply(
      `✅ Привязано: «${label}»\nЛист: ${sheetName}\nНовые заявки будут приходить сюда.`
    );
  });

  // /unbind — отключить выгрузку в эту группу
  bot.command('unbind', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const ok = await disableClientByChatId(ctx.chat.id);
    await ctx.reply(ok ? '⏸ Выгрузка в эту группу отключена.' : 'Эта группа ни к чему не привязана.');
  });

  // /leads [N] — последние N заявок из привязанной таблицы (по умолчанию 5)
  bot.command('leads', async (ctx) => {
    const client = findByChatId(ctx.chat.id);
    if (!client) return ctx.reply('Эта группа не привязана к таблице. Привязка: /bind');

    const n = Math.min(Number(ctx.match.trim()) || 5, 20);
    const rows = await readSheet(client.spreadsheetId, client.sheetName);
    if (rows.length < 2) return ctx.reply('В таблице пока нет заявок.');

    const headers = rows[0];
    const markerIdx = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === MARKER_HEADER
    );
    const dataRows = rows
      .slice(1)
      .filter((r) => r && r.some((v, i) => i !== markerIdx && String(v || '').trim() !== ''));
    const last = dataRows.slice(-n);

    const blocks = last.map(
      (r, i) =>
        `<b>#${dataRows.length - last.length + i + 1}</b>\n` +
        renderLead(client.template, headers, r, markerIdx)
    );
    await ctx.reply(`Последние ${last.length} заявок:\n\n${blocks.join('\n\n———\n\n')}`, {
      parse_mode: 'HTML',
    });
  });

  // /rows <N> или /rows <N>-<M> — выгрузить строки таблицы по номерам
  // Номера — как в самой гугл-таблице (строка 1 — заголовки, лиды со 2-й)
  bot.command('rows', async (ctx) => {
    const client = findByChatId(ctx.chat.id);
    if (!client) return ctx.reply('Эта группа не привязана к таблице. Привязка: /bind');

    const m = ctx.match.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) {
      return ctx.reply('Формат: /rows 50 (с 50-й строки до конца) или /rows 50-70 (диапазон)');
    }
    const from = Number(m[1]);
    const rows = await readSheet(client.spreadsheetId, client.sheetName);
    const to = Math.min(m[2] ? Number(m[2]) : rows.length, rows.length);

    if (from < 2 || from > rows.length) {
      return ctx.reply(`В таблице сейчас ${rows.length} строк (заявки со 2-й).`);
    }

    const headers = rows[0];
    const markerIdx = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === MARKER_HEADER
    );

    const blocks = [];
    for (let i = from - 1; i <= to - 1; i++) {
      const r = rows[i] || [];
      const hasData = r.some((v, idx) => idx !== markerIdx && String(v || '').trim() !== '');
      if (!hasData) continue;
      blocks.push(`<b>Строка ${i + 1}</b>\n` + renderLead(client.template, headers, r, markerIdx));
    }
    if (!blocks.length) return ctx.reply('В этом диапазоне нет заполненных строк.');

    // Telegram ограничивает сообщение 4096 символами — режем на части
    let chunk = `Строки ${from}–${to}:\n\n`;
    for (const b of blocks) {
      if (chunk.length + b.length > 3800) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
        chunk = '';
      }
      chunk += b + '\n\n———\n\n';
    }
    if (chunk.trim()) await ctx.reply(chunk, { parse_mode: 'HTML' });
  });

  // /template <текст> — задать формат сообщения для этой группы
  // Плейсхолдеры: {A} {B} — колонки по буквам, {Имя} — по заголовку, {время} — дата и время
  // /template default — вернуть формат по умолчанию (все поля)
  bot.command('template', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const client = findByChatId(ctx.chat.id);
    if (!client) return ctx.reply('Эта группа не привязана к таблице. Привязка: /bind');

    const tpl = ctx.match.trim();
    if (!tpl) {
      return ctx.reply(
        'Формат: /template Имя {A}, тел {B}, получено {время}\n\n' +
          'Плейсхолдеры: {A}, {B}… — колонки по буквам; {Заголовок} — по названию колонки; ' +
          '{время} — дата и время получения; \\n — перенос строки.\n' +
          'Сброс: /template default\n\n' +
          `Текущий шаблон: ${client.template || '(по умолчанию — все поля)'}`
      );
    }

    const value = tpl.toLowerCase() === 'default' ? '' : tpl;
    await setTemplateByChatId(ctx.chat.id, value);

    // Предпросмотр на последней заявке из таблицы
    const rows = await readSheet(client.spreadsheetId, client.sheetName);
    const headers = rows[0] || [];
    const markerIdx = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === MARKER_HEADER
    );
    const lastRow = [...rows.slice(1)]
      .reverse()
      .find((r) => r && r.some((v, i) => i !== markerIdx && String(v || '').trim() !== ''));

    let msg = '✅ Шаблон сохранён.';
    if (lastRow) {
      msg += `\n\nТак будет выглядеть заявка:\n\n${renderLead(value, headers, lastRow, markerIdx)}`;
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // /reload — перечитать конфиг-таблицу
  bot.command('reload', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const clients = await loadConfig();
    await ctx.reply(`Конфиг перечитан. Активных клиентов: ${clients.filter((c) => c.enabled).length}`);
  });

  // /status — сводка по всем клиентам (только в личке бота)
  bot.command('status', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const clients = getClients();
    if (!clients.length) return ctx.reply('Конфиг пуст.');
    const lines = clients.map(
      (c) => `${c.enabled ? '🟢' : '⚪️'} ${c.label} — лист «${c.sheetName}» → chat ${c.chatId}`
    );
    await ctx.reply(lines.join('\n'));
  });

  // /id — узнать chat_id группы (полезно для ручного заполнения конфига)
  bot.command('id', async (ctx) => {
    await ctx.reply(`chat_id: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
  });

  return bot;
}

module.exports = { createBot };
