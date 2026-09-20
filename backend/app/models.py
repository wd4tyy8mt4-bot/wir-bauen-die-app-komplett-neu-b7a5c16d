"""
Database Models

Define your SQLAlchemy ORM models here.
Each model represents a table in your database.
"""

# CRITICAL: Always import Base from app.database - DO NOT create your own Base!
from app.database import Base

# Example model (delete and replace with your models):
# from sqlalchemy import Column, Integer, String, DateTime, func
#
# class User(Base):
#     __tablename__ = "users"
#     id = Column(Integer, primary_key=True)
#     email = Column(String(255), unique=True, nullable=False)
#     # CRITICAL: Always use server_default=func.now() for timestamps (prevents NULL values)
#     created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
#     updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
