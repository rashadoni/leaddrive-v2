import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");
const repoVideoDir = resolve(projectDir, "..");
const repoRoot = resolve(repoVideoDir, "..");
const audioDir = resolve(projectDir, "public/audio");
const generatedDir = resolve(projectDir, "src/generated");
const outDir = resolve(repoVideoDir, "player");
const fps = 30;

const locales = ["az", "en", "ru"];
const voices = {
  az: "az-AZ-BanuNeural",
  en: "en-US-JennyNeural",
  ru: "ru-RU-SvetlanaNeural",
};

const script = {
  az: [
    "AI məsləhətçi. Gündəlik riski tapmağı, sübutu yoxlamağı və təhlükəsiz növbəti addımı təsdiq növbəsinə göndərməyi göstəririk.",
    "Yuxarı xülasədən başlayın. Açıq risklər, kritik siqnallar, risk altında məbləğ və təsdiq gözləyən əməliyyatlar günün miqyasını göstərir.",
    "Solda ilk kritik siqnalı seçin. Detal kartı səhifədən çıxmadan sağda açılır.",
    "Sübutları yoxlayın. Səbəb, faktlar, ön baxış və təsdiqdən sonra nə dəyişəcəyi görünür.",
    "Əməliyyatı növbəyə əlavə edin. Bu müştəriyə göndəriş deyil, əl ilə yoxlama mərhələsidir.",
    "Soruş tabına keçin və pul riski ssenarisini açın. Advisor siqnalları süzür və mənbəli cavab verir.",
    "Modullar bölməsində hansı mənbələrin aktiv, bloklu və ya siqnalsız olduğunu yoxlayın.",
    "Növbədə sübutu, ön baxışı və təsdiq ya da rədd düymələrini görün.",
    "Tarixçədə qərar və icra statusu audit üçün saxlanır.",
  ].join("\n\n"),
  en: [
    "AI Advisor. This walkthrough shows how to find the day's risk, review evidence, and move a safe next step into approval.",
    "Start with the top summary. Open risks, critical signals, money at risk, and pending actions show the scale of the day.",
    "Select the first critical signal on the left. The detail card opens on the right without leaving the page.",
    "Review the evidence. The reason, facts, preview, and post-approval change are visible before anything is executed.",
    "Queue the action. This is not a customer send; it moves into manual review.",
    "Open Ask and choose the money risk scenario. Advisor filters the signals and answers with sources.",
    "Use Modules to check which sources are active, permission blocked, or missing signals.",
    "In Queue, review the evidence, action preview, and approve or reject controls.",
    "History keeps the decision and execution status auditable.",
  ].join("\n\n"),
  ru: [
    "AI-советник. Показываем, как найти риск дня, проверить доказательства и отправить безопасный следующий шаг в очередь согласования.",
    "Начинаем с верхней сводки. Открытые риски, критичные сигналы, деньги под риском и действия на согласовании показывают масштаб дня.",
    "Выбираем первый критичный сигнал слева. Детальная карточка открывается справа без перехода на другую страницу.",
    "Проверяем доказательства. Видно причину, факты, предпросмотр и что изменится после согласования.",
    "Добавляем действие в очередь. Это не отправка клиенту, а ручная проверка перед выполнением.",
    "Открываем вкладку Спросить и выбираем сценарий Деньги под риском. Advisor фильтрует сигналы и отвечает с источниками.",
    "Во вкладке Модули проверяем, какие источники активны, где нет прав и где нет сигналов.",
    "В Очереди видны доказательства, предпросмотр действия и кнопки одобрить или отклонить.",
    "История сохраняет решение и статус исполнения для аудита.",
  ].join("\n\n"),
};

mkdirSync(audioDir, { recursive: true });
mkdirSync(generatedDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const python = resolvePython();
const audioMeta = {};

for (const locale of locales) {
  const audioPath = resolve(audioDir, `ai-actions.${locale}.mp3`);
  execFileSync(
    python,
    [
      "-m",
      "edge_tts",
      "--voice",
      voices[locale],
      "--rate",
      "+5%",
      "--text",
      script[locale],
      "--write-media",
      audioPath,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  const duration = Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath],
      { encoding: "utf8" },
    ).trim(),
  );
  audioMeta[locale] = {
    duration,
    frames: Math.ceil((duration + 0.6) * fps),
  };
}

writeFileSync(
  resolve(generatedDir, "audioMeta.ts"),
  `export const audioMeta = ${JSON.stringify(audioMeta, null, 2)} as const;\n`,
);

for (const locale of locales) {
  const id = `AiActions${locale[0].toUpperCase()}${locale.slice(1)}`;
  const mp4 = resolve(outDir, `ai-actions.${locale}.VOICE.mp4`);
  const poster = resolve(outDir, `ai-actions.${locale}.poster.jpg`);
  execFileSync(
    "npx",
    [
      "remotion",
      "render",
      "src/index.ts",
      id,
      mp4,
      "--overwrite",
      "--codec=h264",
      "--crf=18",
      "--pixel-format=yuv420p",
      "--audio-codec=aac",
    ],
    { cwd: projectDir, stdio: "inherit" },
  );
  execFileSync(
    "npx",
    ["remotion", "still", "src/index.ts", id, poster, "--overwrite", "--frame=36"],
    { cwd: projectDir, stdio: "inherit" },
  );
}

function resolvePython() {
  const preferred = process.env.EDGE_TTS_PYTHON || "/tmp/leaddrive-tts-venv/bin/python";
  if (existsSync(preferred)) return preferred;
  execFileSync("python3", ["-m", "venv", "/tmp/leaddrive-tts-venv"], { stdio: "inherit" });
  execFileSync("/tmp/leaddrive-tts-venv/bin/python", ["-m", "pip", "install", "edge-tts"], { stdio: "inherit" });
  return "/tmp/leaddrive-tts-venv/bin/python";
}
