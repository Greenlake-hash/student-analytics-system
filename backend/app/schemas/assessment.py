"""
Pydantic schema for listing a course's assessment definitions -- needed by
the frontend's Grade Lab (Phase 4) so a student knows what assessments
exist before submitting a score for one. No router existed for this
before Phase 4 surfaced the gap; see app/main.py's GET
/courses/{course_id}/assessments.
"""
from uuid import UUID

from pydantic import BaseModel


class AssessmentRead(BaseModel):
    id: UUID
    course_id: UUID
    name: str
    assessment_type: str
    max_marks: float
    weight: float
    best_of_group: str
    best_of_eligible: bool
    enabled: bool

    model_config = {"from_attributes": True}
