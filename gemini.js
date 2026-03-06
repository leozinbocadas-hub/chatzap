import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = "Você é um assistente pessoal prestativo. Responda sempre em Português do Brasil (PT-BR). Seja conciso e amigável. IMPORTANTE: Use negrito (*) apenas em tópicos, títulos ou palavras-chave extremamente importantes. Não exagere. Sempre use APENAS UM asterisco para negrito (exemplo: *Tópico*). NUNCA use dois asteriscos (**).";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanWhatsAppText(text) {
    if (!text) return text;
    return text.replace(/\*\*(.*?)\*\*/g, '*$1*');
}

export async function processMessage(messageText, mediaBuffer = null, mimeType = null) {
    const isMedia = mediaBuffer !== null;
    let responseText = "";

    // 1. TENTATIVA COM GEMINI (Multimodal: Texto, Imagem, Áudio)
    try {
        if (isMedia) console.log(`🧪 [MIDIA] Enviando para Gemini (Prioridade 1)...`);
        else console.log(`📝 [TEXTO] Enviando para Gemini (Prioridade 1)...`);

        responseText = await processWithGemini(messageText, mediaBuffer, mimeType);
        console.log(`✅ Gemini processou com sucesso.`);
        return cleanWhatsAppText(responseText);
    } catch (error) {
        console.log(`❌ Gemini falhou: ${error.message}`);
    }

    // 2. FALLBACK PARA MIDIA (OPENAI) OU TEXTO (GROQ)
    if (isMedia) {
        // Se o Gemini falhou e é mídia, tentamos OpenAI (Vision para imagem / Whisper para áudio)
        try {
            console.log(`� [FALLBACK MIDIA] Usando OpenAI (GPT-4o Mini / Whisper)...`);
            const fallbackResponse = await processWithOpenAI(messageText, mediaBuffer, mimeType);
            if (fallbackResponse) {
                console.log(`✅ OpenAI processou a mídia com sucesso.`);
                return cleanWhatsAppText(fallbackResponse);
            }
        } catch (error) {
            console.log(`❌ OpenAI falhou no fallback de mídia: ${error.message}`);
        }
    } else {
        // Se o Gemini falhou e é texto, seguimos o rodízio: Groq -> OpenAI
        if (process.env.GROQ_API_KEY) {
            try {
                console.log("🔄 [FALLBACK TEXTO] Usando Groq...");
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

        if (process.env.OPENAI_API_KEY) {
            try {
                console.log("🔄 [FALLBACK TEXTO] Usando OpenAI...");
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: messageText || "Olá" }
                    ],
                });
                return cleanWhatsAppText(response.choices[0]?.message?.content);
            } catch (error) {
                console.log("❌ OpenAI falhou no fallback de texto.");
            }
        }
    }

    return "⚠️ Estou com instabilidade nas minhas APIs de IA. Por favor, aguarde um momento e tente novamente.";
}

async function processWithGemini(messageText, mediaBuffer, mimeType) {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT
    });

    let promptParts = [messageText || "O que tem nesta mídia?"];
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

    // TRATAMENTO DE IMAGEM (GPT-4o Mini Vision)
    if (cleanMime?.startsWith('image/')) {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
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
        return response.choices[0]?.message?.content;
    }

    // TRATAMENTO DE ÁUDIO (Whisper + GPT)
    if (cleanMime?.startsWith('audio/')) {
        // 1. Transcreve com Whisper
        // Criamos um arquivo virtual para o Whisper aceitar
        const transcription = await openai.audio.transcriptions.create({
            file: await toFile(mediaBuffer, `audio.${cleanMime.split('/')[1] || 'ogg'}`, { type: cleanMime }),
            model: "whisper-1",
        });

        const transcribedText = transcription.text;
        console.log(`🎤 Transcrição OpenAI: "${transcribedText}"`);

        // 2. Envia o texto para o GPT processar
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: `O usuário enviou um áudio que diz: "${transcribedText}". Responda de forma adequada.` }
            ]
        });
        return response.choices[0]?.message?.content;
    }

    return null;
}
