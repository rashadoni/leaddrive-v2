import { Composition } from "remotion";
import { AiActionsVideo } from "./AiActionsVideo";
import { audioMeta } from "./generated/audioMeta";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="AiActionsAz"
        component={AiActionsVideo}
        durationInFrames={audioMeta.az.frames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "az" as const }}
      />
      <Composition
        id="AiActionsEn"
        component={AiActionsVideo}
        durationInFrames={audioMeta.en.frames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "en" as const }}
      />
      <Composition
        id="AiActionsRu"
        component={AiActionsVideo}
        durationInFrames={audioMeta.ru.frames}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ locale: "ru" as const }}
      />
    </>
  );
};
