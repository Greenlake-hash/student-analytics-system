"""
Grading engine: computes a student's course percentage from their
individual assessment submissions, honoring each course's best-of-N
configuration.

This is a direct, behavior-preserving port of legacy-v1's script.js
(evaluatePlan / buildAssessmentItem / groupAssessmentItems /
evaluateAssessmentGroup / calculateBestOf / calculatePercentage /
calculateContribution / calculateWeightedScore). See migration plan
Section 1.1 — "Phase 2.1 — Port grading engine to Python" — this module IS
that deliverable.

Deliberately pure functions with no DB or FastAPI imports: everything here
takes plain dataclasses/dicts in and returns plain dataclasses/dicts out,
so it can be tested in complete isolation (see tests/test_grading.py) and
reused later from the relative grading engine (Phase 3) without dragging
in request/session state.

Where this differs from v1, and why:
- v1: one flat array of assessment configs, each carrying its own score.
  Here: assessment DEFINITIONS (Assessment rows) and STUDENT SCORES
  (AssessmentSubmission rows) are separate tables, so the entry point
  takes both and joins them by assessment_id. An assessment with no
  matching submission is treated exactly like v1 treated a score of
  null/blank: enabled, contributing 0 toward attempted weight, eligible
  for best-of exclusion, percentage 0.
- v1: per-assessment bestOfGroup/bestOf lived in the same JSON blob.
  Here: best-of-N count comes from CourseGradingRule, keyed by
  (course_id, best_of_group) — ported faithfully in app/seed/run.py
  (see Phase 1.3) from assessment-rules.json's bestOfRules.
- v1 only ever evaluated submitted/draft scores client-side with no
  concept of submission status. Here, only submissions with
  status == APPROVED count toward the calculation (everything else is
  treated as "not yet entered", i.e. score=0, entered=False) — this is
  the hook where Phase 2.4's verification workflow and Phase 3.3's
  portal freeze actually bite into the numbers, instead of being a
  separate, easy-to-forget filter bolted on elsewhere.
"""
from dataclasses import dataclass, field

# Only an APPROVED submission counts as "real" for grading purposes. Every
# other status (draft, submitted, pending_verification, rejected) is
# treated as not-yet-entered -- see module docstring.
COUNTABLE_SUBMISSION_STATUSES = frozenset({"approved", "published"})


@dataclass(frozen=True)
class AssessmentInput:
    """One assessment definition, independent of any student's score."""
    id: str
    name: str
    best_of_group: str
    max_marks: float
    weight: float
    best_of_eligible: bool
    enabled: bool = True


@dataclass(frozen=True)
class SubmissionInput:
    """One student's submission for one assessment, if it exists."""
    assessment_id: str
    score: float | None
    status: str  # one of SubmissionStatus.value


@dataclass(frozen=True)
class GradingRuleInput:
    """Best-of-N policy for one (course, best_of_group) pair."""
    best_of_group: str
    best_of_count: int
    enabled: bool = True


@dataclass
class AssessmentItemResult:
    """Per-assessment result, mirroring v1's buildAssessmentItem() output."""
    assessment_id: str
    name: str
    group: str
    max_marks: float
    weight: float
    score: float
    entered: bool
    percentage: float
    contribution: float = 0.0
    selected: bool = True  # whether this item survived best-of selection
    best_of_eligible: bool = True


@dataclass
class GroupResult:
    """Per-best-of-group result, mirroring v1's evaluateAssessmentGroup() output."""
    group: str
    items: list[AssessmentItemResult]
    selected: list[AssessmentItemResult]
    dropped: list[AssessmentItemResult]
    best_of_count: int
    eligible_count: int
    weight: float
    contribution: float
    attempted_weight: float
    remaining_weight: float


@dataclass
class PlanResult:
    """Whole-course result, mirroring v1's evaluatePlan() output."""
    projected: float
    total_weight: float
    attempted_weight: float
    remaining_weight: float
    groups: list[GroupResult] = field(default_factory=list)


def calculate_percentage(score: float, max_marks: float) -> float:
    """(score / max_marks) * 100, clamped to [0, max_marks] before dividing — matches v1 exactly."""
    max_marks = max(1.0, float(max_marks or 1))
    clamped_score = min(max(float(score or 0), 0), max_marks)
    return (clamped_score / max_marks) * 100


def calculate_contribution(score: float, max_marks: float, weight: float, selected: bool = True) -> float:
    """percentage * (weight / 100), zero if not selected by the best-of engine — matches v1 exactly."""
    if not selected:
        return 0.0
    clamped_weight = min(max(float(weight or 0), 0), 100)
    return calculate_percentage(score, max_marks) * (clamped_weight / 100)


def _build_item(assessment: AssessmentInput, submission: SubmissionInput | None) -> AssessmentItemResult:
    entered = submission is not None and submission.status in COUNTABLE_SUBMISSION_STATUSES and submission.score is not None
    score = float(submission.score) if entered else 0.0
    return AssessmentItemResult(
        assessment_id=assessment.id,
        name=assessment.name,
        group=assessment.best_of_group,
        max_marks=assessment.max_marks,
        weight=assessment.weight,
        score=score,
        entered=entered,
        percentage=calculate_percentage(score, assessment.max_marks),
        best_of_eligible=assessment.best_of_eligible,
    )


def _calculate_best_of(items: list[AssessmentItemResult], best_of_count: int) -> tuple[list[AssessmentItemResult], list[AssessmentItemResult]]:
    """
    Selects the top `best_of_count` eligible items by percentage (ties
    broken by original list order, matching v1's `a.index - b.index`
    tiebreak). Items with best_of_eligible=False always count ("fixed").
    Mirrors v1's calculateBestOf() exactly.
    """
    fixed = [item for item in items if not item.best_of_eligible]
    eligible = list(enumerate(item for item in items if item.best_of_eligible))

    count = len(eligible)
    if count:
        count = min(max(round(best_of_count or count), 1), len(eligible))
    else:
        count = 0

    eligible_sorted = sorted(eligible, key=lambda pair: (-pair[1].percentage, pair[0]))
    selected_eligible = [item for _, item in eligible_sorted[:count]]
    selected_ids = {id(item) for item in fixed + selected_eligible}

    selected = [item for item in items if id(item) in selected_ids]
    dropped = [item for _, item in eligible if id(item) not in selected_ids]
    return selected, dropped


def _evaluate_group(group: str, items: list[AssessmentItemResult], rule: GradingRuleInput | None) -> GroupResult:
    eligible_count = sum(1 for item in items if item.best_of_eligible)
    best_of_count = rule.best_of_count if (rule and rule.enabled) else eligible_count
    selected, dropped = _calculate_best_of(items, best_of_count)

    selected_ids = {id(item) for item in selected}
    for item in items:
        item.selected = id(item) in selected_ids
        item.contribution = calculate_contribution(item.score, item.max_marks, item.weight, item.selected)

    contribution = sum(item.contribution for item in selected)
    weight = sum(item.weight for item in selected)
    attempted_weight = sum(item.weight for item in selected if item.entered)
    remaining_weight = sum(item.weight for item in selected if not item.entered)

    return GroupResult(
        group=group,
        items=items,
        selected=selected,
        dropped=dropped,
        best_of_count=min(best_of_count, eligible_count) if eligible_count else 0,
        eligible_count=eligible_count,
        weight=weight,
        contribution=contribution,
        attempted_weight=attempted_weight,
        remaining_weight=remaining_weight,
    )


def evaluate_plan(
    assessments: list[AssessmentInput],
    submissions: list[SubmissionInput],
    rules: list[GradingRuleInput],
) -> PlanResult:
    """
    The main entry point — equivalent to v1's evaluatePlan(plan).

    Joins assessment definitions to submissions by assessment_id, groups
    by best_of_group, applies each group's best-of-N rule, and sums
    contributions into a single projected course percentage.
    """
    submissions_by_assessment = {s.assessment_id: s for s in submissions}
    rules_by_group = {r.best_of_group: r for r in rules}

    items = [
        _build_item(a, submissions_by_assessment.get(a.id))
        for a in assessments
        if a.enabled
    ]

    groups_in_order: list[str] = []
    items_by_group: dict[str, list[AssessmentItemResult]] = {}
    for item in items:
        if item.group not in items_by_group:
            items_by_group[item.group] = []
            groups_in_order.append(item.group)
        items_by_group[item.group].append(item)

    group_results = [
        _evaluate_group(group, items_by_group[group], rules_by_group.get(group))
        for group in groups_in_order
    ]

    projected = sum(g.contribution for g in group_results)
    total_weight = sum(g.weight for g in group_results)
    attempted_weight = sum(g.attempted_weight for g in group_results)
    remaining_weight = sum(g.remaining_weight for g in group_results)

    return PlanResult(
        projected=projected,
        total_weight=total_weight,
        attempted_weight=attempted_weight,
        remaining_weight=remaining_weight,
        groups=group_results,
    )
