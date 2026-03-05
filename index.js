import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
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

    const socket = makeWASocket({
        auth: state,
        // Adicionar o browser ajuda a evitar o erro 405 Connection Failure
        browser: ['ChatZap', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' })
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
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Conexão aberta com sucesso!');
        }
    });

    socket.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        let mediaBuffer = null;
        let mimeType = null;

        try {
            // Se for imagem
            if (messageType === 'imageMessage') {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer');
                mimeType = msg.message.imageMessage.mimetype;
                text = msg.message.imageMessage.caption || "Descreva esta imagem";
            }
            // Se for áudio
            else if (messageType === 'audioMessage') {
                mediaBuffer = await downloadMediaMessage(msg, 'buffer');
                mimeType = msg.message.audioMessage.mimetype;
                text = "Transcreva e responda a este áudio";

                // Gemini aceita áudio nativamente se for em formato suportado (como MP3/OGG/AAC)
                // O WhatsApp costuma enviar em OGG/OPUS
            }

            // Mostrar que está "digitando..."
            await socket.presenceSubscribe(remoteJid);
            await socket.sendPresenceUpdate('composing', remoteJid);

            const response = await processMessage(text, mediaBuffer, mimeType);

            await socket.sendMessage(remoteJid, { text: response }, { quoted: msg });

            // Parar "digitando"
            await socket.sendPresenceUpdate('paused', remoteJid);

        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
            await socket.sendMessage(remoteJid, { text: "Ocorreu um erro ao processar sua solicitação." });
        }
    });
}

connectToWhatsApp();
