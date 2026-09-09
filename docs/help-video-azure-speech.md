# Help Video Azure Speech Setup

This project allows Microsoft Azure Speech only as an explicitly approved external voice provider. Local TTS remains prohibited.

## Required Azure Values

Create an Azure AI Speech resource and keep these values outside git. The script loads `.env.local` and `.env` automatically:

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`

Alternatively, use `AZURE_SPEECH_ENDPOINT` when the Speech resource requires a custom endpoint such as:

```text
https://<resource-name>.cognitiveservices.azure.com
```

Supported aliases:

- key: `AZURE_SPEECH_KEY`, `SPEECH_KEY`, `AZURE_AI_SPEECH_KEY`, `MICROSOFT_SPEECH_KEY`
- region: `AZURE_SPEECH_REGION`, `SPEECH_REGION`, `AZURE_AI_SPEECH_REGION`, `MICROSOFT_SPEECH_REGION`
- endpoint: `AZURE_SPEECH_ENDPOINT`, `SPEECH_ENDPOINT`, `AZURE_AI_SPEECH_ENDPOINT`, `MICROSOFT_SPEECH_ENDPOINT`

`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT_ID` are Azure AD OAuth settings and cannot synthesize Speech audio.

## Generate Approved Audio

```bash
AZURE_SPEECH_KEY="..." \
AZURE_SPEECH_REGION="westeurope" \
node scripts/help-video/generate-azure-speech-audio.mjs \
  --slug ai-actions \
  --locales ru,en,az \
  --outDir video/approved-audio
```

Output files:

```text
video/approved-audio/ai-actions.ru.mp3
video/approved-audio/ai-actions.en.mp3
video/approved-audio/ai-actions.az.mp3
```

Default voices:

- `az`: `az-AZ-BabekNeural`
- `en`: `en-US-Ava:DragonHDLatestNeural`
- `ru`: `ru-RU-DmitryNeural`

Override per locale when needed:

```bash
AZURE_SPEECH_VOICE_RU="ru-RU-SvetlanaNeural" \
AZURE_SPEECH_VOICE_EN="en-US-Jenny:DragonHDLatestNeural" \
AZURE_SPEECH_VOICE_AZ="az-AZ-BanuNeural" \
node scripts/help-video/generate-azure-speech-audio.mjs --slug ai-actions
```

## Render Browser-Guided Video With Approved Audio

```bash
HELP_VIDEO_APPROVED_AUDIO_DIR=video/approved-audio \
node scripts/help-video/generate-browser-guided.mjs \
  --slug ai-actions \
  --locales ru,en,az \
  --baseUrl http://127.0.0.1:3000
```

The browser-guided generator must fail if approved audio is missing. Do not add a local TTS fallback.

## Security Rules

- Never commit Azure keys.
- Never write real keys into `.env.example`, scripts, docs, or scenario JSON.
- Do not call local TTS tools as a fallback.
- A help video can be unblocked only after the generated audio is approved for the target languages.
