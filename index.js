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
import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';
import ffmpeg from 'ffmpeg-static';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Buscar a versão mais recente do WhatsApp para evitar erro 405
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Usando WhatsApp v${version.join('.')}, isLatest: ${isLatest}`);

    const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        // Navegador Linux costuma ser mais estável para containers
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        // Cabeçalhos que ajudam a simular web.whatsapp.com corretamente
        options: {
            headers: {
                'Origin': 'https://web.whatsapp.com',
                'Host': 'web.whatsapp.com'
            }
        }
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('----\nEscaneie o QR Code abaixo para conectar:\n----');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada devido a ', lastDisconnect.error, ', reconectando: ', shouldReconnect);
            if (shouldReconnect) {
                // Delay para evitar loop infinito rápido
                setTimeout(() => connectToWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            console.log('Conexão aberta com sucesso!');
        }
    });

    socket.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;

        // IGNORAR GRUPOS: Se o JID terminar com @g.us, o robô não faz nada
        if (remoteJid.endsWith('@g.us')) {
            return;
        }

        const messageType = Object.keys(msg.message)[0];

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        let mediaBuffer = null;
        let mimeType = null;

        try {
            if (messageType === 'imageMessage') {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer');
                mimeType = msg.message.imageMessage.mimetype;
                text = msg.message.imageMessage.caption || "Descreva esta imagem";
            }
            else if (messageType === 'audioMessage') {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer');
                mimeType = msg.message.audioMessage.mimetype;
                text = "Transcreva e responda a este áudio";
            }

            await socket.presenceSubscribe(remoteJid);
            await socket.sendPresenceUpdate('composing', remoteJid);

            const response = await processMessage(text, mediaBuffer, mimeType);

            await socket.sendMessage(remoteJid, { text: response }, { quoted: msg });
            await socket.sendPresenceUpdate('paused', remoteJid);

        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
            await socket.sendMessage(remoteJid, { text: "Ocorreu um erro ao processar sua solicitação." });
        }
    });
}

connectToWhatsApp();
