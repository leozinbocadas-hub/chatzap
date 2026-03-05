import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// Log para debug no EasyPanel (não mostra a chave toda por segurança)
console.log("Config: Gemini:", !!process.env.GEMINI_API_KEY, "| Groq:", !!process.env.GROQ_API_KEY, "| OpenAI:", !!process.env.OPENAI_API_KEY);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    // 1. TENTATIVA COM GEMINI (Multimodal)
    try {
        console.log("Tentando Gemini 2.0 Flash...");
        return await processWithGemini(messageText, mediaBuffer, mimeType);
    } catch (error) {
        console.log(`⚠️ Gemini falhou: ${error.status === 429 ? 'Cota esgotada' : error.message}`);
        if (mediaBuffer && !messageText) {
            return "⚠️ O Gemini (mídia) está sem cota. Tente texto puro ou aguarde 1 minuto.";
        }
    }

    // 2. TENTATIVA COM GROQ (Com Timeout para não travar o WhatsApp)
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length > 10) {
        try {
            console.log("Tentando Groq (Llama 3.3)...");

            // Promise race para dar timeout de 10 segundos
            const response = await Promise.race([
                groq.chat.completions.create({
                    messages: [{ role: "user", content: messageText || "Olá" }],
                    model: "llama-3.3-70b-versatile",
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout Groq")), 10000))
            ]);

            const content = response.choices[0]?.message?.content;
            if (content) return "🚀 *[Groq]* " + content;
        } catch (error) {
            console.log("⚠️ Groq falhou:", error.message);
        }
    }

    // 3. TENTATIVA COM GPT-4o MINI
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10) {
        try {
            console.log("Tentando GPT-4o Mini...");
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: messageText || "Olá" }],
                timeout: 10000 // Timeout nativo da OpenAI
            });
            const content = response.choices[0]?.message?.content;
            if (content) return "🤖 *[GPT Mini]* " + content;
        } catch (error) {
            console.log("⚠️ GPT Mini falhou:", error.message);
        }
    }

    return "❌ Todas as APIs estão indisponíveis. Aguarde um momento.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    let promptParts = [messageText || "O que tem nesta imagem/áudio?"];

    if (mediaBuffer && mimeType) {
        const cleanMimeType = mimeType.split(';')[0];
        promptParts.push({
            inlineData: {
                data: mediaBuffer.toString("base64"),
                mimeType: cleanMimeType
            }
        });
    }

    const result = await model.generateContent(promptParts);
    const response = await result.response;
    return response.text();
}
