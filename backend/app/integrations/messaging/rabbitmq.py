from uuid import UUID

import aio_pika
from aio_pika.abc import AbstractRobustConnection
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings


class JobMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_version: int = Field(default=1, ge=1, le=1)
    message_id: UUID
    job_id: UUID
    generation: int = Field(ge=1)


async def connect(settings: Settings) -> AbstractRobustConnection:
    if settings.rabbitmq_url is None:
        raise RuntimeError("rabbitmq_url must be configured")
    return await aio_pika.connect_robust(settings.rabbitmq_url.get_secret_value(), timeout=5)


async def channel_and_queue(connection: AbstractRobustConnection, settings: Settings):
    channel = await connection.channel(publisher_confirms=True, on_return_raises=True)
    await channel.set_qos(prefetch_count=1)
    dlq_name = settings.queue_name + ".dead"
    await channel.declare_queue(dlq_name, durable=True)
    queue = await channel.declare_queue(
        settings.queue_name,
        durable=True,
        arguments={
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": dlq_name,
        },
    )
    return channel, queue


async def publish(channel, settings: Settings, message: JobMessage) -> None:
    confirmation = await channel.default_exchange.publish(
        aio_pika.Message(
            body=message.model_dump_json().encode(),
            message_id=str(message.message_id),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        ),
        routing_key=settings.queue_name,
        mandatory=True,
        timeout=5,
    )
    if confirmation is False or confirmation is None:
        raise RuntimeError("publisher_confirmation_missing")
