import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = "Você é um assistente pessoal prestativo. Responda sempre em Português do Brasil (PT-BR). Seja conciso e amigável.";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    const isMedia = mediaBuffer !== null;

    // 1. TENTATIVA COM GEMINI (O ÚNICO QUE PROCESSA ÁUDIO/IMAGEM)
    try {
        return await processWithGemini(messageText, mediaBuffer, mimeType);
    } catch (error) {
        // Se for mídia (áudio/imagem), não adianta passar para Groq/GPT Mini pois eles não "ouvem" nem "veem" o arquivo.
        if (isMedia) {
            return "⚠️ Meu sistema de processamento de áudio/imagem está congestionado agora. Por favor, tente enviar um texto ou aguarde 1 minuto.";
        }
    }

    // 2. TENTATIVA COM GROQ (Fallback apenas para TEXTO)
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.includes("gsk_")) {
        try {
            const response = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: messageText || "Olá" }
                ],
                model: "llama-3.1-8b-instant",
            }).catch(() => null);

            if (response && response.choices[0]?.message?.content) {
                return response.choices[0].message.content;
            }
        } catch (error) { }
    }

    // 3. TENTATIVA COM GPT-4o MINI (Fallback apenas para TEXTO)
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.includes("sk-")) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: messageText || "Olá" }
                ],
            }).catch(() => null);

            if (response && response.choices[0]?.message?.content) {
                return response.choices[0].message.content;
            }
        } catch (error) { }
    }

    return "⚠️ Estou com instabilidade nas APIs. Aguarde um momento.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT
    });

    let promptParts = [messageText || "O que tem nesta mídia?"];

    if (mediaBuffer && mimeType) {
        // WhatsApp envia audio/ogg; codecs=opus. O Gemini quer apenas audio/ogg.
        const cleanMimeType = mimeType.split(';')[0];
        promptParts.push({
            inlineData: {
                data: mediaBuffer.toString("base64"),
                mimeType: cleanMimeType
            }
        });
    }

    const result = await model.generateContent(promptParts);
    return result.response.text();
}
