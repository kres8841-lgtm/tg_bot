const { google } = require('googleapis');

let sheetsClient = null;

function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// Читает весь лист (значения как строки)
async function readSheet(spreadsheetId, sheetName) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}

// Пишет одну ячейку
async function writeCell(spreadsheetId, sheetName, cellA1, value) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!${cellA1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

// Добавляет строку в конец листа
async function appendRow(spreadsheetId, sheetName, row) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Номер колонки (0-based) -> буква A1 (0 -> A, 25 -> Z, 26 -> AA)
function colLetter(n) {
  let s = '';
  n = n + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

module.exports = { readSheet, writeCell, appendRow, colLetter };
