"""
Pydantic schemas for course listing. Replaces the temporary hand-rolled
dict response in app/main.py's original /courses endpoint (flagged in
that endpoint's own docstring as "Phase 1 proof-of-life only" -- this is
that promised follow-up, prompted by the frontend needing a real course
id to call analytics/recompute/submission endpoints, which the old
code/name/trimester-only shape didn't expose).
"""
from uuid import UUID

from pydantic import BaseModel


class CourseRead(BaseModel):
    id: UUID
    code: str
    name: str
    trimester: int
    credits: int
    type: str

    model_config = {"from_attributes": True}
