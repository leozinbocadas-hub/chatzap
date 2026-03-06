import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq, { toFile as groqToFile } from "groq-sdk";
import OpenAI, { toFile as openaiToFile } from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = "Você é um assistente pessoal prestativo. Responda sempre em Português do Brasil (PT-BR). Seja conciso e amigável. IMPORTANTE: Use negrito (*) apenas em tópicos ou palavras-chave importantes. Sempre use APENAS UM asterisco para negrito (exemplo: *Tópico*). NUNCA use dois asteriscos (**).";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanWhatsAppText(text) {
    if (!text) return text;
    return text.replace(/\*\*(.*?)\*\*/g, '*$1*');
}

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    const isMedia = mediaBuffer !== null;
    let responseText = "";

    // 1. TENTATIVA COM GEMINI (Principal para tudo)
    try {
        responseText = await processWithGemini(messageText, mediaBuffer, mimeType);
        return cleanWhatsAppText(responseText);
    } catch (error) {
        console.log(`❌ Gemini fora de cota.`);
    }

    // 2. FALLBACK PARA ÁUDIO (GROQ WHISPER - Grátis e Rápido)
    const cleanMime = mimeType?.split(';')[0];
    if (isMedia && cleanMime?.startsWith('audio/')) {
        try {
            console.log(`🔄 [FALLBACK AUDIO] Usando Groq Whisper (Grátis)...`);
            const groqTranscription = await groq.audio.transcriptions.create({
                file: await groqToFile(mediaBuffer, `audio.ogg`),
                model: "whisper-large-v3",
            });

            const textResult = groqTranscription.text;
            console.log(`🎤 Groq transcreveu: "${textResult}"`);

            // Agora pede para o Groq responder o texto transcrito
            const chatRes = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: `O usuário enviou um áudio que diz: "${textResult}". Responda de forma adequada.` }
                ],
                model: "llama-3.1-8b-instant",
            });
            return cleanWhatsAppText(chatRes.choices[0]?.message?.content);
        } catch (err) {
            console.log(`❌ Groq Whisper também falhou.`);
        }
    }

    // 3. FALLBACK PARA OPENAI (Se as anteriores falharem e você tiver créditos)
    if (isMedia) {
        try {
            console.log(`🔄 [FALLBACK MIDIA] Tentando OpenAI como última opção...`);
            const itWorked = await processWithOpenAI(messageText, mediaBuffer, mimeType);
            if (itWorked) return cleanWhatsAppText(itWorked);
        } catch (error) {
            console.log(`❌ OpenAI também falhou.`);
        }
    } else {
        // Se for só Texto, tenta Groq e então OpenAI
        try {
            const response = await groq.chat.completions.create({
                messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: messageText }],
                model: "llama-3.1-8b-instant",
            });
            return cleanWhatsAppText(response.choices[0]?.message?.content);
        } catch (e) {
            try {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: messageText }],
                });
                return cleanWhatsAppText(response.choices[0]?.message?.content);
            } catch (e2) { }
        }
    }

    return "⚠️ Todas as minhas APIs atingiram o limite simultaneamente (Gemini, Groq e OpenAI). Por favor, aguarde 1 minuto e tente novamente.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", systemInstruction: SYSTEM_PROMPT });
    let promptParts = [messageText || "O que tem nesta mídia?"];
    if (mediaBuffer && mimeType) {
        promptParts.push({ inlineData: { data: mediaBuffer.toString("base64"), mimeType: mimeType.split(';')[0] } });
    }
    const result = await model.generateContent(promptParts);
    return result.response.text();
}

async function processWithOpenAI(messageText, mediaBuffer, mimeType) {
    if (!process.env.OPENAI_API_KEY) return null;
    const cleanMime = mimeType?.split(';')[0];
    if (cleanMime?.startsWith('image/')) {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: [{ type: "text", text: messageText || "Descreva" }, { type: "image_url", image_url: { url: `data:${cleanMime};base64,${mediaBuffer.toString("base64")}` } }] }]
        });
        return response.choices[0]?.message?.content;
    }
    if (cleanMime?.startsWith('audio/')) {
        const transcription = await openai.audio.transcriptions.create({
            file: await openaiToFile(mediaBuffer, `audio.ogg`),
            model: "whisper-1",
        });
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Responda a isso: ${transcription.text}` }]
        });
        return response.choices[0]?.message?.content;
    }
    return null;
}
