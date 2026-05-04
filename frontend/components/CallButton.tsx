"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Phone, PhoneOff, Mic, MicOff, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Message {
  speaker: "Agent" | "Customer"
  text: string
}

interface Props {
  onTranscript: (messages: Message[]) => void
  onStatusChange: (status: "idle" | "connecting" | "connected" | "ended") => void
}

export default function CallButton({ onTranscript, onStatusChange }: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended">("idle")
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const messagesRef = useRef<Message[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioQueueRef = useRef<Float32Array[]>([])
  const playingRef = useRef(false)
  const gainNodeRef = useRef<GainNode | null>(null)

  const updateStatus = useCallback(
    (s: "idle" | "connecting" | "connected" | "ended") => {
      setStatus(s)
      onStatusChange(s)
    },
    [onStatusChange]
  )

  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      playingRef.current = false
      return
    }
    playingRef.current = true
    const ctx = audioContextRef.current
    const gain = gainNodeRef.current
    if (!ctx || !gain) return

    const pcmData = audioQueueRef.current.shift()!
    const buffer = ctx.createBuffer(1, pcmData.length, 24000)
    buffer.getChannelData(0).set(pcmData)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    source.onended = () => playNextAudio()
    source.start()
  }, [])

  const startCall = useCallback(async () => {
    setError(null)
    updateStatus("connecting")
    messagesRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = ctx

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      analyserRef.current = analyser

      const gain = ctx.createGain()
      gain.gain.value = 0.8
      gainNodeRef.current = gain
      gain.connect(ctx.destination)

      const ws = new WebSocket("ws://localhost:8000/ws/call")
      wsRef.current = ws

      ws.onopen = () => {
        updateStatus("connected")

        const source = ctx.createMediaStreamSource(stream)
        sourceRef.current = source
        source.connect(analyser)

        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor
        source.connect(processor)
        processor.connect(ctx.destination)

        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0)
          const pcm16 = new Int16Array(input.length)
          for (let i = 0; i < input.length; i++) {
            pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)))
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(pcm16.buffer)
          }
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === "audio" && msg.payload) {
            const binary = atob(msg.payload)
            const pcm16 = new Int16Array(binary.length / 2)
            for (let i = 0; i < pcm16.length; i++) {
              pcm16[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)
            }
            const float32 = new Float32Array(pcm16.length)
            for (let i = 0; i < pcm16.length; i++) {
              float32[i] = pcm16[i] / 32768.0
            }
            audioQueueRef.current.push(float32)
            if (!playingRef.current) {
              playNextAudio()
            }
          }

          if (msg.type === "transcript") {
            messagesRef.current.push({
              speaker: msg.speaker,
              text: msg.text,
            })
            onTranscript([...messagesRef.current])
          }

          if (msg.type === "result" && msg.done) {
            setTimeout(() => endCall(), 3000)
          }

          if (msg.type === "error") {
            setError(msg.message)
          }
        } catch {}
      }

      ws.onclose = () => {
        updateStatus("ended")
      }

      ws.onerror = () => {
        setError("Connection failed. Is the server running?")
        updateStatus("ended")
      }
    } catch (err: any) {
      setError(err.message || "Microphone access denied")
      updateStatus("ended")
    }
  }, [])

  const endCall = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect()
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
    }
    if (wsRef.current) {
      wsRef.current.close()
    }
    audioQueueRef.current = []
    playingRef.current = false
    updateStatus("ended")
  }, [updateStatus])

  useEffect(() => {
    return () => {
      endCall()
    }
  }, [endCall])

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {status === "idle" && (
        <button
          onClick={startCall}
          className="flex items-center gap-3 px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg shadow-green-600/25"
        >
          <Phone className="w-5 h-5" />
          Call Now
        </button>
      )}

      {status === "connecting" && (
        <div className="flex items-center gap-3 px-8 py-4 bg-yellow-600 text-white rounded-full text-lg font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          Connecting...
        </div>
      )}

      {status === "connected" && (
        <button
          onClick={endCall}
          className="flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-700 text-white rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-600/25"
        >
          <PhoneOff className="w-5 h-5" />
          End Call
        </button>
      )}

      {status === "ended" && (
        <button
          onClick={startCall}
          className="flex items-center gap-3 px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg shadow-green-600/25"
        >
          <Phone className="w-5 h-5" />
          Call Again
        </button>
      )}

      {status === "connected" && (
        <p className="text-green-400 text-sm flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Call in progress
        </p>
      )}
    </div>
  )
}
