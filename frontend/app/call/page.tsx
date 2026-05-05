"use client"

import { useEffect, useRef, useState } from "react"
import CallButton from "@/components/CallButton"
import AudioVisualizer from "@/components/AudioVisualizer"
import { Phone } from "lucide-react"

interface Message {
  speaker: "Agent" | "Customer"
  text: string
}

export default function CallPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended">("idle")
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript) return

    transcript.scrollTo({
      top: transcript.scrollHeight,
      behavior: status === "connected" ? "smooth" : "auto",
    })
  }, [messages, status])

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] p-6">
      <div className="max-w-2xl w-full space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-gray-800 rounded-full border border-gray-700">
            <Phone className="w-4 h-4 text-green-400" />
            <span className="text-sm text-gray-300">
              AI Restaurant Assistant
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white">
            Book a Table or Order Food
          </h1>
          <p className="text-gray-400 max-w-md mx-auto">
            Call our AI agent to reserve a table or place a takeaway order.
            Speak naturally — our agent will guide you through the process.
          </p>
        </div>

        <AudioVisualizer status={status} />

        <CallButton
          onTranscript={setMessages}
          onStatusChange={setStatus}
        />

        {messages.length > 0 && (
          <div
            ref={transcriptRef}
            className="space-y-3 max-h-80 overflow-y-auto scroll-smooth"
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.speaker === "Customer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                    msg.speaker === "Customer"
                      ? "bg-green-600 text-white rounded-br-md"
                      : "bg-gray-800 text-gray-200 rounded-bl-md border border-gray-700"
                  }`}
                >
                  <p className="text-xs font-medium mb-1 opacity-70">
                    {msg.speaker}
                  </p>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
