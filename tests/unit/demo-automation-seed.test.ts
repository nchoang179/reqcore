import { describe, expect, it } from "vitest";
import {
  OPERATORS_BY_QUESTION_TYPE,
  evaluateRule,
} from "../../shared/application-rules";
import type {
  EvaluatedRule,
  QuestionType,
  ResponseValue,
} from "../../shared/application-rules";
import {
  DEMO_AUTOMATION_RULES,
  DEMO_JOB_QUESTIONS,
} from "../../server/scripts/seed-data/automation";
import type {
  DemoAutomationCondition,
} from "../../server/scripts/seed-data/automation";

function matchingResponse(condition: DemoAutomationCondition): ResponseValue {
  switch (condition.operator) {
    case "is_missing":
    case "is_unanswered":
    case "is_false":
      return undefined;
    case "is_provided":
    case "is_answered":
      return "https://example.com/sample";
    case "is_true":
      return true;
    case "is_one_of":
      return (condition.value as string[])[0];
    case "includes_any":
    case "includes_all":
      return condition.value as string[];
    case "gt":
      return Number(condition.value) + 1;
    case "lt":
      return Number(condition.value) - 1;
    default:
      return condition.value;
  }
}

describe("demo automation seed data", () => {
  it("configures ordered eligibility and fast-track rules for every demo job", () => {
    expect(DEMO_JOB_QUESTIONS).toHaveLength(5);
    expect(DEMO_AUTOMATION_RULES).toHaveLength(DEMO_JOB_QUESTIONS.length);

    for (const rules of DEMO_AUTOMATION_RULES) {
      expect(rules.length).toBeGreaterThanOrEqual(2);
      expect(rules[0]?.action).toBe("rejected");
      expect(rules.some((rule) => rule.action === "screening")).toBe(true);
    }
  });

  it("only references existing questions with compatible operators and options", () => {
    DEMO_AUTOMATION_RULES.forEach((rules, jobIndex) => {
      const questions = DEMO_JOB_QUESTIONS[jobIndex];
      expect(questions).toBeDefined();
      const questionsByLabel = new Map(
        questions?.map((question) => [question.label, question]),
      );

      for (const rule of rules) {
        for (const condition of rule.conditions) {
          const question = questionsByLabel.get(condition.questionLabel);
          expect(
            question,
            `${rule.name}: ${condition.questionLabel}`,
          ).toBeDefined();
          expect(condition.questionType).toBe(question?.type);
          expect(OPERATORS_BY_QUESTION_TYPE[condition.questionType]).toContain(
            condition.operator,
          );

          if (
            Array.isArray(condition.value) &&
            ["single_select", "multi_select"].includes(condition.questionType)
          ) {
            for (const value of condition.value) {
              expect(question?.options).toContain(value);
            }
          }
        }
      }
    });
  });

  it("creates conditions that can actually trigger each configured rule", () => {
    DEMO_AUTOMATION_RULES.forEach((rules, jobIndex) => {
      const questions = DEMO_JOB_QUESTIONS[jobIndex];
      expect(questions).toBeDefined();
      const questionIds = new Map(
        questions?.map((question, index) => [question.label, String(index)]),
      );
      const questionTypes: Record<string, QuestionType> = {};
      questions?.forEach((question, index) => {
        questionTypes[String(index)] = question.type;
      });

      for (const rule of rules) {
        const responses: Record<string, ResponseValue> = {};
        const conditions = rule.conditions.map((condition) => {
          const questionId = questionIds.get(condition.questionLabel);
          expect(questionId).toBeDefined();
          responses[questionId!] = matchingResponse(condition);
          return {
            questionId: questionId!,
            operator: condition.operator,
            value: condition.value,
          };
        });
        const evaluatedRule: EvaluatedRule = {
          id: `${jobIndex}-${rule.name}`,
          name: rule.name,
          matchType: rule.matchType,
          action: rule.action,
          enabled: rule.enabled,
          conditions,
        };

        expect(evaluateRule(evaluatedRule, responses, questionTypes)).toBe(true);
      }
    });
  });
});
