from dataclasses import dataclass, field


@dataclass
class Invoice:
    id: int
    customer_id: int
    amount_cents: int
    sent: bool = False


@dataclass
class Store:
    invoices: dict[int, Invoice] = field(default_factory=dict)
    processed_messages: set[str] = field(default_factory=set)


store = Store()
