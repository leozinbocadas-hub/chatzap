import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    let promptParts = [messageText || "O que tem nesta imagem/áudio?"];

    if (mediaBuffer && mimeType) {
        // Limpa mimeType (ex: audio/ogg; codecs=opus -> audio/ogg)
        const cleanMimeType = mimeType.split(';')[0];
        promptParts.push({
            inlineData: {
                data: mediaBuffer.toString("base64"),
                mimeType: cleanMimeType
            }
        });
    }

    try {
        const result = await model.generateContent(promptParts);
        const response = await result.response;
        return response.text();
    } catch (error) {
        // Trata erro de limite de cota (Rate Limit) sem poluir o console
        if (error.status === 429) {
            console.log("⚠️ Limite de cota do Gemini atingido (15 req/min). Aguardando reset...");
            return "⚠️ *Limite atingido:* Estou processando muitas mensagens no momento. Por favor, aguarde um minuto e tente novamente! (Limite de cota do Google Gemini)";
        }

        console.error("Erro no Gemini:", error);
        return "❌ Desculpe, tive um problema ao processar sua mensagem agora. Tente de novo em instantes.";
    }
}
