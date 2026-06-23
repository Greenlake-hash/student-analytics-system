"use strict";

const STORAGE_KEY = "academic-spad-state-v1";
const THEME_KEY = "academic-spad-theme";
const FALLBACK_PROGRAM_CREDITS = 228;
const ASSESSMENT_RULES_URL = "data/assessment-rules.json";
const COURSE_ASSESSMENTS_URL = "data/course-assessments.json";

const DEFAULT_GRADE_SCALE = [
  { letter: "AA", min: 90, point: 10 },
  { letter: "AB", min: 80, point: 9 },
  { letter: "BB", min: 70, point: 8 },
  { letter: "BC", min: 60, point: 7 },
  { letter: "CC", min: 50, point: 6 },
  { letter: "CD", min: 40, point: 5 },
  { letter: "DD", min: 30, point: 4 },
  { letter: "F", min: 0, point: 0 }
];

const viewTitles = {
  dashboard: "Student Performance Analytics Dashboard",
  calculator: "Dynamic Grade Lab",
  comparison: "Semester Comparison Dashboard",
  syllabus: "Searchable Syllabus Viewer",
  portfolio: "Future Roadmap",
  data: "Profile, Export, Import"
};

const GRADE_WORKFLOW_STEPS = [
  "Select Trimester",
  "Enter Assessment Scores",
  "Review Rule Summary",
  "View Grade Calculation",
  "View Grade Report",
  "Save Record",
  "Open Analytics Dashboard"
];

const TERM_DEFINITIONS = {
  "Best Of": "Lowest assessments are automatically excluded from the final calculation.",
  Weight: "Contribution toward the final grade percentage."
};

let state = {
  profile: {
    name: "Demo Student",
    studentId: "DSAI-STUDENT",
    targetCgpa: 8.5
  },
  records: [],
  assessmentPlans: {},
  assessmentRules: null,
  defaultAssessmentRules: null,
  courseAssessments: null,
  defaultCourseAssessments: null,
  gradeScale: DEFAULT_GRADE_SCALE.map((grade) => ({ ...grade })),
  selectedCourse: "",
  beginnerMode: true,
  theme: localStorage.getItem(THEME_KEY) || "dark",
  courses: [],
  syllabus: []
};

let charts = {};
let deferredInstallPrompt = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [courses, syllabus, assessmentRules, courseAssessments] = await Promise.all([
      fetchJson("data/courses.json"),
      fetchJson("data/syllabus.json"),
      fetchJson(ASSESSMENT_RULES_URL),
      fetchJson(COURSE_ASSESSMENTS_URL)
    ]);
    const saved = readState();
    const normalizedDefaultRules = normalizeAssessmentRules(assessmentRules);
    const normalizedDefaultCourseAssessments = normalizeCourseAssessments(courseAssessments);
    state = {
      ...state,
      ...saved,
      courses,
      syllabus,
      defaultAssessmentRules: normalizedDefaultRules,
      assessmentRules: normalizeAssessmentRules(saved.assessmentRules || normalizedDefaultRules),
      defaultCourseAssessments: normalizedDefaultCourseAssessments,
      courseAssessments: normalizeCourseAssessments(saved.courseAssessments || normalizedDefaultCourseAssessments),
      gradeScale: normalizeGradeScale(saved.gradeScale || state.gradeScale),
      beginnerMode: saved.beginnerMode ?? state.beginnerMode,
      theme: localStorage.getItem(THEME_KEY) || saved.theme || state.theme
    };
    if (!state.records || state.records.length === 0) {
      state.records = seedDemoRecords(courses);
    }
    if (!state.selectedCourse) {
      state.selectedCourse = courses[0]?.code || "";
    }
    document.documentElement.dataset.theme = state.theme;
    wireEvents();
    populateStaticControls();
    loadCoursePlan();
    updateConnectionStatus();
    renderAll();
    const initialView = location.hash.replace("#", "");
    if (viewTitles[initialView]) {
      switchView(initialView);
    }
    persistState();
    registerServiceWorker();
    document.body.classList.remove("is-loading");
  } catch (error) {
    console.error(error);
    document.body.classList.remove("is-loading");
    showToast("Unable to load dashboard data. Serve the folder from a static server.");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return response.json();
}

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function persistState() {
  const payload = {
    profile: state.profile,
    records: state.records,
    assessmentPlans: state.assessmentPlans,
    assessmentRules: state.assessmentRules,
    courseAssessments: state.courseAssessments,
    gradeScale: state.gradeScale,
    selectedCourse: state.selectedCourse,
    beginnerMode: state.beginnerMode,
    theme: state.theme
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem(THEME_KEY, state.theme);
}

function wireEvents() {
  $$(".nav-link").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#quickExportBtn").addEventListener("click", exportPdf);
  $("#exportPdfBtn").addEventListener("click", exportPdf);
  $("#exportJsonBtn").addEventListener("click", exportJson);
  $("#importJsonInput").addEventListener("change", importJson);
  $("#printDashboardBtn").addEventListener("click", printDashboard);
  $("#printReportBtn").addEventListener("click", printReport);
  $("#exportChartsPngBtn").addEventListener("click", () => exportCharts("png"));
  $("#exportChartsJpegBtn").addEventListener("click", () => exportCharts("jpeg"));
  $("#exportChartsSvgBtn").addEventListener("click", () => exportCharts("svg"));
  $("#resetDemoBtn").addEventListener("click", resetDemoData);
  $("#resetGradeScaleBtn").addEventListener("click", resetGradeScale);

  $("#profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.profile = {
      name: $("#studentName").value.trim() || "Student",
      studentId: $("#studentId").value.trim() || "DSAI-STUDENT",
      targetCgpa: clamp(Number($("#targetCgpa").value) || 8.5, 0, 10)
    };
    persistState();
    renderAll();
    showToast("Profile saved locally.");
  });

  $("#courseSelect").addEventListener("change", (event) => {
    state.selectedCourse = event.target.value;
    loadCoursePlan();
    persistState();
  });
  $("#recordTrimester").addEventListener("change", () => {
    syncActivePlanFromRules({ preserveScores: true });
    persistState();
  });
  $("#targetGradeSelect").addEventListener("change", renderCalculatorSummary);
  $("#beginnerModeToggle").addEventListener("change", (event) => {
    state.beginnerMode = event.target.checked;
    persistState();
    applyBeginnerMode();
    renderCalculatorSummary();
  });
  $("#whatIfCgpaInput").addEventListener("input", renderCalculatorSummary);
  $("#whatIfCreditsInput").addEventListener("input", renderCalculatorSummary);
  $("#loadTemplateBtn").addEventListener("click", () => {
    state.assessmentRules = cloneRules(state.defaultAssessmentRules);
    state.courseAssessments = cloneCourseAssessments(state.defaultCourseAssessments);
    syncActivePlanFromRules({ preserveScores: true });
    persistState();
    showToast("Official JSON rules and course assessments reloaded.");
  });
  $("#openRuleManagerBtn").addEventListener("click", toggleRuleManager);
  $("#closeRuleManagerBtn").addEventListener("click", closeRuleManager);
  $("#addComponentBtn").addEventListener("click", addAssessmentComponent);
  $("#addCourseAssessmentBtn").addEventListener("click", addCourseAssessmentDefinition);
  $("#exportRulesBtn").addEventListener("click", exportAssessmentRules);
  $("#exportCourseAssessmentsBtn").addEventListener("click", exportCourseAssessments);
  $("#resetPlanBtn").addEventListener("click", () => {
    const course = getSelectedCourse();
    if (!course) return;
    state.assessmentPlans[course.code] = planFromRule(getActiveRule(), []);
    renderComponentRows();
    persistState();
    showToast("Active scores reset to the current course assessment set.");
  });
  $("#duplicatePlanBtn").addEventListener("click", () => {
    persistState();
    showToast("Local rule template saved.");
  });
  $("#saveResultBtn").addEventListener("click", saveCalculatorResult);

  $("#syllabusSearch").addEventListener("input", renderSyllabus);
  $("#trimesterFilter").addEventListener("change", renderSyllabus);
  $("#courseFilter").addEventListener("change", renderSyllabus);
  $("#typeFilter").addEventListener("change", renderSyllabus);
  $("#comparisonFocus").addEventListener("change", renderComparison);
  ["plannerCurrentCgpa", "plannerCompletedCredits", "plannerTargetCgpa"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderTargetCgpaPlanner);
  });
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallButtonsVisible(true);
  });

  [$("#installPwaBtn"), $("#installPwaTopBtn")].forEach((button) => {
    button.addEventListener("click", promptInstall);
  });
}

function populateStaticControls() {
  const courseOptions = state.courses
    .map((course) => `<option value="${course.code}">${course.code} - ${escapeHtml(course.name)}</option>`)
    .join("");
  $("#courseSelect").innerHTML = courseOptions;
  $("#courseFilter").innerHTML = `<option value="all">All</option>${courseOptions}`;
  $("#courseSelect").value = state.selectedCourse;

  const trimesterOptions = Array.from({ length: 9 }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}">Trimester ${value}</option>`;
  }).join("");
  $("#recordTrimester").innerHTML = trimesterOptions;
  $("#trimesterFilter").innerHTML = `<option value="all">All</option>${trimesterOptions}`;
  $("#comparisonFocus").innerHTML = `<option value="all">All trimesters</option>${trimesterOptions}`;
  renderTargetGradeOptions();
  $("#beginnerModeToggle").checked = Boolean(state.beginnerMode);

  $("#studentName").value = state.profile.name || "";
  $("#studentId").value = state.profile.studentId || "";
  $("#targetCgpa").value = state.profile.targetCgpa ?? 8.5;
  hydratePlannerDefaults();
  applyBeginnerMode();
}

function renderTargetGradeOptions() {
  const select = $("#targetGradeSelect");
  if (!select) return;
  const previous = select.value;
  const grades = activeGradeScale().filter((grade) => grade.letter !== "F");
  select.innerHTML = grades
    .map((grade) => `<option value="${grade.letter}">${grade.letter} - ${grade.min}%</option>`)
    .join("");
  select.value = grades.some((grade) => grade.letter === previous)
    ? previous
    : grades.find((grade) => grade.letter === "AA")?.letter || grades[0]?.letter || "";
}

function switchView(view) {
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  $("#viewTitle").textContent = viewTitles[view] || viewTitles.dashboard;
  history.replaceState(null, "", `#${view}`);
  if (view === "comparison") {
    renderComparison();
  }
  if (view === "syllabus") {
    renderSyllabus();
  }
}

function renderAll() {
  populateProfile();
  renderDashboard();
  renderCalculatorSummary();
  renderComparison();
  renderSyllabus();
  renderGradeScaleRows();
  renderRecordsTable();
}

function populateProfile() {
  $("#profileChip").textContent = `${state.profile.name || "Student"} - Target ${formatNumber(state.profile.targetCgpa, 1)} CGPA`;
  $("#studentName").value = state.profile.name || "";
  $("#studentId").value = state.profile.studentId || "";
  $("#targetCgpa").value = state.profile.targetCgpa ?? 8.5;
}

function renderDashboard() {
  const summaries = semesterSummaries();
  const cgpa = calculateCgpa(state.records);
  const forecast = forecastNextSgpa(summaries);
  const completedCredits = state.records.reduce((sum, record) => sum + Number(record.credits || 0), 0);
  const totalProgramCredits = state.courses.reduce((sum, course) => sum + Number(course.credits || 0), 0) || FALLBACK_PROGRAM_CREDITS;
  const riskRecords = state.records.filter((record) => record.gradePoint < 7 || record.percentage < 60);
  const last = summaries.at(-1);
  const previous = summaries.at(-2);
  const delta = last && previous ? last.sgpa - previous.sgpa : 0;

  $("#cgpaMetric").textContent = formatNumber(cgpa, 2);
  $("#cgpaDelta").textContent = summaries.length > 1 ? `${delta >= 0 ? "+" : ""}${formatNumber(delta, 2)} vs previous trimester` : "Add records to build trend";
  $("#creditsMetric").textContent = completedCredits.toString();
  $("#creditProgress").textContent = `${completedCredits} of ${totalProgramCredits} credit units`;
  $("#forecastMetric").textContent = formatNumber(forecast, 2);
  $("#forecastDelta").textContent = forecast >= (state.profile.targetCgpa || 0) ? "Above target trajectory" : "Below target trajectory";
  $("#riskMetric").textContent = riskRecords.length.toString();
  $("#riskSummary").textContent = riskRecords.length ? `${riskRecords.length} course${riskRecords.length === 1 ? "" : "s"} below BC range` : "No low-score courses";
  const readiness = calculateReadinessScore(cgpa, completedCredits, riskRecords.length, totalProgramCredits);
  const neededSgpa = estimateNeededSgpa(cgpa, completedCredits, state.profile.targetCgpa, totalProgramCredits);
  $("#readinessMetric").textContent = readiness.toString();
  $("#readinessSummary").textContent = readiness >= 80 ? "Strong portfolio signal" : readiness >= 60 ? "Good, with clear gaps" : "Needs attention";
  $("#targetSgpaMetric").textContent = neededSgpa === null ? "10.00" : formatNumber(neededSgpa, 2);
  $("#targetSgpaSummary").textContent = neededSgpa === null ? "Target needs multiple high terms" : "Average needed from remaining credits";

  renderRecommendations();
  renderRiskTable();
  renderCurriculumProgress();
  renderHealthSignals(readiness);
  renderCharts();
}

function renderRiskTable() {
  const rows = [...state.records]
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 7)
    .map((record) => {
      const course = findCourse(record.code);
      return `<tr>
        <td><strong>${record.code}</strong><br><small>${escapeHtml(course?.name || record.code)}</small></td>
        <td>Trimester ${record.trimester}</td>
        <td>${formatNumber(record.percentage, 1)}%</td>
        <td><span class="badge ${badgeClass(record.gradePoint)}">${record.letter} - ${record.gradePoint}</span></td>
      </tr>`;
    })
    .join("");
  $("#courseRiskTable").innerHTML = rows || `<tr><td colspan="4">No records available.</td></tr>`;
}

function renderCurriculumProgress() {
  const completedCodes = new Set(state.records.map((record) => record.code));
  const completedCourses = state.courses.filter((course) => completedCodes.has(course.code));
  const completion = state.courses.length ? (completedCourses.length / state.courses.length) * 100 : 0;
  const completedCredits = completedCourses.reduce((sum, course) => sum + Number(course.credits || 0), 0);
  const totalCredits = state.courses.reduce((sum, course) => sum + Number(course.credits || 0), 0);
  const nextTrimester = state.courses.find((course) => !completedCodes.has(course.code))?.trimester || 9;
  const nextCourses = state.courses
    .filter((course) => course.trimester === nextTrimester && !completedCodes.has(course.code))
    .slice(0, 5);

  $("#curriculumProgressMeta").textContent = `${completedCourses.length} of ${state.courses.length} courses`;
  $("#curriculumProgressBar").style.width = `${formatNumber(completion, 1)}%`;
  $("#curriculumProgressStats").innerHTML = `
    <span>${formatNumber(completion, 1)}% curriculum complete</span>
    <span>${completedCredits} / ${totalCredits} credit units</span>
  `;
  $("#nextCourseGrid").innerHTML = nextCourses.map((course) => `
    <div class="mini-course">
      <strong>${course.code}</strong>
      <span>${escapeHtml(course.name)}</span>
      <small>Trimester ${course.trimester} - ${course.credits} credits</small>
    </div>
  `).join("") || `<div class="empty-state">All catalog courses are marked complete.</div>`;
}

function renderHealthSignals(readiness) {
  const summaries = semesterSummaries();
  const cgpa = calculateCgpa(state.records);
  const latest = summaries.at(-1);
  const previous = summaries.at(-2);
  const trend = latest && previous ? latest.sgpa - previous.sgpa : 0;
  const riskCount = state.records.filter((record) => record.gradePoint < 7 || record.percentage < 60).length;
  const signals = [
    {
      label: "Portfolio Readiness",
      value: `${readiness}/100`,
      tone: readiness >= 80 ? "good" : readiness >= 60 ? "warn" : "risk"
    },
    {
      label: "CGPA Health",
      value: formatNumber(cgpa, 2),
      tone: cgpa >= state.profile.targetCgpa ? "good" : cgpa >= state.profile.targetCgpa - 0.5 ? "warn" : "risk"
    },
    {
      label: "Latest Trend",
      value: summaries.length > 1 ? `${trend >= 0 ? "+" : ""}${formatNumber(trend, 2)}` : "New",
      tone: trend >= 0 ? "good" : "warn"
    },
    {
      label: "Risk Courses",
      value: String(riskCount),
      tone: riskCount === 0 ? "good" : riskCount <= 2 ? "warn" : "risk"
    },
    {
      label: "PWA Mode",
      value: navigator.serviceWorker ? "Ready" : "Basic",
      tone: navigator.serviceWorker ? "good" : "warn"
    },
    {
      label: "Data Model",
      value: "Local",
      tone: "good"
    }
  ];

  $("#healthSignals").innerHTML = signals.map((signal) => `
    <div class="health-signal">
      <span>${escapeHtml(signal.label)}</span>
      <strong class="${signal.tone}">${escapeHtml(signal.value)}</strong>
    </div>
  `).join("");
}

function renderRecommendations() {
  const target = Number(state.profile.targetCgpa || 8.5);
  const cgpa = calculateCgpa(state.records);
  const result = calculatePlanResult();
  const predictedGrade = gradeFromPercentage(result.projected);
  const lowRecords = [...state.records]
    .filter((record) => record.gradePoint < 8)
    .sort((a, b) => a.percentage - b.percentage)
    .slice(0, 3);
  const strongRecords = [...state.records]
    .filter((record) => record.gradePoint >= 9)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 4);
  const summaries = semesterSummaries();
  const last = summaries.at(-1);
  const previous = summaries.at(-2);
  const recommendations = [];

  recommendations.push({
    title: "Grade Prediction",
    body: `Current Grade Lab projection is ${formatNumber(result.projected, 1)}%, likely ${predictedGrade.letter}, worth ${predictedGrade.point} grade points under your saved boundaries.`
  });

  if (strongRecords.length) {
    const strengths = strongRecords
      .map((record) => findCourse(record.code)?.tags?.[0] || findCourse(record.code)?.name || record.code)
      .slice(0, 4)
      .join(", ");
    recommendations.push({
      title: "Strengths",
      body: `Strong signal in ${strengths}. Keep using these areas as anchors for project and resume storytelling.`
    });
  }

  if (lowRecords.length) {
    const weakTopics = lowRecords
      .flatMap((record) => findSyllabus(record.code)?.topics?.slice(0, 2) || [])
      .slice(0, 5);
    recommendations.push({
      title: "Weak Topics",
      body: weakTopics.length ? `Watch ${weakTopics.join(", ")} based on lower-scoring courses.` : "No specific weak topic cluster detected yet."
    });
    lowRecords.forEach((record) => {
      const course = findCourse(record.code);
      const syllabus = findSyllabus(record.code);
      const topics = syllabus?.topics?.slice(0, 4).join(", ") || "core concepts";
      recommendations.push({
        title: `${record.code}: Recommended Focus`,
        body: `Prioritize ${topics}. A 7 to 10 point gain here has strong CGPA leverage because this course carries ${course?.credits || record.credits} credits.`
      });
    });
  } else {
    const nextCourses = state.courses
      .filter((course) => course.trimester === Math.min((last?.trimester || 0) + 1, 9))
      .slice(0, 3)
      .map((course) => course.code)
      .join(", ");
    recommendations.push({
      title: "Maintain the advantage",
      body: `Your saved scores are stable. Preview ${nextCourses || "upcoming electives"} and reserve early weekly slots for assignments.`
    });
  }

  if (last && previous && last.sgpa < previous.sgpa) {
    recommendations.unshift({
      title: "Trend correction",
      body: `Latest SGPA slipped by ${formatNumber(previous.sgpa - last.sgpa, 2)}. Start with the two weakest courses and convert one assessment component into a weekly checkpoint.`
    });
  }

  if (cgpa < target) {
    recommendations.push({
      title: "Target CGPA bridge",
      body: `Current CGPA is ${formatNumber(cgpa, 2)} against a ${formatNumber(target, 1)} target. Aim for ${formatNumber(Math.min(10, target + 0.4), 1)} SGPA over the next two trimesters.`
    });
  }

  recommendations.push({
    title: "Forecast discipline",
    body: "Use the Grade Lab after every assessment, lab, or project update. Forecasting improves when each configured component has current scores."
  });

  $("#recommendations").innerHTML = recommendations
    .slice(0, 5)
    .map((item) => `<div class="recommendation"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></div>`)
    .join("");
}

function renderCharts() {
  if (!window.Chart) {
    renderChartFallbacks("Charts will appear after Chart.js loads from the CDN.");
    return;
  }
  clearChartFallbacks();
  const summaries = semesterSummaries();
  const labels = summaries.map((summary) => `T${summary.trimester}`);
  const sgpa = summaries.map((summary) => summary.sgpa);
  const credits = summaries.map((summary) => summary.credits);
  const colors = chartColors();
  const mix = activeGradeScale().map((grade) => ({
    letter: grade.letter,
    count: state.records.filter((record) => record.letter === grade.letter).length
  })).filter((item) => item.count > 0);

  drawChart("gpaTrendChart", {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "SGPA",
        data: sgpa,
        borderColor: colors.brand,
        backgroundColor: colors.brandSoft,
        fill: true,
        tension: 0.34,
        pointRadius: 4
      }]
    },
    options: baseChartOptions({ suggestedMin: 0, suggestedMax: 10 })
  });

  drawChart("gradeMixChart", {
    type: "doughnut",
    data: {
      labels: mix.map((item) => item.letter),
      datasets: [{
        data: mix.map((item) => item.count),
        backgroundColor: [colors.brand, colors.amber, colors.rose, colors.green, "#a78bfa", "#38bdf8", "#f97316", "#94a3b8"],
        borderColor: colors.surface,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: colors.text } }
      }
    }
  });

  drawChart("semesterChart", {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Credits",
          data: credits,
          backgroundColor: colors.amberSoft,
          borderColor: colors.amber,
          yAxisID: "credits"
        },
        {
          type: "line",
          label: "SGPA",
          data: sgpa,
          borderColor: colors.brand,
          backgroundColor: colors.brand,
          tension: 0.25,
          yAxisID: "gpa"
        }
      ]
    },
    options: dualAxisOptions()
  });
}

function renderComparison() {
  renderSemesterCards();
  renderTargetCgpaPlanner();
  renderSemesterHeatmap();
  renderRiskForecastDashboard();
  if (!window.Chart) {
    renderChartFallbacks("Charts will appear after Chart.js loads from the CDN.");
    return;
  }
  const focus = $("#comparisonFocus").value;
  const summaries = semesterSummaries().filter((summary) => focus === "all" || String(summary.trimester) === focus);
  const labels = summaries.map((summary) => `T${summary.trimester}`);
  const colors = chartColors();

  drawChart("comparisonChart", {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Average %",
          data: summaries.map((summary) => summary.averagePercentage),
          backgroundColor: colors.roseSoft,
          borderColor: colors.rose,
          yAxisID: "percentage"
        },
        {
          type: "line",
          label: "SGPA",
          data: summaries.map((summary) => summary.sgpa),
          borderColor: colors.brand,
          backgroundColor: colors.brand,
          tension: 0.28,
          yAxisID: "gpa"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        percentage: {
          beginAtZero: true,
          suggestedMax: 100,
          grid: { color: colors.grid },
          ticks: { color: colors.text }
        },
        gpa: {
          position: "right",
          beginAtZero: true,
          suggestedMax: 10,
          grid: { drawOnChartArea: false },
          ticks: { color: colors.text }
        },
        x: { grid: { color: colors.grid }, ticks: { color: colors.text } }
      },
      plugins: { legend: { labels: { color: colors.text } } }
    }
  });

  const forecastData = buildForecastSeries(semesterSummaries());
  drawChart("forecastChart", {
    type: "line",
    data: {
      labels: forecastData.map((item) => item.label),
      datasets: [
        {
          label: "Actual",
          data: forecastData.map((item) => item.actual),
          borderColor: colors.brand,
          backgroundColor: colors.brandSoft,
          tension: 0.25
        },
        {
          label: "Forecast",
          data: forecastData.map((item) => item.forecast),
          borderColor: colors.amber,
          backgroundColor: colors.amberSoft,
          borderDash: [5, 5],
          tension: 0.25
        }
      ]
    },
    options: baseChartOptions({ suggestedMin: 0, suggestedMax: 10 })
  });

  renderAssessmentCharts();
}

function renderSemesterCards() {
  const summaries = semesterSummaries();
  $("#semesterSummaryMeta").textContent = `${state.records.length} records`;
  $("#semesterCards").innerHTML = summaries.map((summary) => `
    <article class="semester-card">
      <h4>Trimester ${summary.trimester}</h4>
      <dl>
        <dt>SGPA</dt><dd>${formatNumber(summary.sgpa, 2)}</dd>
        <dt>Average</dt><dd>${formatNumber(summary.averagePercentage, 1)}%</dd>
        <dt>Credits</dt><dd>${summary.credits}</dd>
        <dt>Courses</dt><dd>${summary.count}</dd>
      </dl>
    </article>
  `).join("") || `<div class="empty-state">No semester records available.</div>`;
}

function hydratePlannerDefaults() {
  const completedCredits = state.records.reduce((sum, record) => sum + Number(record.credits || 0), 0);
  const cgpa = calculateCgpa(state.records);
  $("#plannerCurrentCgpa").value = formatNumber(cgpa, 2);
  $("#plannerCompletedCredits").value = completedCredits;
  $("#plannerTargetCgpa").value = state.profile.targetCgpa ?? 8.5;
}

function renderTargetCgpaPlanner() {
  const current = clamp(Number($("#plannerCurrentCgpa").value) || calculateCgpa(state.records), 0, 10);
  const completed = Math.max(0, Number($("#plannerCompletedCredits").value) || state.records.reduce((sum, record) => sum + Number(record.credits || 0), 0));
  const target = clamp(Number($("#plannerTargetCgpa").value) || Number(state.profile.targetCgpa) || 8.5, 0, 10);
  const avgCredits = Math.max(1, Math.round(average(semesterSummaries().map((summary) => summary.credits)) || 24));
  const plans = [1, 2, 3].map((terms) => {
    const futureCredits = avgCredits * terms;
    const required = futureCredits ? ((target * (completed + futureCredits)) - (current * completed)) / futureCredits : target;
    return {
      title: `Next ${terms} trimester${terms > 1 ? "s" : ""}`,
      value: required > 10 ? "Not reachable" : formatNumber(clamp(required, 0, 10), 2),
      detail: `${futureCredits} projected credits`
    };
  });
  $("#targetCgpaPlanner").innerHTML = plans.map((plan) => `
    <div class="insight-card">
      <strong>${escapeHtml(plan.title)}</strong>
      <p>${escapeHtml(plan.value)} required GPA</p>
      <small>${escapeHtml(plan.detail)}</small>
    </div>
  `).join("");
}

function renderSemesterHeatmap() {
  const recordsByTrimester = new Map();
  state.records.forEach((record) => {
    if (!recordsByTrimester.has(record.trimester)) recordsByTrimester.set(record.trimester, []);
    recordsByTrimester.get(record.trimester).push(record);
  });
  $("#semesterHeatmap").innerHTML = Array.from({ length: 9 }, (_, index) => {
    const trimester = index + 1;
    const records = recordsByTrimester.get(trimester) || [];
    const averageScore = average(records.map((record) => record.percentage));
    const intensity = clamp(averageScore, 0, 100);
    return `<div class="heatmap-cell" style="background:${heatColor(intensity)}">
      <strong>T${trimester}</strong>
      <span>${records.length ? `${formatNumber(averageScore, 1)}%` : "No data"}</span>
    </div>`;
  }).join("");
}

function heatColor(score) {
  const hue = Math.round((clamp(score, 0, 100) / 100) * 145);
  return `linear-gradient(180deg, hsla(${hue}, 72%, 42%, 0.38), var(--surface-2))`;
}

function renderRiskForecastDashboard() {
  const summaries = semesterSummaries();
  const forecast = forecastNextSgpa(summaries);
  const riskRecords = state.records.filter((record) => record.gradePoint < 7 || record.percentage < 60);
  const weakTopics = riskRecords
    .flatMap((record) => findSyllabus(record.code)?.topics?.slice(0, 2) || [])
    .slice(0, 5);
  const cards = [
    { title: "Forecast SGPA", value: formatNumber(forecast, 2), detail: "Linear projection from saved records" },
    { title: "Risk Courses", value: String(riskRecords.length), detail: riskRecords.map((record) => record.code).join(", ") || "None" },
    { title: "Topic Focus", value: weakTopics.length ? weakTopics[0] : "Stable", detail: weakTopics.slice(1).join(", ") || "No weak topics detected" },
    { title: "Target Pressure", value: forecast >= state.profile.targetCgpa ? "Low" : "Medium", detail: `Target CGPA ${formatNumber(state.profile.targetCgpa, 1)}` }
  ];
  $("#riskForecastDashboard").innerHTML = cards.map((card) => `
    <div class="insight-card">
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.value)}</p>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
}

function renderAssessmentCharts() {
  if (!window.Chart) return;
  const result = calculatePlanResult();
  const colors = chartColors();
  const primary = result.components[0];
  const secondary = result.components[1];
  const palette = assessmentPalette(colors, Math.max(3, result.components.length));

  $("#primaryTrendTitle").textContent = `${primary?.type || "Primary"} Trend`;
  $("#secondaryTrendTitle").textContent = `${secondary?.type || "Secondary"} Trend`;
  drawTrendChart("ptTrendChart", primary, colors.brand, `${primary?.type || "Primary"} Marks`);
  drawTrendChart("nptTrendChart", secondary, colors.amber, `${secondary?.type || "Secondary"} Marks`);

  const comparisonComponents = result.components;
  drawChart("assessmentComparisonChart", {
    type: "bar",
    data: {
      labels: comparisonComponents.map((component) => component.type),
      datasets: [{
        label: "Assessment %",
        data: comparisonComponents.map((component) => component.percentage),
        backgroundColor: palette.soft,
        borderColor: palette.solid,
        borderWidth: 1
      }]
    },
    options: baseChartOptions({ suggestedMin: 0, suggestedMax: 100 })
  });

  drawChart("contributionChart", {
    type: "doughnut",
    data: {
      labels: comparisonComponents.map((component) => component.type),
      datasets: [{
        data: comparisonComponents.map((component) => component.contribution),
        backgroundColor: palette.solid,
        borderColor: colors.surface,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: colors.text } } }
    }
  });
}

function assessmentPalette(colors, count) {
  const solid = [colors.brand, colors.amber, colors.rose, colors.green, "#60a5fa", "#a78bfa", "#f97316", "#94a3b8"];
  const soft = [colors.brandSoft, colors.amberSoft, colors.roseSoft, "rgba(34, 197, 94, 0.18)", "rgba(96, 165, 250, 0.18)", "rgba(167, 139, 250, 0.18)", "rgba(249, 115, 22, 0.18)", "rgba(148, 163, 184, 0.18)"];
  return {
    solid: Array.from({ length: count }, (_, index) => solid[index % solid.length]),
    soft: Array.from({ length: count }, (_, index) => soft[index % soft.length])
  };
}

function drawTrendChart(id, component, color, label) {
  const colors = chartColors();
  const items = component?.items || [];
  drawChart(id, {
    type: "line",
    data: {
      labels: items.map((item) => item.label),
      datasets: [{
        label,
        data: items.map((item) => item.entered ? item.score : null),
        borderColor: color,
        backgroundColor: "rgba(45, 212, 191, 0.12)",
        tension: 0.28,
        spanGaps: true
      }]
    },
    options: baseChartOptions({ suggestedMin: 0, suggestedMax: component?.maxMarks || 100 })
  });
}

function loadCoursePlan() {
  const course = getSelectedCourse();
  if (!course) return;
  $("#courseSelect").value = course.code;
  $("#recordTrimester").value = String(course.trimester);
  syncActivePlanFromRules({ preserveScores: true });
}

function syncActivePlanFromRules({ preserveScores = true } = {}) {
  const course = getSelectedCourse();
  if (!course) return;
  const previousPlan = preserveScores ? state.assessmentPlans[course.code] || [] : [];
  state.assessmentPlans[course.code] = planFromRule(getActiveRule(), previousPlan);
  renderComponentRows();
}

function getActiveRule() {
  const trimester = Number($("#recordTrimester")?.value || getSelectedCourse()?.trimester || 1);
  return getRuleForTrimester(trimester);
}

function getRuleForTrimester(trimester) {
  const rules = state.assessmentRules?.rules || [];
  return rules.find((rule) => rule.appliesTo?.trimesters?.includes(Number(trimester))) || rules[0] || {
    id: "empty-rule",
    name: "No assessment rule configured",
    appliesTo: { trimesters: [Number(trimester) || 1] },
    bestOfRules: []
  };
}

function planFromRule(rule, previousPlan = []) {
  const course = getSelectedCourse();
  const definitions = courseAssessmentDefinitionsForCourse(course);
  const previousAssessments = normalizePreviousAssessmentPlan(previousPlan);
  return definitions
    .filter((definition) => definition.enabled !== false)
    .map((definition, index) => {
      const matchingPrevious = findPreviousAssessment(previousAssessments, definition, index);
      const maxMarksSource = matchingPrevious?.fromLegacy ? definition.maxMarks : matchingPrevious?.maxMarks ?? definition.maxMarks;
      const maxMarks = Math.max(1, Number(maxMarksSource) || 1);
      const studentScore = normalizeNullableNumber(matchingPrevious?.studentScore);
      const type = normalizeAssessmentType(definition.type || definition.bestOfGroup || definition.id);
      const bestOfGroup = normalizeAssessmentType(definition.bestOfGroup || definition.group || type);
      const weight = firstFiniteNumber(
        matchingPrevious?.fromLegacy ? null : matchingPrevious?.weight,
        definition.weight,
        fallbackAssessmentWeight(rule, definition, definitions)
      ) ?? 0;
      return {
        id: String(definition.id || `${type}-${index + 1}`),
        name: String(definition.name || definition.label || definition.id || `${type} ${index + 1}`),
        type,
        maxMarks,
        studentScore,
        weight: clamp(weight, 0, 100),
        bestOfEligible: definition.bestOfEligible !== false,
        bestOfGroup,
        enabled: definition.enabled !== false,
        order: index
      };
    });
}

function fallbackAssessmentWeight(rule, definition, definitions) {
  const group = normalizeAssessmentType(definition.bestOfGroup || definition.group || definition.type);
  const legacyComponent = (rule?.components || [])
    .find((component) => normalizeAssessmentType(component.type || component.group) === group);
  if (!legacyComponent) return null;
  const eligibleCount = definitions
    .filter((item) => item.enabled !== false && normalizeAssessmentType(item.bestOfGroup || item.group || item.type) === group)
    .length || 1;
  const bestOf = clamp(Math.round(Number(legacyComponent.bestOf) || eligibleCount), 1, eligibleCount);
  return clamp(Number(legacyComponent.weight) || 0, 0, 100) / bestOf;
}

function inferComponentType(component) {
  return normalizeAssessmentType(component?.type || component?.name || "Assessment");
}

function renderComponentRows() {
  renderRuleManager();
  renderCalculatorSummary();
}

function renderRuleManager() {
  const rule = getActiveRule();
  const rows = rule.bestOfRules || [];
  $("#ruleManagerRows").innerHTML = rows.map((component, index) => `
    <article class="rule-editor-card">
      <div class="rule-editor-head">
        <strong>${escapeHtml(component.group || `Group ${index + 1}`)}</strong>
        <label class="mini-toggle">
          <input type="checkbox" data-rule-index="${index}" data-rule-field="enabled" ${component.enabled !== false ? "checked" : ""}>
          Enabled
        </label>
      </div>
      <div class="rule-editor-grid">
        <label>
          Best-Of Group
          <input data-rule-index="${index}" data-rule-field="group" value="${escapeAttr(component.group)}" aria-label="Best-of group">
        </label>
        <label>
          Select Best
          <input data-rule-index="${index}" data-rule-field="bestOf" type="number" min="1" step="1" value="${Number(component.bestOf) || 1}" aria-label="Best-of count">
        </label>
      </div>
      <button class="danger-btn small-btn" type="button" data-remove-rule="${index}">Remove Best-Of Rule</button>
    </article>
  `).join("") || `<div class="empty-state">No best-of rules configured for this trimester.</div>`;

  $$("[data-rule-index]", $("#ruleManagerRows")).forEach((input) => {
    input.addEventListener("input", updateAssessmentComponent);
    input.addEventListener("change", updateAssessmentComponent);
  });
  $$("[data-remove-rule]", $("#ruleManagerRows")).forEach((button) => {
    button.addEventListener("click", () => removeAssessmentComponent(Number(button.dataset.removeRule)));
  });
  renderCourseAssessmentManager();
}

function renderCourseAssessmentManager() {
  const course = getSelectedCourse();
  const definitions = courseAssessmentDefinitionsForCourse(course);
  $("#courseAssessmentRows").innerHTML = definitions.map((assessment, index) => `
    <article class="rule-editor-card course-assessment-editor">
      <div class="rule-editor-head">
        <strong>${escapeHtml(assessment.name || assessment.id)}</strong>
        <label class="mini-toggle">
          <input type="checkbox" data-course-assessment-index="${index}" data-course-assessment-field="enabled" ${assessment.enabled !== false ? "checked" : ""}>
          Enabled
        </label>
      </div>
      <div class="rule-editor-grid">
        <label>
          Assessment Name
          <input data-course-assessment-index="${index}" data-course-assessment-field="name" value="${escapeAttr(assessment.name || assessment.id)}" aria-label="Assessment name">
        </label>
        <label>
          Assessment ID
          <input data-course-assessment-index="${index}" data-course-assessment-field="id" value="${escapeAttr(assessment.id)}" aria-label="Assessment id">
        </label>
        <label>
          Best-Of Group
          <input data-course-assessment-index="${index}" data-course-assessment-field="bestOfGroup" value="${escapeAttr(assessment.bestOfGroup || assessment.type)}" aria-label="Best-of group">
        </label>
        <label>
          Maximum Marks
          <input data-course-assessment-index="${index}" data-course-assessment-field="maxMarks" type="number" min="1" step="0.01" value="${Number(assessment.maxMarks) || 1}" aria-label="${escapeAttr(assessment.id)} maximum marks">
        </label>
        <label>
          Weight %
          <input data-course-assessment-index="${index}" data-course-assessment-field="weight" type="number" min="0" max="100" step="0.01" value="${Number(assessment.weight) || 0}" aria-label="${escapeAttr(assessment.id)} weight percent">
        </label>
        <label class="mini-toggle">
          <input type="checkbox" data-course-assessment-index="${index}" data-course-assessment-field="bestOfEligible" ${assessment.bestOfEligible !== false ? "checked" : ""}>
          Best-Of Eligible
        </label>
      </div>
      <button class="danger-btn small-btn" type="button" data-remove-course-assessment="${index}">Remove Assessment</button>
    </article>
  `).join("") || `<div class="empty-state">No assessment definitions found for ${escapeHtml(course?.code || "this course")}.</div>`;

  $$("[data-course-assessment-index]", $("#courseAssessmentRows")).forEach((input) => {
    input.addEventListener("input", updateCourseAssessmentDefinition);
    input.addEventListener("change", updateCourseAssessmentDefinition);
  });
  $$("[data-remove-course-assessment]", $("#courseAssessmentRows")).forEach((button) => {
    button.addEventListener("click", () => removeCourseAssessmentDefinition(Number(button.dataset.removeCourseAssessment)));
  });
}

function updateCourseAssessmentDefinition(event) {
  const course = getSelectedCourse();
  const override = ensureCourseAssessmentOverride(course);
  const index = Number(event.target.dataset.courseAssessmentIndex);
  const field = event.target.dataset.courseAssessmentField;
  if (!override?.assessments?.[index]) return;
  const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  const assessment = override.assessments[index];
  if (field === "enabled") {
    assessment.enabled = Boolean(value);
  } else if (field === "bestOfEligible") {
    assessment.bestOfEligible = Boolean(value);
  } else if (field === "maxMarks") {
    assessment.maxMarks = Math.max(1, Number(value) || 1);
  } else if (field === "weight") {
    assessment.weight = clamp(Number(value) || 0, 0, 100);
  } else if (field === "bestOfGroup") {
    assessment.bestOfGroup = normalizeAssessmentType(value);
    assessment.type = assessment.bestOfGroup;
    ensureComponentDefinition(assessment.bestOfGroup);
  } else if (field === "name") {
    assessment.name = String(value || assessment.name || assessment.id).trim() || assessment.id;
  } else if (field === "id") {
    assessment.id = String(value || assessment.id).trim() || assessment.id;
  }
  syncActivePlanFromRules({ preserveScores: true });
  persistState();
}

function addCourseAssessmentDefinition() {
  const course = getSelectedCourse();
  const override = ensureCourseAssessmentOverride(course);
  const type = getActiveRule().bestOfRules?.[0]?.group || "CUSTOM";
  const existing = new Set((override.assessments || []).map((assessment) => assessment.id));
  let index = 1;
  let id = `${normalizeAssessmentType(type)}${index}`;
  while (existing.has(id)) {
    index += 1;
    id = `${normalizeAssessmentType(type)}${index}`;
  }
  override.assessments.push({
    id,
    name: id,
    type: normalizeAssessmentType(type),
    maxMarks: 100,
    studentScore: null,
    weight: 0,
    bestOfEligible: true,
    bestOfGroup: normalizeAssessmentType(type),
    enabled: true
  });
  syncActivePlanFromRules({ preserveScores: true });
  persistState();
  showToast(`${id} added for ${course.code}.`);
}

function removeCourseAssessmentDefinition(index) {
  const course = getSelectedCourse();
  const override = ensureCourseAssessmentOverride(course);
  if (!override?.assessments?.[index]) return;
  const removed = override.assessments.splice(index, 1)[0];
  syncActivePlanFromRules({ preserveScores: true });
  persistState();
  showToast(`${removed.id} removed from ${course.code}.`);
}

function updateAssessmentComponent(event) {
  const rule = getActiveRule();
  const index = Number(event.target.dataset.ruleIndex);
  const field = event.target.dataset.ruleField;
  if (!rule?.bestOfRules?.[index]) return;
  const component = rule.bestOfRules[index];
  const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  component[field] = field === "bestOf" ? Number(value) : value;
  if (field === "enabled") component.enabled = Boolean(value);
  if (field === "group") {
    component.group = normalizeAssessmentType(value);
    ensureComponentDefinition(component.group);
  }
  component.bestOf = Math.max(1, Math.round(Number(component.bestOf) || 1));
  syncActivePlanFromRules({ preserveScores: true });
  persistState();
}

function addAssessmentComponent() {
  const rule = getActiveRule();
  if (!rule.bestOfRules) rule.bestOfRules = [];
  const type = nextCustomAssessmentType(rule.bestOfRules);
  rule.bestOfRules.push({
    id: makeId(),
    group: type,
    bestOf: 1,
    enabled: true
  });
  ensureComponentDefinition(type);
  syncActivePlanFromRules({ preserveScores: true });
  persistState();
  showToast(`${type} best-of rule added.`);
}

function removeAssessmentComponent(index) {
  const rule = getActiveRule();
  if (!rule?.bestOfRules?.[index]) return;
  const removed = rule.bestOfRules.splice(index, 1)[0];
  syncActivePlanFromRules({ preserveScores: true });
  persistState();
  showToast(`${removed.group || "Assessment"} best-of rule removed.`);
}

function normalizeAssessmentRules(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rules = Array.isArray(source.rules) ? source.rules : Array.isArray(source) ? source : [];
  return {
    version: String(source.version || "1.0.0"),
    updatedAt: source.updatedAt || new Date().toISOString().slice(0, 10),
    source: source.source || "Local assessment rules",
    componentDefinitions: { ...(source.componentDefinitions || {}) },
    rules: rules.map((rule, ruleIndex) => {
      const trimesters = Array.isArray(rule.appliesTo?.trimesters) ? rule.appliesTo.trimesters : [ruleIndex + 1];
      return {
        id: rule.id || `rule-${ruleIndex + 1}`,
        name: rule.name || `Evaluation Rule ${ruleIndex + 1}`,
        appliesTo: {
          trimesters: trimesters.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        },
        bestOfRules: (rule.bestOfRules || rule.components || []).map((component, componentIndex) => {
          const group = normalizeAssessmentType(component.group || component.type || component.name || `GROUP${componentIndex + 1}`);
          return {
            id: component.id || makeId(),
            group,
            bestOf: Math.max(1, Math.round(Number(component.bestOf) || Number(component.count) || 1)),
            enabled: component.enabled !== false
          };
        })
      };
    })
  };
}

function cloneRules(rules) {
  return normalizeAssessmentRules(JSON.parse(JSON.stringify(rules || {})));
}

function normalizeCourseAssessments(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const directCourses = Object.fromEntries(
    Object.entries(source)
      .filter(([key, value]) => !["version", "updatedAt", "source", "_defaults", "courses"].includes(key) && value?.assessments)
  );
  const nestedCourses = source.courses && typeof source.courses === "object" ? source.courses : {};
  return {
    version: String(source.version || "1.0.0"),
    updatedAt: source.updatedAt || new Date().toISOString().slice(0, 10),
    source: source.source || "Local course assessment definitions",
    _defaults: (source._defaults || []).map(normalizeCourseAssessmentSet),
    courses: Object.fromEntries(
      Object.entries({ ...nestedCourses, ...directCourses }).map(([code, value]) => [
        code,
        normalizeCourseAssessmentSet(value, code)
      ])
    )
  };
}

function normalizeCourseAssessmentSet(set, courseCode = "") {
  return {
    id: set?.id || makeId(),
    courseCode: String(set?.courseCode || courseCode || ""),
    appliesTo: {
      trimesters: (set?.appliesTo?.trimesters || []).map((trimester) => Number(trimester)).filter((trimester) => Number.isFinite(trimester))
    },
    assessments: (set?.assessments || []).map(normalizeCourseAssessmentDefinition)
  };
}

function normalizeCourseAssessmentDefinition(definition, index = 0) {
  const type = normalizeAssessmentType(definition?.type || definition?.id || `A${index + 1}`);
  const id = String(definition?.id || `${type}${index + 1}`);
  const bestOfGroup = normalizeAssessmentType(definition?.bestOfGroup || definition?.group || type);
  const weight = firstFiniteNumber(definition?.weight);
  return {
    id,
    name: String(definition?.name || definition?.label || id),
    type,
    maxMarks: Math.max(1, Number(definition?.maxMarks) || 100),
    studentScore: normalizeNullableNumber(definition?.studentScore),
    weight,
    bestOfEligible: definition?.bestOfEligible !== false,
    bestOfGroup,
    enabled: definition?.enabled !== false
  };
}

function cloneCourseAssessments(courseAssessments) {
  return normalizeCourseAssessments(JSON.parse(JSON.stringify(courseAssessments || {})));
}

function normalizeAssessmentType(type) {
  return String(type || "Assessment")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase() || "ASSESSMENT";
}

function ensureComponentDefinition(type) {
  if (!state.assessmentRules.componentDefinitions) state.assessmentRules.componentDefinitions = {};
  if (!state.assessmentRules.componentDefinitions[type]) {
    state.assessmentRules.componentDefinitions[type] = "Custom assessment component";
  }
}

function componentDefinition(type) {
  return state.assessmentRules?.componentDefinitions?.[type] || "Assessment component";
}

function findMatchingPlanComponent(plan, type, index) {
  const byType = (plan || []).filter((component) => inferComponentType(component) === type);
  return byType.shift() || plan?.[index] || null;
}

function courseAssessmentDefinitionsForCourse(course) {
  if (!course) return [];
  const courseSet = state.courseAssessments?.courses?.[course.code];
  const defaultSet = (state.courseAssessments?._defaults || [])
    .find((set) => set.appliesTo?.trimesters?.includes(Number(course.trimester)));
  return (courseSet?.assessments?.length ? courseSet.assessments : defaultSet?.assessments || [])
    .map((definition, index) => normalizeCourseAssessmentDefinition(definition, index));
}

function ensureCourseAssessmentOverride(course = getSelectedCourse()) {
  if (!course) return null;
  if (!state.courseAssessments.courses) state.courseAssessments.courses = {};
  if (!state.courseAssessments.courses[course.code]) {
    state.courseAssessments.courses[course.code] = {
      id: `${course.code}-assessments`,
      courseCode: course.code,
      appliesTo: { trimesters: [Number(course.trimester)] },
      assessments: courseAssessmentDefinitionsForCourse(course)
    };
  }
  return state.courseAssessments.courses[course.code];
}

function normalizePreviousAssessmentPlan(previousPlan) {
  if (!Array.isArray(previousPlan)) return [];
  if (!previousPlan.some((item) => Number(item.count) || Array.isArray(item.scores) || typeof item.scores === "string")) {
    return previousPlan.map((assessment, index) => ({
      id: String(assessment.id || `${normalizeAssessmentType(assessment.type)}${index + 1}`),
      name: String(assessment.name || assessment.label || assessment.id || `${normalizeAssessmentType(assessment.type)}${index + 1}`),
      type: normalizeAssessmentType(assessment.type),
      maxMarks: Math.max(1, Number(assessment.maxMarks) || 100),
      studentScore: normalizeNullableNumber(assessment.studentScore ?? assessment.score),
      weight: firstFiniteNumber(assessment.weight),
      bestOfEligible: assessment.bestOfEligible !== false,
      bestOfGroup: normalizeAssessmentType(assessment.bestOfGroup || assessment.group || assessment.type),
      enabled: assessment.enabled !== false,
      fromLegacy: false
    }));
  }
  return previousPlan.flatMap((component) => {
    const type = inferComponentType(component);
    const count = Math.max(1, Number(component.count) || 1);
    const bestOf = clamp(Math.round(Number(component.bestOf) || count), 1, count);
    const itemWeight = clamp(Number(component.weight) || 0, 0, 100) / bestOf;
    const maxMarksList = normalizeMaxMarksList(component.maxMarksList, count, Math.max(1, Number(component.maxMarks) || 100));
    const scores = normalizeScoreList(component.scores, count);
    return Array.from({ length: count }, (_, index) => ({
      id: `${type}${index + 1}`,
      name: `${type}${index + 1}`,
      type,
      maxMarks: maxMarksList[index],
      studentScore: normalizeNullableNumber(scores[index]),
      weight: itemWeight,
      bestOfEligible: true,
      bestOfGroup: type,
      enabled: component.enabled !== false,
      fromLegacy: true
    }));
  });
}

function findPreviousAssessment(previousAssessments, definition, index) {
  const group = normalizeAssessmentType(definition.bestOfGroup || definition.group || definition.type);
  const id = String(definition.id || "").toLowerCase();
  return previousAssessments.find((assessment) => String(assessment.id || "").toLowerCase() === id && normalizeAssessmentType(assessment.bestOfGroup || assessment.type) === group)
    || previousAssessments.filter((assessment) => normalizeAssessmentType(assessment.bestOfGroup || assessment.type) === group)[indexWithinType(courseAssessmentDefinitionsForCourse(getSelectedCourse()), definition, index)]
    || null;
}

function indexWithinType(definitions, definition, fallbackIndex) {
  const type = normalizeAssessmentType(definition.bestOfGroup || definition.group || definition.type);
  const normalized = definitions.map((item) => ({
    id: item.id,
    type: normalizeAssessmentType(item.bestOfGroup || item.group || item.type)
  }));
  const exactIndex = normalized.findIndex((item) => item.id === definition.id && item.type === type);
  const boundary = exactIndex >= 0
    ? exactIndex
    : clamp(Math.round(Number(fallbackIndex) || 0), 0, Math.max(0, normalized.length - 1));
  return Math.max(0, normalized.slice(0, boundary + 1).filter((item) => item.type === type).length - 1);
}

function normalizeScoreList(value, count = 0) {
  let scores;
  if (Array.isArray(value)) {
    scores = value.map((item) => Number.isFinite(Number(item)) ? Number(item) : null);
  } else {
    scores = String(value || "")
      .split(",")
      .map((item) => item.trim() === "" ? null : Number(item.trim()))
      .map((item) => Number.isFinite(item) ? item : null);
  }
  while (scores.length < count) scores.push(null);
  return scores.slice(0, count);
}

function normalizeMaxMarksList(value, count, fallback) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const candidate = Number(source[index]);
    return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
  });
}

function getMaxMarksAt(component, index) {
  const fromList = Number(component?.maxMarksList?.[index]);
  if (Number.isFinite(fromList) && fromList > 0) return fromList;
  return Math.max(1, Number(component?.maxMarks) || 1);
}

function setScoreAt(component, index, value) {
  const parsed = value === "" ? null : Number(value);
  component.studentScore = Number.isFinite(parsed) ? parsed : null;
}

function setMaxMarksAt(component, index, value) {
  const parsed = value === "" ? null : Number(value);
  component.maxMarks = Number.isFinite(parsed) ? parsed : null;
  const course = getSelectedCourse();
  const override = ensureCourseAssessmentOverride(course);
  const matching = override?.assessments?.find((assessment) => assessment.id === component.id && normalizeAssessmentType(assessment.bestOfGroup || assessment.type) === normalizeAssessmentType(component.bestOfGroup || component.type));
  if (matching) matching.maxMarks = component.maxMarks;
}

function setWeightAt(component, index, value) {
  const parsed = value === "" ? null : Number(value);
  component.weight = Number.isFinite(parsed) ? parsed : null;
  const course = getSelectedCourse();
  const override = ensureCourseAssessmentOverride(course);
  const matching = override?.assessments?.find((assessment) => assessment.id === component.id && normalizeAssessmentType(assessment.bestOfGroup || assessment.type) === normalizeAssessmentType(component.bestOfGroup || component.type));
  if (matching) matching.weight = component.weight;
}

function nextCustomAssessmentType(components) {
  const existing = new Set((components || []).map((component) => normalizeAssessmentType(component.group || component.type)));
  let index = 1;
  while (existing.has(`CUSTOM${index}`)) index += 1;
  return `CUSTOM${index}`;
}

function toggleRuleManager() {
  const panel = $("#ruleManagerPanel");
  const shouldOpen = panel.hidden;
  panel.hidden = !shouldOpen;
  $("#openRuleManagerBtn").setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    state.beginnerMode = false;
    $("#beginnerModeToggle").checked = false;
    applyBeginnerMode();
    renderRuleManager();
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function closeRuleManager() {
  $("#ruleManagerPanel").hidden = true;
  $("#openRuleManagerBtn").setAttribute("aria-expanded", "false");
}

function applyBeginnerMode() {
  const calculator = $("#calculator");
  calculator?.classList.toggle("beginner-mode", Boolean(state.beginnerMode));
  calculator?.classList.toggle("power-mode", !state.beginnerMode);
  $("#openRuleManagerBtn").hidden = Boolean(state.beginnerMode);
  if (state.beginnerMode) closeRuleManager();
}

function exportAssessmentRules() {
  const blob = new Blob([JSON.stringify(state.assessmentRules, null, 2)], { type: "application/json" });
  downloadBlob(blob, `assessment-rules-${dateStamp()}.json`);
  showToast("Assessment rules JSON exported.");
}

function exportCourseAssessments() {
  const blob = new Blob([JSON.stringify(state.courseAssessments, null, 2)], { type: "application/json" });
  downloadBlob(blob, `course-assessments-${dateStamp()}.json`);
  showToast("Course assessment definitions JSON exported.");
}

function renderCalculatorSummary({ renderCards = true } = {}) {
  const result = calculatePlanResult();
  const grade = gradeFromPercentage(result.projected);
  const weightClass = Math.abs(result.totalWeight - 100) <= 0.1 ? "Weights total 100%" : `Weights total ${formatNumber(result.totalWeight, 1)}%`;

  $("#weightedScore").textContent = `${formatNumber(result.projected, 1)}%`;
  $("#weightHealth").textContent = `${weightClass}, attempted ${formatNumber(result.attemptedWeight, 1)}%`;
  $("#letterGrade").textContent = grade.letter;
  $("#gradePoint").textContent = String(grade.point);
  $("#passFailStatus").textContent = grade.letter === "F" ? "Fail" : "Pass";
  $("#passFailMessage").textContent = grade.letter === "F" ? "Below DD threshold" : `${grade.letter} standing`;
  if (renderCards) {
    renderAssessmentCards(result);
  } else {
    patchAssessmentCards(result);
  }
  renderRuleExplanation(result);
  renderOfficialBreakdown(result);

  const targetGrade = getTargetGrade();
  const target = targetGrade.min;
  const gap = Math.max(0, target - result.projected);
  $("#targetGap").textContent = `${formatNumber(Math.max(0, target - result.projected), 1)}%`;
  if (result.remainingWeight > 0 && gap > 0) {
    const required = clamp((gap / result.remainingWeight) * 100, 0, 100);
    $("#targetMessage").textContent = `Need about ${formatNumber(required, 1)}% average on remaining official weight.`;
  } else if (target <= result.projected) {
    $("#targetMessage").textContent = `${targetGrade.letter} target is currently covered.`;
  } else {
    $("#targetMessage").textContent = "No remaining configured weight.";
  }
  renderLiveAnalytics(result, grade, targetGrade);
  renderTargetNeedCard(result);
  renderWorkflowSteps(result);
  renderWhatIfSummary(result);
}

function renderAssessmentCards(result) {
  const course = getSelectedCourse();
  if (!course) return;
  $("#assessmentCardGroups").innerHTML = result.components.map((component, componentIndex) => {
    const selectedKeys = new Set(component.selected.map((item) => item.key));
    const droppedKeys = new Set(component.dropped.map((item) => item.key));
    return `
      <section class="assessment-group" data-component-index="${componentIndex}" aria-labelledby="assessmentGroup${componentIndex}">
        <div class="assessment-group-head">
          <div>
            <button class="term-chip" type="button" title="${escapeAttr(componentDefinition(component.type))}" aria-label="${escapeAttr(component.type)} means ${escapeAttr(componentDefinition(component.type))}">${escapeHtml(component.type)}</button>
            <h3 id="assessmentGroup${componentIndex}">${escapeHtml(component.name || `${component.type} Scores`)}</h3>
            <p data-group-summary>${componentSummaryText(component)}</p>
          </div>
          <span class="weight-badge" data-group-weight>${formatNumber(component.weight, 1)}% Active Weight</span>
        </div>
        <div class="assessment-card-grid">
          ${component.items.map((item) => {
            const status = selectedKeys.has(item.key) ? "included" : droppedKeys.has(item.key) ? "dropped" : "included";
            return `
              <article class="assessment-card ${status} ${item.validationErrors.length ? "invalid" : ""}" data-status="${status}" data-plan-index="${item.planIndex}">
                <div class="assessment-card-head">
                  <strong>${escapeHtml(item.label)}</strong>
                  <span data-card-status>${statusLabel(status)}</span>
                </div>
                <label>
                  Student Score
                  <input
                    type="number"
                    min="0"
                    max="${escapeAttr(item.maxMarks)}"
                    step="0.01"
                    value="${item.entered ? escapeAttr(item.rawScore) : ""}"
                    data-score-index="${item.planIndex}"
                    aria-invalid="${item.validationErrors.length > 0}"
                    aria-label="${escapeAttr(item.label)} student score">
                </label>
                <label>
                  Maximum Marks
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value="${item.rawMaxMarks === null ? "" : escapeAttr(item.rawMaxMarks)}"
                    data-max-index="${item.planIndex}"
                    aria-invalid="${item.validationErrors.length > 0}"
                    aria-label="${escapeAttr(item.label)} maximum marks">
                </label>
                <label>
                  Weight %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value="${item.rawWeight === null ? "" : escapeAttr(item.rawWeight)}"
                    data-weight-index="${item.planIndex}"
                    aria-invalid="${item.validationErrors.length > 0}"
                    aria-label="${escapeAttr(item.label)} weight percent">
                </label>
                <div class="validation-stack" data-card-validation>${validationMessagesHtml(item.validationErrors)}</div>
                <div class="assessment-meta">
                  <span>Contribution %</span>
                  <strong data-card-contribution>${formatNumber(item.contribution, 2)}%</strong>
                </div>
                <div class="best-status ${status}" data-best-status>
                  ${statusIcon(status)} ${status === "included" ? "Selected" : "Not Selected"}
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }).join("") || `<article class="panel empty-state">No assessment components are enabled for this trimester.</article>`;

  $$("[data-score-index]", $("#assessmentCardGroups")).forEach((input) => {
    input.addEventListener("input", updateAssessmentScore);
  });
  $$("[data-max-index]", $("#assessmentCardGroups")).forEach((input) => {
    input.addEventListener("input", updateAssessmentMaxMarks);
  });
  $$("[data-weight-index]", $("#assessmentCardGroups")).forEach((input) => {
    input.addEventListener("input", updateAssessmentWeight);
  });
}

function patchAssessmentCards(result) {
  const root = $("#assessmentCardGroups");
  if (!root) return;
  const active = document.activeElement;

  result.components.forEach((component, componentIndex) => {
    const group = root.querySelector(`[data-component-index="${componentIndex}"]`);
    if (!group) return;
    const summary = group.querySelector("[data-group-summary]");
    const weight = group.querySelector("[data-group-weight]");
    if (summary) summary.textContent = componentSummaryText(component);
    if (weight) weight.textContent = `${formatNumber(component.weight, 1)}% Active Weight`;

    const selectedKeys = new Set(component.selected.map((item) => item.key));
    const droppedKeys = new Set(component.dropped.map((item) => item.key));
    component.items.forEach((item) => {
      const status = selectedKeys.has(item.key) ? "included" : droppedKeys.has(item.key) ? "dropped" : "included";
      patchAssessmentCard(root, item, status, active);
    });
  });
}

function patchAssessmentCard(root, item, status, activeElement) {
  const card = root.querySelector(`[data-plan-index="${item.planIndex}"]`);
  if (!card) return;

  card.dataset.status = status;
  card.classList.toggle("included", status === "included");
  card.classList.toggle("dropped", status === "dropped");
  card.classList.toggle("pending", status === "pending");
  card.classList.toggle("invalid", item.validationErrors.length > 0);

  const statusLabelElement = card.querySelector("[data-card-status]");
  const contribution = card.querySelector("[data-card-contribution]");
  const bestStatus = card.querySelector("[data-best-status]");
  const validation = card.querySelector("[data-card-validation]");
  if (statusLabelElement) statusLabelElement.textContent = statusLabel(status);
  if (contribution) contribution.textContent = `${formatNumber(item.contribution, 2)}%`;
  if (bestStatus) {
    bestStatus.className = `best-status ${status}`;
    bestStatus.innerHTML = `${statusIcon(status)} ${status === "included" ? "Selected" : "Not Selected"}`;
  }
  if (validation) validation.innerHTML = validationMessagesHtml(item.validationErrors);

  syncAssessmentInputValue(card.querySelector("[data-score-index]"), item.entered ? item.rawScore : "", activeElement);
  const scoreInput = card.querySelector("[data-score-index]");
  if (scoreInput) scoreInput.max = String(item.maxMarks);
  syncAssessmentInputValue(card.querySelector("[data-max-index]"), item.rawMaxMarks === null ? "" : item.rawMaxMarks, activeElement);
  syncAssessmentInputValue(card.querySelector("[data-weight-index]"), item.rawWeight === null ? "" : item.rawWeight, activeElement);
  card.querySelectorAll("input").forEach((input) => {
    input.setAttribute("aria-invalid", String(item.validationErrors.length > 0));
  });
}

function syncAssessmentInputValue(input, value, activeElement) {
  if (!input || input === activeElement) return;
  const nextValue = String(value ?? "");
  if (input.value !== nextValue) input.value = nextValue;
}

function componentSummaryText(component) {
  return component.bestOf < component.eligibleCount
    ? `Best ${component.bestOf} of ${component.eligibleCount} eligible assessment${component.eligibleCount === 1 ? "" : "s"} selected automatically`
    : `All ${component.count} assessment${component.count === 1 ? "" : "s"} used`;
}

function validationMessagesHtml(messages) {
  return (messages || []).map((message) => `<div class="validation-message">${escapeHtml(message)}</div>`).join("");
}

function renderRuleExplanation(result) {
  const rule = getActiveRule();
  $("#engineRuleLabel").textContent = `${rule.name} - from ${ASSESSMENT_RULES_URL}`;
  const selectionPills = result.components.map((component) => {
    const selection = component.bestOf < component.eligibleCount
      ? `Best ${component.bestOf} ${component.type}${component.bestOf === 1 ? "" : "s"} selected`
      : `All ${component.count} ${component.type}${component.count === 1 ? "" : "s"} used`;
    return `<button class="rule-pill" type="button" title="${escapeAttr(TERM_DEFINITIONS["Best Of"])}">${escapeHtml(selection)}</button>`;
  });
  const weightPills = result.components.map((component) => `
    <button class="rule-pill" type="button" title="${escapeAttr(TERM_DEFINITIONS.Weight)}">${escapeHtml(component.type)} Active Weight = ${formatNumber(component.weight, 1)}%</button>
  `);
  $("#ruleExplanationList").innerHTML = [...selectionPills, ...weightPills].join("");
  const typeDefinitions = result.components.map((component) => ({
    term: component.type,
    definition: componentDefinition(component.type)
  }));
  const genericDefinitions = Object.entries(TERM_DEFINITIONS).map(([term, definition]) => ({ term, definition }));
  $("#definitionGrid").innerHTML = [...typeDefinitions, ...genericDefinitions].map((item) => `
    <div class="definition-card">
      <strong>${escapeHtml(item.term)}</strong>
      <span>${escapeHtml(item.definition)}</span>
    </div>
  `).join("");
}

function renderLiveAnalytics(result, grade, targetGrade) {
  $("#cgpaImpact").textContent = calculateCgpaImpact(grade);
  $("#componentContributions").innerHTML = result.components.map((component) => `
    <div>
      <span>${escapeHtml(component.type)} Contribution</span>
      <strong>${formatNumber(component.contribution, 2)}</strong>
    </div>
  `).join("");
  const dropped = result.components.flatMap((component) => component.dropped.map((item) => item.label));
  $("#droppedAssessments").textContent = dropped.length ? dropped.join(", ") : "None";

  const attemptedItems = result.components.flatMap((component) => component.items).filter((item) => item.entered).length;
  const totalItems = result.components.reduce((sum, component) => sum + component.items.length, 0);
  const assessmentCompletion = totalItems ? (attemptedItems / totalItems) * 100 : 0;
  const courseCompletion = result.totalWeight ? (result.attemptedWeight / result.totalWeight) * 100 : 0;
  const targetProgress = targetGrade.min ? (result.projected / targetGrade.min) * 100 : 0;
  const cgpa = calculateCgpa(state.records);
  const cgpaGoal = Number(state.profile.targetCgpa || 0);
  const cgpaProgress = cgpaGoal ? (cgpa / cgpaGoal) * 100 : 0;
  const progressItems = [
    { label: "Course Completion", value: courseCompletion },
    { label: "Assessment Completion", value: assessmentCompletion },
    { label: "Grade Progress", value: result.projected },
    { label: "Target Grade Progress", value: targetProgress },
    { label: "CGPA Goal Progress", value: cgpaProgress }
  ];
  $("#progressDashboard").innerHTML = progressItems.map((item) => `
    <div class="grade-progress-row ${toneFromScore(item.value)}">
      <div>
        <span>${escapeHtml(item.label)}</span>
        <strong>${formatNumber(clamp(item.value, 0, 100), 0)}%</strong>
      </div>
      <div class="progress-track"><span style="width:${formatNumber(clamp(item.value, 0, 100), 1)}%"></span></div>
    </div>
  `).join("");
}

function renderTargetNeedCard(result) {
  const aaGrade = activeGradeScale().find((grade) => grade.letter === "AA");
  const abGrade = activeGradeScale().find((grade) => grade.letter === "AB");
  const targetGrade = getTargetGrade();
  const aaNeed = aaGrade ? findRequiredNextAssessmentScore(aaGrade.min) : null;
  const abNeed = abGrade ? findRequiredNextAssessmentScore(abGrade.min) : null;
  const targetNeed = findRequiredNextAssessmentScore(targetGrade.min);
  $("#targetNeedsCard").innerHTML = `
    <div class="need-hero ${result.projected >= (aaGrade?.min || 101) ? "excellent" : toneFromScore(result.projected)}">
      <span>What Do I Need For AA?</span>
      <strong>${escapeHtml(requirementText(aaGrade, aaNeed, result.projected))}</strong>
    </div>
    <div class="need-grid">
      <div><span>For AB</span><strong>${escapeHtml(requirementText(abGrade, abNeed, result.projected))}</strong></div>
      <div><span>For ${escapeHtml(targetGrade.letter)}</span><strong>${escapeHtml(requirementText(targetGrade, targetNeed, result.projected))}</strong></div>
      <div><span>Remaining Open Assessments</span><strong>${remainingAssessmentCount(result)}</strong></div>
    </div>
  `;
}

function renderWorkflowSteps(result) {
  const hasScores = result.components.some((component) => component.items.some((item) => item.entered));
  const saved = state.records.some((record) => record.code === getSelectedCourse()?.code);
  $("#gradeWorkflowSteps").innerHTML = GRADE_WORKFLOW_STEPS.map((step, index) => {
    const complete = index === 0 || (index >= 1 && hasScores) || (index >= 2 && result.components.length) || (index >= 3 && result.projected > 0) || (index === 5 && saved);
    return `
      <span class="workflow-step ${complete ? "complete" : ""}">
        <b>${index + 1}</b>
        ${escapeHtml(step)}
      </span>
    `;
  }).join("");
}

function updateAssessmentScore(event) {
  const course = getSelectedCourse();
  const assessment = state.assessmentPlans[course.code]?.[Number(event.target.dataset.scoreIndex)];
  if (!assessment) return;
  setScoreAt(assessment, 0, event.target.value);
  persistState();
  renderCalculatorSummary({ renderCards: false });
}

function updateAssessmentMaxMarks(event) {
  const course = getSelectedCourse();
  const assessment = state.assessmentPlans[course.code]?.[Number(event.target.dataset.maxIndex)];
  if (!assessment) return;
  setMaxMarksAt(assessment, 0, event.target.value);
  persistState();
  renderCalculatorSummary({ renderCards: false });
}

function updateAssessmentWeight(event) {
  const course = getSelectedCourse();
  const assessment = state.assessmentPlans[course.code]?.[Number(event.target.dataset.weightIndex)];
  if (!assessment) return;
  setWeightAt(assessment, 0, event.target.value);
  persistState();
  renderCalculatorSummary({ renderCards: false });
}

function calculatePlanResult() {
  const course = getSelectedCourse();
  const plan = course ? state.assessmentPlans[course.code] || [] : [];
  return evaluatePlan(plan);
}

function evaluatePlan(plan) {
  const rule = getActiveRule();
  const items = (plan || [])
    .map((assessment, planIndex) => buildAssessmentItem(assessment, planIndex))
    .filter((item) => item.enabled !== false);
  const groups = groupAssessmentItems(items);
  const components = Array.from(groups.entries()).map(([group, groupItems], componentIndex) => {
    return evaluateAssessmentGroup(rule, group, groupItems, componentIndex);
  });
  const summary = components.reduce((acc, component) => {
    acc.components.push(component);
    acc.totalWeight += component.weight;
    acc.attemptedWeight += component.attemptedWeight;
    acc.remainingWeight += component.remainingWeight;
    acc.completedContribution += component.contribution;
    return acc;
  }, {
    projected: 0,
    completedContribution: 0,
    attemptedWeight: 0,
    remainingWeight: 0,
    totalWeight: 0,
    components: []
  });
  summary.projected = calculateWeightedScore(components);
  return summary;
}

function buildAssessmentItem(assessment, planIndex) {
  const type = normalizeAssessmentType(assessment.type || assessment.bestOfGroup || "ASSESSMENT");
  const group = normalizeAssessmentType(assessment.bestOfGroup || assessment.group || type);
  const maxMarksRaw = assessment.maxMarks === null || assessment.maxMarks === "" ? null : Number(assessment.maxMarks);
  const maxMarks = Number.isFinite(maxMarksRaw) && maxMarksRaw > 0 ? maxMarksRaw : 1;
  const rawScore = normalizeNullableNumber(assessment.studentScore);
  const entered = Number.isFinite(rawScore);
  const score = entered ? clamp(rawScore, 0, maxMarks) : 0;
  const weightRaw = assessment.weight === null || assessment.weight === "" ? null : Number(assessment.weight);
  const weight = Number.isFinite(weightRaw) ? clamp(weightRaw, 0, 100) : 0;
  const validationErrors = validateAssessmentValues(rawScore, maxMarksRaw, weightRaw);

  return {
    enabled: assessment.enabled !== false,
    index: planIndex,
    planIndex,
    key: `${group}-${assessment.id}-${planIndex}`,
    id: assessment.id,
    label: assessment.name || assessment.label || assessment.id || `Assessment ${planIndex + 1}`,
    type,
    group,
    rawScore,
    rawMaxMarks: Number.isFinite(maxMarksRaw) ? maxMarksRaw : null,
    rawWeight: Number.isFinite(weightRaw) ? weightRaw : null,
    score,
    maxMarks,
    weight,
    bestOfEligible: assessment.bestOfEligible !== false,
    entered,
    validationErrors,
    percentage: calculatePercentage(score, maxMarks),
    contribution: 0
  };
}

function validateAssessmentValues(rawScore, rawMaxMarks, rawWeight) {
  const errors = [];
  if (Number.isFinite(rawScore) && rawScore < 0) errors.push("Score cannot be negative.");
  if (Number.isFinite(rawScore) && Number.isFinite(rawMaxMarks) && rawScore > rawMaxMarks) errors.push("Score cannot exceed maximum marks.");
  if (!Number.isFinite(rawMaxMarks) || rawMaxMarks <= 0) errors.push("Maximum marks must be greater than 0.");
  if (Number.isFinite(rawWeight) && rawWeight < 0) errors.push("Weight cannot be negative.");
  if (Number.isFinite(rawWeight) && rawWeight > 100) errors.push("Weight cannot exceed 100%.");
  return errors;
}

function groupAssessmentItems(items) {
  return items.reduce((groups, item) => {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
    return groups;
  }, new Map());
}

function evaluateAssessmentGroup(rule, group, items, componentIndex) {
  const eligibleCount = items.filter((item) => item.bestOfEligible).length;
  const bestOfRule = bestOfRuleForGroup(rule, group);
  const bestOf = eligibleCount
    ? clamp(Math.round(Number(bestOfRule?.bestOf) || eligibleCount), 1, eligibleCount)
    : 0;
  const { selected, dropped } = calculateBestOf(items, bestOf);
  const selectedKeys = new Set(selected.map((item) => item.key));
  items.forEach((item) => {
    item.componentIndex = componentIndex;
    item.contribution = calculateContribution(item.score, item.maxMarks, item.weight);
    item.activeContribution = selectedKeys.has(item.key) ? item.contribution : 0;
  });
  const contribution = selected.reduce((sum, item) => sum + item.activeContribution, 0);
  const weight = selected.reduce((sum, item) => sum + item.weight, 0);
  const attemptedWeight = selected.filter((item) => item.entered).reduce((sum, item) => sum + item.weight, 0);
  const remainingWeight = selected.filter((item) => !item.entered).reduce((sum, item) => sum + item.weight, 0);

  return {
    type: group,
    name: `${group} Assessments`,
    count: items.length,
    eligibleCount,
    bestOf,
    maxMarks: Math.max(...items.map((item) => item.maxMarks), 1),
    weight,
    items,
    selected,
    dropped,
    percentage: weight ? (contribution / weight) * 100 : 0,
    contribution,
    attemptedWeight,
    remainingWeight
  };
}

function calculatePercentage(studentScore, maxMarks) {
  const max = Math.max(1, Number(maxMarks) || 1);
  return (clamp(Number(studentScore) || 0, 0, max) / max) * 100;
}

function calculateContribution(studentScore, maxMarks, weight, selected = true) {
  if (!selected) return 0;
  return calculatePercentage(studentScore, maxMarks) * (clamp(Number(weight) || 0, 0, 100) / 100);
}

function calculateBestOf(items, bestOfCount) {
  const fixed = items.filter((item) => !item.bestOfEligible);
  const eligible = items.filter((item) => item.bestOfEligible);
  const count = eligible.length ? clamp(Math.round(Number(bestOfCount) || eligible.length), 1, eligible.length) : 0;
  const selectedEligible = [...eligible]
    .sort((a, b) => b.percentage - a.percentage || a.index - b.index)
    .slice(0, count);
  const selectedKeys = new Set([...fixed, ...selectedEligible].map((item) => item.key));
  return {
    selected: items.filter((item) => selectedKeys.has(item.key)).sort((a, b) => a.index - b.index),
    dropped: eligible.filter((item) => !selectedKeys.has(item.key)).sort((a, b) => a.index - b.index)
  };
}

function calculateWeightedScore(components) {
  return (components || []).reduce((sum, component) => sum + Number(component.contribution || 0), 0);
}

function calculateCoursePercentage(plan) {
  return evaluatePlan(plan).projected;
}

function bestOfRuleForGroup(rule, group) {
  return (rule?.bestOfRules || [])
    .find((item) => item.enabled !== false && normalizeAssessmentType(item.group || item.type) === normalizeAssessmentType(group));
}

function renderOfficialBreakdown(result) {
  $("#officialBreakdown").innerHTML = result.components.map((component) => `
    <div class="engine-card">
      <div class="engine-card-head">
        <strong>${escapeHtml(component.type)}</strong>
        <span>${formatNumber(component.contribution, 2)}% contribution</span>
      </div>
      <dl>
        <dt>Percentage</dt><dd>${formatNumber(component.percentage, 1)}%</dd>
        <dt>Selected</dt><dd>${component.selected.length}/${component.count}</dd>
        <dt>Dropped</dt><dd>${component.dropped.length ? component.dropped.map((item) => item.label).join(", ") : "None"}</dd>
        <dt>Rule</dt><dd>${component.bestOf < component.eligibleCount ? `Best ${component.bestOf} of ${component.eligibleCount}` : "All selected"}</dd>
        <dt>Included Marks</dt><dd>${formatItems(component.selected)}</dd>
      </dl>
    </div>
  `).join("");
}

function renderWhatIfSummary(result) {
  const targetGrade = getTargetGrade();
  const neededForGrade = findRequiredNextAssessmentScore(targetGrade.min);
  const aaGrade = activeGradeScale().find((grade) => grade.letter === "AA");
  const abGrade = activeGradeScale().find((grade) => grade.letter === "AB");
  const aaNeed = aaGrade ? findRequiredNextAssessmentScore(aaGrade.min) : null;
  const abNeed = abGrade ? findRequiredNextAssessmentScore(abGrade.min) : null;
  const cgpaTarget = clamp(Number($("#whatIfCgpaInput").value) || Number(state.profile.targetCgpa) || 8, 0, 10);
  const nextCredits = Math.max(1, Number($("#whatIfCreditsInput").value) || 24);
  const currentCgpa = calculateCgpa(state.records);
  const completedCredits = state.records.reduce((sum, record) => sum + Number(record.credits || 0), 0);
  const requiredNext = completedCredits
    ? ((cgpaTarget * (completedCredits + nextCredits)) - (currentCgpa * completedCredits)) / nextCredits
    : cgpaTarget;
  const currentGrade = gradeFromPercentage(result.projected);
  const insights = [
    {
      title: "Marks Needed for AA",
      body: requirementText(aaGrade, aaNeed, result.projected)
    },
    {
      title: "Marks Needed for AB",
      body: requirementText(abGrade, abNeed, result.projected)
    },
    {
      title: "Predicted Grade",
      body: `${formatNumber(result.projected, 1)}% maps to ${currentGrade.letter} with predicted GPA ${currentGrade.point}.`
    },
    {
      title: `${targetGrade.letter} Scenario`,
      body: neededForGrade
        ? `${neededForGrade.label}: score at least ${formatNumber(neededForGrade.score, 1)} / ${neededForGrade.maxMarks} to reach ${targetGrade.letter}.`
        : result.projected >= targetGrade.min
          ? `You are already projected in the ${targetGrade.letter} range.`
          : "No open assessment is available; edit future marks in the score cells."
    },
    {
      title: "CGPA Protection",
      body: `To maintain ${formatNumber(cgpaTarget, 1)} CGPA after ${nextCredits} credits, target ${formatNumber(clamp(requiredNext, 0, 10), 2)} SGPA next trimester.`
    }
  ];
  $("#whatIfSummary").innerHTML = insights.map((item) => `
    <div class="insight-card">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
    </div>
  `).join("");
}

function requirementText(grade, need, projected) {
  if (!grade) return "Grade boundary is not configured.";
  if (projected >= grade.min) return `Already projected above the ${grade.letter} boundary.`;
  if (!need) return `No single open assessment can currently reach ${grade.letter}; adjust future marks across remaining assessments.`;
  return `${need.label}: need at least ${formatNumber(need.score, 1)} / ${need.maxMarks}.`;
}

function findRequiredNextAssessmentScore(targetPercentage) {
  const course = getSelectedCourse();
  if (!course) return null;
  const plan = state.assessmentPlans[course.code] || [];
  for (let assessmentIndex = 0; assessmentIndex < plan.length; assessmentIndex += 1) {
    const assessment = plan[assessmentIndex];
    if (Number.isFinite(normalizeNullableNumber(assessment.studentScore))) continue;
    const maxMarks = Math.max(1, Number(assessment.maxMarks) || 1);
    for (let score = 0; score <= maxMarks; score += 0.5) {
      const cloned = clonePlanForSimulation(plan);
      cloned[assessmentIndex].studentScore = score;
      const projected = evaluatePlan(cloned).projected;
      if (projected >= targetPercentage) {
        return { label: assessment.id, score, maxMarks };
      }
    }
  }
  return null;
}

function clonePlanForSimulation(plan) {
  return plan.map((component) => ({
    ...component
  }));
}

function formatItems(items) {
  return items.map((item) => `${item.label} ${formatNumber(item.score, 1)}/${item.maxMarks}${item.entered ? "" : " pending"}`).join(", ");
}

function saveCalculatorResult() {
  const course = getSelectedCourse();
  if (!course) return;
  const result = calculatePlanResult();
  const grade = gradeFromPercentage(result.projected);
  const trimester = Number($("#recordTrimester").value || course.trimester);
  const record = {
    id: `${course.code}-${trimester}`,
    code: course.code,
    trimester,
    percentage: clamp(result.projected, 0, 100),
    letter: grade.letter,
    gradePoint: grade.point,
    credits: course.credits,
    updatedAt: new Date().toISOString()
  };

  const index = state.records.findIndex((item) => item.code === record.code);
  if (index >= 0) {
    state.records[index] = record;
  } else {
    state.records.push(record);
  }
  persistState();
  renderAll();
  showToast(`${course.code} result saved.`);
}

function renderSyllabus() {
  const query = ($("#syllabusSearch").value || "").trim().toLowerCase();
  const trimester = $("#trimesterFilter").value;
  const courseFilter = $("#courseFilter").value;
  const type = $("#typeFilter").value;

  const filtered = state.courses.filter((course) => {
    const syllabus = findSyllabus(course.code);
    const haystack = [
      course.code,
      course.name,
      course.type,
      ...(course.tags || []),
      syllabus?.overview,
      ...(syllabus?.topics || []),
      ...(syllabus?.recommendedBooks || [])
    ].join(" ").toLowerCase();
    return (trimester === "all" || String(course.trimester) === trimester)
      && (courseFilter === "all" || course.code === courseFilter)
      && (type === "all" || course.type === type)
      && (!query || haystack.includes(query));
  });

  $("#courseList").innerHTML = filtered.map((course, index) => `
    <button class="course-tile ${index === 0 ? "active" : ""}" type="button" data-course-card="${course.code}">
      <h3>${course.code} - ${escapeHtml(course.name)}</h3>
      <p>${escapeHtml(findSyllabus(course.code)?.overview || "Syllabus information available in the course catalog.")}</p>
      <div class="course-meta">
        <span class="badge">Trimester ${course.trimester}</span>
        <span class="badge">${course.credits} credits</span>
        <span class="badge">${course.type}</span>
      </div>
    </button>
  `).join("") || `<div class="empty-state">No syllabus results found.</div>`;

  $$("[data-course-card]").forEach((card) => {
    card.addEventListener("click", () => {
      $$("[data-course-card]").forEach((item) => item.classList.remove("active"));
      card.classList.add("active");
      renderSyllabusDetail(card.dataset.courseCard);
    });
  });

  renderSyllabusDetail(filtered[0]?.code);
}

function renderSyllabusDetail(code) {
  const detail = $("#syllabusDetail");
  if (!code) {
    detail.innerHTML = `<div class="empty-state">Select a course to view syllabus details.</div>`;
    return;
  }
  const course = findCourse(code);
  const syllabus = findSyllabus(code);
  const focusAreas = examFocusAreas(course, syllabus);
  detail.innerHTML = `
    <h3>${course.code} - ${escapeHtml(course.name)}</h3>
    <div class="course-meta">
      <span class="badge">Trimester ${course.trimester}</span>
      <span class="badge">${course.creditPattern}</span>
      <span class="badge">${course.type}</span>
      <span class="badge">${difficultyLevel(course)} difficulty</span>
    </div>
    <p>${escapeHtml(syllabus?.overview || "Syllabus details are being updated.")}</p>
    <h4>Exam Focus Areas</h4>
    <div class="topic-cloud">
      ${focusAreas.map((topic) => `<span class="badge warn">${escapeHtml(topic)}</span>`).join("")}
    </div>
    <h4>Topics</h4>
    <div class="topic-cloud">
      ${(syllabus?.topics || []).map((topic) => `<span class="badge">${escapeHtml(topic)}</span>`).join("")}
    </div>
    <h4>Recommended Books</h4>
    <ul class="book-list">
      ${(syllabus?.recommendedBooks || ["Textbook list to be updated."]).map((book) => `<li>${escapeHtml(book)}</li>`).join("")}
    </ul>
    <h4>Instructor</h4>
    <p>${escapeHtml(course.instructor)}</p>
  `;
}

function difficultyLevel(course) {
  if (!course) return "Moderate";
  if (course.trimester >= 7 || course.type === "Elective") return "Advanced";
  if (course.trimester >= 4 || Number(course.credits) >= 8) return "Moderate-High";
  return "Foundational";
}

function examFocusAreas(course, syllabus) {
  const topics = syllabus?.topics || course?.tags || [];
  const preferred = topics.filter((topic) => /probability|linear|program|algorithm|machine|model|database|forecast|deep|ethics|cloud|signal|optimization|statistics|regression|visual/i.test(topic));
  return (preferred.length ? preferred : topics).slice(0, 6);
}

function renderGradeScaleRows() {
  $("#gradeScaleRows").innerHTML = state.gradeScale.map((grade, index) => `
    <tr>
      <td><strong>${escapeHtml(grade.letter)}</strong></td>
      <td><input data-grade-index="${index}" data-grade-field="min" type="number" min="0" max="100" step="1" value="${Number(grade.min)}" aria-label="${escapeAttr(grade.letter)} minimum percentage"></td>
      <td><input data-grade-index="${index}" data-grade-field="point" type="number" min="0" max="10" step="1" value="${Number(grade.point)}" aria-label="${escapeAttr(grade.letter)} grade point"></td>
    </tr>
  `).join("");

  $$("[data-grade-index]", $("#gradeScaleRows")).forEach((input) => {
    input.addEventListener("input", updateGradeScale);
  });
}

function updateGradeScale(event) {
  const index = Number(event.target.dataset.gradeIndex);
  const field = event.target.dataset.gradeField;
  const value = Number(event.target.value);
  if (!Number.isFinite(value) || !state.gradeScale[index]) return;
  state.gradeScale[index][field] = field === "point" ? clamp(value, 0, 10) : clamp(value, 0, 100);
  recalculateRecordsFromScale();
  persistState();
  renderTargetGradeOptions();
  renderDashboard();
  renderComparison();
  renderRecordsTable();
  renderCalculatorSummary();
}

function resetGradeScale() {
  state.gradeScale = DEFAULT_GRADE_SCALE.map((grade) => ({ ...grade }));
  recalculateRecordsFromScale();
  persistState();
  renderAll();
  showToast("Grade scale reset to absolute grading defaults.");
}

function renderRecordsTable() {
  $("#recordsMeta").textContent = `${state.records.length} record${state.records.length === 1 ? "" : "s"}`;
  const rows = [...state.records]
    .sort((a, b) => a.trimester - b.trimester || a.code.localeCompare(b.code))
    .map((record) => {
      const course = findCourse(record.code);
      return `<tr>
        <td><strong>${record.code}</strong><br><small>${escapeHtml(course?.name || record.code)}</small></td>
        <td>Trimester ${record.trimester}</td>
        <td>${formatNumber(record.percentage, 1)}%</td>
        <td><span class="badge ${badgeClass(record.gradePoint)}">${record.letter} - ${record.gradePoint}</span></td>
        <td><button class="ghost-btn small-btn" type="button" data-delete-record="${escapeAttr(record.id)}">Delete</button></td>
      </tr>`;
    })
    .join("");

  $("#recordsTable").innerHTML = rows || `<tr><td colspan="5">No saved results yet.</td></tr>`;
  $$("[data-delete-record]", $("#recordsTable")).forEach((button) => {
    button.addEventListener("click", () => deleteRecord(button.dataset.deleteRecord));
  });
}

function deleteRecord(recordId) {
  state.records = state.records.filter((record) => record.id !== recordId);
  persistState();
  renderAll();
  showToast("Course result deleted.");
}

function exportJson() {
  const payload = {
    project: "Student Performance Analytics Dashboard",
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    records: state.records,
    gradeScale: state.gradeScale,
    beginnerMode: state.beginnerMode,
    assessmentRules: state.assessmentRules,
    courseAssessments: state.courseAssessments,
    assessmentPlans: state.assessmentPlans,
    courses: state.courses,
    syllabus: state.syllabus
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `student-performance-${dateStamp()}.json`);
  showToast("JSON export ready.");
}

async function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    state.profile = data.profile || state.profile;
    state.records = Array.isArray(data.records) ? data.records : state.records;
    state.assessmentRules = normalizeAssessmentRules(data.assessmentRules || state.assessmentRules);
    state.courseAssessments = normalizeCourseAssessments(data.courseAssessments || state.courseAssessments);
    state.assessmentPlans = data.assessmentPlans || state.assessmentPlans;
    state.beginnerMode = data.beginnerMode ?? state.beginnerMode;
    state.gradeScale = normalizeGradeScale(data.gradeScale || state.gradeScale);
    recalculateRecordsFromScale();
    persistState();
    populateStaticControls();
    loadCoursePlan();
    renderAll();
    showToast("JSON data imported.");
  } catch (error) {
    console.error(error);
    showToast("Import failed. Check the JSON file.");
  } finally {
    event.target.value = "";
  }
}

async function exportPdf() {
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    showToast("PDF export needs html2canvas and jsPDF from the CDN.");
    return;
  }
  const activeView = $(".view.active")?.id;
  if (activeView !== "dashboard") {
    switchView("dashboard");
    await nextFrame();
  }
  try {
    showToast("Rendering report...");
    const target = $("#dashboard");
    const canvas = await html2canvas(target, {
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true
    });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 20;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let position = 10;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.text("Student Performance Analytics Dashboard", 10, position);
    position += 8;
    pdf.addImage(imgData, "PNG", 10, position, imgWidth, Math.min(imgHeight, pageHeight - position - 10));

    let remainingHeight = imgHeight - (pageHeight - position - 10);
    while (remainingHeight > 0) {
      pdf.addPage();
      const yOffset = pageHeight - position - 10 - imgHeight;
      pdf.addImage(imgData, "PNG", 10, yOffset - (imgHeight - remainingHeight), imgWidth, imgHeight);
      remainingHeight -= pageHeight - 20;
    }

    pdf.save(`student-dashboard-report-${dateStamp()}.pdf`);
    showToast("PDF report exported.");
  } catch (error) {
    console.error(error);
    showToast("PDF export failed. Check CDN availability.");
  }
}

function printDashboard() {
  switchView("dashboard");
  window.setTimeout(() => window.print(), 120);
}

function printReport() {
  switchView("comparison");
  window.setTimeout(() => window.print(), 120);
}

function exportCharts(format) {
  const chartEntries = Object.entries(charts).filter(([, chart]) => chart?.canvas);
  if (!chartEntries.length) {
    showToast("No rendered charts available to export yet.");
    return;
  }
  chartEntries.forEach(([id, chart], index) => {
    if (format === "svg") {
      const svg = chartToSvg(id, chart);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${id}-${dateStamp()}.svg`);
      return;
    }
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = chart.canvas.toDataURL(mime, 0.92);
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `${id}-${dateStamp()}.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.append(anchor);
    window.setTimeout(() => {
      anchor.click();
      anchor.remove();
    }, index * 120);
  });
  showToast(`Exporting ${chartEntries.length} chart${chartEntries.length === 1 ? "" : "s"} as ${format.toUpperCase()}.`);
}

function chartToSvg(id, chart) {
  const title = id.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
  const labels = chart.data?.labels || [];
  const dataset = chart.data?.datasets?.[0]?.data || [];
  const rows = labels.slice(0, 12).map((label, index) => {
    const value = dataset[index] ?? "";
    return `<text x="48" y="${120 + index * 30}" fill="#a7b0c0" font-size="16">${escapeSvg(String(label))}: ${escapeSvg(String(value))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <rect width="960" height="540" rx="18" fill="#0f1117"/>
    <rect x="24" y="24" width="912" height="492" rx="14" fill="#171b23" stroke="#343d4f"/>
    <text x="48" y="72" fill="#eef2f7" font-family="Arial, sans-serif" font-size="30" font-weight="700">${escapeSvg(title)}</text>
    <text x="48" y="104" fill="#2dd4bf" font-family="Arial, sans-serif" font-size="16">SVG summary export generated by Student Analytics</text>
    ${rows}
  </svg>`;
}

function resetDemoData() {
  state.records = seedDemoRecords(state.courses);
  state.assessmentPlans = {};
  state.assessmentRules = cloneRules(state.defaultAssessmentRules);
  state.courseAssessments = cloneCourseAssessments(state.defaultCourseAssessments);
  state.beginnerMode = true;
  state.selectedCourse = state.courses[0]?.code || "";
  populateStaticControls();
  loadCoursePlan();
  persistState();
  renderAll();
  showToast("Demo data restored.");
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  persistState();
  Object.values(charts).forEach((chart) => chart.destroy());
  charts = {};
  renderCharts();
  renderComparison();
  showToast(`${state.theme === "dark" ? "Dark" : "Light"} theme saved.`);
}

function drawChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas, config);
}

function renderChartFallbacks(message) {
  $$(".chart-frame").forEach((frame) => {
    if (!frame.querySelector(".chart-fallback")) {
      frame.insertAdjacentHTML("beforeend", `<div class="chart-fallback">${escapeHtml(message)}</div>`);
    }
  });
}

function clearChartFallbacks() {
  $$(".chart-fallback").forEach((fallback) => fallback.remove());
}

function baseChartOptions(scale = {}) {
  const colors = chartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: colors.grid }, ticks: { color: colors.text } },
      y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text }, ...scale }
    },
    plugins: {
      legend: { labels: { color: colors.text } }
    }
  };
}

function dualAxisOptions() {
  const colors = chartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      credits: {
        beginAtZero: true,
        position: "left",
        grid: { color: colors.grid },
        ticks: { color: colors.text }
      },
      gpa: {
        beginAtZero: true,
        suggestedMax: 10,
        position: "right",
        grid: { drawOnChartArea: false },
        ticks: { color: colors.text }
      },
      x: { grid: { color: colors.grid }, ticks: { color: colors.text } }
    },
    plugins: { legend: { labels: { color: colors.text } } }
  };
}

function chartColors() {
  const css = getComputedStyle(document.documentElement);
  return {
    text: css.getPropertyValue("--muted").trim(),
    grid: css.getPropertyValue("--line").trim(),
    surface: css.getPropertyValue("--surface").trim(),
    brand: css.getPropertyValue("--brand").trim(),
    amber: css.getPropertyValue("--brand-2").trim(),
    rose: css.getPropertyValue("--accent").trim(),
    green: css.getPropertyValue("--ok").trim(),
    brandSoft: "rgba(45, 212, 191, 0.16)",
    amberSoft: "rgba(245, 158, 11, 0.24)",
    roseSoft: "rgba(251, 113, 133, 0.22)"
  };
}

function semesterSummaries() {
  const grouped = new Map();
  state.records.forEach((record) => {
    if (!grouped.has(record.trimester)) {
      grouped.set(record.trimester, []);
    }
    grouped.get(record.trimester).push(record);
  });
  return Array.from(grouped.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([trimester, records]) => {
      const credits = records.reduce((sum, record) => sum + Number(record.credits || 0), 0);
      const points = records.reduce((sum, record) => sum + Number(record.gradePoint || 0) * Number(record.credits || 0), 0);
      const percentages = records.reduce((sum, record) => sum + Number(record.percentage || 0), 0);
      return {
        trimester: Number(trimester),
        records,
        credits,
        count: records.length,
        sgpa: credits ? points / credits : 0,
        averagePercentage: records.length ? percentages / records.length : 0
      };
    });
}

function calculateCgpa(records) {
  const credits = records.reduce((sum, record) => sum + Number(record.credits || 0), 0);
  const points = records.reduce((sum, record) => sum + Number(record.gradePoint || 0) * Number(record.credits || 0), 0);
  return credits ? points / credits : 0;
}

function buildForecastSeries(summaries) {
  const actual = summaries.map((summary) => ({
    label: `T${summary.trimester}`,
    x: summary.trimester,
    actual: summary.sgpa,
    forecast: null
  }));
  const forecast = forecastLine(summaries, 3).map((item) => ({
    label: `T${item.trimester}`,
    x: item.trimester,
    actual: null,
    forecast: item.sgpa
  }));
  return [...actual, ...forecast];
}

function forecastNextSgpa(summaries) {
  return forecastLine(summaries, 1)[0]?.sgpa || summaries.at(-1)?.sgpa || 0;
}

function forecastLine(summaries, horizon) {
  if (!summaries.length) return [];
  if (summaries.length === 1) {
    return Array.from({ length: horizon }, (_, index) => ({
      trimester: summaries[0].trimester + index + 1,
      sgpa: summaries[0].sgpa
    }));
  }
  const xs = summaries.map((summary) => summary.trimester);
  const ys = summaries.map((summary) => summary.sgpa);
  const meanX = average(xs);
  const meanY = average(ys);
  const numerator = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0);
  const denominator = xs.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0) || 1;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const start = Math.max(...xs);
  return Array.from({ length: horizon }, (_, index) => {
    const trimester = start + index + 1;
    return {
      trimester,
      sgpa: clamp(intercept + slope * trimester, 0, 10)
    };
  });
}

function calculateReadinessScore(cgpa, completedCredits, riskCount, totalProgramCredits) {
  const progressScore = totalProgramCredits ? Math.min(40, (completedCredits / totalProgramCredits) * 40) : 0;
  const cgpaScore = Math.min(35, (cgpa / 10) * 35);
  const riskScore = Math.max(0, 25 - riskCount * 5);
  return Math.round(progressScore + cgpaScore + riskScore);
}

function estimateNeededSgpa(cgpa, completedCredits, targetCgpa, totalProgramCredits) {
  const target = Number(targetCgpa || 0);
  const remainingCredits = Math.max(0, totalProgramCredits - completedCredits);
  if (!remainingCredits) {
    return cgpa >= target ? cgpa : null;
  }
  const currentPoints = cgpa * completedCredits;
  const requiredPoints = target * totalProgramCredits;
  const needed = (requiredPoints - currentPoints) / remainingCredits;
  if (needed > 10) return null;
  return clamp(needed, 0, 10);
}

function gradeFromPercentage(percentage) {
  const value = clamp(Number(percentage) || 0, 0, 100);
  return activeGradeScale().find((grade) => value >= grade.min) || activeGradeScale().at(-1);
}

function nextGrade(percentage) {
  const current = gradeFromPercentage(percentage);
  const next = activeGradeScale()
    .slice()
    .reverse()
    .find((grade) => grade.point > current.point);
  return next ? `toward ${next.letter}` : "inside AA range";
}

function activeGradeScale() {
  return normalizeGradeScale(state.gradeScale);
}

function normalizeGradeScale(scale) {
  const source = Array.isArray(scale) && scale.length ? scale : DEFAULT_GRADE_SCALE;
  return source
    .map((grade) => ({
      letter: String(grade.letter || "").trim() || "G",
      min: clamp(Number(grade.min), 0, 100),
      point: clamp(Number(grade.point), 0, 10)
    }))
    .filter((grade) => Number.isFinite(grade.min) && Number.isFinite(grade.point))
    .sort((a, b) => b.min - a.min || b.point - a.point);
}

function recalculateRecordsFromScale() {
  state.records = state.records.map((record) => {
    const grade = gradeFromPercentage(record.percentage);
    return {
      ...record,
      letter: grade.letter,
      gradePoint: grade.point
    };
  });
}

function seedDemoRecords(courses) {
  const percentages = {
    DA101: 86, DA102: 91, DA103: 78, DA104: 84,
    DA105: 82, DA106: 88, DA107: 75, DA108: 92,
    DA109: 80, DA110: 76, DA111: 72, DA112: 89,
    DA201: 83, DA202: 87, DA203: 74, DA204: 79,
    DA205: 81, DA206: 73, DA207: 68, DA208: 86,
    DA209: 85, DA210: 78, DA261: 88, DA262: 80
  };

  return Object.entries(percentages).map(([code, percentage]) => {
    const course = courses.find((item) => item.code === code);
    const grade = gradeFromPercentage(percentage);
    return {
      id: `${code}-${course?.trimester || 0}`,
      code,
      trimester: course?.trimester || 1,
      percentage,
      letter: grade.letter,
      gradePoint: grade.point,
      credits: course?.credits || 6,
      updatedAt: new Date().toISOString()
    };
  });
}

function getSelectedCourse() {
  return state.courses.find((course) => course.code === state.selectedCourse) || state.courses[0];
}

function getTargetGrade() {
  const selected = $("#targetGradeSelect")?.value;
  return activeGradeScale().find((grade) => grade.letter === selected) || activeGradeScale()[0] || DEFAULT_GRADE_SCALE[0];
}

function calculateCgpaImpact(grade) {
  const course = getSelectedCourse();
  if (!course) return "+0.00";
  const trimester = Number($("#recordTrimester")?.value || course.trimester);
  const before = calculateCgpa(state.records);
  const projectedRecord = {
    id: `${course.code}-${trimester}`,
    code: course.code,
    trimester,
    percentage: 0,
    letter: grade.letter,
    gradePoint: grade.point,
    credits: course.credits
  };
  const withoutCurrent = state.records.filter((record) => record.code !== course.code);
  const after = calculateCgpa([...withoutCurrent, projectedRecord]);
  const delta = after - before;
  return `${delta >= 0 ? "+" : ""}${formatNumber(delta, 2)}`;
}

function remainingAssessmentCount(result) {
  return result.components
    .flatMap((component) => component.items)
    .filter((item) => !item.entered).length;
}

function statusLabel(status) {
  if (status === "included") return "Selected";
  if (status === "dropped") return "Not Selected";
  return "Selected";
}

function statusIcon(status) {
  if (status === "included") return "&#10003;";
  if (status === "dropped") return "&#10005;";
  return "&#10003;";
}

function toneFromScore(score) {
  const value = Number(score) || 0;
  if (value >= 90) return "excellent";
  if (value >= 75) return "good";
  if (value >= 60) return "average";
  return "risk";
}

function findCourse(code) {
  return state.courses.find((course) => course.code === code);
}

function findSyllabus(code) {
  return state.syllabus.find((item) => item.code === code);
}

function badgeClass(point) {
  if (point >= 8) return "good";
  if (point >= 7) return "warn";
  return "risk";
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeSvg(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function promptInstall() {
  if (!deferredInstallPrompt) {
    showToast("Install prompt is not available yet. Use the browser install option if shown.");
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  setInstallButtonsVisible(false);
}

function setInstallButtonsVisible(visible) {
  [$("#installPwaBtn"), $("#installPwaTopBtn")].forEach((button) => {
    button.hidden = !visible;
  });
}

function updateConnectionStatus() {
  const status = $("#connectionStatus");
  if (!status) return;
  const online = navigator.onLine;
  const controlled = Boolean(navigator.serviceWorker?.controller);
  status.textContent = online ? (controlled ? "Online - offline cache ready" : "Online - cache warming") : "Offline - local data available";
  status.dataset.state = online ? "online" : "offline";
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js")
      .then(() => updateConnectionStatus())
      .catch((error) => {
        console.warn("Service worker registration failed", error);
        updateConnectionStatus();
      });
  }
}
