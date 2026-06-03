"""
Polls Mirakl every N minutes for new products and runs the agent on each.
Falls back to demo products if Mirakl is not configured.
"""
import asyncio
import logging
import os

from src.mirakl_client import MiraklClient
from src.product_agent import ProductAgent
from src import database as db

logger = logging.getLogger(__name__)

DEMO_PRODUCTS = [
    {
        "offer_id": "demo-001",
        "title": "Nike Air Max 90",
        "description": "Chaussure",
        "category": "Chaussures de sport",
        "price": "129.99",
        "brand": "Nike",
        "images": [],
        "quantity": 10,
        "shop_name": "SportShop Pro",
    },
    {
        "offer_id": "demo-002",
        "title": "Casque Bluetooth Sony WH-1000XM5 - Réduction de bruit active, autonomie 30h, connexion multipoint, compatible Alexa et Google Assistant, coloris Noir",
        "description": "Le casque Sony WH-1000XM5 offre une réduction de bruit leader du secteur grâce à 8 microphones et 2 processeurs. Profitez de 30 heures d'autonomie, d'une recharge rapide (3h en 3 min), et d'un son Hi-Res certifié. Compatible avec Alexa, Google Assistant et Siri.",
        "category": "Audio / Casques",
        "price": "279.00",
        "origin_price": "349.00",
        "brand": "Sony",
        "ean": "4548736132252",
        "images": ["https://example.com/sony-wh1000xm5.jpg"],
        "quantity": 25,
        "shop_name": "TechStore Paris",
    },
    {
        "offer_id": "demo-003",
        "title": "T-shirt",
        "description": "",
        "category": "",
        "price": "9.99",
        "brand": "",
        "images": [],
        "quantity": 100,
        "shop_name": "FashionSeller",
    },
]


async def fetch_and_analyze():
    mirakl = MiraklClient()
    agent = ProductAgent()

    api_key = os.getenv("MIRAKL_API_KEY", "")
    if api_key and api_key != "your_mirakl_api_key_here":
        try:
            products = await mirakl.get_pending_products()
            logger.info(f"Fetched {len(products)} pending products from Mirakl")
        except Exception as e:
            logger.error(f"Mirakl fetch error: {e}")
            return
    else:
        logger.info("Mirakl not configured — loading demo products")
        products = [p for p in DEMO_PRODUCTS if not db.get_product(p["offer_id"])]
        if not products:
            logger.info("Demo products already analyzed, nothing to do")
            return

    for product in products:
        offer_id = product.get("offer_id") or product.get("id", "")
        if db.get_product(offer_id):
            continue
        try:
            logger.info(f"Analyzing product {offer_id}: {product.get('title', '')[:50]}")
            analysis = await agent.analyze_product(product)
            db.upsert_product(offer_id, product, analysis)
            logger.info(f"  → {analysis.get('recommendation')} (score {analysis.get('score')})")
        except Exception as e:
            logger.error(f"Error analyzing product {offer_id}: {e}")
