"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Phone, PhoneOff, Loader2 } from "lucide-react"

interface Message {
  speaker: "Agent" | "Customer"
  text: string
}

export default function CallButton({
  onTranscript,
  onStatusChange,
}: {
  onTranscript: (msgs: Message[]) => void
  onStatusChange: (s: "idle" | "connecting" | "connected" | "ended") => void
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended">("idle")
  const [error, setError] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)

  const ctxRef = useRef<AudioContext | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const msgsRef = useRef<Message[]>([])
  const cbRef = useRef({ onTranscript, onStatusChange })
  cbRef.current = { onTranscript, onStatusChange }

  const stopAll = useCallback(() => {
    procRef.current?.disconnect()
    procRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    setMicLevel(0)
  }, [])

  const endCall = useCallback(() => {
    stopAll()
    setStatus("ended")
    cbRef.current.onStatusChange("ended")
  }, [stopAll])

  const playBuffer = useCallback(async (pcm16Base64: string) => {
    const ctx = ctxRef.current
    if (!ctx) return

    if (ctx.state === "suspended") await ctx.resume()

    const raw = atob(pcm16Base64)
    const len = raw.length
    const i16 = new Int16Array(len / 2)
    for (let i = 0; i < len / 2; i++) {
      i16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)
    }
    const f32 = new Float32Array(i16.length)
    for (let i = 0; i < i16.length; i++) {
      f32[i] = i16[i] / 32768
    }

    const buf = ctx.createBuffer(1, f32.length, 24000)
    buf.getChannelData(0).set(f32)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start()
  }, [])

  const startCall = useCallback(async () => {
    setError(null)
    setStatus("connecting")
    cbRef.current.onStatusChange("connecting")
    msgsRef.current = []
    setMicLevel(0)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      console.log("[Stream] Microphone acquired", stream.getAudioTracks()[0].label)

      const ctx = new AudioContext()
      ctxRef.current = ctx
      console.log(`[AudioCtx] Created, state=${ctx.state}, sampleRate=${ctx.sampleRate}`)

      const ws = new WebSocket("ws://localhost:8000/ws/call")
      wsRef.current = ws
      ws.binaryType = "arraybuffer"

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === "audio" && msg.payload) {
            playBuffer(msg.payload)
          }
          if (msg.type === "transcript") {
            console.log(`[${msg.speaker}] ${msg.text}`)
            msgsRef.current = [...msgsRef.current, { speaker: msg.speaker, text: msg.text }]
            cbRef.current.onTranscript([...msgsRef.current])
          }
          if (msg.type === "error") setError(msg.message)
        } catch {}
      }
      ws.onclose = () => endCall()
      ws.onerror = () => {
        setError("Connection failed. Is the backend running on port 8000?")
        endCall()
      }

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "init", sampleRate: ctx.sampleRate }))
          console.log("[WS] Connected, sent init")
          resolve()
        }
        setTimeout(() => reject(new Error("WebSocket timeout")), 5000)
      })

      if (ctx.state === "suspended") {
        console.log("[AudioCtx] Resuming...")
        await ctx.resume()
        console.log(`[AudioCtx] State now: ${ctx.state}`)
      }

      const source = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      source.connect(proc)
      proc.connect(ctx.destination)

      let n = 0
      let maxVal = 0
      proc.onaudioprocess = (ev) => {
        n++
        const input = ev.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < input.length; i++) {
          const v = Math.abs(input[i])
          if (v > peak) peak = v
        }
        if (peak > maxVal) maxVal = peak

        if (n === 1 || n % 100 === 0) {
          console.log(`[Mic] Chunk #${n}, peak=${peak.toFixed(3)}, max=${maxVal.toFixed(3)}`)
        }

        const output = ev.outputBuffer.getChannelData(0)
        output.fill(0)

        const i16 = new Int16Array(input.length)
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]))
          i16[i] = s < 0 ? s * 32768 : s * 32767
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new Uint8Array(i16.buffer))
        }
      }

      setStatus("connected")
      cbRef.current.onStatusChange("connected")
      console.log("[Call] Ready - start speaking")
    } catch (err: any) {
      console.error("[Call] Error:", err)
      setError(err.message || "Failed to start")
      endCall()
    }
  }, [endCall, playBuffer])

  useEffect(() => () => stopAll(), [stopAll])

  const btn = (label: string, icon: React.ReactNode, cls: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-8 py-4 rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg ${cls}`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 rounded-lg px-4 py-2 text-center max-w-md">{error}</div>
      )}
      {status === "idle" &&
        btn("Call Now", <Phone className="w-5 h-5" />, "bg-green-600 hover:bg-green-700 text-white shadow-green-600/25", startCall)}
      {status === "connecting" && (
        <div className="flex items-center gap-3 px-8 py-4 bg-yellow-600/80 text-white rounded-full text-lg font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" /> Connecting...
        </div>
      )}
      {status === "connected" && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400">Microphone level:</span>
            <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 transition-all duration-100 rounded-full"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>
          {btn("End Call", <PhoneOff className="w-5 h-5" />, "bg-red-600 hover:bg-red-700 text-white shadow-red-600/25", endCall)}
          <p className="text-green-400 text-sm flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Call in progress — speak now
          </p>
        </>
      )}
      {status === "ended" &&
        btn("Call Again", <Phone className="w-5 h-5" />, "bg-green-600 hover:bg-green-700 text-white shadow-green-600/25", startCall)}
    </div>
  )
}
