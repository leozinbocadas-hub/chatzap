import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = "Você é um assistente pessoal prestativo. Responda sempre em Português do Brasil (PT-BR). Seja conciso e amigável. IMPORTANTE: Para negrito, use sempre APENAS UM asterisco de cada lado (exemplo: *negrito*). NUNCA use dois asteriscos (**).";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanWhatsAppText(text) {
    if (!text) return text;
    return text.replace(/\*\*(.*?)\*\*/g, '*$1*');
}

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    const isMedia = mediaBuffer !== null;

    // 1. TENTATIVA COM GEMINI (UNICO PARA MIDIA)
    try {
        if (isMedia) console.log("🧪 Enviando Mídia para o Gemini...");
        else console.log("📝 Enviando Texto para o Gemini...");

        const responseText = await processWithGemini(messageText, mediaBuffer, mimeType);
        console.log("✅ Resposta do Gemini obtida.");
        return cleanWhatsAppText(responseText);
    } catch (error) {
        console.log(`❌ Gemini falhou: ${error.message}`);
        if (isMedia) {
            return "⚠️ Meu sistema de áudio/imagem está lento. Tente texto ou aguarde 1 minuto.";
        }
    }

    // FALLBACK PARA TEXTO (GROQ)
    if (process.env.GROQ_API_KEY) {
        try {
            console.log("🔄 Usando Fallback: Groq...");
            const response = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: messageText || "Olá" }
                ],
                model: "llama-3.1-8b-instant",
            });
            return cleanWhatsAppText(response.choices[0]?.message?.content);
        } catch (error) {
            console.log("❌ Groq falhou.");
        }
    }

    return "⚠️ Estou com instabilidade. Tente novamente logo.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT
    });

    let promptParts = [messageText || "Analise esta mídia"];

    if (mediaBuffer && mimeType) {
        const cleanMimeType = mimeType.split(';')[0];
        console.log(`📂 Arquivo: ${cleanMimeType} (${mediaBuffer.length} bytes)`);

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
