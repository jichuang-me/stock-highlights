from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SearchStock(BaseModel):
    code: str
    name: str
    industry: Optional[str] = None
    price: float = 0.0
    pct: float = 0.0


class StockInfo(BaseModel):
    code: str
    name: str
    industry: Optional[str] = None


class Evidence(BaseModel):
    source: str
    title: str
    published_at: str
    url: str


class HighlightItem(BaseModel):
    id: str
    side: Literal["risk", "positive"]
    label: str
    score: int = Field(ge=0, le=100)
    category: str
    why: str
    thesis: str
    importance: str
    interpretation: str
    game_view: str
    evidenceChain: List[str] = Field(default_factory=list)
    evidence: List[Evidence] = Field(default_factory=list)


class StockSummary(BaseModel):
    riskCount: int
    positiveCount: int
    sentiment: Literal["positive", "negative", "neutral"]


class NewsItem(BaseModel):
    title: str
    time: str
    url: str
    source: str
    tag: Optional[str] = None


class BoardLinkedStock(BaseModel):
    code: str
    name: str
    pct: Optional[float] = None
    role: str
    reason: str


class BoardContext(BaseModel):
    industry: str
    boardName: Optional[str] = None
    boardPct: Optional[float] = None
    boardRank: Optional[int] = None
    upCount: Optional[int] = None
    downCount: Optional[int] = None
    netInflow: Optional[float] = None
    leader: Optional[str] = None
    leaderPct: Optional[float] = None
    role: str
    roleReason: Optional[str] = None
    summary: str
    linkedStocks: List[BoardLinkedStock] = Field(default_factory=list)


class ValuationSnapshot(BaseModel):
    pe: str
    pb: str
    roe: str


class AnalystConsensus(BaseModel):
    stance: Literal["看好", "中性", "看空"]
    rationale: str


class ShortTermOutlook(BaseModel):
    catalysts: List[str] = Field(default_factory=list)
    earningsExpectation: str


class ValuationOutlook(BaseModel):
    currentLevel: str
    targetRange: str
    upsideDrivers: List[str] = Field(default_factory=list)
    downsideRisks: List[str] = Field(default_factory=list)


class FutureOutlook(BaseModel):
    analystConsensus: AnalystConsensus
    shortTermOutlook: ShortTermOutlook
    valuationOutlook: ValuationOutlook


class RadarPoint(BaseModel):
    k: str
    v: float = Field(ge=0, le=100)


class HighlightsResponse(BaseModel):
    stock: StockInfo
    summary: StockSummary
    headline: Optional[str] = None
    marketImpression: str
    analysisMode: Literal["ai", "rules"] = "rules"
    analysisPending: bool = False
    analysisModel: Optional[str] = None
    analysisUpdatedAt: Optional[str] = None
    analysisProfileLabel: Optional[str] = None
    aiTopPositiveLabel: Optional[str] = None
    aiTopRiskLabel: Optional[str] = None
    aiTurningPoint: Optional[str] = None
    price: float
    pctChange: float
    valuationSnapshot: ValuationSnapshot
    futureOutlook: FutureOutlook
    highlights: List[HighlightItem] = Field(default_factory=list)
    liveNews: List[NewsItem] = Field(default_factory=list)
    boardContext: Optional[BoardContext] = None
    radar: List[RadarPoint] = Field(default_factory=list)
