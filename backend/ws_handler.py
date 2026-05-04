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
        print(f"[WS] Sample rate: {sample_rate} Hz")
    except Exception as e:
        print(f"[WS] No init: {e}")
        sample_rate = 48000

    stt = DeepgramSTT(sample_rate=sample_rate)
    agent = LLMAgent()
    conv = ConversationManager()
    stt_queue: asyncio.Queue = asyncio.Queue()
    silence = 0
    chunk_count = 0
    stt_task = None

    try:
        await stt.connect()
    except Exception as e:
        print(f"[Deepgram] Failed: {e}")
        await websocket.close()
        return

    async def send_agent(text: str):
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

    async def process_input(user_text: str):
        nonlocal silence
        print(f"[User] {user_text}")
        conv.add_to_transcript("Customer", user_text)
        await websocket.send_json({
            "type": "transcript",
            "speaker": "Customer",
            "text": user_text,
        })
        agent.add_user_message(user_text)
        silence = 0

        try:
            result = await agent.get_response()
        except Exception as e:
            print(f"[LLM] Error: {e}")
            await send_agent("I'm sorry, I had trouble. Could you repeat that?")
            return

        if result.get("extracted_booking"):
            conv.set_booking(result["extracted_booking"])
            summary = conv.get_booking_summary()
            await send_agent(
                f"Let me confirm your booking:\n\n{summary}\n\n"
                f"Does everything look correct? Say 'yes' to confirm or tell me what to change."
            )
        elif result.get("done") and result.get("confirmed"):
            conv.confirmed = True
            await send_agent(
                f"Perfect! Your booking is confirmed. Thank you for choosing {restaurant_name}. "
                f"We look forward to serving you. Have a wonderful day!"
            )
        elif result.get("text"):
            agent_text = result["text"]
            print(f"[Agent] {agent_text}")
            await send_agent(agent_text)

    async def stt_listener():
        while not conv.done:
            try:
                transcript = await stt.receive_transcript()
                if transcript:
                    await stt_queue.put(transcript)
            except Exception:
                await asyncio.sleep(0.1)

    try:
        await send_agent(
            f"Hello, and welcome to {restaurant_name}! "
            f"I'm the automated booking assistant. "
            f"Are you looking to book a table or place a takeaway order today?"
        )

        stt_task = asyncio.create_task(stt_listener())

        while not conv.done:
            try:
                data = await asyncio.wait_for(websocket.receive(), timeout=0.3)
                if "bytes" in data:
                    chunk_count += 1
                    if chunk_count == 1:
                        print(f"[Audio] Receiving ({len(data['bytes'])} bytes/chunk)")
                    if chunk_count % 200 == 0:
                        print(f"[Audio] {chunk_count} chunks total")
                    stt.send_audio(data["bytes"])
                elif "text" in data:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "end":
                        conv.done = True
                        break
                    elif msg.get("type") == "user_text" and msg.get("text"):
                        await process_input(msg["text"])
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                print(f"[WS] Error: {e}")
                break

            try:
                transcript = stt_queue.get_nowait()
                if transcript.get("is_final") and transcript.get("text"):
                    await process_input(transcript["text"])
            except asyncio.QueueEmpty:
                pass

            silence += 1
            if silence >= 200:
                await send_agent(
                    "I'm not hearing you. Please check your microphone and speak again, "
                    "or type your message in the text box below."
                )
                silence = 0

            await asyncio.sleep(0.05)

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
        print(f"[WS] Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if stt_task and not stt_task.done():
            stt_task.cancel()
        await stt.close()
        try:
            await websocket.close()
        except Exception:
            pass
        print(f"[WS] Disconnected ({chunk_count} audio chunks)")
