import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    // 1. TENTATIVA COM GEMINI (Suporta Multimodal: Texto, Imagem, Áudio)
    try {
        console.log("Tentando Gemini 2.0 Flash...");
        const result = await processWithGemini(messageText, mediaBuffer, mimeType);
        return result;
    } catch (error) {
        // Se for erro de cota ou erro fatal, passa para o próximo se for apenas texto
        console.log(`⚠️ Gemini falhou: ${error.status === 429 ? 'Cota esgotada' : error.message}`);

        // Se a mensagem contiver mídia, o Groq/GPT Mini (via API simples) podem ter dificuldade
        // Então tentaremos apenas o texto se possível.
        if (mediaBuffer && !messageText) {
            return "⚠️ O Gemini (que processa imagens/áudio) está fora do ar ou sem cota. Tente novamente em 1 minuto.";
        }
    }

    // 2. TENTATIVA COM GROQ (Fallback Ultra Rápido para Texto)
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "sua_chave_do_groq") {
        try {
            console.log("Tentando Groq (Llama)...");
            const chatCompletion = await groq.chat.completions.create({
                messages: [{ role: "user", content: messageText || "Olá" }],
                model: "llama3-8b-8192", // Modelo mais estável para contas grátis
            });
            const response = chatCompletion.choices[0]?.message?.content;
            if (response) return "🚀 *[Groq]* " + response;
        } catch (error) {
            console.log("⚠️ Groq falhou:", error.message);
        }
    } else {
        console.log("⏭️ Groq ignorado (chave não configurada)");
    }

    // 3. TENTATIVA COM GPT-4o MINI (Último recurso)
    if (process.env.OPENAI_API_KEY) {
        try {
            console.log("Tentando GPT-4o Mini...");
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: messageText || "Olá" }],
            });
            return "🤖 *[GPT Mini]* " + response.choices[0].message.content;
        } catch (error) {
            console.log("⚠️ GPT Mini falhou:", error.message);
        }
    }

    return "❌ Todas as APIs estão indisponíveis ou sem cota no momento. Tente novamente em instantes.";
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
