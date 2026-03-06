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
    const cleanMime = mimeType?.split(';')[0];
    let responseText = "";

    // 1. TENTATIVA COM GEMINI (Principal para tudo pois é Grátis e Multimodal)
    try {
        responseText = await processWithGemini(messageText, mediaBuffer, mimeType);
        return cleanWhatsAppText(responseText);
    } catch (error) {
        console.log(`❌ Gemini fora de cota. Iniciando Rodízio de Fallback...`);
    }

    // 2. RODÍZIO INTELIGENTE (GROQ - Econômico e Eficiente)
    if (process.env.GROQ_API_KEY) {
        try {
            // FALLBACK PARA ÁUDIO (Groq Whisper + Llama 8B)
            if (isMedia && cleanMime?.startsWith('audio/')) {
                console.log(`🔄 [RODÍZIO] Áudio -> Groq Whisper...`);
                const transcription = await groq.audio.transcriptions.create({
                    file: await groqToFile(mediaBuffer, `audio.ogg`),
                    model: "whisper-large-v3",
                });
                const chatRes = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: `O usuário enviou um áudio que diz: "${transcription.text}". Responda adequadamente.` }
                    ],
                    model: "llama-3.1-8b-instant", // Versão econômica para resposta de texto
                });
                return cleanWhatsAppText(chatRes.choices[0]?.message?.content);
            }

            // FALLBACK PARA IMAGEM (Groq Vision Llama 3.2 11B)
            if (isMedia && cleanMime?.startsWith('image/')) {
                console.log(`🔄 [RODÍZIO] Imagem -> Groq Vision 11B...`);
                const visionRes = await groq.chat.completions.create({
                    model: "llama-3.2-11b-vision-preview", // Versão específica para Visão
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        {
                            role: "user",
                            content: [
                                { type: "text", text: messageText || "Descreva esta imagem" },
                                {
                                    type: "image_url",
                                    image_url: { url: `data:${cleanMime};base64,${mediaBuffer.toString("base64")}` }
                                }
                            ]
                        }
                    ]
                });
                return cleanWhatsAppText(visionRes.choices[0]?.message?.content);
            }

            // FALLBACK PARA TEXTO PURO (Groq Llama 8B - O mais rápido e econômico)
            if (!isMedia) {
                console.log(`🔄 [RODÍZIO] Texto -> Groq Llama 8B (Econômico)...`);
                const textRes = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: messageText }
                    ],
                    model: "llama-3.1-8b-instant",
                });
                return cleanWhatsAppText(textRes.choices[0]?.message?.content);
            }
        } catch (err) {
            console.log(`❌ Groq também falhou: ${err.message}`);
        }
    }

    // 3. ÚLTIMO RECURSO (OPENAI - Caso tudo acima falhe)
    try {
        console.log(`🔄 [RODÍZIO] Último Recurso -> OpenAI...`);
        const openaiResponse = await processWithOpenAI(messageText, mediaBuffer, mimeType);
        if (openaiResponse) return cleanWhatsAppText(openaiResponse);
    } catch (e) {
        console.log(`❌ OpenAI também falhou.`);
    }

    return "⚠️ Desculpe, todos os meus sistemas (Gemini, Groq e OpenAI) estão temporariamente fora de cota. Tente novamente em 1 minuto.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT
    });
    let promptParts = [messageText || "Analise esta mídia"];
    if (mediaBuffer && mimeType) {
        promptParts.push({
            inlineData: {
                data: mediaBuffer.toString("base64"),
                mimeType: mimeType.split(';')[0]
            }
        });
    }
    const result = await model.generateContent(promptParts);
    return result.response.text();
}

async function processWithOpenAI(messageText, mediaBuffer, mimeType) {
    if (!process.env.OPENAI_API_KEY) return null;
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

    const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: messageText }]
    });
    return res.choices[0]?.message?.content;
}
