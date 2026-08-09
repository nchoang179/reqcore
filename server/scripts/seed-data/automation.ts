import type {
  QuestionType,
  RuleAction,
  RuleMatchType,
  RuleOperator,
} from "../../../shared/application-rules";

export interface DemoJobQuestion {
  type: QuestionType;
  label: string;
  required: boolean;
  options?: string[];
}

export interface DemoAutomationCondition {
  questionLabel: string;
  questionType: QuestionType;
  operator: RuleOperator;
  value?: string | string[] | number | null;
}

export interface DemoAutomationRule {
  name: string;
  matchType: RuleMatchType;
  action: RuleAction;
  enabled: boolean;
  conditions: DemoAutomationCondition[];
}

/**
 * Application questions and automation rules for the five jobs in the demo
 * account. Both collections use the same job order as JOBS_DATA in seed.ts.
 *
 * Conditions refer to labels here and are resolved to the generated question
 * IDs by the seed script. Keeping the expected question type on each condition
 * makes a renamed or retyped question fail the seed instead of leaving behind
 * a rule that can never match.
 */
export const DEMO_JOB_QUESTIONS: DemoJobQuestion[][] = [
  [
    {
      type: "number",
      label: "Years of TypeScript experience",
      required: true,
    },
    {
      type: "single_select",
      label: "Preferred frontend framework",
      options: ["Vue", "React", "Svelte", "Angular", "Solid"],
      required: true,
    },
    {
      type: "long_text",
      label: "Describe a challenging technical problem you solved recently",
      required: true,
    },
    {
      type: "url",
      label: "Link to your GitHub profile or portfolio",
      required: false,
    },
    {
      type: "single_select",
      label: "When can you start?",
      options: ["Immediately", "2 weeks", "1 month", "2-3 months"],
      required: true,
    },
  ],
  [
    { type: "url", label: "Link to your portfolio", required: true },
    {
      type: "number",
      label: "Years of product design experience",
      required: true,
    },
    {
      type: "single_select",
      label: "Primary design tool",
      options: ["Figma", "Sketch", "Adobe XD", "Framer"],
      required: true,
    },
    {
      type: "long_text",
      label: "Walk us through your design process for a recent project",
      required: true,
    },
    {
      type: "checkbox",
      label: "I have experience with design systems",
      required: false,
    },
  ],
  [
    {
      type: "multi_select",
      label: "Which cloud platforms have you worked with?",
      options: ["AWS", "GCP", "Azure", "Hetzner", "DigitalOcean", "Other"],
      required: true,
    },
    {
      type: "number",
      label: "Years of Docker experience",
      required: true,
    },
    {
      type: "single_select",
      label: "Preferred CI/CD platform",
      options: ["GitHub Actions", "GitLab CI", "Jenkins", "CircleCI", "Other"],
      required: true,
    },
  ],
  [
    {
      type: "url",
      label: "Link to a technical writing sample",
      required: true,
    },
    {
      type: "number",
      label: "Years of technical writing experience",
      required: true,
    },
    {
      type: "multi_select",
      label: "Which documentation have you owned?",
      options: [
        "API documentation",
        "User guides",
        "Deployment guides",
        "Release notes",
        "Tutorials",
      ],
      required: true,
    },
    {
      type: "checkbox",
      label: "I have worked in a docs-as-code workflow",
      required: false,
    },
  ],
  [
    {
      type: "single_select",
      label: "Are you currently enrolled in a degree program?",
      options: ["Yes", "No", "Graduating before the internship starts"],
      required: true,
    },
    {
      type: "single_select",
      label: "Can you work on-site in Berlin for this internship?",
      options: [
        "Yes — on-site in Berlin",
        "Yes — I can relocate",
        "No — remote only",
      ],
      required: true,
    },
    {
      type: "multi_select",
      label: "Which frontend technologies have you used in projects?",
      options: ["HTML/CSS", "JavaScript", "TypeScript", "Vue", "React"],
      required: true,
    },
    {
      type: "url",
      label: "Link to a GitHub profile or frontend project",
      required: false,
    },
  ],
];

export const DEMO_AUTOMATION_RULES: DemoAutomationRule[][] = [
  [
    {
      name: "Minimum TypeScript experience",
      matchType: "any",
      action: "rejected",
      enabled: true,
      conditions: [
        {
          questionLabel: "Years of TypeScript experience",
          questionType: "number",
          operator: "lt",
          value: 5,
        },
      ],
    },
    {
      name: "Fast-track Vue full-stack candidates",
      matchType: "all",
      action: "screening",
      enabled: true,
      conditions: [
        {
          questionLabel: "Preferred frontend framework",
          questionType: "single_select",
          operator: "is_one_of",
          value: ["Vue"],
        },
        {
          questionLabel: "Link to your GitHub profile or portfolio",
          questionType: "url",
          operator: "is_answered",
        },
        {
          questionLabel:
            "Describe a challenging technical problem you solved recently",
          questionType: "long_text",
          operator: "is_answered",
        },
      ],
    },
  ],
  [
    {
      name: "Minimum product design experience",
      matchType: "all",
      action: "rejected",
      enabled: true,
      conditions: [
        {
          questionLabel: "Years of product design experience",
          questionType: "number",
          operator: "lt",
          value: 3,
        },
      ],
    },
    {
      name: "Fast-track Figma design-system candidates",
      matchType: "all",
      action: "screening",
      enabled: true,
      conditions: [
        {
          questionLabel: "Primary design tool",
          questionType: "single_select",
          operator: "is_one_of",
          value: ["Figma"],
        },
        {
          questionLabel: "I have experience with design systems",
          questionType: "checkbox",
          operator: "is_true",
        },
      ],
    },
  ],
  [
    {
      name: "Minimum Docker experience",
      matchType: "any",
      action: "rejected",
      enabled: true,
      conditions: [
        {
          questionLabel: "Years of Docker experience",
          questionType: "number",
          operator: "lt",
          value: 3,
        },
      ],
    },
    {
      name: "Fast-track cloud delivery experience",
      matchType: "all",
      action: "screening",
      enabled: true,
      conditions: [
        {
          questionLabel: "Which cloud platforms have you worked with?",
          questionType: "multi_select",
          operator: "includes_any",
          value: ["AWS", "GCP", "Azure"],
        },
        {
          questionLabel: "Preferred CI/CD platform",
          questionType: "single_select",
          operator: "is_one_of",
          value: ["GitHub Actions", "GitLab CI"],
        },
      ],
    },
  ],
  [
    {
      name: "Minimum technical writing experience",
      matchType: "all",
      action: "rejected",
      enabled: true,
      conditions: [
        {
          questionLabel: "Years of technical writing experience",
          questionType: "number",
          operator: "lt",
          value: 2,
        },
      ],
    },
    {
      name: "Fast-track docs-as-code specialists",
      matchType: "all",
      action: "screening",
      enabled: true,
      conditions: [
        {
          questionLabel: "Years of technical writing experience",
          questionType: "number",
          operator: "gte",
          value: 3,
        },
        {
          questionLabel: "Which documentation have you owned?",
          questionType: "multi_select",
          operator: "includes_any",
          value: ["API documentation", "Deployment guides"],
        },
        {
          questionLabel: "I have worked in a docs-as-code workflow",
          questionType: "checkbox",
          operator: "is_true",
        },
      ],
    },
  ],
  [
    {
      name: "Internship eligibility",
      matchType: "any",
      action: "rejected",
      enabled: true,
      conditions: [
        {
          questionLabel: "Are you currently enrolled in a degree program?",
          questionType: "single_select",
          operator: "is_one_of",
          value: ["No", "Graduating before the internship starts"],
        },
        {
          questionLabel: "Can you work on-site in Berlin for this internship?",
          questionType: "single_select",
          operator: "is_one_of",
          value: ["No — remote only"],
        },
      ],
    },
    {
      name: "Fast-track Vue project experience",
      matchType: "all",
      action: "screening",
      enabled: true,
      conditions: [
        {
          questionLabel:
            "Which frontend technologies have you used in projects?",
          questionType: "multi_select",
          operator: "includes_all",
          value: ["JavaScript", "Vue"],
        },
        {
          questionLabel: "Link to a GitHub profile or frontend project",
          questionType: "url",
          operator: "is_answered",
        },
      ],
    },
  ],
];
