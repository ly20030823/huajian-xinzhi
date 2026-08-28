import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import writingPetStill from "../assets/writing-pet-still.png";

type PetSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const MESSAGE_KEYS = [
  "main.writingPet.messages.hello",
  "main.writingPet.messages.listen",
  "main.writingPet.messages.line",
  "main.writingPet.messages.secret",
  "main.writingPet.messages.rest",
] as const;

const PET_REACTION_DURATION_MS = 860;

interface WritingPetProps {
  noteKey: string | null;
  saveState: PetSaveState;
  onHide: () => void;
}

export function WritingPet({ noteKey, saveState, onHide }: WritingPetProps) {
  const { t } = useTranslation();
  const previousSaveState = useRef<PetSaveState>(saveState);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pettingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState(1);
  const [messageIndex, setMessageIndex] = useState(0);
  const [speech, setSpeech] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [petting, setPetting] = useState(false);
  const [reactionNonce, setReactionNonce] = useState(0);

  const showSpeech = (message: string, duration = 2600) => {
    if (speechTimer.current) clearTimeout(speechTimer.current);
    setSpeech(message);
    speechTimer.current = setTimeout(() => setSpeech(null), duration);
  };

  useEffect(() => {
    const seed = noteKey ? [...noteKey].reduce((total, char) => total + char.charCodeAt(0), 0) : 0;
    setPosition(seed % 3);
    setSpeech(null);
  }, [noteKey]);

  useEffect(() => {
    const previous = previousSaveState.current;
    previousSaveState.current = saveState;

    if (saveState === "saving" && previous === "dirty") {
      showSpeech(t("main.writingPet.saving", { defaultValue: "我帮你看着这句话。" }), 1800);
    }

    if (saveState === "saved" && (previous === "saving" || previous === "dirty")) {
      showSpeech(t("main.writingPet.saved", { defaultValue: "收好啦，送你一朵小花。" }), 2400);
      setCelebrating(true);
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
      celebrationTimer.current = setTimeout(() => setCelebrating(false), 1800);
    }

    if (saveState === "error") {
      showSpeech(t("main.writingPet.error", { defaultValue: "这页还没收好，再试一次？" }), 3200);
    }
  }, [saveState, t]);

  useEffect(
    () => () => {
      if (speechTimer.current) clearTimeout(speechTimer.current);
      if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
      if (pettingTimer.current) clearTimeout(pettingTimer.current);
      if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
    },
    [],
  );

  const petTheCat = () => {
    const currentMessage = messageIndex;
    setMessageIndex((messageIndex + 1) % MESSAGE_KEYS.length);
    setReactionNonce((current) => current + 1);
    setPetting(true);
    if (pettingTimer.current) clearTimeout(pettingTimer.current);
    pettingTimer.current = setTimeout(() => setPetting(false), PET_REACTION_DURATION_MS);
    showSpeech(t(MESSAGE_KEYS[currentMessage]));
  };

  const handleClick = () => {
    if (singleClickTimer.current) clearTimeout(singleClickTimer.current);
    singleClickTimer.current = setTimeout(() => {
      singleClickTimer.current = null;
      petTheCat();
    }, 220);
  };

  const handleDoubleClick = () => {
    if (singleClickTimer.current) {
      clearTimeout(singleClickTimer.current);
      singleClickTimer.current = null;
    }
    onHide();
  };

  return (
    <div
      className={`writing-pet-habitat pet-position-${position} ${celebrating ? "is-celebrating" : ""}`}
      aria-label={t("main.writingPet.habitat", { defaultValue: "橘团的小窗台" })}
    >
      <div className="writing-pet-trail" aria-hidden="true" />
      <button
        type="button"
        className={`writing-pet ${petting ? "is-petting" : ""}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={t("main.writingPet.touchAndHide", {
          defaultValue: "单击摸摸橘团，双击隐藏",
        })}
        aria-label={t("main.writingPet.touch", { defaultValue: "摸摸橘团" })}
      >
        {speech && <span className="writing-pet-speech">{speech}</span>}
        <img
          key={`pet-${reactionNonce}`}
          className="writing-pet-animation"
          src={writingPetStill}
          alt=""
          draggable={false}
        />
        <span className="writing-pet-celebration" aria-hidden="true">
          🌼
        </span>
        <span className="writing-pet-name">
          {t("main.writingPet.name", { defaultValue: "橘团" })}
        </span>
      </button>
      <div className="writing-pet-shelf" aria-hidden="true">
        <span className="writing-pet-sprout">
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
