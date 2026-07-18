from __future__ import annotations

import threading
from collections import deque

from .models import OrderEvent

STATUS_PRIORITY = {"ready": 0, "received": 1, "preparing": 2, "served": 3, "cancelled": 4}


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

            if event.initial and previous_status is None:
                if event.status in {"served", "cancelled"}:
                    return False
                if event.status == "ready" and not self._queue_existing_ready_on_start:
                    return False

            if event.status == "ready":
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

            if self._latest_by_order:
                event = sorted(
                    self._latest_by_order.values(),
                    key=lambda item: (item.number, STATUS_PRIORITY.get(item.status, 9)),
                )[0]
                self._latest_by_order.pop(event.order_id, None)
                return event

            return None
