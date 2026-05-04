import asyncio
import json
import base64
from fastapi import WebSocket
from stt import DeepgramSTT
from llm import LLMAgent
from tts import text_to_speech
from conversation import ConversationManager
from config_loader import get_config

_config = get_config()
restaurant_name = _config["restaurant"]["name"]


async def handle_call(websocket: WebSocket):
    await websocket.accept()
    print("[WS] Call connected")

    try:
        init_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        sample_rate = init_msg.get("sampleRate", 48000)
        print(f"[WS] Browser sample rate: {sample_rate} Hz")
    except Exception as e:
        print(f"[WS] No init message: {e}")
        sample_rate = 48000

    stt = DeepgramSTT(sample_rate=sample_rate)
    agent = LLMAgent()
    conv = ConversationManager()
    silence_count = 0
    audio_count = 0

    try:
        await stt.connect()
        print("[Deepgram] Connected")
    except Exception as e:
        print(f"[Deepgram] Connection failed: {e}")
        await websocket.close()
        return

    greeting = (
        f"Hello, and welcome to {restaurant_name}! "
        f"This is the automated booking assistant. "
        f"Are you looking to book a table or place a takeaway order today?"
    )

    try:
        greeting_audio = await text_to_speech(greeting)
        await websocket.send_json({
            "type": "audio",
            "payload": base64.b64encode(greeting_audio).decode("utf-8"),
        })
        await websocket.send_json({
            "type": "transcript",
            "speaker": "Agent",
            "text": greeting,
        })
        conv.add_to_transcript("Agent", greeting)
    except Exception as e:
        print(f"[TTS] Greeting error: {e}")

    async def receive_audio():
        nonlocal audio_count
        while not conv.done:
            try:
                data = await asyncio.wait_for(websocket.receive(), timeout=0.2)
                if "bytes" in data:
                    audio_count += 1
                    if audio_count == 1:
                        print(f"[Audio] First chunk received: {len(data['bytes'])} bytes")
                    if audio_count % 100 == 0:
                        print(f"[Audio] {audio_count} chunks received")
                    try:
                        stt.send_audio(data["bytes"])
                    except Exception as e:
                        print(f"[Audio] Send error: {e}")
                elif "text" in data:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "end":
                        conv.done = True
                        break
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                print(f"[Audio] Receive error: {e}")
                break

    async def speak(text: str):
        conv.add_to_transcript("Agent", text)
        try:
            audio = await text_to_speech(text)
            await websocket.send_json({
                "type": "audio",
                "payload": base64.b64encode(audio).decode("utf-8"),
            })
        except Exception as e:
            print(f"[TTS] Error: {e}")
        await websocket.send_json({
            "type": "transcript",
            "speaker": "Agent",
            "text": text,
        })

    try:
        audio_task = asyncio.create_task(receive_audio())

        while not conv.done:
            transcript = await stt.receive_transcript()

            if transcript and transcript.get("is_final") and transcript.get("text"):
                user_text = transcript["text"]
                print(f"[User] {user_text}")
                conv.add_to_transcript("Customer", user_text)
                await websocket.send_json({
                    "type": "transcript",
                    "speaker": "Customer",
                    "text": user_text,
                })

                agent.add_user_message(user_text)
                silence_count = 0

                try:
                    result = await agent.get_response()
                except Exception as e:
                    print(f"[LLM] Error: {e}")
                    await speak("I'm sorry, I had trouble understanding. Could you repeat that?")
                    continue

                if result.get("extracted_booking"):
                    conv.set_booking(result["extracted_booking"])
                    summary = conv.get_booking_summary()
                    await speak(
                        f"Let me confirm your booking:\n\n{summary}\n\n"
                        f"Does everything look correct? Please say 'yes' to confirm "
                        f"or let me know what needs to change."
                    )

                elif result.get("done") and result.get("confirmed"):
                    conv.confirmed = True
                    await speak(
                        f"Perfect! Your booking is confirmed. Thank you for choosing "
                        f"{restaurant_name}. We look forward to serving you. Have a wonderful day!"
                    )

                elif result.get("text"):
                    agent_text = result["text"]
                    print(f"[Agent] {agent_text}")
                    await speak(agent_text)

            elif transcript is None:
                silence_count += 1
                if silence_count >= 15:
                    await speak(
                        "I didn't quite catch that. Could you please repeat what you said? "
                        "Speak clearly into your microphone."
                    )
                    silence_count = 0
            else:
                silence_count = 0

            await asyncio.sleep(0.01)

        await audio_task

        await websocket.send_json({
            "type": "result",
            "booking": conv.booking,
            "confirmed": conv.confirmed,
            "done": conv.done,
        })

        if conv.confirmed and conv.booking:
            from database import async_session
            from models import Booking
            from datetime import date, time

            b = conv.booking
            try:
                booking_date = date.fromisoformat(b["date"])
                booking_time = time.fromisoformat(b["time"])
            except (ValueError, KeyError):
                booking_date = date.today()
                booking_time = time(19, 0)

            total = 0.0
            if b.get("food_order"):
                for item in b["food_order"]:
                    total += item.get("price", 0) * item.get("quantity", 0)

            async with async_session() as session:
                booking = Booking(
                    customer_name=b.get("customer_name", "Unknown"),
                    contact_number=b.get("contact_number", ""),
                    guest_count=b.get("guest_count", 1),
                    date=booking_date,
                    time=booking_time,
                    special_requests=b.get("special_requests"),
                    food_order=b.get("food_order"),
                    payment_method=b.get("payment_method", "card_at_arrival"),
                    status="confirmed",
                    total_amount=total,
                    conversation_summary=conv.get_transcript_text(),
                )
                session.add(booking)
                await session.commit()

            await websocket.send_json({
                "type": "booking_saved",
                "booking_id": booking.id,
            })

            from main import broadcast_booking
            await broadcast_booking(booking.to_dict())
            print(f"[DB] Booking saved: {booking.id}")

    except Exception as e:
        print(f"[WS] Error in call: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        await stt.close()
        if audio_task and not audio_task.done():
            audio_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
        print(f"[WS] Call disconnected (audio chunks: {audio_count})")
