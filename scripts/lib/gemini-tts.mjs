/**
 * How to ask Gemini TTS for speech - which depends on the model's generation.
 *
 * The preview models (gemini-2.5-*-preview-tts, gemini-3.1-flash-tts-preview)
 * take a spoken direction in the text itself and return headerless PCM. From
 * 3.8 on the text is a verbatim transcript and a plain call returns a WAV
 * file. Sent a preview-style request, gemini-3.8-flash-lite-tts read the
 * direction out loud - nine seconds of "Read this Azerbaijani text aloud
 * exactly as written…" in front of a one-second phrase (live API, 2026-10-08).
 * A generator that only swaps the model id records that into every file, and
 * encodes a WAV header as the first 44 bytes of audio.
 *
 * Google shuts the preview models down no earlier than 2026-11-17. The three
 * generators (demo guide, video guides, voice samples) build their requests
 * here so the difference lives in one place and cannot be forgotten in one of
 * them.
 */

/** What a retired preview model is replaced with. */
export const GEMINI_TTS_SUCCESSOR = "gemini-3.8-flash-tts"

const PREVIEW_MARKERS = ["preview-tts", "tts-preview"]

export function geminiTtsReadsTextVerbatim(model) {
  return !PREVIEW_MARKERS.some((marker) => String(model).includes(marker))
}

/**
 * The request for one utterance.
 *
 * `direction` is the sentence a preview model is told to read by ("calmly, in
 * Azerbaijani:"). `style` says the same thing to a 3.8 model as metadata, which
 * is the only place it can go without being spoken.
 */
export function geminiTtsRequest({ model, key, text, voice, direction = "", style = "" }) {
  if (!geminiTtsReadsTextVerbatim(model)) {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      body: {
        contents: [{ parts: [{ text: direction ? `${direction}\n${text}` : text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      },
    }
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/interactions?key=${key}`,
    body: {
      model,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          // Every word here is a word that ends up in the recording.
          text,
          ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}),
        }],
      }],
      // Headerless PCM by name: the default for this call is a WAV file.
      response_format: { type: "audio", mime_type: "audio/l16" },
      generation_config: { speech_config: [{ voice }] },
    },
  }
}

/** The PCM payload of a WAV file; headerless audio passes through. */
export function stripWavHeader(audio) {
  if (audio.length < 12 || audio.toString("latin1", 0, 4) !== "RIFF" || audio.toString("latin1", 8, 12) !== "WAVE") {
    return audio
  }
  let offset = 12
  while (offset + 8 <= audio.length) {
    const size = audio.readUInt32LE(offset + 4)
    if (audio.toString("latin1", offset, offset + 4) === "data") {
      return audio.subarray(offset + 8, offset + 8 + size)
    }
    offset += 8 + size + (size & 1)
  }
  throw new Error("Gemini TTS returned a WAV file without audio")
}

/**
 * 24 kHz mono PCM16 from either generation's answer, or null when the model
 * returned no audio. ffmpeg is told `-f s16le`, so a header left in place
 * would be encoded as sound.
 */
export function geminiTtsPcm(json, model) {
  let encoded = null
  if (!geminiTtsReadsTextVerbatim(model)) {
    encoded = json?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data ?? null
  } else {
    for (const step of json?.steps ?? []) {
      if (step?.type !== "model_output") continue
      for (const block of step.content ?? []) {
        if (block?.type === "audio" && block.data) encoded = block.data
      }
    }
  }
  if (!encoded) return null
  const pcm = stripWavHeader(Buffer.from(encoded, "base64"))
  return pcm.length > 0 ? pcm : null
}

/**
 * Audio far too short to be the text.
 *
 * The preview model sometimes answers a full sentence with a tenth of a second
 * of sound and no error (seen on the live API, 2026-10-08). Encoded and saved,
 * that is a phrase the guide silently skips. Speech in the shipped recordings
 * runs at about 0.08 s a character; a quarter of that is not speech.
 */
export function geminiTtsTooShort(pcm, text) {
  return pcm.length / 2 / 24_000 < String(text).length * 0.02
}

/** Google's answer for a model that no longer exists. */
export function geminiTtsModelRetired(model, status) {
  return status === 404 && !geminiTtsReadsTextVerbatim(model)
}
