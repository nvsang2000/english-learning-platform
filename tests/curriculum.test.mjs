import assert from "node:assert/strict";
import test from "node:test";
import {
  COURSE_DEFINITIONS,
  buildLessonContent,
  courseBySlug,
  startingWeek
} from "../dist/curriculum.js";

test("all courses have complete weekly curricula", () => {
  assert.equal(COURSE_DEFINITIONS.length, 8);
  assert.equal(new Set(COURSE_DEFINITIONS.map((course) => course.slug)).size, COURSE_DEFINITIONS.length);
  for (const course of COURSE_DEFINITIONS) {
    assert.equal(course.weeks.length, course.durationWeeks, course.slug);
    assert.ok(["communication", "exam"].includes(course.direction), course.slug);
    assert.ok(course.weeks.every((week) => week.trim().length > 0), course.slug);
  }
});

test("courses are separated into communication and exam directions", () => {
  const communication = COURSE_DEFINITIONS.filter((course) => course.direction === "communication").map((course) => course.slug);
  const exam = COURSE_DEFINITIONS.filter((course) => course.direction === "exam").map((course) => course.slug);
  assert.deepEqual(communication, ["foundation", "conversation", "workplace", "travel"]);
  assert.deepEqual(exam, ["b1", "b2", "toeic", "ielts"]);
});

test("new practical courses produce valid personalized lessons", () => {
  for (const slug of ["conversation", "workplace", "travel"]) {
    const course = courseBySlug(slug);
    const week = startingWeek(slug, "b1");
    assert.ok(week >= 1 && week <= course.durationWeeks, slug);
    const lesson = buildLessonContent(course, week, 3, 30);
    assert.equal(lesson.lessonPlan.totalMinutes, 30);
    assert.equal(lesson.lessonPlan.stages.reduce((sum, stage) => sum + stage.minutes, 0), 30);
    assert.match(lesson.titleVi, /^Tuần \d+ · Ngày 3:/);
    assert.ok(lesson.exercises.requirements.some((item) => item.includes("Gen Z")));
  }
});

test("lesson builder clamps week and focus to curriculum boundaries", () => {
  const course = courseBySlug("travel");
  const lesson = buildLessonContent(course, 999, 7, 15);
  assert.match(lesson.titleVi, /^Tuần 8 · Ngày 7:/);
  assert.equal(lesson.lessonPlan.theme, course.weeks.at(-1));
  assert.equal(lesson.lessonPlan.focus, "Ôn nhẹ + tiếp xúc tiếng Anh");
  assert.equal(lesson.lessonPlan.stages.reduce((sum, stage) => sum + stage.minutes, 0), 15);
});
