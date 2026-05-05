import os
import asyncio
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)
from dotenv import load_dotenv

load_dotenv()


class DeepgramSTT:
    def __init__(self, sample_rate: int = 48000):
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            raise ValueError("DEEPGRAM_API_KEY not set")
        self.client = DeepgramClient(api_key)
        self.sample_rate = sample_rate
        self.event_queue: asyncio.Queue = asyncio.Queue()
        self._loop = None
        self._connection = None
        self._keepalive_task = None
        self._running = False

    def _queue_event(self, event: dict):
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self.event_queue.put_nowait, event)
        else:
            self.event_queue.put_nowait(event)

    def _on_transcript(self, *args, **kwargs):
        try:
            result = kwargs.get("result")
            if result is None:
                result = args[-1] if args else None
            if result is None:
                return
            channel = result.channel
            if not channel or not channel.alternatives:
                return
            sentence = channel.alternatives[0].transcript
            if not sentence:
                return
            speech_final = bool(getattr(result, "speech_final", False))
            is_final = bool(getattr(result, "is_final", speech_final))
            final = speech_final or is_final
            print(f"[Deepgram] {'FINAL' if final else 'interim'}: {sentence}")
            self._queue_event({
                "type": "transcript",
                "text": sentence.strip(),
                "is_final": final,
                "speech_final": speech_final,
            })
        except Exception as e:
            print(f"[Deepgram] Parse error: {e}")

    def _on_speech_started(self, *args, **kwargs):
        print("[Deepgram] Speech started")
        self._queue_event({"type": "speech_started"})

    def _on_utterance_end(self, *args, **kwargs):
        print("[Deepgram] Utterance end")
        self._queue_event({"type": "utterance_end"})

    def _on_error(self, *args, **kwargs):
        error = kwargs.get("error") or (args[-1] if args else None)
        print(f"[Deepgram] ERROR: {error}")

    def _on_close(self, *args, **kwargs):
        print("[Deepgram] Connection closed")
        self._running = False

    def _on_open(self, *args, **kwargs):
        print("[Deepgram] Connection opened")

    async def _keepalive(self):
        while self._running:
            try:
                if self._connection:
                    self._connection.keep_alive()
            except Exception:
                pass
            await asyncio.sleep(5)

    async def connect(self):
        self._loop = asyncio.get_running_loop()
        self._running = True
        self._connection = self.client.listen.live.v("1")
        self._connection.on(LiveTranscriptionEvents.Open, self._on_open)
        self._connection.on(LiveTranscriptionEvents.Transcript, self._on_transcript)
        self._connection.on(LiveTranscriptionEvents.SpeechStarted, self._on_speech_started)
        self._connection.on(LiveTranscriptionEvents.UtteranceEnd, self._on_utterance_end)
        self._connection.on(LiveTranscriptionEvents.Error, self._on_error)
        self._connection.on(LiveTranscriptionEvents.Close, self._on_close)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=True,
            no_delay=True,
            utterance_end_ms="500",
            vad_events=True,
            encoding="linear16",
            sample_rate=self.sample_rate,
            channels=1,
            endpointing=150,
        )
        started = self._connection.start(options)
        print(f"[Deepgram] Start result: {started}, rate: {self.sample_rate}")
        self._keepalive_task = asyncio.create_task(self._keepalive())
        return started

    def send_audio(self, audio_bytes: bytes):
        if self._connection and self._running:
            self._connection.send(audio_bytes)

    async def receive_event(self):
        try:
            return await asyncio.wait_for(self.event_queue.get(), timeout=30.0)
        except asyncio.TimeoutError:
            return None

    async def receive_transcript(self):
        while True:
            event = await self.receive_event()
            if event is None or event.get("type") == "transcript":
                return event

    async def close(self):
        self._running = False
        if self._keepalive_task:
            self._keepalive_task.cancel()
        if self._connection:
            try:
                self._connection.finish()
            except Exception:
                pass
