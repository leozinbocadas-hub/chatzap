# WhatsApp + Gemini Agent (Backend)

Este é um back-end para WhatsApp que utiliza o Google Gemini (2.0 Flash) para transcrever áudios, analisar imagens e responder a mensagens de texto.

## Configuração

1.  **Obtenha uma API Key do Gemini**: Vá em [Google AI Studio](https://aistudio.google.com/) e crie uma chave gratuita.
2.  **Variáveis de Ambiente**: Crie um arquivo `.env` baseado no `.env.example` e cole sua chave.
3.  **Hospedagem no EasyPanel**:
    *   Crie um novo serviço no EasyPanel usando o repositório deste projeto.
    *   O EasyPanel detectará automaticamente o `Dockerfile`.
    *   **Importante**: Para que você não precise escanear o QR Code toda vez que o container reiniciar, configure um **Volume** no EasyPanel:
        *   Caminho no Host: `/seu/caminho/de/dados/whatsapp`
        *   Caminho no Container: `/app/auth_info_baileys`
    *   Configure a variável de ambiente `GEMINI_API_KEY` no painel do EasyPanel.

## Como Conectar

Ao rodar pela primeira vez (ou se a sessão expirar), o QR Code aparecerá nos **Logs** do serviço no EasyPanel. Abra o WhatsApp no seu celular e escaneie.

## Funcionalidades

-   **Texto**: Conversa normal como o ChatGPT.
-   **Imagens**: Envie uma foto e pergunte algo sobre ela na legenda.
-   **Áudio**: Envie um áudio e o agente irá transcrever e responder.
