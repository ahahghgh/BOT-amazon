const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const TELEGRAM_TOKEN = '9000118537:AAF6FFH6Ry3HgfVdm2TCH-sl35DwFTSMmIE';
const MY_CHAT_ID = 'INSERISCI_QUI_IL_TUO_ID'; // Metti qui il tuo ID numerico
const INTERVALLO_MINUTI = 30;

let RICERCHE = [
  { nome: 'RTX 5060 / 5060 Ti', query: 'RTX 5060', minPrezzo: 250, maxPrezzo: 430 },
  { nome: 'RX 9060 / 9060 XT', query: 'RX 9060', minPrezzo: 230, maxPrezzo: 400 },
  { nome: 'RTX 5070', query: 'RTX 5070', minPrezzo: 450, maxPrezzo: 610 },
  { nome: 'RX 9070 / 9070 XT', query: 'RX 9070', minPrezzo: 450, maxPrezzo: 650 },
  { nome: 'Ryzen 7 7800X3D', query: 'Ryzen 7 7800X3D', minPrezzo: 280, maxPrezzo: 410 },
  { nome: 'RAM DDR5 32GB', query: 'DDR5 32GB 6000', minPrezzo: 70, maxPrezzo: 115 },
  { nome: 'Scheda Madre B650', query: 'B650 AM5', minPrezzo: 100, maxPrezzo: 175 },
  { nome: 'Scheda Madre B850', query: 'B850 AM5', minPrezzo: 130, maxPrezzo: 210 }
];

const PAESI = [
  { codice: 'IT 🇮🇹', dominio: 'amazon.it' },
  { codice: 'DE 🇩🇪', dominio: 'amazon.de' },
  { codice: 'FR 🇫🇷', dominio: 'amazon.fr' },
  { codice: 'ES 🇪🇸', dominio: 'amazon.es' }
];

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const DB_FILE = './storico_prezzi.json';
let storico = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : {};
let scansioneInCorso = false;

function salvaStorico() {
  fs.writeFileSync(DB_FILE, JSON.stringify(storico, null, 2));
}

function pulisciPrezzo(testoPrezzo) {
  if (!testoPrezzo) return null;
  const pulito = testoPrezzo.replace(/[^\d,\.]/g, '').replace(/\./g, '').replace(',', '.');
  const num = parseFloat(pulito);
  return isNaN(num) ? null : num;
}

const pausa = (ms) => new Promise(res => setTimeout(res, ms));

async function scansionaAmazon() {
  if (scansioneInCorso) return;
  scansioneInCorso = true;
  console.log(`[${new Date().toLocaleTimeString()}] Avvio scansione leggera...`);

  for (const ricerca of RICERCHE) {
    for (const paese of PAESI) {
      try {
        const url = `https://www.${paese.dominio}/s?k=${encodeURIComponent(ricerca.query)}&s=price-asc-rank`;
        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
        };
        
        const response = await axios.get(url, { headers, timeout: 15000 });
        const $ = cheerio.load(response.data);
        
        const prodotti = [];
        $('div[data-component-type="s-search-result"]').each((i, el) => {
          if (i >= 8) return false;
          const asin = $(el).attr('data-asin');
          const titolo = $(el).find('h2 a span').first().text().trim() || $(el).find('h2 span').first().text().trim();
          const prezzoIntero = $(el).find('.a-price-whole').first().text().trim();
          const prezzoDecimale = $(el).find('.a-price-fraction').first().text().trim();
          
          if (asin && titolo && prezzoIntero) {
            prodotti.push({ asin, titolo, prezzoRaw: `${prezzoIntero}${prezzoDecimale || '00'}` });
          }
        });

        for (const p of prodotti) {
          const prezzo = pulisciPrezzo(p.prezzoRaw);
          if (!prezzo) continue;

          if (prezzo >= ricerca.minPrezzo && prezzo <= ricerca.maxPrezzo) {
            const chiaveUnica = `${paese.dominio}_${p.asin}`;
            const vecchioPrezzo = storico[chiaveUnica];

            if (!vecchioPrezzo || prezzo < vecchioPrezzo - 3) {
              storico[chiaveUnica] = prezzo;
              salvaStorico();

              const linkDiretto = `https://www.${paese.dominio}/dp/${p.asin}`;
              const msg = `🔥 **OFFERTA TROVATA (${paese.codice})**\n\n` +
                          `📦 **Categoria:** ${ricerca.nome}\n` +
                          `📝 **Prodotto:** ${p.titolo.substring(0, 100)}...\n` +
                          `💰 **Prezzo:** **${prezzo.toFixed(2)} €**` +
                          (vecchioPrezzo ? ` *(era ${vecchioPrezzo.toFixed(2)} €)*` : '') + `\n` +
                          `🔗 [Apri su Amazon](${linkDiretto})`;

              try {
                await bot.sendMessage(MY_CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
              } catch (e) {
                console.error("Errore invio Telegram:", e.message);
              }
              await pausa(2000);
            }
          }
        }
        await pausa(3000);
      } catch (err) {
        console.log(`Errore su ${paese.dominio} per ${ricerca.query}: ${err.message}`);
      }
    }
  }
  scansioneInCorso = false;
  console.log(`[${new Date().toLocaleTimeString()}] Scansione completata.`);
}

bot.onText(/\/start/, (msg) => {
  if (msg.chat.id.toString() !== MY_CHAT_ID) return;
  bot.sendMessage(MY_CHAT_ID, "🤖 Bot Amazon leggero attivo!", { parse_mode: 'Markdown' });
});

scansionaAmazon();
setInterval(scansionaAmazon, INTERVALLO_MINUTI * 60 * 1000);
