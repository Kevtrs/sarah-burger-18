from __future__ import annotations

import threading
from collections import deque

from .models import OrderEvent

STATUS_PRIORITY = ("preparing", "received", "served", "cancelled")


class DisplayQueue:
    def __init__(self, *, queue_existing_ready_on_start: bool = False):
        self._condition = threading.Condition()
        self._last_status_by_order: dict[str, str] = {}
        self._latest_by_order: dict[str, OrderEvent] = {}
        self._ready_queue: deque[OrderEvent] = deque()
        self._ready_ids: set[str] = set()
        self._queue_existing_ready_on_start = queue_existing_ready_on_start

    def enqueue(self, event: OrderEvent) -> bool:
        with self._condition:
            previous_status = self._last_status_by_order.get(event.order_id)
            if previous_status == event.status:
                return False

            self._last_status_by_order[event.order_id] = event.status

            if event.status == "ready":
                if event.initial and previous_status is None and not self._queue_existing_ready_on_start:
                    return False
                if event.order_id not in self._ready_ids:
                    self._ready_queue.append(event)
                    self._ready_ids.add(event.order_id)
                    self._condition.notify()
                    return True
                return False

            self._ready_ids.discard(event.order_id)
            self._latest_by_order[event.order_id] = event
            self._condition.notify()
            return True

    def next_event(self, timeout: float | None = None) -> OrderEvent | None:
        with self._condition:
            if not self._ready_queue and not self._latest_by_order:
                self._condition.wait(timeout=timeout)

            if self._ready_queue:
                event = self._ready_queue.popleft()
                self._ready_ids.discard(event.order_id)
                return event

            for status in STATUS_PRIORITY:
                matches = [
                    event for event in self._latest_by_order.values() if event.status == status
                ]
                if matches:
                    event = sorted(matches, key=lambda item: item.number)[0]
                    self._latest_by_order.pop(event.order_id, None)
                    return event

            return None
