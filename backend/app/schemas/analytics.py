"""
Pydantic schemas for the admin freeze/analytics API (Phase 3.3, 3.4).
"""
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SemesterFreezeRequest(BaseModel):
    is_frozen: bool


class SemesterRead(BaseModel):
    id: UUID
    trimester_number: int
    is_frozen: bool

    model_config = {"from_attributes": True}


class CourseStatisticsRead(BaseModel):
    course_id: UUID
    mean: float | None
    median: float | None
    mode: float | None
    stdev: float | None
    submission_count: int
    computed_at: datetime | None

    model_config = {"from_attributes": True}


class StudentResultRead(BaseModel):
    student_id: UUID
    course_id: UUID
    raw_score: float
    z_score: float | None
    relative_grade: str | None
    rank: int | None
    percentile: float | None
    computed_at: datetime

    model_config = {"from_attributes": True}


class GradeDistributionBucket(BaseModel):
    grade: str
    count: int


class HistogramBucket(BaseModel):
    """One bucket of a score-range histogram, e.g. '70-80%': 6 students."""
    range_label: str
    range_min: float
    range_max: float
    count: int


class CourseAnalyticsRead(BaseModel):
    """
    Aggregate-only view: safe for any authenticated user (student or
    admin) since it reveals nothing about any individual's identity or
    exact score -- mean/median/stdev/histogram/grade-distribution are all
    computed across the whole cohort. Per-student identities and scores
    are in CourseAnalyticsWithRosterRead, which is admin-only.
    """
    statistics: CourseStatisticsRead
    grade_distribution: list[GradeDistributionBucket]
    histogram: list[HistogramBucket]


class CourseAnalyticsWithRosterRead(CourseAnalyticsRead):
    """Admin-only: adds the full per-student roster (identity + exact score + rank) to the aggregate view."""
    results: list[StudentResultRead]


class MyResultRead(BaseModel):
    """A single student's own result for one course -- what GET /me/results/{course_id} returns."""
    course_id: UUID
    raw_score: float
    z_score: float | None
    relative_grade: str | None
    rank: int | None
    percentile: float | None
    computed_at: datetime

    model_config = {"from_attributes": True}
