"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

const WAVEFORM_BAR_COUNT = 13;
const WAVEFORM_BAR_WIDTH = 2.5;
const WAVEFORM_BAR_MAX_HEIGHT = 15;
const WAVEFORM_GAP = 1.5;

export function VoiceDemo() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState("");
  const [showCursor, setShowCursor] = useState(true);
  const [audioLevels, setAudioLevels] = useState<number[]>(
    Array(WAVEFORM_BAR_COUNT).fill(0)
  );
  const recordingStartTime = useRef<number>(0);
  const animationRef = useRef<number | null>(null);

  // Cursor blink effect
  useEffect(() => {
    if (!isRecording && !isProcessing && inputText === "") {
      const interval = setInterval(() => {
        setShowCursor((prev) => !prev);
      }, 530);
      return () => clearInterval(interval);
    }
    setShowCursor(true);
  }, [isRecording, isProcessing, inputText]);

  // Simulate audio levels during recording
  useEffect(() => {
    if (isRecording) {
      const updateLevels = () => {
        const newLevels = Array(WAVEFORM_BAR_COUNT)
          .fill(0)
          .map(() => 0.2 + Math.random() * 0.8);
        setAudioLevels(newLevels);
        animationRef.current = requestAnimationFrame(updateLevels);
      };
      
      // Small delay before starting animation
      const timeout = setTimeout(() => {
        updateLevels();
      }, 50);
      
      return () => {
        clearTimeout(timeout);
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    } else {
      setAudioLevels(Array(WAVEFORM_BAR_COUNT).fill(0));
    }
  }, [isRecording]);

  // Handle key events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Check for Option/Alt + Space
      if (e.altKey && e.code === "Space" && !isRecording && !isProcessing) {
        e.preventDefault();
        setIsRecording(true);
        recordingStartTime.current = Date.now();
      }
    },
    [isRecording, isProcessing]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.key === "Alt") && isRecording) {
        e.preventDefault();
        const recordingDuration = Date.now() - recordingStartTime.current;

        // Only process if held for at least 300ms
        if (recordingDuration >= 300) {
          setIsRecording(false);
          setIsProcessing(true);

          // Simulate processing delay then show result
          setTimeout(() => {
            setIsProcessing(false);
            // Type out the text character by character
            const text = "omw be there in 5";
            let index = 0;
            const typeInterval = setInterval(() => {
              if (index <= text.length) {
                setInputText(text.slice(0, index));
                index++;
              } else {
                clearInterval(typeInterval);
              }
            }, 30);
          }, 800);
        } else {
          // Quick release - cancel
          setIsRecording(false);
        }
      }
    },
    [isRecording]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Reset demo
  const resetDemo = () => {
    setInputText("");
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* iMessage UI Container */}
      <div className="bg-white rounded-3xl shadow-2xl shadow-black/10 overflow-hidden border border-gray-200/50">
        {/* Messages Area */}
        <div className="p-6 pb-4 min-h-[120px] flex flex-col justify-end">
          {/* Received Message Bubble */}
          <div className="flex justify-start mb-4">
            <div className="bg-[#e9e9eb] rounded-2xl rounded-bl-md px-4 py-2.5 max-w-[85%]">
              <p className="text-[#000000] text-[15px]">when will you get here?</p>
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="px-4 pb-4">
          <div className="relative flex items-center gap-2">
            {/* Plus Button */}
            <button className="w-8 h-8 rounded-full bg-[#e9e9eb] flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-[#8e8e93]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>

            {/* Text Input */}
            <div className="flex-1 relative bg-[#f2f2f7] rounded-full px-4 py-2.5 flex items-center min-h-[40px]">
              <span className="text-[15px] text-[#000000]">
                {inputText}
                {!isRecording && !isProcessing && inputText === "" && (
                  <span
                    className={`inline-block w-[2px] h-[18px] bg-[#007aff] ml-0.5 align-middle transition-opacity ${
                      showCursor ? "opacity-100" : "opacity-0"
                    }`}
                  />
                )}
              </span>
              
              {/* Waveform Overlay */}
              <AnimatePresence>
                {(isRecording || isProcessing) && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <div
                      className="flex items-center justify-center rounded-full bg-[#1c1c1e] px-3 py-1.5"
                      style={{ gap: WAVEFORM_GAP }}
                    >
                      {isProcessing
                        ? // Processing animation - bouncing wave
                          Array.from({ length: WAVEFORM_BAR_COUNT }).map((_, i) => (
                            <motion.div
                              key={i}
                              style={{
                                width: WAVEFORM_BAR_WIDTH,
                                background: "#fff",
                                borderRadius: 1,
                              }}
                              animate={{
                                height: [2, WAVEFORM_BAR_MAX_HEIGHT * 0.6, 2],
                              }}
                              transition={{
                                duration: 0.8,
                                repeat: Infinity,
                                delay: i * 0.05,
                                ease: "easeInOut",
                              }}
                            />
                          ))
                        : // Recording waveform
                          audioLevels.map((level, i) => (
                            <div
                              key={i}
                              style={{
                                width: WAVEFORM_BAR_WIDTH,
                                height: Math.max(2, level * WAVEFORM_BAR_MAX_HEIGHT),
                                background: "#fff",
                                borderRadius: 1,
                                transition: "height 0.05s ease",
                              }}
                            />
                          ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Instruction Text */}
      <div className="mt-6 text-center">
        <AnimatePresence mode="wait">
          {inputText ? (
            <motion.button
              key="reset"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              onClick={resetDemo}
              className="text-sm text-[#007aff] hover:underline"
            >
              try again
            </motion.button>
          ) : (
            <motion.p
              key="instruction"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-sm text-[#71717a]"
            >
              {isRecording ? (
                <span className="text-[#0a0a0a] font-medium">recording... release to transcribe</span>
              ) : isProcessing ? (
                <span className="text-[#0a0a0a] font-medium">transcribing...</span>
              ) : (
                <>
                  hold and release{" "}
                  <kbd className="px-1.5 py-0.5 bg-[#e4e4e7] rounded text-[11px] font-mono mx-0.5">
                    ⌥
                  </kbd>
                  <kbd className="px-1.5 py-0.5 bg-[#e4e4e7] rounded text-[11px] font-mono mx-0.5">
                    space
                  </kbd>{" "}
                  to respond
                </>
              )}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
