import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { processMessage } from './gemini.js';

// Fila de mensagens para evitar respostas múltiplas (Debounce)
const userQueues = new Map();

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,      // Mata o erro 515 (não sincroniza passado)
        markOnlineOnConnect: true,   // Mantém o bot Online sempre que conectar
        connectTimeoutMs: 20000,
        defaultQueryTimeoutMs: 0,
        retryRequestDelayMs: 5000,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 5000);
        } else if (connection === 'open') {
            console.log('✅ CONECTADO');
        }
    });

    socket.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us')) return;

        const remoteJid = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        let mediaBuffer = null;
        let mimeType = null;

        // Processamento de Mídia com Logs
        if (messageType === 'imageMessage') {
            console.log(`📸 Imagem recebida de ${remoteJid}`);
            mediaBuffer = await downloadMediaMessage(msg, 'buffer');
            mimeType = msg.message.imageMessage.mimetype;
            text = msg.message.imageMessage.caption || "Analise esta imagem";
        } else if (messageType === 'audioMessage') {
            console.log(`🎤 Áudio recebido de ${remoteJid}`);
            mediaBuffer = await downloadMediaMessage(msg, 'buffer');
            mimeType = msg.message.audioMessage.mimetype;
            text = "Transcreva e responda este áudio";
        }

        // LÓGICA DE ESPERA (DEBOUNCE)
        // Se o usuário mandar várias mensagens, vamos juntar tudo e responder uma vez só após 7 segundos de silêncio.
        if (!userQueues.has(remoteJid)) {
            userQueues.set(remoteJid, { text: "", media: null, mime: null, timeout: null });
        }

        const queue = userQueues.get(remoteJid);

        // Acumula o texto
        if (text) queue.text += " " + text;
        // Prioriza a última mídia enviada na rajada
        if (mediaBuffer) {
            queue.media = mediaBuffer;
            queue.mime = mimeType;
        }

        // Reinicia o cronômetro de espera (7 segundos)
        if (queue.timeout) clearTimeout(queue.timeout);

        queue.timeout = setTimeout(async () => {
            try {
                const finalData = userQueues.get(remoteJid);
                userQueues.delete(remoteJid);

                // IGNORAR SE NÃO HOUVER TEXTO NEM MÍDIA
                if (!finalData.text.trim() && !finalData.media) {
                    return;
                }

                await socket.sendPresenceUpdate('composing', remoteJid);

                console.log(`🤖 Processando mensagens para ${remoteJid}...`);
                const response = await processMessage(finalData.text.trim(), finalData.media, finalData.mime);

                // DIVIDIR RESPOSTA EM PARTES SE HOUVER [BREAK]
                const parts = response.split('[BREAK]').map(p => p.trim()).filter(p => p.length > 0);

                for (let i = 0; i < parts.length; i++) {
                    await socket.sendPresenceUpdate('composing', remoteJid);
                    // Delay proporcional ao tamanho do texto (mín 1s, máx 4s)
                    const delay = Math.min(4000, Math.max(1000, parts[i].length * 20));
                    await new Promise(res => setTimeout(res, delay));
                    await socket.sendMessage(remoteJid, { text: parts[i] });
                    console.log(`📤 Parte ${i + 1}/${parts.length} enviada.`);
                }
            } catch (err) {
                console.log('Erro na fila:', err.message);
            }
        }, 7000);
    });
}

connectToWhatsApp();
