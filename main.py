import asyncio
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler

load_dotenv()

from src import database as db
from src.scheduler import fetch_and_analyze

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Mirakl Product Agent")
templates = Jinja2Templates(directory="templates")
scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def startup():
    interval = int(os.getenv("POLL_INTERVAL_MINUTES", "10"))
    scheduler.add_job(fetch_and_analyze, "interval", minutes=interval, id="poll_mirakl")
    scheduler.start()
    # Run immediately on startup
    asyncio.create_task(fetch_and_analyze())


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/api/products")
async def list_products():
    return db.get_all_products()


@app.get("/api/stats")
async def get_stats():
    return db.get_stats()


@app.post("/api/analyze")
async def trigger_analysis():
    asyncio.create_task(fetch_and_analyze())
    return {"status": "analysis started"}


@app.post("/api/products/{offer_id}/validate")
async def validate(offer_id: str):
    product = db.get_product(offer_id)
    if not product:
        raise HTTPException(404, "Product not found")
    db.update_status(offer_id, "approved")
    # If Mirakl is configured, also call the real API
    api_key = os.getenv("MIRAKL_API_KEY", "")
    if api_key and api_key != "your_mirakl_api_key_here":
        from src.mirakl_client import MiraklClient
        await MiraklClient().validate_product(offer_id)
    return {"status": "approved"}


@app.post("/api/products/{offer_id}/reject")
async def reject(offer_id: str):
    product = db.get_product(offer_id)
    if not product:
        raise HTTPException(404, "Product not found")
    db.update_status(offer_id, "rejected")
    analysis = product.get("analysis", {})
    reason = analysis.get("seller_message", "Produit non conforme")
    api_key = os.getenv("MIRAKL_API_KEY", "")
    if api_key and api_key != "your_mirakl_api_key_here":
        from src.mirakl_client import MiraklClient
        await MiraklClient().reject_product(offer_id, reason)
    return {"status": "rejected"}


class MessageUpdate(BaseModel):
    message: str


@app.put("/api/products/{offer_id}/message")
async def update_message(offer_id: str, body: MessageUpdate):
    if not db.get_product(offer_id):
        raise HTTPException(404, "Product not found")
    db.update_seller_message(offer_id, body.message)
    return {"status": "updated"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
