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
    // 1. TENTATIVA COM GEMINI (Multimodal)
    try {
        console.log("Tentando Gemini...");
        return await processWithGemini(messageText, mediaBuffer, mimeType);
    } catch (error) {
        console.log(`⚠️ Gemini fora: ${error.status === 429 ? 'Cota' : 'Erro'}`);
    }

    // 2. TENTATIVA COM GROQ (Llama 3.1 8b - Mais rápido)
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.includes("gsk_")) {
        try {
            console.log("Tentando Groq...");
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
        } catch (error) {
            console.log("⚠️ Groq falhou.");
        }
    }

    // 3. TENTATIVA COM GPT-4o MINI
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.includes("sk-")) {
        try {
            console.log("Tentando GPT Mini...");
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
        } catch (error) {
            console.log("⚠️ GPT Mini falhou.");
        }
    }

    return "⚠️ Desculpe, estou recebendo muitas mensagens agora e minhas APIs grátis atingiram o limite. Tente novamente em 1 minuto.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT
    });

    let promptParts = [messageText || "O que tem nesta imagem/áudio?"];

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
