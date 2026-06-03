"""
Simple JSON file-based store so there's no DB to set up.
Stores analyzed products with their analysis results and status.
"""
import json
import os
from datetime import datetime
from typing import Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "products.json")


def _load() -> dict:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if not os.path.exists(DB_PATH):
        return {}
    with open(DB_PATH) as f:
        return json.load(f)


def _save(data: dict):
    with open(DB_PATH, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def upsert_product(offer_id: str, product_data: dict, analysis: dict):
    db = _load()
    existing = db.get(offer_id, {})
    db[offer_id] = {
        **existing,
        "offer_id": offer_id,
        "product": product_data,
        "analysis": analysis,
        "status": existing.get("status", "pending"),
        "analyzed_at": datetime.now().isoformat(),
        "validated_at": existing.get("validated_at"),
    }
    _save(db)


def get_all_products() -> list[dict]:
    db = _load()
    return sorted(db.values(), key=lambda x: x.get("analyzed_at", ""), reverse=True)


def get_product(offer_id: str) -> Optional[dict]:
    return _load().get(offer_id)


def update_status(offer_id: str, status: str):
    db = _load()
    if offer_id in db:
        db[offer_id]["status"] = status
        db[offer_id]["validated_at"] = datetime.now().isoformat()
        _save(db)


def update_seller_message(offer_id: str, message: str):
    db = _load()
    if offer_id in db:
        db[offer_id]["analysis"]["seller_message"] = message
        _save(db)


def get_stats() -> dict:
    products = get_all_products()
    return {
        "pending": sum(1 for p in products if p["status"] == "pending"),
        "approved": sum(1 for p in products if p["status"] == "approved"),
        "rejected": sum(1 for p in products if p["status"] == "rejected"),
        "total": len(products),
    }
