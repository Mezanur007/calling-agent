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

    stt = DeepgramSTT()
    agent = LLMAgent()
    conv = ConversationManager()
    connected = False
    audio_task = None
    conv_task = None

    async def receive_audio():
        while True:
            try:
                data = await websocket.receive()
                if "bytes" in data:
                    await stt.send_audio(data["bytes"])
                elif "text" in data:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "end":
                        conv.done = True
                        break
            except Exception:
                break

    async def conversation_loop():
        nonlocal connected

        try:
            greeting = (
                f"Hello, and welcome to {restaurant_name}! "
                f"This is the automated booking assistant. "
                f"Are you looking to book a table or place a takeaway order today?"
            )
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

                    try:
                        result = await agent.get_response()
                    except Exception as e:
                        print(f"[LLM] Error: {e}")
                        error_msg = "I'm sorry, I had trouble understanding. Could you repeat that?"
                        error_audio = await text_to_speech(error_msg)
                        await websocket.send_json({
                            "type": "audio",
                            "payload": base64.b64encode(error_audio).decode("utf-8"),
                        })
                        await websocket.send_json({
                            "type": "transcript",
                            "speaker": "Agent",
                            "text": error_msg,
                        })
                        continue

                    if result.get("extracted_booking"):
                        conv.set_booking(result["extracted_booking"])
                        summary = conv.get_booking_summary()
                        confirmation_text = (
                            f"Let me confirm your booking:\n\n{summary}\n\n"
                            f"Does everything look correct? Please say 'yes' to confirm "
                            f"or let me know what needs to change."
                        )
                        confirmation_audio = await text_to_speech(confirmation_text)
                        await websocket.send_json({
                            "type": "audio",
                            "payload": base64.b64encode(confirmation_audio).decode("utf-8"),
                        })
                        await websocket.send_json({
                            "type": "transcript",
                            "speaker": "Agent",
                            "text": confirmation_text,
                        })
                        conv.add_to_transcript("Agent", confirmation_text)

                    elif result.get("done") and result.get("confirmed"):
                        conv.confirmed = True
                        final_text = (
                            f"Perfect! Your booking is confirmed. Thank you for choosing "
                            f"{restaurant_name}. We look forward to serving you. Have a wonderful day!"
                        )
                        final_audio = await text_to_speech(final_text)
                        await websocket.send_json({
                            "type": "audio",
                            "payload": base64.b64encode(final_audio).decode("utf-8"),
                        })
                        await websocket.send_json({
                            "type": "transcript",
                            "speaker": "Agent",
                            "text": final_text,
                        })
                        conv.add_to_transcript("Agent", final_text)

                    elif result.get("text"):
                        agent_text = result["text"]
                        print(f"[Agent] {agent_text}")
                        try:
                            agent_audio = await text_to_speech(agent_text)
                            await websocket.send_json({
                                "type": "audio",
                                "payload": base64.b64encode(agent_audio).decode("utf-8"),
                            })
                        except Exception as e:
                            print(f"[TTS] Error: {e}")
                        await websocket.send_json({
                            "type": "transcript",
                            "speaker": "Agent",
                            "text": agent_text,
                        })
                        conv.add_to_transcript("Agent", agent_text)

                elif transcript is None and not conv.done:
                    continue

                await asyncio.sleep(0.01)

        except Exception as e:
            print(f"[Conv] Error: {e}")
        finally:
            conv.done = True

    try:
        await stt.connect()
        connected = True

        audio_task = asyncio.create_task(receive_audio())
        conv_task = asyncio.create_task(conversation_loop())

        await conv_task

        if audio_task and not audio_task.done():
            audio_task.cancel()
            try:
                await audio_task
            except asyncio.CancelledError:
                pass

        result_msg = {
            "type": "result",
            "booking": conv.booking,
            "confirmed": conv.confirmed,
            "done": conv.done,
        }
        await websocket.send_json(result_msg)

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
        if connected:
            await stt.close()
        if audio_task and not audio_task.done():
            audio_task.cancel()
        if conv_task and not conv_task.done():
            conv_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass
        print("[WS] Call disconnected")
