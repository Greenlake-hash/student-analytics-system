"""
Tests for app/services/grading.py.

The four test cases below (test_matches_v1_*) use the EXACT same inputs
that were run through the real legacy-v1/script.js (Node.js, with the
relevant functions extracted unmodified) during development, and assert
the EXACT same outputs, including floating point representation
(70.60000000000001, not 70.6) -- this is deliberate: it proves the Python
port reproduces v1's floating-point arithmetic order, not just "a
mathematically equivalent answer." See the module docstring in
app/services/grading.py for what's preserved vs. intentionally adapted.

To re-run the cross-validation against v1 directly (requires Node.js):
    1. Extract evaluatePlan + its helper functions from legacy-v1/script.js
    2. Feed them the same plan + rule fixtures as below, translated to v1's
       flat-array-with-embedded-score shape
    3. Diff JSON output against these test assertions

That's a manual verification step, not part of this automated suite,
because it depends on Node and the legacy file being present -- this
suite is what actually runs in CI and guards against regression.
"""
from app.services.grading import (
    AssessmentInput,
    GradingRuleInput,
    SubmissionInput,
    calculate_contribution,
    calculate_percentage,
    evaluate_plan,
)


# ---------------------------------------------------------------------------
# Pure math primitives
# ---------------------------------------------------------------------------

def test_calculate_percentage_basic():
    assert calculate_percentage(25, 30) == (25 / 30) * 100


def test_calculate_percentage_clamps_score_to_max_marks():
    """A score above max_marks (data entry error) is clamped, not allowed to exceed 100%."""
    assert calculate_percentage(150, 100) == 100.0


def test_calculate_percentage_clamps_negative_score():
    assert calculate_percentage(-10, 100) == 0.0


def test_calculate_percentage_handles_zero_max_marks():
    """max_marks of 0 would divide by zero in naive code; v1 floors it to 1."""
    assert calculate_percentage(0, 0) == 0.0


def test_calculate_contribution_applies_weight():
    # 80% on a 25-weight component contributes 20.0
    assert calculate_contribution(score=16, max_marks=20, weight=25) == 20.0


def test_calculate_contribution_zero_when_not_selected():
    assert calculate_contribution(score=20, max_marks=20, weight=50, selected=False) == 0.0


# ---------------------------------------------------------------------------
# Cross-validated against real legacy-v1/script.js output (see module docstring)
# ---------------------------------------------------------------------------

def test_matches_v1_full_course_with_drops_and_missing_scores():
    """
    6 PT (best 5 of 6) + 6 NPT (best 5 of 6), two assessments not entered
    (PT3, NPT6), one dropped for low score (PT5... actually PT3 drops,
    since not-entered scores as 0% which is worse than PT5's 40%).
    """
    assessments = [
        AssessmentInput(id="PT1", name="PT1", best_of_group="PT", max_marks=30, weight=18, best_of_eligible=True),
        AssessmentInput(id="PT2", name="PT2", best_of_group="PT", max_marks=30, weight=18, best_of_eligible=True),
        AssessmentInput(id="PT3", name="PT3", best_of_group="PT", max_marks=30, weight=18, best_of_eligible=True),
        AssessmentInput(id="PT4", name="PT4", best_of_group="PT", max_marks=30, weight=18, best_of_eligible=True),
        AssessmentInput(id="PT5", name="PT5", best_of_group="PT", max_marks=30, weight=18, best_of_eligible=True),
        AssessmentInput(id="PT6", name="PT6", best_of_group="PT", max_marks=30, weight=18, best_of_eligible=True),
        AssessmentInput(id="NPT1", name="NPT1", best_of_group="NPT", max_marks=10, weight=2, best_of_eligible=True),
        AssessmentInput(id="NPT2", name="NPT2", best_of_group="NPT", max_marks=10, weight=2, best_of_eligible=True),
        AssessmentInput(id="NPT3", name="NPT3", best_of_group="NPT", max_marks=10, weight=2, best_of_eligible=True),
        AssessmentInput(id="NPT4", name="NPT4", best_of_group="NPT", max_marks=10, weight=2, best_of_eligible=True),
        AssessmentInput(id="NPT5", name="NPT5", best_of_group="NPT", max_marks=10, weight=2, best_of_eligible=True),
        AssessmentInput(id="NPT6", name="NPT6", best_of_group="NPT", max_marks=10, weight=2, best_of_eligible=True),
    ]
    scores = {"PT1": 25, "PT2": 18, "PT4": 30, "PT5": 12, "PT6": 22,
              "NPT1": 8, "NPT2": 5, "NPT3": 10, "NPT4": 2, "NPT5": 7}
    submissions = [SubmissionInput(assessment_id=aid, score=score, status="approved") for aid, score in scores.items()]
    rules = [
        GradingRuleInput(best_of_group="PT", best_of_count=5, enabled=True),
        GradingRuleInput(best_of_group="NPT", best_of_count=5, enabled=True),
    ]

    result = evaluate_plan(assessments, submissions, rules)

    # Exact values from the v1 Node.js cross-validation run.
    assert result.projected == 70.60000000000001
    assert result.total_weight == 100
    assert result.attempted_weight == 100
    assert result.remaining_weight == 0

    pt_group = next(g for g in result.groups if g.group == "PT")
    assert pt_group.weight == 90
    assert pt_group.contribution == 64.2
    assert sorted(i.assessment_id for i in pt_group.selected) == ["PT1", "PT2", "PT4", "PT5", "PT6"]
    assert sorted(i.assessment_id for i in pt_group.dropped) == ["PT3"]

    npt_group = next(g for g in result.groups if g.group == "NPT")
    assert npt_group.weight == 10
    assert npt_group.contribution == 6.4
    assert sorted(i.assessment_id for i in npt_group.selected) == ["NPT1", "NPT2", "NPT3", "NPT4", "NPT5"]
    assert sorted(i.assessment_id for i in npt_group.dropped) == ["NPT6"]


def test_matches_v1_tiebreak_prefers_earlier_index():
    """
    Three assessments tied at the same percentage, bestOf=2. v1 breaks
    ties by original array index (earlier wins). This is the single
    detail most likely to silently diverge in a naive re-implementation
    (e.g. Python's sort being unstable, or sorting by ID instead of
    insertion order) -- which is exactly why it's pinned as its own test.
    """
    assessments = [
        AssessmentInput(id="PT1", name="PT1", best_of_group="PT", max_marks=30, weight=30, best_of_eligible=True),
        AssessmentInput(id="PT2", name="PT2", best_of_group="PT", max_marks=30, weight=30, best_of_eligible=True),
        AssessmentInput(id="PT3", name="PT3", best_of_group="PT", max_marks=30, weight=40, best_of_eligible=True),
    ]
    submissions = [
        SubmissionInput(assessment_id="PT1", score=20, status="approved"),
        SubmissionInput(assessment_id="PT2", score=20, status="approved"),
        SubmissionInput(assessment_id="PT3", score=20, status="approved"),  # identical percentage, later index
    ]
    rules = [GradingRuleInput(best_of_group="PT", best_of_count=2, enabled=True)]

    result = evaluate_plan(assessments, submissions, rules)
    group = result.groups[0]

    assert [i.assessment_id for i in group.selected] == ["PT1", "PT2"]
    assert [i.assessment_id for i in group.dropped] == ["PT3"]


def test_not_entered_assessment_scores_as_zero_and_is_drop_priority():
    """
    An assessment with no submission at all behaves exactly like v1's
    null/blank score: percentage 0%, so it's the first to be dropped in
    a best-of group when competing against any real (even low) score.
    """
    assessments = [
        AssessmentInput(id="PT1", name="PT1", best_of_group="PT", max_marks=30, weight=50, best_of_eligible=True),
        AssessmentInput(id="PT2", name="PT2", best_of_group="PT", max_marks=30, weight=50, best_of_eligible=True),
    ]
    submissions = [
        SubmissionInput(assessment_id="PT1", score=1, status="approved"),  # barely-entered, 3.3%
        # PT2 has no submission at all
    ]
    rules = [GradingRuleInput(best_of_group="PT", best_of_count=1, enabled=True)]

    result = evaluate_plan(assessments, submissions, rules)
    group = result.groups[0]

    assert [i.assessment_id for i in group.selected] == ["PT1"]
    assert [i.assessment_id for i in group.dropped] == ["PT2"]


def test_only_approved_submissions_count_toward_grading():
    """
    A submission that exists but isn't APPROVED (e.g. still pending
    verification, or rejected) must be treated as not-entered -- this is
    the hook where Phase 2.4's verification workflow actually changes the
    grading outcome, per the module docstring.
    """
    assessments = [
        AssessmentInput(id="PT1", name="PT1", best_of_group="PT", max_marks=30, weight=100, best_of_eligible=True),
    ]
    submissions = [
        SubmissionInput(assessment_id="PT1", score=30, status="pending_verification"),
    ]
    rules = [GradingRuleInput(best_of_group="PT", best_of_count=1, enabled=True)]

    result = evaluate_plan(assessments, submissions, rules)

    assert result.projected == 0.0
    assert result.attempted_weight == 0.0
    assert result.remaining_weight == 100.0
    assert result.groups[0].items[0].entered is False


# ---------------------------------------------------------------------------
# Edge cases not present in v1's typical usage but real given our DB-backed model
# ---------------------------------------------------------------------------

def test_disabled_assessment_is_excluded_entirely():
    assessments = [
        AssessmentInput(id="PT1", name="PT1", best_of_group="PT", max_marks=30, weight=50, best_of_eligible=True, enabled=True),
        AssessmentInput(id="PT2", name="PT2", best_of_group="PT", max_marks=30, weight=50, best_of_eligible=True, enabled=False),
    ]
    submissions = [
        SubmissionInput(assessment_id="PT1", score=30, status="approved"),
        SubmissionInput(assessment_id="PT2", score=0, status="approved"),
    ]
    rules = [GradingRuleInput(best_of_group="PT", best_of_count=2, enabled=True)]

    result = evaluate_plan(assessments, submissions, rules)

    assert len(result.groups[0].items) == 1
    assert result.total_weight == 50


def test_best_of_eligible_false_always_counts():
    """An item with best_of_eligible=False is 'fixed' -- always selected, never competes for drop."""
    assessments = [
        AssessmentInput(id="ENDTERM", name="End Term", best_of_group="ENDTERM", max_marks=100, weight=50, best_of_eligible=False),
    ]
    submissions = [SubmissionInput(assessment_id="ENDTERM", score=40, status="approved")]
    rules = []  # no best-of rule needed; nothing competes

    result = evaluate_plan(assessments, submissions, rules)

    assert [i.assessment_id for i in result.groups[0].selected] == ["ENDTERM"]
    assert result.groups[0].dropped == []


def test_empty_plan_returns_zero_result():
    result = evaluate_plan([], [], [])
    assert result.projected == 0.0
    assert result.total_weight == 0.0
    assert result.groups == []
