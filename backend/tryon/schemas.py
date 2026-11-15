"""Modelli dei dati estratti da una pagina prodotto.

Regola: nessun dato inventato. Ogni valore ha una provenienza (`source`) e i campi mancanti restano `None`.
"""
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ImageRef(BaseModel):
    url: str
    source: str                       # json-ld | microdata | opengraph | twitter | html


class ProductInfo(BaseModel):
    name: Optional[str] = None
    brand: Optional[str] = None
    description: Optional[str] = None
    category_raw: Optional[str] = None
    breadcrumbs: List[str] = Field(default_factory=list)
    color: Optional[str] = None
    images: List[ImageRef] = Field(default_factory=list)
    sizes_available: List[str] = Field(default_factory=list)
    sources: Dict[str, str] = Field(default_factory=dict)      # campo -> origine del dato


class Measure(BaseModel):
    """Una misura di una riga della size chart, normalizzata in centimetri."""
    value_cm: float                   # valore usato (punto medio se e' un range)
    min_cm: Optional[float] = None
    max_cm: Optional[float] = None
    raw: str = ""                     # testo originale della cella
    basis: str = "circumference"      # circumference | length
    note: Optional[str] = None        # assunzioni fatte (es. "larghezza a piatto x2")


class SizeRow(BaseModel):
    size: str
    measures: Dict[str, Measure]


class ChartColumn(BaseModel):
    key: str                          # chest, waist, hips, hem, length, shoulder, sleeve, sleeve_opening, bicep, neck, body_height
    label: str                        # etichetta originale
    unit: str = "cm"                  # unita' originale rilevata: cm | in


class SizeChart(BaseModel):
    kind: str = "unknown"             # garment | body | unknown
    kind_hint: Optional[str] = None   # ipotesi quando kind == unknown
    kind_confidence: float = 0.0
    kind_reasons: List[str] = Field(default_factory=list)
    title: Optional[str] = None
    unit: str = "cm"
    unit_assumed: bool = False
    columns: List[ChartColumn] = Field(default_factory=list)
    rows: List[SizeRow] = Field(default_factory=list)
    source: str = ""                  # es. html-table:2
    warnings: List[str] = Field(default_factory=list)


class Classification(BaseModel):
    category: str = "unknown"         # tshirt | hoodie | unknown
    confidence: float = 0.0
    reasons: List[str] = Field(default_factory=list)


class ExtractWarning(BaseModel):
    code: str
    message: str


class ExtractResult(BaseModel):
    url: str
    final_url: str
    product: ProductInfo
    classification: Classification
    size_chart: Optional[SizeChart] = None
    other_size_charts: List[SizeChart] = Field(default_factory=list)
    dominant_color: Optional[str] = None                        # hex, dal colore dell'immagine principale
    warnings: List[ExtractWarning] = Field(default_factory=list)
