"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Phone, PhoneOff, Loader2 } from "lucide-react"

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
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workletRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const messagesRef = useRef<Message[]>([])
  const audioQueueRef = useRef<Float32Array[]>([])
  const playingRef = useRef(false)
  const gainRef = useRef<GainNode | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onStatusChangeRef = useRef(onStatusChange)
  const endCallRef = useRef<() => void>(() => {})

  useEffect(() => {
    onTranscriptRef.current = onTranscript
  }, [onTranscript])

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  }, [onStatusChange])

  const playNext = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      playingRef.current = false
      return
    }
    playingRef.current = true
    const ctx = ctxRef.current
    const gain = gainRef.current
    if (!ctx || !gain) return

    const pcmData = audioQueueRef.current.shift()!
    const buffer = ctx.createBuffer(1, pcmData.length, 24000)
    buffer.getChannelData(0).set(pcmData)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    source.onended = () => playNext()
    source.start()
  }, [])

  const cleanup = useCallback(() => {
    if (workletRef.current) {
      try { workletRef.current.disconnect() } catch {}
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {})
      ctxRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    audioQueueRef.current = []
    playingRef.current = false
    workletRef.current = null
  }, [])

  const endCall = useCallback(() => {
    cleanup()
    onStatusChangeRef.current("ended")
    setStatus("ended")
  }, [cleanup])

  useEffect(() => {
    endCallRef.current = endCall
  }, [endCall])

  const startCall = useCallback(async () => {
    setError(null)
    setStatus("connecting")
    onStatusChangeRef.current("connecting")
    messagesRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 16000 })
      ctxRef.current = ctx

      const gain = ctx.createGain()
      gain.gain.value = 0.8
      gain.connect(ctx.destination)
      gainRef.current = gain

      const ws = new WebSocket("ws://localhost:8000/ws/call")
      wsRef.current = ws
      ws.binaryType = "arraybuffer"

      ws.onopen = () => {
        setStatus("connected")
        onStatusChangeRef.current("connected")

        const source = ctx.createMediaStreamSource(stream)

        const processor = ctx.createScriptProcessor(4096, 1, 1)
        workletRef.current = processor
        source.connect(processor)

        const silentGain = ctx.createGain()
        silentGain.gain.value = 0
        processor.connect(silentGain)
        silentGain.connect(ctx.destination)

        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0)
          const pcm16 = new Int16Array(input.length)
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]))
            pcm16[i] = s < 0 ? s * 32768 : s * 32767
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
            const len = binary.length
            const pcm16 = new Int16Array(len / 2)
            for (let i = 0; i < len / 2; i++) {
              pcm16[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)
            }
            const float32 = new Float32Array(pcm16.length)
            for (let i = 0; i < pcm16.length; i++) {
              float32[i] = pcm16[i] / 32768.0
            }
            audioQueueRef.current.push(float32)
            if (!playingRef.current) {
              playNext()
            }
          }

          if (msg.type === "transcript") {
            messagesRef.current = [
              ...messagesRef.current,
              { speaker: msg.speaker, text: msg.text },
            ]
            onTranscriptRef.current([...messagesRef.current])
          }

          if (msg.type === "result" && msg.done) {
            setTimeout(() => endCallRef.current(), 3000)
          }

          if (msg.type === "error") {
            setError(msg.message)
          }
        } catch {}
      }

      ws.onclose = () => {
        setStatus("ended")
        onStatusChangeRef.current("ended")
        cleanup()
      }

      ws.onerror = () => {
        setError("Connection failed. Is the backend running on port 8000?")
        endCallRef.current()
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Microphone access denied. Please allow mic permissions.")
      } else {
        setError(err.message || "Failed to start call")
      }
      endCallRef.current()
    }
  }, [playNext, cleanup])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 rounded-lg px-4 py-2 max-w-md text-center">
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
        <div className="flex items-center gap-3 px-8 py-4 bg-yellow-600/80 text-white rounded-full text-lg font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" />
          Connecting...
        </div>
      )}

      {status === "connected" && (
        <button
          onClick={() => endCallRef.current()}
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
