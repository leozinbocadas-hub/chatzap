import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq, { toFile as groqToFile } from "groq-sdk";
import OpenAI, { toFile as openaiToFile } from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = "Você é um assistente pessoal prestativo. Responda sempre em Português do Brasil (PT-BR). Seja conciso e amigável. IMPORTANTE: Use negrito (*) apenas em tópicos ou palavras-chave importantes. Sempre use APENAS UM asterisco para negrito (exemplo: *Tópico*). NUNCA use dois asteriscos (**).";

// Função para pegar chaves de uma string separada por vírgula
const getKeys = (envVar) => (envVar || "").split(",").map(k => k.trim()).filter(k => k);

const geminiKeys = getKeys(process.env.GEMINI_API_KEY);
const groqKeys = getKeys(process.env.GROQ_API_KEY);
const openaiKeys = getKeys(process.env.OPENAI_API_KEY);

function cleanWhatsAppText(text) {
    if (!text) return text;
    return text.replace(/\*\*(.*?)\*\*/g, '*$1*');
}

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    const isMedia = mediaBuffer !== null;
    const cleanMime = mimeType?.split(';')[0];

    // 1. RODÍZIO DE CHAVES GEMINI
    for (let i = 0; i < geminiKeys.length; i++) {
        try {
            console.log(`🧪 [GEMINI] Tentando chave ${i + 1} de ${geminiKeys.length}...`);
            const genAI = new GoogleGenerativeAI(geminiKeys[i]);
            const responseText = await processWithGemini(genAI, messageText, mediaBuffer, mimeType);
            console.log(`✅ Gemini (Chave ${i + 1}) respondeu.`);
            return cleanWhatsAppText(responseText);
        } catch (error) {
            console.log(`⚠️ Gemini (Chave ${i + 1}) falhou.`);
            if (i === geminiKeys.length - 1) console.log("❌ Todas as chaves Gemini esgotadas.");
        }
    }

    // 2. RODÍZIO DE CHAVES GROQ (Fallback)
    for (let i = 0; i < groqKeys.length; i++) {
        try {
            const groq = new Groq({ apiKey: groqKeys[i] });

            // Fallback ÁUDIO
            if (isMedia && cleanMime?.startsWith('audio/')) {
                console.log(`🔄 [GROQ] Áudio -> Whisper (Chave ${i + 1})...`);
                const transcription = await groq.audio.transcriptions.create({
                    file: await groqToFile(mediaBuffer, `audio.ogg`),
                    model: "whisper-large-v3",
                });
                const chatRes = await groq.chat.completions.create({
                    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Responda: ${transcription.text}` }],
                    model: "llama-3.1-8b-instant",
                });
                return cleanWhatsAppText(chatRes.choices[0]?.message?.content);
            }

            // Fallback IMAGEM
            if (isMedia && cleanMime?.startsWith('image/')) {
                console.log(`🔄 [GROQ] Imagem -> Vision (Chave ${i + 1})...`);
                const visionRes = await groq.chat.completions.create({
                    model: "llama-3.2-11b-vision-preview",
                    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: [{ type: "text", text: messageText || "Descreva" }, { type: "image_url", image_url: { url: `data:${cleanMime};base64,${mediaBuffer.toString("base64")}` } }] }]
                });
                return cleanWhatsAppText(visionRes.choices[0]?.message?.content);
            }

            // Fallback TEXTO
            if (!isMedia) {
                console.log(`🔄 [GROQ] Texto -> Llama (Chave ${i + 1})...`);
                const textRes = await groq.chat.completions.create({
                    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: messageText }],
                    model: "llama-3.1-8b-instant",
                });
                return cleanWhatsAppText(textRes.choices[0]?.message?.content);
            }
            break; // Se processou algo, sai do loop do Groq
        } catch (err) {
            console.log(`⚠️ Groq (Chave ${i + 1}) falhou.`);
        }
    }

    // 3. RODÍZIO DE CHAVES OPENAI (Último recurso)
    for (let i = 0; i < openaiKeys.length; i++) {
        try {
            console.log(`🔄 [OPENAI] Tentando chave ${i + 1}...`);
            const openai = new OpenAI({ apiKey: openaiKeys[i] });
            const res = await processWithOpenAI(openai, messageText, mediaBuffer, mimeType);
            if (res) return cleanWhatsAppText(res);
        } catch (e) {
            console.log(`⚠️ OpenAI (Chave ${i + 1}) falhou.`);
        }
    }

    return "⚠️ Todas as chaves de todas as APIs (Gemini, Groq e OpenAI) estão sem cota. Aguarde um momento.";
}

async function processWithGemini(genAI, messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", systemInstruction: SYSTEM_PROMPT });
    let promptParts = [messageText || "Analise esta mídia"];
    if (mediaBuffer && mimeType) {
        promptParts.push({ inlineData: { data: mediaBuffer.toString("base64"), mimeType: mimeType.split(';')[0] } });
    }
    const result = await model.generateContent(promptParts);
    return result.response.text();
}

async function processWithOpenAI(openai, messageText, mediaBuffer, mimeType) {
    const cleanMime = mimeType?.split(';')[0];
    if (cleanMime?.startsWith('image/')) {
        const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: [{ type: "text", text: messageText || "Descreva" }, { type: "image_url", image_url: { url: `data:${cleanMime};base64,${mediaBuffer.toString("base64")}` } }] }]
        });
        return res.choices[0]?.message?.content;
    }
    if (cleanMime?.startsWith('audio/')) {
        const trans = await openai.audio.transcriptions.create({ file: await openaiToFile(mediaBuffer, `audio.ogg`), model: "whisper-1" });
        const res = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Responda: ${trans.text}` }] });
        return res.choices[0]?.message?.content;
    }
    const res = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: messageText }] });
    return res.choices[0]?.message?.content;
}
