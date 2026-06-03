import httpx
import os
from typing import Optional


class MiraklClient:
    def __init__(self):
        self.api_key = os.getenv("MIRAKL_API_KEY")
        self.base_url = os.getenv("MIRAKL_BASE_URL", "").rstrip("/")
        self.headers = {"Authorization": self.api_key}

    async def get_pending_products(self, max_count: int = 50) -> list[dict]:
        """Fetch products awaiting validation (status WAITING_FOR_OPERATOR_VALIDATION)."""
        url = f"{self.base_url}/api/offers"
        params = {
            "offer_state_codes": "WAITING_FOR_OPERATOR_VALIDATION",
            "max": max_count,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = client.get(url, headers=self.headers, params=params)
            response.raise_for_status()
            data = response.json()
            return data.get("offers", [])

    async def get_product_details(self, offer_id: str) -> dict:
        url = f"{self.base_url}/api/offers/{offer_id}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def validate_product(self, offer_id: str) -> bool:
        url = f"{self.base_url}/api/offers/{offer_id}/validate"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.put(url, headers=self.headers)
            return response.status_code == 200

    async def reject_product(self, offer_id: str, reason: str) -> bool:
        url = f"{self.base_url}/api/offers/{offer_id}/reject"
        payload = {"reason": reason}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.put(url, headers=self.headers, json=payload)
            return response.status_code == 200

    async def send_seller_message(self, offer_id: str, message: str) -> bool:
        """Send feedback message to the seller."""
        url = f"{self.base_url}/api/offers/{offer_id}/message"
        payload = {"body": message}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=self.headers, json=payload)
            return response.status_code in (200, 201)
