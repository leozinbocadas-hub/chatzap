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

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();


    const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),

        // CONFIGURAÇÕES CRÍTICAS PARA EVITAR ERRO 515
        syncFullHistory: false,      // Mata o erro 515 (não sincroniza passado)
        markOnlineOnConnect: false,  // Mais estável
        connectTimeoutMs: 20000,
        defaultQueryTimeoutMs: 0,    // Evita timeout em queries
        retryRequestDelayMs: 5000,   // Tenta novamente se falhar
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('----\nEscaneie o QR Code abaixo:\n----');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 5000);
            }

        } else if (connection === 'open') {
            console.log('✅ BOT CONECTADO COM SUCESSO!');
        }
    });

    socket.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        // Ignora: se não for mensagem, se for minha ou se for grupo
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.endsWith('@g.us')) return;

        const remoteJid = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        let mediaBuffer = null;
        let mimeType = null;

        try {
            // Se for mídia, baixa e define o prompt
            if (messageType === 'imageMessage') {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer');
                mimeType = msg.message.imageMessage.mimetype;
                text = msg.message.imageMessage.caption || "Analise esta imagem";
            } else if (messageType === 'audioMessage') {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer');
                mimeType = msg.message.audioMessage.mimetype;
                text = "Transcreva este áudio e responda";
            }

            // Mostra que está digitando
            await socket.sendPresenceUpdate('composing', remoteJid);

            // Pede a resposta para as APIs (Sistema de Rodízio)
            const response = await processMessage(text, mediaBuffer, mimeType);

            // Espera 5 segundos para simular a digitação humana
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Envia a resposta Final
            await socket.sendMessage(remoteJid, { text: response });
        } catch (err) {
            // Silencioso
        }

    });
}

connectToWhatsApp();
