import anthropic
import json


SYSTEM_PROMPT = """Rôle : Onboarder technique Marketplace Vertbaudet

Mission :
Analyser fiches produits → détecter anomalies → produire rapport structuré + mail vendeur

IMPORTANT :
- Ne jamais inventer
- Appliquer STRICTEMENT les règles
- Si doute → signaler

---

RÈGLES (priorité haute)

TITRE :
- Interdits : marque, taille, couleur
- Pas de caractères spéciaux
- Pas de genre adulte (sauf maternité)
- Sinon → KO

DESCRIPTION :
- HTML obligatoire
- FR ou DE
- max 5000 caractères
- cohérente avec attributs

PRODUIT :
- Adulte → REFUS
- Exception : maternité → OK

VGC :
- Tous les EAN doivent avoir EXACTEMENT le même titre + description
- Sinon → KO

PUBLIC / TAILLES (CRITIQUE) :
- tailles en mois → bébé
- tailles en années → enfant
- incohérence → KO

CATÉGORIE :
- Doit correspondre au produit + public + attributs
- incohérence → KO

IMAGES :
- JPG uniquement
- minimum 2 images
- min 1200x800
- < 2300 Ko
- pas de texte/logo

---

ANOMALIES À SIGNALER :
- attribut obligatoire manquant
- titre non conforme
- description insuffisante
- incohérence VGC
- incohérence taille/public
- catégorie incorrecte
- images non conformes

---

Réponds UNIQUEMENT en JSON valide avec la structure suivante (pas de markdown autour).
"""

ANALYSIS_SCHEMA = {
    "score": "integer 0-100",
    "strengths": ["liste de points positifs"],
    "issues": [
        {"field": "champ concerné (TITRE|DESCRIPTION|VGC|PUBLIC_TAILLE|CATEGORIE|IMAGES|ATTRIBUT)", "severity": "BLOQUANT|IMPORTANT|MINEUR", "message": "description précise"}
    ],
    "seller_message": "mail vendeur complet : contexte, taux conformité, problèmes principaux avec exemples, demande de correction, mention 'non publiable en l'état'. Signature: Support technique Marketplace Vertbaudet",
    "recommendation": "VALIDER|CORRIGER_AVANT_VALIDATION|REFUSER",
    "summary": "résumé en 1 phrase",
    "asana_recap": "[date] résumé + anomalies + attente correction",
    "conformity": {
        "total_ean": "integer",
        "conformes": "integer",
        "non_conformes": "integer",
        "taux": "ex: 75%",
        "vgc_avec_anomalies": "integer"
    }
}


class ProductAgent:
    def __init__(self):
        self.client = anthropic.Anthropic()

    async def analyze_product(self, product: dict) -> dict:
        product_text = self._format_product(product)

        message = self.client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"""Analyse cette fiche produit soumise par un vendeur :

{product_text}

Réponds avec ce schéma JSON exact :
{json.dumps(ANALYSIS_SCHEMA, ensure_ascii=False, indent=2)}"""
                }
            ]
        )

        raw = message.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        return json.loads(raw)

    def _format_product(self, product: dict) -> str:
        fields = [
            ("ID", product.get("offer_id") or product.get("id", "N/A")),
            ("Titre", product.get("title") or product.get("name", "")),
            ("Description", product.get("description", "")),
            ("Catégorie", product.get("category_label") or product.get("category", "")),
            ("Prix", product.get("price", "")),
            ("Prix barré", product.get("origin_price", "")),
            ("EAN/Code", product.get("ean") or product.get("barcode", "")),
            ("Marque", product.get("brand", "")),
            ("Images", ", ".join(product.get("images", []) or [])),
            ("Stock", product.get("quantity", "")),
            ("Vendeur", product.get("shop_name") or product.get("seller_name", "")),
        ]
        return "\n".join(f"**{k}** : {v}" for k, v in fields if v)
