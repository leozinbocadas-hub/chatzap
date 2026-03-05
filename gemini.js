import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

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

    // 2. TENTATIVA COM GROQ (Ultra rápido - 5s timeout)
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.startsWith("gsk_")) {
        try {
            console.log("Tentando Groq (Mixtral)...");
            const response = await Promise.race([
                groq.chat.completions.create({
                    messages: [{ role: "user", content: messageText || "Olá" }],
                    model: "mixtral-8x7b-32768",
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
            ]);

            const content = response.choices[0]?.message?.content;
            if (content) return "🚀 *[Groq]* " + content;
        } catch (error) {
            console.log("⚠️ Groq falhou ou Timeout de 5s.");
        }
    }

    // 3. TENTATIVA COM GPT-4o MINI (5s timeout)
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith("sk-")) {
        try {
            console.log("Tentando GPT Mini...");
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: messageText || "Olá" }],
                timeout: 5000
            });
            const content = response.choices[0]?.message?.content;
            if (content) return "🤖 *[GPT Mini]* " + content;
        } catch (error) {
            console.log("⚠️ GPT Mini falhou.");
        }
    }

    return "⚠️ Estou com instabilidade em todas as minhas conexões (Gemini, Groq e GPT). Por favor, tente novamente em um minuto.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    let promptParts = [messageText || "Descreva"];
    if (mediaBuffer && mimeType) {
        promptParts.push({ inlineData: { data: mediaBuffer.toString("base64"), mimeType: mimeType.split(';')[0] } });
    }
    const result = await model.generateContent(promptParts);
    return result.response.text();
}
