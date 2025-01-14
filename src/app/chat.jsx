"use client";

import { useId, useEffect, useRef, useState } from "react";
import { useChat } from "ai/react";
import useSilenceAwareRecorder from "silence-aware-recorder/react";
import useMediaRecorder from "@wmik/use-media-recorder";
import { useLocalStorage } from "../lib/use-local-storage";

const SILENCE_DURATION = 1000;
const SILENT_THRESHOLD = -30;

// A function that plays an audio from a url and reutnrs a promise that resolves when the audio ends
function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.play();
  });
}

const sendPcmData = async (blob) => {
  const websocket = new WebSocket('ws://43.138.84.42:6002');

  websocket.onopen = async () => {
    await websocket.send(JSON.stringify({"signal":"start","input_format":"audio/x-wav;codec=pcm;bit=16;rate=16000","output_format":"flv"}));

    websocket.onmessage = async (event) => {
      const start_result = JSON.parse(event.data);
      console.log(start_result);

      if (start_result["type"] === "server_ready" && start_result["content"] === "ok") {
        // The chunk size should be determined by your application needs
        const chunkSize = 160000; // This is just a placeholder value
        let offset = 0;

        while (offset < blob.size) {
          const chunk = blob.slice(offset, Math.min(blob.size, offset + chunkSize));
          // Here we convert the blob chunk to an ArrayBuffer before sending
          const buffer = await chunk.arrayBuffer();
          websocket.send(buffer);
          offset += chunkSize;
        }

        // Send the end signal when done
        await websocket.send(JSON.stringify({"signal":"end"}));
      } else {
        // Handle start error
        websocket.close();
        console.log("socked closed...");
      }
    };

    websocket.onerror = (event) => {
      // Handle WebSocket error
      console.error('WebSocket error:', event);
    };
  };
};

export default function Chat() {
  const id = useId();
  const maxVolumeRef = useRef(0);
  const minVolumeRef = useRef(-100);
  const [displayDebug, setDisplayDebug] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [phase, setPhase] = useState("not inited");
  const [transcription, setTranscription] = useState("");
  const [currentVolume, setCurrentVolume] = useState(-50);
  const [volumePercentage, setVolumePercentage] = useState(0);
  const [token, setToken] = useLocalStorage("ai-token", "");
  const [lang, setLang] = useLocalStorage("lang", "");
  const isBusy = useRef(false);
  const videoRef = useRef();
  const canvasRef = useRef();

  const audio = useSilenceAwareRecorder({
    onDataAvailable: onSpeech,
    onVolumeChange: setCurrentVolume,
    silenceDuration: SILENCE_DURATION,
    silentThreshold: SILENT_THRESHOLD,
    minDecibels: -100,
  });

  let { liveStream, ...video } = useMediaRecorder({
    recordScreen: false,
    blobOptions: { type: "video/webm" },
    mediaStreamConstraints: { audio: false, video: true },
  });

  function startRecording() {
    audio.startRecording();
    video.startRecording();

    setIsStarted(true);
    setPhase("user: waiting for speech");
  }

  function stopRecording() {
    document.location.reload();
  }

  async function onSpeech(data) {
    if (isBusy.current) return;

    // current state is not available here, so we get token from localstorage
    const token = JSON.parse(localStorage.getItem("ai-token"));

    isBusy.current = true;
    audio.stopRecording();

    setPhase("user: processing speech to text");

    const speechtotextFormData = new FormData();
    speechtotextFormData.append("file", data, "audio.webm");
    speechtotextFormData.append("token", token);
    speechtotextFormData.append("lang", lang);

    const speechtotextResponse = await fetch("/api/speechtotext", {
      method: "POST",
      body: speechtotextFormData,
    });

    const { text, error } = await speechtotextResponse.json();

    if (error) {
      alert(error);
    }

    setTranscription(text);

    setPhase("user: processing completion");

    await append({
      content: text,
      role: "user",
    });
  }

  const { messages, append, reload, isLoading } = useChat({
    id,
    body: {
      id,
      token,
      lang,
    },
    async onFinish(message) {
      setPhase("assistant: processing text to speech");

      // same here
      const token = JSON.parse(localStorage.getItem("ai-token"));

      const texttospeechFormData = new FormData();
      texttospeechFormData.append("input", message.content);
      texttospeechFormData.append("token", token);

      const response = await fetch("/api/texttospeech", {
        method: "POST",
        body: texttospeechFormData,
      });

      setPhase("assistant: playing audio");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      console.log("url of audio:", url);
      await playAudio(url);

      // sendPcmData(blob);

      audio.startRecording();
      isBusy.current = false;

      setPhase("user: waiting for speech");
    },
  });

  useEffect(() => {
    if (videoRef.current && liveStream && !videoRef.current.srcObject) {
      videoRef.current.srcObject = liveStream;
    }
  }, [liveStream]);

  useEffect(() => {
    if (!audio.isRecording) {
      setVolumePercentage(0);
      return;
    }

    if (typeof currentVolume === "number" && isFinite(currentVolume)) {
      if (currentVolume > maxVolumeRef.current)
        maxVolumeRef.current = currentVolume;
      if (currentVolume < minVolumeRef.current)
        minVolumeRef.current = currentVolume;

      if (maxVolumeRef.current !== minVolumeRef.current) {
        setVolumePercentage(
          (currentVolume - minVolumeRef.current) /
            (maxVolumeRef.current - minVolumeRef.current)
        );
      }
    }
  }, [currentVolume, audio.isRecording]);

  const lastAssistantMessage = messages
    .filter((it) => it.role === "assistant")
    .pop();

  return (
    <>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div className="antialiased w-screen h-screen p-4 flex flex-col justify-center items-center bg-black">
        <div className="w-full h-full sm:container sm:h-auto grid grid-rows-[auto_1fr] grid-cols-[1fr] sm:grid-cols-[2fr_1fr] sm:grid-rows-[1fr] justify-content-center bg-black">
          <div className="relative">
            <video
              ref={videoRef}
              className="h-auto w-full aspect-[4/3] object-cover rounded-[1rem] bg-gray-900"
              autoPlay
            />
            {audio.isRecording ? (
              <div className="w-16 h-16 absolute bottom-4 left-4 flex justify-center items-center">
                <div
                  className="w-16 h-16 bg-red-500 opacity-50 rounded-full"
                  style={{
                    transform: `scale(${Math.pow(volumePercentage, 4).toFixed(
                      4
                    )})`,
                  }}
                ></div>
              </div>
            ) : (
              <div className="w-16 h-16 absolute bottom-4 left-4 flex justify-center items-center cursor-pointer">
                <div className="text-5xl text-red-500 opacity-50">⏸</div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center p-12 text-md leading-relaxed relative">
            {lastAssistantMessage?.content}
            {isLoading && (
              <div className="absolute left-50 top-50 w-8 h-8 ">
                <div className="w-6 h-6 -mr-3 -mt-3 rounded-full bg-cyan-500 animate-ping" />
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-center p-4 opacity-50 gap-2">
          {isStarted ? (
            <button
              className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
              onClick={stopRecording}
            >
              ⏹
            </button>
          ) : (
            <button
              className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
              onClick={startRecording}
            >
              ▶️
            </button>
          )}
          {/* <button
            className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
            onClick={() => reload()}
          >
            Regenerate
          </button>
          <button
            className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
            onClick={() => setDisplayDebug((p) => !p)}
          >
            Debug
          </button> */}
          {/* <input
            type="password"
            className="px-4 py-2 bg-gray-700 rounded-md"
            value={token}
            placeholder="OpenAI API key"
            onChange={(e) => setToken(e.target.value)}
          /> */}
          {/* <input
            className="px-4 py-2 bg-gray-700 rounded-md"
            value={lang}
            placeholder="Optional language code"
            onChange={(e) => setLang(e.target.value)}
          /> */}
        </div>
      </div>
      <div
        className={`bg-[rgba(20,20,20,0.8)] backdrop-blur-xl p-8 rounded-sm absolute left-0 top-0 bottom-0 transition-all w-[75vw] sm:w-[33vw] ${
          displayDebug ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div
          className="absolute z-10 top-4 right-4 opacity-50 cursor-pointer"
          onClick={() => setDisplayDebug(false)}
        >
          ⛌
        </div>
        <div className="space-y-8">
          <div className="space-y-2">
            <div className="font-semibold opacity-50">Phase:</div>
            <p>{phase}</p>
          </div>
          <div className="space-y-2">
            <div className="font-semibold opacity-50">Transcript:</div>
            <p>{transcription || "--"}</p>
          </div>
        </div>
      </div>
    </>
  );
}
