import os
import io
import base64
from typing import AsyncGenerator
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


async def text_to_speech(text: str) -> bytes:
    """Convert text to PCM 16-bit 24kHz mono audio bytes."""
    response = await client.audio.speech.create(
        model="tts-1",
        voice="alloy",
        input=text,
        response_format="pcm",
        speed=1.05,
    )
    return response.content


async def text_to_speech_stream(text: str) -> AsyncGenerator[bytes, None]:
    """Stream TTS audio chunks. Falls back to whole response if streaming not supported."""
    audio = await text_to_speech(text)
    chunk_size = 4096
    for i in range(0, len(audio), chunk_size):
        yield audio[i : i + chunk_size]
