import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq, { toFile as groqToFile } from "groq-sdk";
import OpenAI, { toFile as openaiToFile } from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = "Você é um assistente pessoal prestativo. Responda sempre em Português do Brasil (PT-BR). Seja conciso e amigável. IMPORTANTE: Use negrito (*) apenas em tópicos ou palavras-chave importantes. Sempre use APENAS UM asterisco para negrito (exemplo: *Tópico*). NUNCA use dois asteriscos (**).";

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

    // 1. RODÍZIO GEMINI
    for (let i = 0; i < geminiKeys.length; i++) {
        try {
            const genAI = new GoogleGenerativeAI(geminiKeys[i]);
            const responseText = await processWithGemini(genAI, messageText, mediaBuffer, mimeType);
            return cleanWhatsAppText(responseText);
        } catch (error) {
            console.log(`❌ Gemini (Chave ${i + 1}) erro: ${error.status || error.message}`);
        }
    }

    // 2. RODÍZIO GROQ
    for (let i = 0; i < groqKeys.length; i++) {
        try {
            const groq = new Groq({ apiKey: groqKeys[i] });

            if (isMedia && cleanMime?.startsWith('audio/')) {
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

            if (isMedia && cleanMime?.startsWith('image/')) {
                console.log(`📸 [GROQ] Processando imagem com Chave ${i + 1}...`);
                const visionRes = await groq.chat.completions.create({
                    model: "llama-3.2-11b-vision-preview",
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: messageText || "Descreva esta imagem" },
                            { type: "image_url", image_url: { url: `data:${cleanMime};base64,${mediaBuffer.toString("base64")}` } }
                        ]
                    }]
                });
                return cleanWhatsAppText(visionRes.choices[0]?.message?.content);
            }

            if (!isMedia) {
                const textRes = await groq.chat.completions.create({
                    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: messageText }],
                    model: "llama-3.1-8b-instant",
                });
                return cleanWhatsAppText(textRes.choices[0]?.message?.content);
            }
        } catch (err) {
            console.log(`❌ Groq (Chave ${i + 1}) erro: ${err.message}`);
        }
    }

    // 3. RODÍZIO OPENAI
    for (let i = 0; i < openaiKeys.length; i++) {
        try {
            console.log(`🔄 [OPENAI] Tentando Chave ${i + 1}...`);
            const openai = new OpenAI({ apiKey: openaiKeys[i] });
            const res = await processWithOpenAI(openai, messageText, mediaBuffer, mimeType);
            if (res) return cleanWhatsAppText(res);
        } catch (e) {
            console.log(`❌ OpenAI (Chave ${i + 1}) erro: ${e.message}`);
        }
    }

    return "⚠️ Infelizmente não consegui processar sua imagem agora. Tente mandar um texto ou aguarde 1 minuto para o reset das cotas gratuitas.";
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
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: messageText || "Descreva" },
                    { type: "image_url", image_url: { url: `data:${cleanMime};base64,${mediaBuffer.toString("base64")}` } }
                ]
            }]
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
