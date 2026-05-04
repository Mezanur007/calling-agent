from sqlalchemy import Column, String, Integer, Float, Date, Time, Text, JSON, Enum, DateTime
from sqlalchemy.ext.declarative import declarative_base
import uuid
from datetime import datetime

Base = declarative_base()


class Booking(Base):
    __tablename__ = "bookings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    customer_name = Column(String, nullable=False)
    contact_number = Column(String, nullable=False)
    guest_count = Column(Integer, nullable=False)
    date = Column(Date, nullable=False)
    time = Column(Time, nullable=False)
    special_requests = Column(Text, nullable=True)
    food_order = Column(JSON, nullable=True)
    payment_method = Column(String, default="card_at_arrival")
    status = Column(String, default="confirmed")
    total_amount = Column(Float, default=0.0)
    conversation_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "customer_name": self.customer_name,
            "contact_number": self.contact_number,
            "guest_count": self.guest_count,
            "date": str(self.date),
            "time": str(self.time),
            "special_requests": self.special_requests,
            "food_order": self.food_order,
            "payment_method": self.payment_method,
            "status": self.status,
            "total_amount": self.total_amount,
            "conversation_summary": self.conversation_summary,
            "created_at": str(self.created_at),
        }
