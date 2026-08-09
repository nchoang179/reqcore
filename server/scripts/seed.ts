/**
 * Seeds the database with realistic demo data for Reqcore.
 *
 * Creates:
 * - 1 demo user (demo@reqcore.com / demo1234)
 * - 1 organization ("Reqcore Demo")
 * - 5 jobs with varying statuses
 * - Only candidates attached to the top 3 scored applications in each job/status
 * - At most 3 applications per pipeline stage and job, ordered by score
 * - 35 candidate inbox messages across 28 conversations and every represented pipeline status
 * - Custom application questions and automation rules for every job
 * - Question responses on applications
 * - Tracking links and source attribution with UTM & referrer data
 * - Scheduled/completed interviews across the pipeline
 * - Activity log entries covering all action types (for Timeline page)
 *
 * Usage: npx tsx server/scripts/seed.ts
 * Requires DATABASE_URL in .env (loaded via dotenv or shell env).
 *
 * Idempotent — checks if demo org exists before running.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../database/schema";
import { resolveDatabaseUrl } from "../utils/database-url";
import { encrypt } from "../utils/encryption";
import {
  DEMO_AUTOMATION_RULES,
  DEMO_JOB_QUESTIONS,
} from "./seed-data/automation";
import { selectTopApplicationsPerStatus } from "./seed-data/top-applications";

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const processWithLoadEnv = process as NodeJS.Process & {
  loadEnvFile?: (path?: string) => void;
};

if (
  !process.env.DATABASE_URL &&
  typeof processWithLoadEnv.loadEnvFile === "function"
) {
  try {
    processWithLoadEnv.loadEnvFile(".env");
  } catch {
    // .env is optional in hosted environments like Railway
  }
}

const DATABASE_URL = resolveDatabaseUrl(process.env);
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required. Set it in .env or export it.");
  process.exit(1);
}

const DEMO_EMAIL = "demo@reqcore.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";
const DEMO_ORG_NAME = "Reqcore Demo";
const DEMO_ORG_SLUG = "reqcore-demo";
const DEMO_NOTIFICATION_TYPES = [
  "candidate_replied",
  "application_created",
  "interview_response",
] as const;

// Legacy values from the old applirank.com domain — cleaned up on seed
const LEGACY_DEMO_EMAIL = "demo@applirank.com";
const LEGACY_ORG_SLUG = "applirank-demo";

// ─────────────────────────────────────────────
// Database connection
// ─────────────────────────────────────────────

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function id(): string {
  return crypto.randomUUID();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Create a date offset from today with a specific time. Positive = future, negative = past. */
function dateWithOffset(
  daysOffset: number,
  hour: number,
  minute: number = 0,
): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function getArrayItemOrThrow<T>(
  arr: readonly T[],
  index: number,
  context: string,
): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(`Missing ${context} at index ${index}`);
  }
  return value;
}

function generateSlug(title: string, uuid: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const shortId = uuid.replace(/-/g, "").slice(0, 8);
  return `${base}-${shortId}`;
}

async function disableDemoEmailNotifications(
  userId: string,
  organizationId: string,
): Promise<void> {
  const now = new Date();

  for (const type of DEMO_NOTIFICATION_TYPES) {
    await db
      .insert(schema.notificationPreference)
      .values({
        id: id(),
        userId,
        organizationId,
        type,
        channelMode: "off",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.notificationPreference.userId,
          schema.notificationPreference.organizationId,
          schema.notificationPreference.type,
        ],
        set: { channelMode: "off", updatedAt: now },
      });
  }

  console.log("✅ Disabled email notifications for the demo account");
}

// ─────────────────────────────────────────────
// Seed Data Definitions
// ─────────────────────────────────────────────

const JOBS_DATA = [
  {
    title: "Senior Full-Stack Engineer",
    description: `We're hiring a Senior Full-Stack Engineer to help scale the core Reqcore platform used by growing hiring teams. You will own high-impact features across product, API, and data layers using TypeScript, Nuxt, and PostgreSQL in a pragmatic, fast-moving environment.\n\n**What you'll do**\n- Deliver end-to-end features from discovery and technical design to production rollout\n- Shape architecture decisions for multi-tenant workflows, performance, and reliability\n- Partner with product and design to turn recruiter pain points into elegant UX\n- Raise engineering quality through thoughtful code review, testing, and observability\n- Mentor team members and improve development standards across the stack\n\n**What we're looking for**\n- 5+ years building and shipping production web applications\n- Strong TypeScript proficiency across frontend and backend services\n- Experience with modern component architectures (Vue, React, or similar)\n- Practical PostgreSQL skills including query tuning and schema evolution\n- Familiarity with CI/CD, Dockerized environments, and cloud deployment workflows\n- Clear communication and ownership mindset in cross-functional teams\n\n**Nice to have**\n- Experience building internal tools, ATS/HR products, or workflow-heavy B2B software\n- Interest in transparent, explainable AI experiences`,
    location: "Berlin, Germany (Hybrid)",
    type: "full_time" as const,
    status: "open" as const,
  },
  {
    title: "Product Designer",
    description: `Join Reqcore as a Product Designer and craft the daily workflows used by recruiters to evaluate talent fairly and efficiently. You'll collaborate closely with engineering and product to design intuitive, high-trust experiences across dashboard, pipeline, and candidate flows.\n\n**What you'll do**\n- Lead design work from discovery through polished UI and production handoff\n- Translate complex hiring workflows into clear, low-friction user journeys\n- Run lightweight research and usability testing with real recruiting users\n- Evolve our design system and interaction patterns for speed and consistency\n- Partner with engineers to ensure high-quality implementation and accessibility\n\n**What we're looking for**\n- 3+ years in product design, ideally in B2B SaaS or workflow tools\n- Strong portfolio demonstrating end-to-end problem-solving and measurable outcomes\n- Advanced Figma skills including components, variants, and prototyping\n- Experience balancing visual polish with delivery constraints\n- Solid understanding of accessibility, hierarchy, and information architecture\n\n**Nice to have**\n- Experience designing data-rich interfaces or collaborative tooling\n- Familiarity with recruiting, HR, or marketplace products`,
    location: "Remote (EU)",
    type: "full_time" as const,
    status: "open" as const,
  },
  {
    title: "DevOps Engineer",
    description: `We are looking for a DevOps Engineer to harden and streamline our delivery platform across hosted and self-hosted environments. You will own deployment reliability, operational visibility, and developer productivity with a strong focus on secure, repeatable infrastructure.\n\n**What you'll do**\n- Build and improve CI/CD pipelines for faster, safer releases\n- Maintain containerized environments and infrastructure automation\n- Improve runtime observability with meaningful alerts, dashboards, and runbooks\n- Strengthen backup, restore, and disaster recovery practices for Postgres and storage\n- Document deployment standards to make enterprise self-hosting predictable\n\n**What we're looking for**\n- 3+ years of DevOps or platform engineering experience\n- Deep Docker and Linux operations knowledge\n- Hands-on CI/CD experience (GitHub Actions, GitLab CI, or similar)\n- Practical understanding of reverse proxies, TLS, and networking fundamentals\n- Experience with database operations and incident response\n\n**Nice to have**\n- IaC experience (Terraform, Pulumi, or equivalent)\n- Experience supporting compliance-sensitive B2B workloads`,
    location: "Remote (Worldwide)",
    type: "contract" as const,
    status: "open" as const,
  },
  {
    title: "Technical Writer (Part-Time)",
    description: `We're hiring a part-time Technical Writer to make Reqcore documentation clear, actionable, and enterprise-ready. Your work will directly improve product adoption by helping recruiters, admins, and developers succeed quickly.\n\n**What you'll do**\n- Create and maintain setup guides, API docs, and troubleshooting playbooks\n- Improve onboarding flows for first-time teams and self-hosted deployments\n- Standardize tone, structure, and quality across product documentation\n- Work with engineering and product to document new releases and migrations\n- Identify knowledge gaps from support and feedback loops\n\n**What we're looking for**\n- 2+ years writing technical documentation for software products\n- Ability to explain complex systems in simple, practical language\n- Strong Markdown/docs-as-code workflow habits\n- Attention to clarity, consistency, and user intent\n- Experience editing developer-facing and operations-focused content\n\n**Nice to have**\n- Open-source documentation contributions\n- Familiarity with hiring/recruiting software terminology`,
    location: "Remote (EU)",
    type: "part_time" as const,
    status: "open" as const,
  },
  {
    title: "Frontend Engineering Intern",
    description: `Start your frontend career on a real product with real users. In this 6-month internship, you'll contribute production code to Reqcore while learning modern frontend engineering practices from an experienced team.\n\n**What you'll work on**\n- Build and ship Vue/Nuxt interface components used in daily recruiting workflows\n- Improve usability, accessibility, and performance of existing screens\n- Collaborate in code reviews and iterative delivery cycles\n- Learn how product, design, and engineering collaborate in a modern SaaS team\n\n**What we're looking for**\n- Currently enrolled in computer science, software engineering, or equivalent program\n- Strong foundations in HTML, CSS, and JavaScript\n- Basic familiarity with TypeScript and component-based frameworks is a plus\n- Curiosity, coachability, and attention to detail\n- Ability to communicate clearly and ask good questions\n\n**Internship details**\n- Structured mentorship, weekly feedback, and clear growth goals\n- Opportunity to present shipped work at the end of the internship`,
    location: "Berlin, Germany (On-site)",
    type: "internship" as const,
    status: "draft" as const,
  },
];

const CANDIDATES_DATA = [
  {
    firstName: "Emma",
    lastName: "Schmidt",
    email: "emma.schmidt@example.com",
    phone: "+49 170 1234567",
  },
  {
    firstName: "Liam",
    lastName: "Müller",
    email: "liam.mueller@example.com",
    phone: "+49 171 2345678",
  },
  {
    firstName: "Sofia",
    lastName: "Dubois",
    email: "sofia.dubois@example.com",
    phone: "+33 6 12 34 56 78",
  },
  {
    firstName: "Noah",
    lastName: "van der Berg",
    email: "noah.vdberg@example.com",
    phone: "+31 6 12345678",
  },
  {
    firstName: "Olivia",
    lastName: "Rossi",
    email: "olivia.rossi@example.com",
    phone: "+39 320 1234567",
  },
  {
    firstName: "James",
    lastName: "O'Brien",
    email: "james.obrien@example.com",
    phone: "+44 7700 123456",
  },
  {
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara.okafor@example.com",
    phone: "+234 801 234 5678",
  },
  {
    firstName: "Yuki",
    lastName: "Tanaka",
    email: "yuki.tanaka@example.com",
    phone: "+81 90 1234 5678",
  },
  {
    firstName: "Lucas",
    lastName: "Andersson",
    email: "lucas.andersson@example.com",
    phone: "+46 70 123 45 67",
  },
  {
    firstName: "Priya",
    lastName: "Sharma",
    email: "priya.sharma@example.com",
    phone: "+91 98765 43210",
  },
  {
    firstName: "Mateo",
    lastName: "García",
    email: "mateo.garcia@example.com",
    phone: "+34 612 345 678",
  },
  {
    firstName: "Aisha",
    lastName: "Hassan",
    email: "aisha.hassan@example.com",
    phone: "+971 50 123 4567",
  },
  {
    firstName: "Felix",
    lastName: "Weber",
    email: "felix.weber@example.com",
    phone: "+49 172 3456789",
  },
  {
    firstName: "Chloe",
    lastName: "Martin",
    email: "chloe.martin@example.com",
    phone: "+33 7 12 34 56 78",
  },
  {
    firstName: "David",
    lastName: "Kim",
    email: "david.kim@example.com",
    phone: "+82 10 1234 5678",
  },
  {
    firstName: "Elena",
    lastName: "Petrova",
    email: "elena.petrova@example.com",
    phone: "+7 916 123 4567",
  },
  {
    firstName: "Alexander",
    lastName: "Johansson",
    email: "alex.johansson@example.com",
    phone: "+46 73 234 56 78",
  },
  {
    firstName: "Maria",
    lastName: "Costa",
    email: "maria.costa@example.com",
    phone: "+351 912 345 678",
  },
  {
    firstName: "Ryan",
    lastName: "Chen",
    email: "ryan.chen@example.com",
    phone: "+1 415 234 5678",
  },
  {
    firstName: "Laura",
    lastName: "Nguyen",
    email: "laura.nguyen@example.com",
    phone: "+84 90 123 4567",
  },
  {
    firstName: "Henrik",
    lastName: "Larsen",
    email: "henrik.larsen@example.com",
    phone: "+45 20 12 34 56",
  },
  {
    firstName: "Fatima",
    lastName: "Al-Rashid",
    email: "fatima.alrashid@example.com",
    phone: "+962 79 123 4567",
  },
  {
    firstName: "Tom",
    lastName: "Kowalski",
    email: "tom.kowalski@example.com",
    phone: "+48 501 234 567",
  },
  {
    firstName: "Sarah",
    lastName: "Williams",
    email: "sarah.williams@example.com",
    phone: "+1 212 345 6789",
  },
  {
    firstName: "Raj",
    lastName: "Patel",
    email: "raj.patel@example.com",
    phone: "+91 99887 76655",
  },
  {
    firstName: "Anna",
    lastName: "Becker",
    email: "anna.becker@example.com",
    phone: "+49 175 4567890",
  },
  {
    firstName: "Marcus",
    lastName: "Eriksson",
    email: "marcus.eriksson@example.com",
    phone: "+46 76 345 67 89",
  },
  {
    firstName: "Ines",
    lastName: "da Silva",
    email: "ines.dasilva@example.com",
    phone: "+55 11 98765 4321",
  },
  {
    firstName: "Kevin",
    lastName: "Dupont",
    email: "kevin.dupont@example.com",
    phone: "+33 6 98 76 54 32",
  },
  {
    firstName: "Zara",
    lastName: "Khan",
    email: "zara.khan@example.com",
    phone: "+92 300 1234567",
  },

  // ── Batch A: European candidates (indices 30–49) ──
  {
    firstName: "Casper",
    lastName: "Lindqvist",
    email: "casper.lindqvist@example.com",
    phone: "+46 72 456 78 90",
  },
  {
    firstName: "Theodora",
    lastName: "Papadopoulos",
    email: "theodora.papadopoulos@example.com",
    phone: "+30 697 123 4567",
  },
  {
    firstName: "Mikkel",
    lastName: "Hansen",
    email: "mikkel.hansen@example.com",
    phone: "+45 22 34 56 78",
  },
  {
    firstName: "Oksana",
    lastName: "Shevchenko",
    email: "oksana.shevchenko@example.com",
    phone: "+380 67 123 4567",
  },
  {
    firstName: "Adrián",
    lastName: "Kovács",
    email: "adrian.kovacs@example.com",
    phone: "+36 30 123 4567",
  },
  {
    firstName: "Lena",
    lastName: "Zimmermann",
    email: "lena.zimmermann2@example.com",
    phone: "+49 176 1234567",
  },
  {
    firstName: "Piotr",
    lastName: "Wiśniewski",
    email: "piotr.wisniewski@example.com",
    phone: "+48 502 345 678",
  },
  {
    firstName: "Nikoletta",
    lastName: "Balogh",
    email: "nikoletta.balogh@example.com",
    phone: "+36 20 234 5678",
  },
  {
    firstName: "Conor",
    lastName: "Murphy",
    email: "conor.murphy@example.com",
    phone: "+353 87 123 4567",
  },
  {
    firstName: "Soraya",
    lastName: "Laurent",
    email: "soraya.laurent@example.com",
    phone: "+33 6 23 45 67 89",
  },
  {
    firstName: "Andrei",
    lastName: "Popescu",
    email: "andrei.popescu@example.com",
    phone: "+40 721 234 567",
  },
  {
    firstName: "Lotte",
    lastName: "de Vries",
    email: "lotte.devries@example.com",
    phone: "+31 6 23456789",
  },
  {
    firstName: "Eero",
    lastName: "Mäkinen",
    email: "eero.makinen@example.com",
    phone: "+358 40 1234567",
  },
  {
    firstName: "Brigita",
    lastName: "Jonauskaitė",
    email: "brigita.jonauskaite@example.com",
    phone: "+370 612 34567",
  },
  {
    firstName: "Vladislav",
    lastName: "Novak",
    email: "vladislav.novak@example.com",
    phone: "+420 601 234 567",
  },
  {
    firstName: "Penelope",
    lastName: "Blackwood",
    email: "penelope.blackwood@example.com",
    phone: "+44 7800 234567",
  },
  {
    firstName: "Rafał",
    lastName: "Jabłoński",
    email: "rafal.jablonski@example.com",
    phone: "+48 503 456 789",
  },
  {
    firstName: "Inga",
    lastName: "Sigurðardóttir",
    email: "inga.sigurdardottir@example.com",
    phone: "+354 8911234",
  },
  {
    firstName: "Bogdan",
    lastName: "Rusu",
    email: "bogdan.rusu@example.com",
    phone: "+40 722 345 678",
  },
  {
    firstName: "Katja",
    lastName: "Hämäläinen",
    email: "katja.hamalainen@example.com",
    phone: "+358 45 2345678",
  },

  // ── Batch B: North American + Latam (indices 50–69) ──
  {
    firstName: "Tyler",
    lastName: "Brooks",
    email: "tyler.brooks@example.com",
    phone: "+1 312 456 7890",
  },
  {
    firstName: "Mia",
    lastName: "Thompson",
    email: "mia.thompson@example.com",
    phone: "+1 604 234 5678",
  },
  {
    firstName: "Diego",
    lastName: "Ramirez",
    email: "diego.ramirez@example.com",
    phone: "+52 55 1234 5678",
  },
  {
    firstName: "Jordan",
    lastName: "Williams",
    email: "jordan.williams@example.com",
    phone: "+1 503 345 6789",
  },
  {
    firstName: "Valentina",
    lastName: "Morales",
    email: "valentina.morales@example.com",
    phone: "+57 300 123 4567",
  },
  {
    firstName: "Ethan",
    lastName: "Campbell",
    email: "ethan.campbell@example.com",
    phone: "+1 416 456 7890",
  },
  {
    firstName: "Camila",
    lastName: "Ferreira",
    email: "camila.ferreira@example.com",
    phone: "+55 11 98765 1234",
  },
  {
    firstName: "Nathan",
    lastName: "Richardson",
    email: "nathan.richardson@example.com",
    phone: "+1 206 567 8901",
  },
  {
    firstName: "Isabella",
    lastName: "Torres",
    email: "isabella.torres@example.com",
    phone: "+54 11 1234 5678",
  },
  {
    firstName: "Owen",
    lastName: "MacDonald",
    email: "owen.macdonald@example.com",
    phone: "+1 902 234 5678",
  },
  {
    firstName: "Gabriela",
    lastName: "Vásquez",
    email: "gabriela.vasquez@example.com",
    phone: "+51 987 654 321",
  },
  {
    firstName: "Blake",
    lastName: "Anderson",
    email: "blake.anderson@example.com",
    phone: "+1 720 345 6789",
  },
  {
    firstName: "Luciana",
    lastName: "Gomes",
    email: "luciana.gomes@example.com",
    phone: "+55 21 98765 4321",
  },
  {
    firstName: "Carson",
    lastName: "Wright",
    email: "carson.wright@example.com",
    phone: "+1 214 456 7890",
  },
  {
    firstName: "Sebastián",
    lastName: "Herrera",
    email: "sebastian.herrera@example.com",
    phone: "+56 9 1234 5678",
  },
  {
    firstName: "Haley",
    lastName: "Turner",
    email: "haley.turner@example.com",
    phone: "+1 404 567 8901",
  },
  {
    firstName: "Renata",
    lastName: "Pereira",
    email: "renata.pereira@example.com",
    phone: "+55 31 98765 4321",
  },
  {
    firstName: "Brett",
    lastName: "Evans",
    email: "brett.evans@example.com",
    phone: "+1 303 234 5678",
  },
  {
    firstName: "Mariana",
    lastName: "Castillo",
    email: "mariana.castillo@example.com",
    phone: "+52 33 1234 5678",
  },
  {
    firstName: "Logan",
    lastName: "Clarke",
    email: "logan.clarke@example.com",
    phone: "+1 613 345 6789",
  },

  // ── Batch C: South Asia + East Asia (indices 70–89) ──
  {
    firstName: "Arjun",
    lastName: "Kapoor",
    email: "arjun.kapoor@example.com",
    phone: "+91 98765 12345",
  },
  {
    firstName: "Min-jun",
    lastName: "Lee",
    email: "minjun.lee@example.com",
    phone: "+82 10 2345 6789",
  },
  {
    firstName: "Preethi",
    lastName: "Krishnamurthy",
    email: "preethi.krishnamurthy@example.com",
    phone: "+91 91234 56789",
  },
  {
    firstName: "Takeshi",
    lastName: "Yamamoto",
    email: "takeshi.yamamoto@example.com",
    phone: "+81 90 2345 6789",
  },
  {
    firstName: "Aditi",
    lastName: "Mehta",
    email: "aditi.mehta@example.com",
    phone: "+91 87654 32109",
  },
  {
    firstName: "Joon-ho",
    lastName: "Park",
    email: "joonho.park@example.com",
    phone: "+82 10 3456 7890",
  },
  {
    firstName: "Kavitha",
    lastName: "Rajan",
    email: "kavitha.rajan@example.com",
    phone: "+91 76543 21098",
  },
  {
    firstName: "Ryo",
    lastName: "Nakamura",
    email: "ryo.nakamura@example.com",
    phone: "+81 80 3456 7890",
  },
  {
    firstName: "Deepak",
    lastName: "Srivastava",
    email: "deepak.srivastava@example.com",
    phone: "+91 65432 10987",
  },
  {
    firstName: "Hyejin",
    lastName: "Kim",
    email: "hyejin.kim@example.com",
    phone: "+82 10 4567 8901",
  },
  {
    firstName: "Rahul",
    lastName: "Bose",
    email: "rahul.bose@example.com",
    phone: "+91 54321 09876",
  },
  {
    firstName: "Tomoya",
    lastName: "Suzuki",
    email: "tomoya.suzuki@example.com",
    phone: "+81 70 4567 8901",
  },
  {
    firstName: "Ananya",
    lastName: "Gupta",
    email: "ananya.gupta@example.com",
    phone: "+91 43210 98765",
  },
  {
    firstName: "Seung-min",
    lastName: "Choi",
    email: "seungmin.choi@example.com",
    phone: "+82 10 5678 9012",
  },
  {
    firstName: "Rohan",
    lastName: "Desai",
    email: "rohan.desai@example.com",
    phone: "+91 32109 87654",
  },
  {
    firstName: "Yuna",
    lastName: "Ito",
    email: "yuna.ito@example.com",
    phone: "+81 90 5678 9012",
  },
  {
    firstName: "Shreya",
    lastName: "Iyer",
    email: "shreya.iyer@example.com",
    phone: "+91 21098 76543",
  },
  {
    firstName: "Daiki",
    lastName: "Fujita",
    email: "daiki.fujita@example.com",
    phone: "+81 80 6789 0123",
  },
  {
    firstName: "Vikram",
    lastName: "Nair",
    email: "vikram.nair@example.com",
    phone: "+91 10987 65432",
  },
  {
    firstName: "Ji-yeon",
    lastName: "Jung",
    email: "jiyeon.jung@example.com",
    phone: "+82 10 6789 0123",
  },

  // ── Batch D: Middle East + Africa (indices 90–109) ──
  {
    firstName: "Omar",
    lastName: "Al-Farsi",
    email: "omar.alfarsi@example.com",
    phone: "+971 55 234 5678",
  },
  {
    firstName: "Ngozi",
    lastName: "Adeyemi",
    email: "ngozi.adeyemi@example.com",
    phone: "+234 802 345 6789",
  },
  {
    firstName: "Tariq",
    lastName: "Benali",
    email: "tariq.benali@example.com",
    phone: "+212 661 234 567",
  },
  {
    firstName: "Chioma",
    lastName: "Eze",
    email: "chioma.eze@example.com",
    phone: "+234 803 456 7890",
  },
  {
    firstName: "Khalid",
    lastName: "Al-Rashidi",
    email: "khalid.alrashidi@example.com",
    phone: "+966 50 123 4567",
  },
  {
    firstName: "Thandiwe",
    lastName: "Dlamini",
    email: "thandiwe.dlamini@example.com",
    phone: "+27 71 234 5678",
  },
  {
    firstName: "Hassan",
    lastName: "Moussa",
    email: "hassan.moussa@example.com",
    phone: "+20 100 234 5678",
  },
  {
    firstName: "Adaeze",
    lastName: "Nwosu",
    email: "adaeze.nwosu@example.com",
    phone: "+234 804 567 8901",
  },
  {
    firstName: "Youssef",
    lastName: "El-Masri",
    email: "youssef.elmasri@example.com",
    phone: "+961 71 234 567",
  },
  {
    firstName: "Thandeka",
    lastName: "Mokoena",
    email: "thandeka.mokoena@example.com",
    phone: "+27 82 345 6789",
  },
  {
    firstName: "Mostafa",
    lastName: "Ibrahim",
    email: "mostafa.ibrahim@example.com",
    phone: "+20 111 345 6789",
  },
  {
    firstName: "Chukwuemeka",
    lastName: "Obi",
    email: "chukwuemeka.obi@example.com",
    phone: "+234 805 678 9012",
  },
  {
    firstName: "Nadia",
    lastName: "Azzam",
    email: "nadia.azzam@example.com",
    phone: "+962 79 234 5678",
  },
  {
    firstName: "Sipho",
    lastName: "Ndlovu",
    email: "sipho.ndlovu@example.com",
    phone: "+27 83 456 7890",
  },
  {
    firstName: "Amir",
    lastName: "Farhat",
    email: "amir.farhat@example.com",
    phone: "+216 21 234 567",
  },
  {
    firstName: "Blessing",
    lastName: "Okonkwo",
    email: "blessing.okonkwo@example.com",
    phone: "+234 806 789 0123",
  },
  {
    firstName: "Reem",
    lastName: "Al-Zahrawi",
    email: "reem.alzahrawi@example.com",
    phone: "+971 56 345 6789",
  },
  {
    firstName: "Kofi",
    lastName: "Mensah",
    email: "kofi.mensah@example.com",
    phone: "+233 24 123 4567",
  },
  {
    firstName: "Layla",
    lastName: "Khalil",
    email: "layla.khalil@example.com",
    phone: "+961 70 345 678",
  },
  {
    firstName: "Tendai",
    lastName: "Chikomba",
    email: "tendai.chikomba@example.com",
    phone: "+263 77 234 5678",
  },

  // ── Batch E: Mixed global (indices 110–129) ──
  {
    firstName: "Mihail",
    lastName: "Georgescu",
    email: "mihail.georgescu@example.com",
    phone: "+40 723 456 789",
  },
  {
    firstName: "Sven",
    lastName: "Bergström",
    email: "sven.bergstrom@example.com",
    phone: "+46 73 567 89 01",
  },
  {
    firstName: "Elif",
    lastName: "Kaya",
    email: "elif.kaya@example.com",
    phone: "+90 532 234 5678",
  },
  {
    firstName: "Rafael",
    lastName: "Almeida",
    email: "rafael.almeida@example.com",
    phone: "+351 913 456 789",
  },
  {
    firstName: "Jana",
    lastName: "Procházková",
    email: "jana.prochazkova@example.com",
    phone: "+420 602 345 678",
  },
  {
    firstName: "Hamid",
    lastName: "Rahimi",
    email: "hamid.rahimi@example.com",
    phone: "+31 6 34567890",
  },
  {
    firstName: "Marek",
    lastName: "Novotný",
    email: "marek.novotny@example.com",
    phone: "+421 901 234 567",
  },
  {
    firstName: "Thiago",
    lastName: "Oliveira",
    email: "thiago.oliveira@example.com",
    phone: "+55 41 98765 4321",
  },
  {
    firstName: "Nour",
    lastName: "Makhlouf",
    email: "nour.makhlouf@example.com",
    phone: "+213 555 123 456",
  },
  {
    firstName: "Wojciech",
    lastName: "Kowalczyk",
    email: "wojciech.kowalczyk@example.com",
    phone: "+48 504 567 890",
  },
  {
    firstName: "Yara",
    lastName: "Harb",
    email: "yara.harb@example.com",
    phone: "+961 72 456 789",
  },
  {
    firstName: "Serdar",
    lastName: "Arslan",
    email: "serdar.arslan@example.com",
    phone: "+90 533 345 6789",
  },
  {
    firstName: "Chidinma",
    lastName: "Okolie",
    email: "chidinma.okolie@example.com",
    phone: "+234 807 890 1234",
  },
  {
    firstName: "Lars",
    lastName: "Magnusson",
    email: "lars.magnusson@example.com",
    phone: "+47 91 23 45 67",
  },
  {
    firstName: "Fatou",
    lastName: "Diallo",
    email: "fatou.diallo@example.com",
    phone: "+221 77 123 4567",
  },
  {
    firstName: "Attila",
    lastName: "Tóth",
    email: "attila.toth@example.com",
    phone: "+36 31 234 5678",
  },
  {
    firstName: "Sonia",
    lastName: "Delgado",
    email: "sonia.delgado@example.com",
    phone: "+34 623 456 789",
  },
  {
    firstName: "Émile",
    lastName: "Leroy",
    email: "emile.leroy@example.com",
    phone: "+33 6 34 56 78 90",
  },
  {
    firstName: "Yaw",
    lastName: "Asante",
    email: "yaw.asante@example.com",
    phone: "+233 25 234 5678",
  },
  {
    firstName: "Ivana",
    lastName: "Šimić",
    email: "ivana.simic@example.com",
    phone: "+385 91 234 5678",
  },

  // ── Batch F: More global diversity (indices 130–149) ──
  {
    firstName: "Patrick",
    lastName: "Sullivan",
    email: "patrick.sullivan@example.com",
    phone: "+353 86 234 5678",
  },
  {
    firstName: "Ekaterina",
    lastName: "Sorokina",
    email: "ekaterina.sorokina@example.com",
    phone: "+372 5234 5678",
  },
  {
    firstName: "Moussa",
    lastName: "Coulibaly",
    email: "moussa.coulibaly@example.com",
    phone: "+225 07 12 34 56",
  },
  {
    firstName: "Helena",
    lastName: "Björk",
    email: "helena.bjork@example.com",
    phone: "+46 74 678 90 12",
  },
  {
    firstName: "Darius",
    lastName: "Stanescu",
    email: "darius.stanescu@example.com",
    phone: "+40 724 567 890",
  },
  {
    firstName: "Xochitl",
    lastName: "Reyes",
    email: "xochitl.reyes@example.com",
    phone: "+52 44 1234 5678",
  },
  {
    firstName: "Brendan",
    lastName: "O'Shea",
    email: "brendan.oshea@example.com",
    phone: "+353 85 345 6789",
  },
  {
    firstName: "Nadia",
    lastName: "Elbadawi",
    email: "nadia.elbadawi@example.com",
    phone: "+249 9 1234 5678",
  },
  {
    firstName: "Kristoffer",
    lastName: "Nilsen",
    email: "kristoffer.nilsen@example.com",
    phone: "+47 92 34 56 78",
  },
  {
    firstName: "Amira",
    lastName: "Tabet",
    email: "amira.tabet@example.com",
    phone: "+961 71 567 890",
  },
  {
    firstName: "Bojan",
    lastName: "Petrović",
    email: "bojan.petrovic@example.com",
    phone: "+381 60 123 4567",
  },
  {
    firstName: "Leena",
    lastName: "Suominen",
    email: "leena.suominen@example.com",
    phone: "+358 44 3456789",
  },
  {
    firstName: "Oumar",
    lastName: "Bah",
    email: "oumar.bah@example.com",
    phone: "+224 622 12 34 56",
  },
  {
    firstName: "Marta",
    lastName: "Wiśniewska",
    email: "marta.wisniewska@example.com",
    phone: "+48 505 678 901",
  },
  {
    firstName: "Goran",
    lastName: "Marković",
    email: "goran.markovic@example.com",
    phone: "+381 61 234 5678",
  },
  {
    firstName: "Tina",
    lastName: "Svensson",
    email: "tina.svensson@example.com",
    phone: "+46 75 789 01 23",
  },
  {
    firstName: "Dimitri",
    lastName: "Petrakis",
    email: "dimitri.petrakis@example.com",
    phone: "+30 698 234 5678",
  },
  {
    firstName: "Fatima-Zahra",
    lastName: "Benali",
    email: "fatimaz.benali@example.com",
    phone: "+212 662 345 678",
  },
  {
    firstName: "Ioannis",
    lastName: "Alexopoulos",
    email: "ioannis.alexopoulos@example.com",
    phone: "+30 699 345 6789",
  },
  {
    firstName: "Siobhan",
    lastName: "O'Brien",
    email: "siobhan.obrien@example.com",
    phone: "+353 83 456 7890",
  },

  // ── Batch G: EU Product Design pool (indices 150–179) ──
  {
    firstName: "Charlotte",
    lastName: "Rousseau",
    email: "charlotte.rousseau@example.com",
    phone: "+33 6 45 67 89 01",
  },
  {
    firstName: "Maximilian",
    lastName: "Brandt",
    email: "maximilian.brandt@example.com",
    phone: "+49 177 1234567",
  },
  {
    firstName: "Isabelle",
    lastName: "Fontaine",
    email: "isabelle.fontaine@example.com",
    phone: "+33 6 56 78 90 12",
  },
  {
    firstName: "Tobias",
    lastName: "Fischer",
    email: "tobias.fischer@example.com",
    phone: "+49 178 2345678",
  },
  {
    firstName: "Amélie",
    lastName: "Leclerc",
    email: "amelie.leclerc@example.com",
    phone: "+33 6 67 89 01 23",
  },
  {
    firstName: "Niklas",
    lastName: "Holm",
    email: "niklas.holm@example.com",
    phone: "+45 26 23 45 67",
  },
  {
    firstName: "Maja",
    lastName: "Lindström",
    email: "maja.lindstrom@example.com",
    phone: "+46 76 890 12 34",
  },
  {
    firstName: "Sébastien",
    lastName: "Moreau",
    email: "sebastien.moreau@example.com",
    phone: "+33 6 78 90 12 34",
  },
  {
    firstName: "Frida",
    lastName: "Olsen",
    email: "frida.olsen@example.com",
    phone: "+47 93 45 67 89",
  },
  {
    firstName: "Luca",
    lastName: "Ferrari",
    email: "luca.ferrari@example.com",
    phone: "+39 333 1234567",
  },
  {
    firstName: "Giulia",
    lastName: "Ricci",
    email: "giulia.ricci@example.com",
    phone: "+39 347 2345678",
  },
  {
    firstName: "Marco",
    lastName: "Esposito",
    email: "marco.esposito@example.com",
    phone: "+39 348 3456789",
  },
  {
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna.kowalska2@example.com",
    phone: "+48 506 789 012",
  },
  {
    firstName: "Jakub",
    lastName: "Wróbel",
    email: "jakub.wrobel@example.com",
    phone: "+48 507 890 123",
  },
  {
    firstName: "Vera",
    lastName: "Hoffmann",
    email: "vera.hoffmann@example.com",
    phone: "+49 179 3456789",
  },
  {
    firstName: "Jonas",
    lastName: "Bergmann",
    email: "jonas.bergmann@example.com",
    phone: "+49 180 4567890",
  },
  {
    firstName: "Nathalie",
    lastName: "Bernard",
    email: "nathalie.bernard@example.com",
    phone: "+33 6 89 01 23 45",
  },
  {
    firstName: "Rasmus",
    lastName: "Christensen",
    email: "rasmus.christensen@example.com",
    phone: "+45 28 34 56 78",
  },
  {
    firstName: "Sigrid",
    lastName: "Andersen",
    email: "sigrid.andersen@example.com",
    phone: "+47 94 56 78 90",
  },
  {
    firstName: "Eduardo",
    lastName: "Sánchez",
    email: "eduardo.sanchez@example.com",
    phone: "+34 634 567 890",
  },
  {
    firstName: "Carmen",
    lastName: "López",
    email: "carmen.lopez@example.com",
    phone: "+34 645 678 901",
  },
  {
    firstName: "Hugo",
    lastName: "Perez",
    email: "hugo.perez@example.com",
    phone: "+34 656 789 012",
  },
  {
    firstName: "Anya",
    lastName: "Kovač",
    email: "anya.kovac@example.com",
    phone: "+385 92 345 6789",
  },
  {
    firstName: "Miriam",
    lastName: "Schwarz",
    email: "miriam.schwarz@example.com",
    phone: "+49 181 5678901",
  },
  {
    firstName: "Emilia",
    lastName: "Conte",
    email: "emilia.conte@example.com",
    phone: "+39 349 4567890",
  },
  {
    firstName: "Lukas",
    lastName: "Baumann",
    email: "lukas.baumann@example.com",
    phone: "+41 78 234 5678",
  },
  {
    firstName: "Sophie",
    lastName: "Müller",
    email: "sophie.mueller@example.com",
    phone: "+41 79 345 6789",
  },
  {
    firstName: "Étienne",
    lastName: "Girard",
    email: "etienne.girard@example.com",
    phone: "+32 487 12 34 56",
  },
  {
    firstName: "Fiona",
    lastName: "MacLeod",
    email: "fiona.macleod@example.com",
    phone: "+44 7711 234567",
  },
  {
    firstName: "Niamh",
    lastName: "Gallagher",
    email: "niamh.gallagher@example.com",
    phone: "+353 86 345 6789",
  },

  // ── Batch H: North America (indices 180–209) ──
  {
    firstName: "Maya",
    lastName: "Johnson",
    email: "maya.johnson@example.com",
    phone: "+1 323 456 7890",
  },
  {
    firstName: "Zoe",
    lastName: "Williams",
    email: "zoe.williams@example.com",
    phone: "+1 718 567 8901",
  },
  {
    firstName: "Chloe",
    lastName: "Davis",
    email: "chloe.davis@example.com",
    phone: "+1 206 678 9012",
  },
  {
    firstName: "Lily",
    lastName: "Martinez",
    email: "lily.martinez@example.com",
    phone: "+1 512 789 0123",
  },
  {
    firstName: "Ava",
    lastName: "Wilson",
    email: "ava.wilson@example.com",
    phone: "+1 617 890 1234",
  },
  {
    firstName: "Emma",
    lastName: "Taylor",
    email: "emma.taylor@example.com",
    phone: "+1 415 901 2345",
  },
  {
    firstName: "Grace",
    lastName: "Anderson",
    email: "grace.anderson@example.com",
    phone: "+1 312 012 3456",
  },
  {
    firstName: "Hannah",
    lastName: "Thomas",
    email: "hannah.thomas@example.com",
    phone: "+1 303 123 4567",
  },
  {
    firstName: "Sofia",
    lastName: "Jackson",
    email: "sofia.jackson@example.com",
    phone: "+1 404 234 5678",
  },
  {
    firstName: "Nora",
    lastName: "White",
    email: "nora.white@example.com",
    phone: "+1 503 345 6789",
  },
  {
    firstName: "Ella",
    lastName: "Harris",
    email: "ella.harris@example.com",
    phone: "+1 213 456 7890",
  },
  {
    firstName: "Abigail",
    lastName: "Clark",
    email: "abigail.clark@example.com",
    phone: "+1 832 567 8901",
  },
  {
    firstName: "Mia",
    lastName: "Lewis",
    email: "mia.lewis@example.com",
    phone: "+1 646 678 9012",
  },
  {
    firstName: "Charlotte",
    lastName: "Lee",
    email: "charlotte.lee@example.com",
    phone: "+1 949 789 0123",
  },
  {
    firstName: "Amelia",
    lastName: "Walker",
    email: "amelia.walker@example.com",
    phone: "+1 281 890 1234",
  },
  {
    firstName: "Jasmine",
    lastName: "Hall",
    email: "jasmine.hall@example.com",
    phone: "+1 702 901 2345",
  },
  {
    firstName: "Leah",
    lastName: "Young",
    email: "leah.young@example.com",
    phone: "+1 785 012 3456",
  },
  {
    firstName: "Natalie",
    lastName: "King",
    email: "natalie.king@example.com",
    phone: "+1 919 123 4567",
  },
  {
    firstName: "Samantha",
    lastName: "Wright",
    email: "samantha.wright@example.com",
    phone: "+1 480 234 5678",
  },
  {
    firstName: "Victoria",
    lastName: "Scott",
    email: "victoria.scott@example.com",
    phone: "+1 614 345 6789",
  },
  {
    firstName: "Aiden",
    lastName: "Green",
    email: "aiden.green@example.com",
    phone: "+1 704 456 7890",
  },
  {
    firstName: "Noah",
    lastName: "Baker",
    email: "noah.baker@example.com",
    phone: "+1 253 567 8901",
  },
  {
    firstName: "Liam",
    lastName: "Nelson",
    email: "liam.nelson@example.com",
    phone: "+1 520 678 9012",
  },
  {
    firstName: "Ethan",
    lastName: "Carter",
    email: "ethan.carter@example.com",
    phone: "+1 571 789 0123",
  },
  {
    firstName: "Oliver",
    lastName: "Mitchell",
    email: "oliver.mitchell@example.com",
    phone: "+1 469 890 1234",
  },
  {
    firstName: "James",
    lastName: "Perez",
    email: "james.perez@example.com",
    phone: "+1 443 901 2345",
  },
  {
    firstName: "William",
    lastName: "Roberts",
    email: "william.roberts@example.com",
    phone: "+1 615 012 3456",
  },
  {
    firstName: "Benjamin",
    lastName: "Turner",
    email: "benjamin.turner@example.com",
    phone: "+1 757 123 4567",
  },
  {
    firstName: "Lucas",
    lastName: "Phillips",
    email: "lucas.phillips@example.com",
    phone: "+1 402 234 5678",
  },
  {
    firstName: "Henry",
    lastName: "Campbell",
    email: "henry.campbell@example.com",
    phone: "+1 716 345 6789",
  },

  // ── Batch I: Asia-Pacific (indices 210–239) ──
  {
    firstName: "Sakura",
    lastName: "Watanabe",
    email: "sakura.watanabe@example.com",
    phone: "+81 90 7890 1234",
  },
  {
    firstName: "Hina",
    lastName: "Kobayashi",
    email: "hina.kobayashi@example.com",
    phone: "+81 80 8901 2345",
  },
  {
    firstName: "Kenji",
    lastName: "Matsumoto",
    email: "kenji.matsumoto@example.com",
    phone: "+81 70 9012 3456",
  },
  {
    firstName: "Yuri",
    lastName: "Hayashi",
    email: "yuri.hayashi@example.com",
    phone: "+81 90 0123 4567",
  },
  {
    firstName: "Rin",
    lastName: "Sato",
    email: "rin.sato@example.com",
    phone: "+81 80 1234 5678",
  },
  {
    firstName: "Ji-hee",
    lastName: "Kim",
    email: "jihee.kim@example.com",
    phone: "+82 10 7890 1234",
  },
  {
    firstName: "Soo-yeon",
    lastName: "Park",
    email: "sooyeon.park@example.com",
    phone: "+82 10 8901 2345",
  },
  {
    firstName: "Tae-yang",
    lastName: "Lee",
    email: "taeyang.lee@example.com",
    phone: "+82 10 9012 3456",
  },
  {
    firstName: "Eun-ji",
    lastName: "Choi",
    email: "eunji.choi@example.com",
    phone: "+82 10 0123 4567",
  },
  {
    firstName: "Min-seo",
    lastName: "Jung",
    email: "minseo.jung@example.com",
    phone: "+82 10 1234 5678",
  },
  {
    firstName: "Xinyi",
    lastName: "Liu",
    email: "xinyi.liu@example.com",
    phone: "+86 138 0001 2345",
  },
  {
    firstName: "Jiaming",
    lastName: "Wang",
    email: "jiaming.wang@example.com",
    phone: "+86 139 0012 3456",
  },
  {
    firstName: "Yanlin",
    lastName: "Chen",
    email: "yanlin.chen@example.com",
    phone: "+86 137 0123 4567",
  },
  {
    firstName: "Ruoxi",
    lastName: "Zhang",
    email: "ruoxi.zhang@example.com",
    phone: "+86 136 1234 5678",
  },
  {
    firstName: "Mengting",
    lastName: "Li",
    email: "mengting.li@example.com",
    phone: "+86 135 2345 6789",
  },
  {
    firstName: "Anh",
    lastName: "Nguyen",
    email: "anh.nguyen@example.com",
    phone: "+84 91 234 5678",
  },
  {
    firstName: "Linh",
    lastName: "Tran",
    email: "linh.tran@example.com",
    phone: "+84 93 345 6789",
  },
  {
    firstName: "Minh",
    lastName: "Pham",
    email: "minh.pham@example.com",
    phone: "+84 94 456 7890",
  },
  {
    firstName: "Thuy",
    lastName: "Le",
    email: "thuy.le@example.com",
    phone: "+84 96 567 8901",
  },
  {
    firstName: "Nhi",
    lastName: "Hoang",
    email: "nhi.hoang@example.com",
    phone: "+84 97 678 9012",
  },
  {
    firstName: "Priya",
    lastName: "Krishnan",
    email: "priya.krishnan@example.com",
    phone: "+65 9123 4567",
  },
  {
    firstName: "Rajan",
    lastName: "Pillai",
    email: "rajan.pillai@example.com",
    phone: "+65 9234 5678",
  },
  {
    firstName: "Mei",
    lastName: "Tan",
    email: "mei.tan@example.com",
    phone: "+65 9345 6789",
  },
  {
    firstName: "Wei",
    lastName: "Lim",
    email: "wei.lim@example.com",
    phone: "+65 9456 7890",
  },
  {
    firstName: "Aiyana",
    lastName: "Barker",
    email: "aiyana.barker@example.com",
    phone: "+61 412 345 678",
  },
  {
    firstName: "Lachlan",
    lastName: "Murray",
    email: "lachlan.murray@example.com",
    phone: "+61 413 456 789",
  },
  {
    firstName: "Zara",
    lastName: "Evans",
    email: "zara.evans@example.com",
    phone: "+61 414 567 890",
  },
  {
    firstName: "Riley",
    lastName: "Smith",
    email: "riley.smith@example.com",
    phone: "+64 21 123 4567",
  },
  {
    firstName: "Harper",
    lastName: "Wilson",
    email: "harper.wilson@example.com",
    phone: "+64 22 234 5678",
  },
  {
    firstName: "Isla",
    lastName: "Thompson",
    email: "isla.thompson@example.com",
    phone: "+64 27 345 6789",
  },

  // ── Batch J: India (indices 240–259) ──
  {
    firstName: "Sneha",
    lastName: "Reddy",
    email: "sneha.reddy@example.com",
    phone: "+91 98776 54321",
  },
  {
    firstName: "Pooja",
    lastName: "Nair",
    email: "pooja.nair@example.com",
    phone: "+91 87654 32109",
  },
  {
    firstName: "Aishwarya",
    lastName: "Rao",
    email: "aishwarya.rao@example.com",
    phone: "+91 76543 21098",
  },
  {
    firstName: "Divya",
    lastName: "Menon",
    email: "divya.menon@example.com",
    phone: "+91 65432 10987",
  },
  {
    firstName: "Riya",
    lastName: "Joshi",
    email: "riya.joshi@example.com",
    phone: "+91 54321 09876",
  },
  {
    firstName: "Tanvi",
    lastName: "Patel",
    email: "tanvi.patel@example.com",
    phone: "+91 43210 98765",
  },
  {
    firstName: "Kriti",
    lastName: "Singh",
    email: "kriti.singh@example.com",
    phone: "+91 32109 87654",
  },
  {
    firstName: "Nandini",
    lastName: "Kumar",
    email: "nandini.kumar@example.com",
    phone: "+91 21098 76543",
  },
  {
    firstName: "Srishti",
    lastName: "Sharma",
    email: "srishti.sharma@example.com",
    phone: "+91 10987 65432",
  },
  {
    firstName: "Megha",
    lastName: "Agarwal",
    email: "megha.agarwal@example.com",
    phone: "+91 99876 54321",
  },
  {
    firstName: "Karan",
    lastName: "Malhotra",
    email: "karan.malhotra@example.com",
    phone: "+91 88765 43210",
  },
  {
    firstName: "Sidharth",
    lastName: "Verma",
    email: "sidharth.verma@example.com",
    phone: "+91 77654 32109",
  },
  {
    firstName: "Akash",
    lastName: "Yadav",
    email: "akash.yadav@example.com",
    phone: "+91 66543 21098",
  },
  {
    firstName: "Harsh",
    lastName: "Tiwari",
    email: "harsh.tiwari@example.com",
    phone: "+91 55432 10987",
  },
  {
    firstName: "Ankit",
    lastName: "Chaudhary",
    email: "ankit.chaudhary@example.com",
    phone: "+91 44321 09876",
  },
  {
    firstName: "Ishaan",
    lastName: "Saxena",
    email: "ishaan.saxena@example.com",
    phone: "+91 33210 98765",
  },
  {
    firstName: "Parth",
    lastName: "Mishra",
    email: "parth.mishra@example.com",
    phone: "+91 22109 87654",
  },
  {
    firstName: "Yash",
    lastName: "Pandey",
    email: "yash.pandey@example.com",
    phone: "+91 11098 76543",
  },
  {
    firstName: "Dev",
    lastName: "Chauhan",
    email: "dev.chauhan@example.com",
    phone: "+91 99765 43210",
  },
  {
    firstName: "Aryan",
    lastName: "Sinha",
    email: "aryan.sinha@example.com",
    phone: "+91 88654 32109",
  },

  // ── Batch K: LATAM (indices 260–279) ──
  {
    firstName: "Valeria",
    lastName: "Rodríguez",
    email: "valeria.rodriguez@example.com",
    phone: "+54 9 11 5678 9012",
  },
  {
    firstName: "Catalina",
    lastName: "Gómez",
    email: "catalina.gomez@example.com",
    phone: "+57 312 345 6789",
  },
  {
    firstName: "Daniela",
    lastName: "Martínez",
    email: "daniela.martinez@example.com",
    phone: "+52 55 2345 6789",
  },
  {
    firstName: "Sofía",
    lastName: "Varela",
    email: "sofia.varela@example.com",
    phone: "+34 667 890 123",
  },
  {
    firstName: "Valentina",
    lastName: "López",
    email: "valentina.lopez@example.com",
    phone: "+54 9 11 6789 0123",
  },
  {
    firstName: "Fernanda",
    lastName: "Oliveira",
    email: "fernanda.oliveira@example.com",
    phone: "+55 11 98765 5678",
  },
  {
    firstName: "Gabriela",
    lastName: "Santos",
    email: "gabriela.santos@example.com",
    phone: "+55 21 98765 6789",
  },
  {
    firstName: "Juliana",
    lastName: "Lima",
    email: "juliana.lima@example.com",
    phone: "+55 31 98765 7890",
  },
  {
    firstName: "Carolina",
    lastName: "Souza",
    email: "carolina.souza@example.com",
    phone: "+55 41 98765 8901",
  },
  {
    firstName: "Amanda",
    lastName: "Costa",
    email: "amanda.costa@example.com",
    phone: "+55 51 98765 9012",
  },
  {
    firstName: "Rodrigo",
    lastName: "Fernández",
    email: "rodrigo.fernandez@example.com",
    phone: "+54 9 11 7890 1234",
  },
  {
    firstName: "Andrés",
    lastName: "Moreno",
    email: "andres.moreno@example.com",
    phone: "+57 313 456 7890",
  },
  {
    firstName: "Felipe",
    lastName: "Torres",
    email: "felipe.torres@example.com",
    phone: "+56 9 2345 6789",
  },
  {
    firstName: "Diego",
    lastName: "Vargas",
    email: "diego.vargas@example.com",
    phone: "+52 33 2345 6789",
  },
  {
    firstName: "Matías",
    lastName: "Ramos",
    email: "matias.ramos@example.com",
    phone: "+54 9 11 8901 2345",
  },
  {
    firstName: "Santiago",
    lastName: "Cruz",
    email: "santiago.cruz@example.com",
    phone: "+57 314 567 8901",
  },
  {
    firstName: "Nicolás",
    lastName: "Flores",
    email: "nicolas.flores@example.com",
    phone: "+56 9 3456 7890",
  },
  {
    firstName: "Emilio",
    lastName: "Reyes",
    email: "emilio.reyes@example.com",
    phone: "+52 55 3456 7890",
  },
  {
    firstName: "Alejandro",
    lastName: "Díaz",
    email: "alejandro.diaz@example.com",
    phone: "+54 9 11 9012 3456",
  },
  {
    firstName: "Cristian",
    lastName: "Núñez",
    email: "cristian.nunez@example.com",
    phone: "+57 315 678 9012",
  },

  // ── Batch L: Middle East & Africa (indices 280–299) ──
  {
    firstName: "Yasmine",
    lastName: "Mansour",
    email: "yasmine.mansour@example.com",
    phone: "+20 112 456 7890",
  },
  {
    firstName: "Sara",
    lastName: "Al-Rashid",
    email: "sara.alrashid@example.com",
    phone: "+966 51 234 5678",
  },
  {
    firstName: "Hana",
    lastName: "Khalil",
    email: "hana.khalil@example.com",
    phone: "+961 70 456 789",
  },
  {
    firstName: "Dina",
    lastName: "El-Sayed",
    email: "dina.elsayed@example.com",
    phone: "+20 113 567 8901",
  },
  {
    firstName: "Nadia",
    lastName: "Osman",
    email: "nadia.osman2@example.com",
    phone: "+249 9 2345 6789",
  },
  {
    firstName: "Amira",
    lastName: "Bousso",
    email: "amira.bousso@example.com",
    phone: "+221 78 234 5678",
  },
  {
    firstName: "Fatou",
    lastName: "Sarr",
    email: "fatou.sarr@example.com",
    phone: "+221 77 345 6789",
  },
  {
    firstName: "Mariama",
    lastName: "Bah",
    email: "mariama.bah@example.com",
    phone: "+224 623 23 45 67",
  },
  {
    firstName: "Awa",
    lastName: "Traoré",
    email: "awa.traore@example.com",
    phone: "+225 07 23 45 67",
  },
  {
    firstName: "Khadija",
    lastName: "El-Fassi",
    email: "khadija.elfassi@example.com",
    phone: "+212 663 456 789",
  },
  {
    firstName: "Emeka",
    lastName: "Chukwu",
    email: "emeka.chukwu@example.com",
    phone: "+234 808 901 2345",
  },
  {
    firstName: "Chidi",
    lastName: "Okeke",
    email: "chidi.okeke@example.com",
    phone: "+234 809 012 3456",
  },
  {
    firstName: "Oluseun",
    lastName: "Akins",
    email: "oluseun.akins@example.com",
    phone: "+234 810 123 4567",
  },
  {
    firstName: "Tobechukwu",
    lastName: "Osei",
    email: "tobechukwu.osei@example.com",
    phone: "+233 26 345 6789",
  },
  {
    firstName: "Kwame",
    lastName: "Boateng",
    email: "kwame.boateng@example.com",
    phone: "+233 27 456 7890",
  },
  {
    firstName: "Ama",
    lastName: "Asante",
    email: "ama.asante@example.com",
    phone: "+233 28 567 8901",
  },
  {
    firstName: "Zainab",
    lastName: "Ibrahim",
    email: "zainab.ibrahim@example.com",
    phone: "+234 811 234 5678",
  },
  {
    firstName: "Abubakar",
    lastName: "Musa",
    email: "abubakar.musa@example.com",
    phone: "+234 812 345 6789",
  },
  {
    firstName: "Bilal",
    lastName: "Hassan",
    email: "bilal.hassan@example.com",
    phone: "+971 57 456 7890",
  },
  {
    firstName: "Sana",
    lastName: "Mirza",
    email: "sana.mirza@example.com",
    phone: "+92 301 2345678",
  },

  // ── Batch M: More EU (indices 300–329) ──
  {
    firstName: "Mathilde",
    lastName: "Hansen",
    email: "mathilde.hansen@example.com",
    phone: "+45 29 45 67 89",
  },
  {
    firstName: "Cecilie",
    lastName: "Berg",
    email: "cecilie.berg@example.com",
    phone: "+47 95 67 89 01",
  },
  {
    firstName: "Ingrid",
    lastName: "Eriksen",
    email: "ingrid.eriksen@example.com",
    phone: "+47 96 78 90 12",
  },
  {
    firstName: "Kristin",
    lastName: "Storhaug",
    email: "kristin.storhaug@example.com",
    phone: "+47 97 89 01 23",
  },
  {
    firstName: "Malin",
    lastName: "Åberg",
    email: "malin.aberg@example.com",
    phone: "+46 79 901 23 45",
  },
  {
    firstName: "Agnes",
    lastName: "Söderberg",
    email: "agnes.soderberg@example.com",
    phone: "+46 79 012 34 56",
  },
  {
    firstName: "Elsa",
    lastName: "Karlsson",
    email: "elsa.karlsson@example.com",
    phone: "+46 73 123 45 67",
  },
  {
    firstName: "Hanna",
    lastName: "Ohlsson",
    email: "hanna.ohlsson@example.com",
    phone: "+46 72 234 56 78",
  },
  {
    firstName: "Emmi",
    lastName: "Virtanen",
    email: "emmi.virtanen@example.com",
    phone: "+358 46 3456789",
  },
  {
    firstName: "Aino",
    lastName: "Leinonen",
    email: "aino.leinonen@example.com",
    phone: "+358 50 4567890",
  },
  {
    firstName: "Lena",
    lastName: "Koch",
    email: "lena.koch@example.com",
    phone: "+43 676 1234567",
  },
  {
    firstName: "Stefan",
    lastName: "Huber",
    email: "stefan.huber@example.com",
    phone: "+43 677 2345678",
  },
  {
    firstName: "Julia",
    lastName: "Wagner",
    email: "julia.wagner@example.com",
    phone: "+43 664 3456789",
  },
  {
    firstName: "Philipp",
    lastName: "Schneider",
    email: "philipp.schneider@example.com",
    phone: "+43 699 4567890",
  },
  {
    firstName: "Lisa",
    lastName: "Bauer",
    email: "lisa.bauer@example.com",
    phone: "+49 152 5678901",
  },
  {
    firstName: "Michael",
    lastName: "Wagner",
    email: "michael.wagner@example.com",
    phone: "+49 153 6789012",
  },
  {
    firstName: "Sandra",
    lastName: "Lehmann",
    email: "sandra.lehmann@example.com",
    phone: "+49 154 7890123",
  },
  {
    firstName: "Thomas",
    lastName: "Günther",
    email: "thomas.gunther@example.com",
    phone: "+49 155 8901234",
  },
  {
    firstName: "Katharina",
    lastName: "Berger",
    email: "katharina.berger@example.com",
    phone: "+49 156 9012345",
  },
  {
    firstName: "Florian",
    lastName: "Wolf",
    email: "florian.wolf@example.com",
    phone: "+49 157 0123456",
  },
  {
    firstName: "Clara",
    lastName: "Blanc",
    email: "clara.blanc@example.com",
    phone: "+33 6 90 12 34 56",
  },
  {
    firstName: "Pierre",
    lastName: "Dupont",
    email: "pierre.dupont@example.com",
    phone: "+32 488 23 45 67",
  },
  {
    firstName: "Alice",
    lastName: "Simon",
    email: "alice.simon@example.com",
    phone: "+33 6 01 23 45 67",
  },
  {
    firstName: "Louis",
    lastName: "Petit",
    email: "louis.petit@example.com",
    phone: "+33 6 12 34 56 78",
  },
  {
    firstName: "Camille",
    lastName: "Laurent",
    email: "camille.laurent@example.com",
    phone: "+33 6 23 45 67 89",
  },
  {
    firstName: "Nicolas",
    lastName: "Thomas",
    email: "nicolas.thomas@example.com",
    phone: "+33 6 34 56 78 90",
  },
  {
    firstName: "Anaïs",
    lastName: "Roux",
    email: "anais.roux@example.com",
    phone: "+33 6 45 67 89 01",
  },
  {
    firstName: "Guillaume",
    lastName: "David",
    email: "guillaume.david@example.com",
    phone: "+33 6 56 78 90 12",
  },
  {
    firstName: "Marion",
    lastName: "Bertrand",
    email: "marion.bertrand@example.com",
    phone: "+33 6 67 89 01 23",
  },
  {
    firstName: "Clément",
    lastName: "Richard",
    email: "clement.richard@example.com",
    phone: "+33 6 78 90 12 34",
  },

  // ── Batch N: Global Diverse (indices 330–369) ──
  {
    firstName: "Amani",
    lastName: "Ochieng",
    email: "amani.ochieng@example.com",
    phone: "+254 712 345 678",
  },
  {
    firstName: "Zawadi",
    lastName: "Kamau",
    email: "zawadi.kamau@example.com",
    phone: "+254 723 456 789",
  },
  {
    firstName: "Neema",
    lastName: "Mwangi",
    email: "neema.mwangi@example.com",
    phone: "+254 734 567 890",
  },
  {
    firstName: "Wanjiru",
    lastName: "Njoroge",
    email: "wanjiru.njoroge@example.com",
    phone: "+254 745 678 901",
  },
  {
    firstName: "Anika",
    lastName: "Patel",
    email: "anika.patel@example.com",
    phone: "+44 7722 345678",
  },
  {
    firstName: "Priti",
    lastName: "Shah",
    email: "priti.shah@example.com",
    phone: "+44 7733 456789",
  },
  {
    firstName: "Reena",
    lastName: "Mehta",
    email: "reena.mehta@example.com",
    phone: "+44 7744 567890",
  },
  {
    firstName: "Neha",
    lastName: "Kapoor",
    email: "neha.kapoor@example.com",
    phone: "+44 7755 678901",
  },
  {
    firstName: "Tanya",
    lastName: "Sidhu",
    email: "tanya.sidhu@example.com",
    phone: "+44 7766 789012",
  },
  {
    firstName: "Jasleen",
    lastName: "Gill",
    email: "jasleen.gill@example.com",
    phone: "+44 7777 890123",
  },
  {
    firstName: "Sabrina",
    lastName: "Favre",
    email: "sabrina.favre@example.com",
    phone: "+41 77 456 7890",
  },
  {
    firstName: "Céline",
    lastName: "Rochat",
    email: "celine.rochat@example.com",
    phone: "+41 78 567 8901",
  },
  {
    firstName: "Mathieu",
    lastName: "Dupuis",
    email: "mathieu.dupuis@example.com",
    phone: "+1 514 456 7890",
  },
  {
    firstName: "Laurence",
    lastName: "Tremblay",
    email: "laurence.tremblay@example.com",
    phone: "+1 418 567 8901",
  },
  {
    firstName: "Audrey",
    lastName: "Gagnon",
    email: "audrey.gagnon@example.com",
    phone: "+1 438 678 9012",
  },
  {
    firstName: "Annie",
    lastName: "Roy",
    email: "annie.roy@example.com",
    phone: "+1 514 789 0123",
  },
  {
    firstName: "Damaris",
    lastName: "Osei",
    email: "damaris.osei@example.com",
    phone: "+233 29 678 9012",
  },
  {
    firstName: "Efua",
    lastName: "Mensah",
    email: "efua.mensah@example.com",
    phone: "+233 30 789 0123",
  },
  {
    firstName: "Akua",
    lastName: "Adjei",
    email: "akua.adjei@example.com",
    phone: "+233 31 890 1234",
  },
  {
    firstName: "Abena",
    lastName: "Owusu",
    email: "abena.owusu@example.com",
    phone: "+233 20 901 2345",
  },
  {
    firstName: "Nkechi",
    lastName: "Eze",
    email: "nkechi.eze@example.com",
    phone: "+234 813 456 7890",
  },
  {
    firstName: "Adaora",
    lastName: "Obi",
    email: "adaora.obi@example.com",
    phone: "+234 814 567 8901",
  },
  {
    firstName: "Ifeoma",
    lastName: "Agu",
    email: "ifeoma.agu@example.com",
    phone: "+234 815 678 9012",
  },
  {
    firstName: "Obiageli",
    lastName: "Nwachukwu",
    email: "obiageli.nwachukwu@example.com",
    phone: "+234 816 789 0123",
  },
  {
    firstName: "Leilani",
    lastName: "Kahale",
    email: "leilani.kahale@example.com",
    phone: "+1 808 234 5678",
  },
  {
    firstName: "Kainoa",
    lastName: "Akana",
    email: "kainoa.akana@example.com",
    phone: "+1 808 345 6789",
  },
  {
    firstName: "Keola",
    lastName: "Makoa",
    email: "keola.makoa@example.com",
    phone: "+1 808 456 7890",
  },
  {
    firstName: "Hemi",
    lastName: "Walker",
    email: "hemi.walker@example.com",
    phone: "+64 21 345 6789",
  },
  {
    firstName: "Mihail",
    lastName: "Popov",
    email: "mihail.popov@example.com",
    phone: "+359 88 123 4567",
  },
  {
    firstName: "Elena",
    lastName: "Ivanova",
    email: "elena.ivanova@example.com",
    phone: "+359 89 234 5678",
  },
  {
    firstName: "Stefan",
    lastName: "Dimitrov",
    email: "stefan.dimitrov@example.com",
    phone: "+359 87 345 6789",
  },
  {
    firstName: "Kristina",
    lastName: "Todorova",
    email: "kristina.todorova@example.com",
    phone: "+359 88 456 7890",
  },
  {
    firstName: "Marija",
    lastName: "Jovanović",
    email: "marija.jovanovic@example.com",
    phone: "+381 62 345 6789",
  },
  {
    firstName: "Nikola",
    lastName: "Stanković",
    email: "nikola.stankovic@example.com",
    phone: "+381 63 456 7890",
  },
  {
    firstName: "Tea",
    lastName: "Horvat",
    email: "tea.horvat@example.com",
    phone: "+385 99 345 6789",
  },
  {
    firstName: "Mateja",
    lastName: "Novak",
    email: "mateja.novak@example.com",
    phone: "+386 31 234 567",
  },
  {
    firstName: "Luka",
    lastName: "Kovač",
    email: "luka.kovac@example.com",
    phone: "+386 41 345 678",
  },
  {
    firstName: "Nika",
    lastName: "Zupan",
    email: "nika.zupan@example.com",
    phone: "+386 51 456 789",
  },
  {
    firstName: "Jan",
    lastName: "Kramer",
    email: "jan.kramer@example.com",
    phone: "+31 6 45678901",
  },
  {
    firstName: "Fleur",
    lastName: "van den Berg",
    email: "fleur.vandenberg@example.com",
    phone: "+31 6 56789012",
  },

  // ── Batch O: Final Global Mix (indices 370–399) ──
  {
    firstName: "Amara",
    lastName: "Diallo",
    email: "amara.diallo@example.com",
    phone: "+221 76 456 7890",
  },
  {
    firstName: "Kadiatou",
    lastName: "Kouyaté",
    email: "kadiatou.kouyate@example.com",
    phone: "+224 624 34 56 78",
  },
  {
    firstName: "Mariam",
    lastName: "Coulibaly",
    email: "mariam.coulibaly@example.com",
    phone: "+225 07 34 56 78",
  },
  {
    firstName: "Assane",
    lastName: "Fall",
    email: "assane.fall@example.com",
    phone: "+221 78 567 8901",
  },
  {
    firstName: "Rokia",
    lastName: "Keita",
    email: "rokia.keita@example.com",
    phone: "+223 76 123 4567",
  },
  {
    firstName: "Cathy",
    lastName: "Otieno",
    email: "cathy.otieno@example.com",
    phone: "+254 756 789 012",
  },
  {
    firstName: "Wambui",
    lastName: "Githire",
    email: "wambui.githire@example.com",
    phone: "+254 767 890 123",
  },
  {
    firstName: "Lydia",
    lastName: "Muthoni",
    email: "lydia.muthoni@example.com",
    phone: "+254 778 901 234",
  },
  {
    firstName: "Olive",
    lastName: "Uwimana",
    email: "olive.uwimana@example.com",
    phone: "+250 78 345 6789",
  },
  {
    firstName: "Ioana",
    lastName: "Constantin",
    email: "ioana.constantin@example.com",
    phone: "+40 725 678 901",
  },
  {
    firstName: "Andreea",
    lastName: "Gheorghe",
    email: "andreea.gheorghe@example.com",
    phone: "+40 726 789 012",
  },
  {
    firstName: "Oana",
    lastName: "Popa",
    email: "oana.popa@example.com",
    phone: "+40 727 890 123",
  },
  {
    firstName: "Cristina",
    lastName: "Munteanu",
    email: "cristina.munteanu@example.com",
    phone: "+40 728 901 234",
  },
  {
    firstName: "Miruna",
    lastName: "Ionescu",
    email: "miruna.ionescu@example.com",
    phone: "+40 729 012 345",
  },
  {
    firstName: "Dragos",
    lastName: "Stoica",
    email: "dragos.stoica@example.com",
    phone: "+40 730 123 456",
  },
  {
    firstName: "Andrei",
    lastName: "Barbu",
    email: "andrei.barbu@example.com",
    phone: "+40 731 234 567",
  },
  {
    firstName: "Razvan",
    lastName: "Dima",
    email: "razvan.dima@example.com",
    phone: "+40 732 345 678",
  },
  {
    firstName: "Petra",
    lastName: "Novák",
    email: "petra.novak@example.com",
    phone: "+421 902 345 678",
  },
  {
    firstName: "Michal",
    lastName: "Horváth",
    email: "michal.horvath@example.com",
    phone: "+421 903 456 789",
  },
  {
    firstName: "Zuzana",
    lastName: "Kováčová",
    email: "zuzana.kovacova@example.com",
    phone: "+421 904 567 890",
  },
  {
    firstName: "Mário",
    lastName: "Varga",
    email: "mario.varga@example.com",
    phone: "+421 905 678 901",
  },
  {
    firstName: "Jana",
    lastName: "Slobodová",
    email: "jana.slobodova@example.com",
    phone: "+421 906 789 012",
  },
  {
    firstName: "Barbora",
    lastName: "Nováková",
    email: "barbora.novakova@example.com",
    phone: "+421 907 890 123",
  },
  {
    firstName: "Tomas",
    lastName: "Kratochvíl",
    email: "tomas.kratochvil@example.com",
    phone: "+420 603 456 789",
  },
  {
    firstName: "Radek",
    lastName: "Dvořák",
    email: "radek.dvorak@example.com",
    phone: "+420 604 567 890",
  },
  {
    firstName: "Lucie",
    lastName: "Horáčková",
    email: "lucie.horachkova@example.com",
    phone: "+420 605 678 901",
  },
  {
    firstName: "Martin",
    lastName: "Blaha",
    email: "martin.blaha@example.com",
    phone: "+420 606 789 012",
  },
  {
    firstName: "Klára",
    lastName: "Veselá",
    email: "klara.vesela@example.com",
    phone: "+420 607 890 123",
  },
  {
    firstName: "Ondrej",
    lastName: "Sedláček",
    email: "ondrej.sedlacek@example.com",
    phone: "+420 608 901 234",
  },
  {
    firstName: "Yuki",
    lastName: "Shimizu",
    email: "yuki.shimizu@example.com",
    phone: "+81 90 2345 6789",
  },

  // ── Batch P: Additional Product Designer overflow (indices 400–419) ──
  {
    firstName: "Nora",
    lastName: "Svensson",
    email: "nora.svensson@example.com",
    phone: "+46 73 456 78 90",
  },
  {
    firstName: "Bastien",
    lastName: "Moreau",
    email: "bastien.moreau@example.com",
    phone: "+33 6 89 01 23 45",
  },
  {
    firstName: "Teresa",
    lastName: "Almeida",
    email: "teresa.almeida@example.com",
    phone: "+351 913 456 789",
  },
  {
    firstName: "Jonas",
    lastName: "Lund",
    email: "jonas.lund@example.com",
    phone: "+45 21 23 45 67",
  },
  {
    firstName: "Iria",
    lastName: "Varela",
    email: "iria.varela@example.com",
    phone: "+34 611 234 567",
  },
  {
    firstName: "Marta",
    lastName: "Pinto",
    email: "marta.pinto@example.com",
    phone: "+351 914 567 890",
  },
  {
    firstName: "Daan",
    lastName: "Bakker",
    email: "daan.bakker@example.com",
    phone: "+31 6 67890123",
  },
  {
    firstName: "Eszter",
    lastName: "Farkas",
    email: "eszter.farkas@example.com",
    phone: "+36 30 345 6789",
  },
  {
    firstName: "Tobias",
    lastName: "Nilsson",
    email: "tobias.nilsson@example.com",
    phone: "+46 70 567 89 01",
  },
  {
    firstName: "Adele",
    lastName: "Mercier",
    email: "adele.mercier@example.com",
    phone: "+33 7 34 56 78 90",
  },
  {
    firstName: "Rui",
    lastName: "Carvalho",
    email: "rui.carvalho@example.com",
    phone: "+351 915 678 901",
  },
  {
    firstName: "Helena",
    lastName: "Costa",
    email: "helena.costa2@example.com",
    phone: "+351 916 789 012",
  },
  {
    firstName: "Milan",
    lastName: "Horak",
    email: "milan.horak@example.com",
    phone: "+420 702 123 456",
  },
  {
    firstName: "Paula",
    lastName: "Vicente",
    email: "paula.vicente@example.com",
    phone: "+34 622 345 678",
  },
  {
    firstName: "Catarina",
    lastName: "Sousa",
    email: "catarina.sousa@example.com",
    phone: "+351 917 890 123",
  },
  {
    firstName: "Ramon",
    lastName: "Gil",
    email: "ramon.gil@example.com",
    phone: "+34 633 456 789",
  },
  {
    firstName: "Aneta",
    lastName: "Krawczyk",
    email: "aneta.krawczyk@example.com",
    phone: "+48 504 567 890",
  },
  {
    firstName: "Claudia",
    lastName: "Greco",
    email: "claudia.greco@example.com",
    phone: "+39 327 4567890",
  },
  {
    firstName: "Petar",
    lastName: "Markovic",
    email: "petar.markovic@example.com",
    phone: "+381 64 567 8901",
  },
  {
    firstName: "Sanne",
    lastName: "Bos",
    email: "sanne.bos@example.com",
    phone: "+31 6 78901234",
  },
];

// ─────────────────────────────────────────────
// Application distribution map
// Ensures realistic pipeline distribution across all stages
// ─────────────────────────────────────────────

type AppStatus =
  "new" | "screening" | "interview" | "offer" | "hired" | "rejected";

interface ApplicationAssignment {
  candidateIndex: number;
  status: AppStatus;
  score?: number;
  notes?: string;
}

const DEMO_APPLICATIONS_PER_STATUS = 3;

// Job 0: Senior Full-Stack Engineer — high volume, full funnel
const JOB_0_APPS: ApplicationAssignment[] = [
  {
    candidateIndex: 0,
    status: "hired",
    score: 96,
    notes:
      "Outstanding architecture interview and strong leadership examples. Accepted offer.",
  },
  {
    candidateIndex: 1,
    status: "offer",
    score: 92,
    notes:
      "Excellent systems design and pragmatic decision-making. Offer package in final approval.",
  },
  {
    candidateIndex: 2,
    status: "offer",
    score: 89,
    notes:
      "Strong backend depth and clear communication. Final compensation discussion scheduled.",
  },
  {
    candidateIndex: 3,
    status: "interview",
    score: 86,
    notes:
      "Great take-home submission. Final panel interview planned next week.",
  },
  {
    candidateIndex: 4,
    status: "interview",
    score: 84,
    notes: "Consistent coding quality. Proceeding to architecture round.",
  },
  {
    candidateIndex: 5,
    status: "interview",
    score: 81,
    notes:
      "Positive recruiter and hiring manager feedback. Interview loop in progress.",
  },
  {
    candidateIndex: 6,
    status: "screening",
    score: 78,
    notes:
      "Relevant multi-tenant SaaS experience. Scheduling technical screen.",
  },
  {
    candidateIndex: 7,
    status: "screening",
    score: 75,
    notes:
      "Solid TypeScript background. Waiting on availability for first call.",
  },
  {
    candidateIndex: 8,
    status: "new",
    score: 73,
    notes:
      "Promising CV with production Nuxt experience. Pending initial review.",
  },
  {
    candidateIndex: 9,
    status: "new",
    score: 70,
    notes: "Good open-source profile. Recruiter triage queued.",
  },
  { candidateIndex: 10, status: "new", score: 68 },
  { candidateIndex: 11, status: "new", score: 66 },
  {
    candidateIndex: 12,
    status: "rejected",
    score: 44,
    notes: "Experience level below senior expectations for this role.",
  },
  {
    candidateIndex: 13,
    status: "rejected",
    score: 39,
    notes: "Limited backend ownership in recent roles.",
  },

  // ── 120 additional applicants representing a realistic high-volume inbound flood ──
  // 90 unreviewed ("new") with AI scores — the pile the ATS shortlist is designed to tame.
  // Sorted by score descending within each tier to show how scores surface the best candidates.

  // Top tier (83–89): AI has flagged these as worth immediate attention
  {
    candidateIndex: 70,
    status: "new",
    score: 89,
    notes:
      "Exceptional full-stack profile — TypeScript, Vue 3, PostgreSQL across 8+ years. Leads technical design in current B2B SaaS team. Top AI shortlist.",
  },
  {
    candidateIndex: 50,
    status: "new",
    score: 88,
    notes:
      "Outstanding senior profile — 7 years TypeScript, multi-tenant architecture ownership. AI shortlist candidate.",
  },
  {
    candidateIndex: 30,
    status: "new",
    score: 87,
    notes:
      "Strong Nuxt 3 and TypeScript depth with measurable B2B SaaS delivery. AI shortlist candidate.",
  },
  {
    candidateIndex: 80,
    status: "new",
    score: 86,
    notes:
      "Senior full-stack with engineering team leadership at B2B SaaS company. AI shortlist candidate.",
  },
  {
    candidateIndex: 110,
    status: "new",
    score: 85,
    notes:
      "Strong senior full-stack profile with B2B SaaS delivery and TypeScript/Vue depth.",
  },
  {
    candidateIndex: 40,
    status: "new",
    score: 85,
    notes:
      "Impressive TypeScript and Vue depth with multi-tenant SaaS experience. AI shortlist candidate.",
  },

  // Good tier (70–84): Worth screening
  { candidateIndex: 60, status: "new", score: 84 },
  { candidateIndex: 74, status: "new", score: 81 },
  { candidateIndex: 53, status: "new", score: 80 },
  { candidateIndex: 113, status: "new", score: 80 },
  { candidateIndex: 90, status: "new", score: 83 },
  { candidateIndex: 93, status: "new", score: 79 },
  { candidateIndex: 34, status: "new", score: 79 },
  { candidateIndex: 71, status: "new", score: 77 },
  { candidateIndex: 41, status: "new", score: 76 },
  { candidateIndex: 58, status: "new", score: 76 },
  { candidateIndex: 84, status: "new", score: 75 },
  { candidateIndex: 111, status: "new", score: 74 },
  { candidateIndex: 64, status: "new", score: 74 },
  { candidateIndex: 31, status: "new", score: 73 },
  { candidateIndex: 91, status: "new", score: 73 },
  { candidateIndex: 51, status: "new", score: 72 },
  { candidateIndex: 79, status: "new", score: 72 },
  { candidateIndex: 99, status: "new", score: 72 },
  { candidateIndex: 44, status: "new", score: 71 },
  { candidateIndex: 61, status: "new", score: 70 },

  // Moderate tier (55–69): Borderline, would take time to manually evaluate
  { candidateIndex: 116, status: "new", score: 69 },
  { candidateIndex: 81, status: "new", score: 69 },
  { candidateIndex: 46, status: "new", score: 67 },
  { candidateIndex: 76, status: "new", score: 67 },
  { candidateIndex: 97, status: "new", score: 67 },
  { candidateIndex: 107, status: "new", score: 66 },
  { candidateIndex: 36, status: "new", score: 64 },
  { candidateIndex: 86, status: "new", score: 64 },
  { candidateIndex: 72, status: "new", score: 63 },
  { candidateIndex: 42, status: "new", score: 62 },
  { candidateIndex: 59, status: "new", score: 62 },
  { candidateIndex: 92, status: "new", score: 62 },
  { candidateIndex: 112, status: "new", score: 62 },
  { candidateIndex: 82, status: "new", score: 60 },
  { candidateIndex: 32, status: "new", score: 61 },
  { candidateIndex: 66, status: "new", score: 61 },
  { candidateIndex: 101, status: "new", score: 61 },
  { candidateIndex: 52, status: "new", score: 59 },
  { candidateIndex: 109, status: "new", score: 58 },
  { candidateIndex: 62, status: "new", score: 58 },
  { candidateIndex: 103, status: "new", score: 57 },
  { candidateIndex: 47, status: "new", score: 57 },
  { candidateIndex: 117, status: "new", score: 57 },
  { candidateIndex: 77, status: "new", score: 55 },
  { candidateIndex: 94, status: "new", score: 55 },
  { candidateIndex: 114, status: "new", score: 55 },
  { candidateIndex: 37, status: "new", score: 55 },
  { candidateIndex: 55, status: "new", score: 65 },

  // Below average (35–54): Probably not a fit, but each would require time to evaluate manually
  { candidateIndex: 73, status: "new", score: 51 },
  { candidateIndex: 98, status: "new", score: 51 },
  { candidateIndex: 33, status: "new", score: 52 },
  { candidateIndex: 67, status: "new", score: 52 },
  { candidateIndex: 56, status: "new", score: 53 },
  { candidateIndex: 87, status: "new", score: 53 },
  { candidateIndex: 54, status: "new", score: 46 },
  { candidateIndex: 95, status: "new", score: 46 },
  { candidateIndex: 115, status: "new", score: 46 },
  { candidateIndex: 63, status: "new", score: 47 },
  { candidateIndex: 83, status: "new", score: 48 },
  { candidateIndex: 104, status: "new", score: 48 },
  { candidateIndex: 43, status: "new", score: 48 },
  { candidateIndex: 48, status: "new", score: 43 },
  { candidateIndex: 118, status: "new", score: 43 },
  { candidateIndex: 106, status: "new", score: 42 },
  { candidateIndex: 75, status: "new", score: 42 },
  { candidateIndex: 88, status: "new", score: 41 },
  { candidateIndex: 35, status: "new", score: 44 },
  { candidateIndex: 100, status: "new", score: 44 },
  { candidateIndex: 68, status: "new", score: 44 },
  { candidateIndex: 38, status: "new", score: 38 },
  { candidateIndex: 78, status: "new", score: 38 },
  { candidateIndex: 96, status: "new", score: 38 },

  // Poor fit (12–34): Clear mismatches the AI correctly deprioritised
  { candidateIndex: 45, status: "new", score: 35 },
  { candidateIndex: 102, status: "new", score: 35 },
  { candidateIndex: 85, status: "new", score: 34 },
  { candidateIndex: 119, status: "new", score: 32 },
  { candidateIndex: 108, status: "new", score: 33 },
  { candidateIndex: 57, status: "new", score: 39 },
  { candidateIndex: 65, status: "new", score: 36 },
  { candidateIndex: 105, status: "new", score: 22 },
  { candidateIndex: 49, status: "new", score: 22 },
  { candidateIndex: 89, status: "new", score: 26 },
  { candidateIndex: 39, status: "new", score: 29 },
  { candidateIndex: 69, status: "new", score: 28 },

  // 30 rejected — already triaged (AI score confirmed poor fit, recruiter bulk-rejected)
  {
    candidateIndex: 120,
    status: "rejected",
    score: 38,
    notes:
      "Limited TypeScript experience for a senior role — primarily junior-level contributions.",
  },
  {
    candidateIndex: 121,
    status: "rejected",
    score: 29,
    notes: "Background is primarily mobile (iOS/Swift), not web full-stack.",
  },
  {
    candidateIndex: 122,
    status: "rejected",
    score: 45,
    notes: "CSS/design focus with insufficient backend depth for this role.",
  },
  {
    candidateIndex: 123,
    status: "rejected",
    score: 33,
    notes:
      "Bootcamp graduate with 1.5 years experience — significantly below senior threshold.",
  },
  {
    candidateIndex: 124,
    status: "rejected",
    score: 41,
    notes:
      "PHP and WordPress background with limited TypeScript or Vue exposure.",
  },
  {
    candidateIndex: 125,
    status: "rejected",
    score: 27,
    notes: "No TypeScript in production — all examples use plain JavaScript.",
  },
  {
    candidateIndex: 126,
    status: "rejected",
    score: 48,
    notes:
      "Marketing background applying for engineering role — minimal technical depth.",
  },
  {
    candidateIndex: 127,
    status: "rejected",
    score: 22,
    notes:
      "Application letter shows minimal understanding of the technical requirements.",
  },
  {
    candidateIndex: 128,
    status: "rejected",
    score: 35,
    notes:
      "React/Next.js only — no Vue/Nuxt experience and no stated interest in learning.",
  },
  {
    candidateIndex: 129,
    status: "rejected",
    score: 31,
    notes:
      "All projects are personal side-projects with no production ownership described.",
  },
  {
    candidateIndex: 130,
    status: "rejected",
    score: 42,
    notes: "DevOps/sysadmin profile — not a web application developer.",
  },
  {
    candidateIndex: 131,
    status: "rejected",
    score: 19,
    notes:
      "AI/ML research background with no web application development experience.",
  },
  {
    candidateIndex: 132,
    status: "rejected",
    score: 44,
    notes: "Less than 2 years total experience — position requires 5+ years.",
  },
  {
    candidateIndex: 133,
    status: "rejected",
    score: 37,
    notes:
      "Ruby on Rails engineer with no TypeScript or JavaScript framework experience.",
  },
  {
    candidateIndex: 134,
    status: "rejected",
    score: 28,
    notes:
      "Data analyst background applying for software engineering role — skills mismatch.",
  },
  {
    candidateIndex: 135,
    status: "rejected",
    score: 46,
    notes:
      "Game development background — limited web stack or SaaS product experience.",
  },
  {
    candidateIndex: 136,
    status: "rejected",
    score: 33,
    notes:
      "QA automation engineer — no production application development background.",
  },
  {
    candidateIndex: 137,
    status: "rejected",
    score: 25,
    notes: "Incomplete application — missing portfolio, broken GitHub link.",
  },
  {
    candidateIndex: 138,
    status: "rejected",
    score: 40,
    notes:
      "Technical writer applying for engineering position — skills misalignment.",
  },
  {
    candidateIndex: 139,
    status: "rejected",
    score: 36,
    notes:
      "Embedded systems engineer — no modern web stack or cloud experience.",
  },
  {
    candidateIndex: 140,
    status: "rejected",
    score: 48,
    notes:
      "Strong Java enterprise background but no TypeScript, Node.js, or Vue usage.",
  },
  {
    candidateIndex: 141,
    status: "rejected",
    score: 21,
    notes:
      "Entry-level graduate — lacks the production experience required for senior level.",
  },
  {
    candidateIndex: 142,
    status: "rejected",
    score: 43,
    notes:
      "CV is a skills list with no project context or ownership description.",
  },
  {
    candidateIndex: 143,
    status: "rejected",
    score: 39,
    notes:
      ".NET/C# background with no TypeScript ecosystem experience or interest stated.",
  },
  {
    candidateIndex: 144,
    status: "rejected",
    score: 32,
    notes:
      "No code samples, GitHub profile, or portfolio provided for a technical role.",
  },
  {
    candidateIndex: 145,
    status: "rejected",
    score: 45,
    notes:
      "Python data science focus — no web application development background.",
  },
  {
    candidateIndex: 146,
    status: "rejected",
    score: 28,
    notes:
      "Applied for 4 different roles simultaneously — no role-specific tailoring evident.",
  },
  {
    candidateIndex: 147,
    status: "rejected",
    score: 35,
    notes:
      "Berlin hybrid required. Candidate explicitly stated no relocation possible.",
  },
  {
    candidateIndex: 148,
    status: "rejected",
    score: 41,
    notes:
      "UI/UX designer applying for a software engineering role — skills mismatch.",
  },
  {
    candidateIndex: 149,
    status: "rejected",
    score: 29,
    notes:
      "Salary expectation significantly outside budget range for this position.",
  },
];

// Job 1: Product Designer — strong mid-funnel representation
const JOB_1_APPS: ApplicationAssignment[] = [
  {
    candidateIndex: 14,
    status: "offer",
    score: 91,
    notes:
      "Exceptional portfolio depth and design-system leadership. Preparing offer.",
  },
  {
    candidateIndex: 15,
    status: "interview",
    score: 88,
    notes: "Strong product thinking and workshop facilitation skills.",
  },
  {
    candidateIndex: 16,
    status: "interview",
    score: 86,
    notes: "High-quality case studies with clear impact metrics.",
  },
  {
    candidateIndex: 17,
    status: "interview",
    score: 83,
    notes: "Great cross-functional collaboration examples.",
  },
  {
    candidateIndex: 18,
    status: "screening",
    score: 79,
    notes: "Compelling research approach. Moving to portfolio walkthrough.",
  },
  {
    candidateIndex: 19,
    status: "screening",
    score: 76,
    notes: "Strong visual craft. Reviewing B2B experience depth.",
  },
  {
    candidateIndex: 20,
    status: "new",
    score: 74,
    notes:
      "Interesting transition from frontend engineering into product design.",
  },
  { candidateIndex: 21, status: "new", score: 71 },
  { candidateIndex: 22, status: "new", score: 69 },
  { candidateIndex: 23, status: "new", score: 67 },
  {
    candidateIndex: 24,
    status: "rejected",
    score: 46,
    notes: "Portfolio focus is primarily brand and campaign design.",
  },
  {
    candidateIndex: 25,
    status: "rejected",
    score: 41,
    notes: "Limited product discovery and usability testing examples.",
  },

  // ── 250 additional applicants — a realistic high-volume inbound flood for a designer role ──
  // Demonstrates the core value: without AI you'd have to manually review all 262 applicants.
  // The AI shortlisted the top 6 instantly; the rest are ranked so you know where to stop.

  // Top tier (86–93): AI flagged these as immediate shortlist — review these first
  {
    candidateIndex: 150,
    status: "new",
    score: 93,
    notes:
      "Exceptional portfolio: 8 end-to-end B2B SaaS case studies with measurable UX outcomes. Led design system at 200-person company. 6 years product design experience. AI top shortlist.",
  },
  {
    candidateIndex: 180,
    status: "new",
    score: 91,
    notes:
      "Outstanding portfolio with data-rich dashboard design and ATS-adjacent HR tool work. Research-driven process with quantified impact. Deep Figma and design systems expertise. AI shortlist.",
  },
  {
    candidateIndex: 210,
    status: "new",
    score: 89,
    notes:
      "Strong B2B workflow designer with design sprint facilitation experience and documented 40% onboarding improvement. Portfolio shows complex state management UI. AI shortlist.",
  },
  {
    candidateIndex: 240,
    status: "new",
    score: 88,
    notes:
      "Design system lead at a 150-person SaaS company. Strong cross-functional pairing record, clean Figma component architecture, and accessible-by-default design process. AI shortlist.",
  },
  {
    candidateIndex: 260,
    status: "new",
    score: 87,
    notes:
      "Portfolio showcases complex workflow design for B2B recruitment-adjacent tools with clear problem framing and structured user research methodology. AI shortlist.",
  },
  {
    candidateIndex: 300,
    status: "new",
    score: 86,
    notes:
      "Information architecture and dashboard design specialist with B2B enterprise background. Design-engineering pairing champion with documented handoff improvements. AI shortlist.",
  },

  // Good tier (70–85): Worth screening — AI surfaced these from the pile
  {
    candidateIndex: 151,
    status: "new",
    score: 85,
    notes:
      "Solid portfolio with 5 case studies, strong visual craft and design system depth. B2B SaaS experience with measurable impact metrics on 2 projects.",
  },
  {
    candidateIndex: 181,
    status: "new",
    score: 84,
    notes:
      "Product designer with CRM tool redesign in portfolio. Good research methodology and strong cross-functional collaboration evidence.",
  },
  {
    candidateIndex: 211,
    status: "new",
    score: 83,
    notes:
      "5 years product design experience. Dashboard and data table design specialist. Clear design process documentation with usability testing examples.",
  },
  {
    candidateIndex: 241,
    status: "new",
    score: 82,
    notes:
      "Strong Figma skills and design token system expertise. Portfolio includes workflow automation tool redesign with documented user research.",
  },
  {
    candidateIndex: 261,
    status: "new",
    score: 81,
    notes:
      "Design-engineering background gives unique technical feasibility awareness. Portfolio shows clean, accessible B2B interfaces with good information hierarchy.",
  },
  {
    candidateIndex: 301,
    status: "new",
    score: 80,
    notes:
      "Experienced B2B SaaS designer with enterprise product background. Strong design critique and workshop facilitation skills.",
  },
  {
    candidateIndex: 152,
    status: "new",
    score: 79,
    notes:
      "Clean portfolio with consistent design system application. 4 years at a project management SaaS company. Some user research depth.",
  },
  {
    candidateIndex: 182,
    status: "new",
    score: 78,
    notes:
      "Good product thinking with strong visual craft. Case studies lack some depth but overall profile is solid for a screening call.",
  },
  {
    candidateIndex: 212,
    status: "new",
    score: 77,
    notes:
      "Interesting background in healthcare UX — strong accessibility practices and documented inclusive design process.",
  },
  {
    candidateIndex: 242,
    status: "new",
    score: 76,
    notes:
      "Design system contributions at current employer. Good Figma component architecture. Limited B2B SaaS depth but strong fundamentals.",
  },
  {
    candidateIndex: 262,
    status: "new",
    score: 75,
    notes:
      "Junior-to-mid designer with unusually strong design process for experience level. Portfolio shows genuine product thinking.",
  },
  {
    candidateIndex: 302,
    status: "new",
    score: 74,
    notes:
      "Agency background with B2B SaaS clients. Good breadth across product types. Case studies show solid problem framing.",
  },
  {
    candidateIndex: 153,
    status: "new",
    score: 73,
    notes:
      "Strong visual craft and recent transition to product design from graphic design. Portfolio depth developing.",
  },
  {
    candidateIndex: 183,
    status: "new",
    score: 72,
    notes:
      "Former frontend engineer turned designer. Technical feasibility awareness is a strength; design process still maturing.",
  },
  {
    candidateIndex: 213,
    status: "new",
    score: 71,
    notes:
      "Good research background with 3 published usability studies. Visual design skills are secondary strength.",
  },
  {
    candidateIndex: 243,
    status: "new",
    score: 70,
    notes:
      "Solid mid-level designer. B2B SaaS experience at a smaller company. Portfolio is clean but impact metrics are sparse.",
  },
  {
    candidateIndex: 263,
    status: "new",
    score: 70,
    notes:
      "Good cross-functional collaboration evidence. Portfolio shows consistent design quality but limited workflow-tool or data-rich interface experience.",
  },
  { candidateIndex: 303, status: "new", score: 70 },

  // Moderate tier (50–69): The unreviewed pile — each would take 15-20 min to evaluate manually
  { candidateIndex: 154, status: "new", score: 69 },
  { candidateIndex: 184, status: "new", score: 68 },
  { candidateIndex: 214, status: "new", score: 68 },
  { candidateIndex: 244, status: "new", score: 67 },
  { candidateIndex: 264, status: "new", score: 67 },
  { candidateIndex: 304, status: "new", score: 67 },
  { candidateIndex: 155, status: "new", score: 66 },
  { candidateIndex: 185, status: "new", score: 66 },
  { candidateIndex: 215, status: "new", score: 65 },
  { candidateIndex: 245, status: "new", score: 65 },
  { candidateIndex: 265, status: "new", score: 65 },
  { candidateIndex: 305, status: "new", score: 64 },
  { candidateIndex: 156, status: "new", score: 64 },
  { candidateIndex: 186, status: "new", score: 63 },
  { candidateIndex: 216, status: "new", score: 63 },
  { candidateIndex: 246, status: "new", score: 62 },
  { candidateIndex: 266, status: "new", score: 62 },
  { candidateIndex: 306, status: "new", score: 62 },
  { candidateIndex: 157, status: "new", score: 61 },
  { candidateIndex: 187, status: "new", score: 61 },
  { candidateIndex: 217, status: "new", score: 60 },
  { candidateIndex: 247, status: "new", score: 60 },
  { candidateIndex: 267, status: "new", score: 60 },
  { candidateIndex: 307, status: "new", score: 59 },
  { candidateIndex: 158, status: "new", score: 59 },
  { candidateIndex: 188, status: "new", score: 58 },
  { candidateIndex: 218, status: "new", score: 58 },
  { candidateIndex: 248, status: "new", score: 57 },
  { candidateIndex: 268, status: "new", score: 57 },
  { candidateIndex: 308, status: "new", score: 57 },
  { candidateIndex: 159, status: "new", score: 56 },
  { candidateIndex: 189, status: "new", score: 56 },
  { candidateIndex: 219, status: "new", score: 55 },
  { candidateIndex: 249, status: "new", score: 55 },
  { candidateIndex: 269, status: "new", score: 55 },
  { candidateIndex: 309, status: "new", score: 54 },
  { candidateIndex: 160, status: "new", score: 54 },
  { candidateIndex: 190, status: "new", score: 53 },
  { candidateIndex: 220, status: "new", score: 53 },
  { candidateIndex: 250, status: "new", score: 52 },
  { candidateIndex: 270, status: "new", score: 52 },
  { candidateIndex: 310, status: "new", score: 52 },
  { candidateIndex: 161, status: "new", score: 51 },
  { candidateIndex: 191, status: "new", score: 51 },
  { candidateIndex: 221, status: "new", score: 51 },
  { candidateIndex: 251, status: "new", score: 50 },
  { candidateIndex: 271, status: "new", score: 50 },
  { candidateIndex: 311, status: "new", score: 50 },
  { candidateIndex: 162, status: "new", score: 50 },
  { candidateIndex: 192, status: "new", score: 68 },
  { candidateIndex: 222, status: "new", score: 64 },
  { candidateIndex: 252, status: "new", score: 61 },
  { candidateIndex: 272, status: "new", score: 58 },
  { candidateIndex: 312, status: "new", score: 55 },
  { candidateIndex: 163, status: "new", score: 53 },
  { candidateIndex: 193, status: "new", score: 51 },
  { candidateIndex: 223, status: "new", score: 66 },
  { candidateIndex: 253, status: "new", score: 63 },
  { candidateIndex: 273, status: "new", score: 59 },
  { candidateIndex: 313, status: "new", score: 56 },
  { candidateIndex: 164, status: "new", score: 54 },
  { candidateIndex: 194, status: "new", score: 52 },
  { candidateIndex: 224, status: "new", score: 65 },
  { candidateIndex: 254, status: "new", score: 62 },
  { candidateIndex: 274, status: "new", score: 58 },
  { candidateIndex: 314, status: "new", score: 55 },
  { candidateIndex: 165, status: "new", score: 53 },
  { candidateIndex: 195, status: "new", score: 51 },
  { candidateIndex: 225, status: "new", score: 67 },
  { candidateIndex: 255, status: "new", score: 63 },
  { candidateIndex: 275, status: "new", score: 60 },
  { candidateIndex: 315, status: "new", score: 57 },
  { candidateIndex: 166, status: "new", score: 54 },
  { candidateIndex: 196, status: "new", score: 52 },
  { candidateIndex: 226, status: "new", score: 66 },
  { candidateIndex: 256, status: "new", score: 62 },
  { candidateIndex: 276, status: "new", score: 59 },
  { candidateIndex: 316, status: "new", score: 56 },
  { candidateIndex: 167, status: "new", score: 53 },
  { candidateIndex: 197, status: "new", score: 51 },
  { candidateIndex: 227, status: "new", score: 64 },
  { candidateIndex: 257, status: "new", score: 61 },
  { candidateIndex: 277, status: "new", score: 58 },
  { candidateIndex: 317, status: "new", score: 55 },
  { candidateIndex: 168, status: "new", score: 52 },
  { candidateIndex: 198, status: "new", score: 50 },
  { candidateIndex: 228, status: "new", score: 63 },
  { candidateIndex: 258, status: "new", score: 60 },
  { candidateIndex: 278, status: "new", score: 57 },
  { candidateIndex: 318, status: "new", score: 54 },
  { candidateIndex: 169, status: "new", score: 51 },
  { candidateIndex: 199, status: "new", score: 68 },
  { candidateIndex: 229, status: "new", score: 65 },
  { candidateIndex: 259, status: "new", score: 62 },
  { candidateIndex: 279, status: "new", score: 59 },
  { candidateIndex: 319, status: "new", score: 56 },
  { candidateIndex: 170, status: "new", score: 53 },
  { candidateIndex: 200, status: "new", score: 51 },
  { candidateIndex: 230, status: "new", score: 64 },
  { candidateIndex: 320, status: "new", score: 57 },

  // Below average (30–49): AI correctly deprioritised these — would be noise in a manual review
  { candidateIndex: 171, status: "new", score: 49 },
  { candidateIndex: 201, status: "new", score: 48 },
  { candidateIndex: 231, status: "new", score: 47 },
  { candidateIndex: 321, status: "new", score: 46 },
  { candidateIndex: 172, status: "new", score: 48 },
  { candidateIndex: 202, status: "new", score: 47 },
  { candidateIndex: 232, status: "new", score: 46 },
  { candidateIndex: 322, status: "new", score: 45 },
  { candidateIndex: 173, status: "new", score: 47 },
  { candidateIndex: 203, status: "new", score: 46 },
  { candidateIndex: 233, status: "new", score: 45 },
  { candidateIndex: 323, status: "new", score: 44 },
  { candidateIndex: 174, status: "new", score: 46 },
  { candidateIndex: 204, status: "new", score: 45 },
  { candidateIndex: 234, status: "new", score: 44 },
  { candidateIndex: 324, status: "new", score: 43 },
  { candidateIndex: 175, status: "new", score: 45 },
  { candidateIndex: 205, status: "new", score: 44 },
  { candidateIndex: 235, status: "new", score: 43 },
  { candidateIndex: 325, status: "new", score: 42 },
  { candidateIndex: 176, status: "new", score: 44 },
  { candidateIndex: 206, status: "new", score: 43 },
  { candidateIndex: 236, status: "new", score: 42 },
  { candidateIndex: 326, status: "new", score: 41 },
  { candidateIndex: 177, status: "new", score: 43 },
  { candidateIndex: 207, status: "new", score: 42 },
  { candidateIndex: 237, status: "new", score: 41 },
  { candidateIndex: 327, status: "new", score: 40 },
  { candidateIndex: 178, status: "new", score: 42 },
  { candidateIndex: 208, status: "new", score: 41 },
  { candidateIndex: 238, status: "new", score: 40 },
  { candidateIndex: 328, status: "new", score: 39 },
  { candidateIndex: 179, status: "new", score: 41 },
  { candidateIndex: 209, status: "new", score: 40 },
  { candidateIndex: 239, status: "new", score: 39 },
  { candidateIndex: 329, status: "new", score: 38 },
  { candidateIndex: 330, status: "new", score: 49 },
  { candidateIndex: 331, status: "new", score: 47 },
  { candidateIndex: 332, status: "new", score: 46 },
  { candidateIndex: 333, status: "new", score: 45 },
  { candidateIndex: 334, status: "new", score: 44 },
  { candidateIndex: 335, status: "new", score: 43 },
  { candidateIndex: 336, status: "new", score: 42 },
  { candidateIndex: 337, status: "new", score: 41 },
  { candidateIndex: 338, status: "new", score: 40 },
  { candidateIndex: 339, status: "new", score: 39 },
  { candidateIndex: 340, status: "new", score: 38 },
  { candidateIndex: 341, status: "new", score: 37 },
  { candidateIndex: 342, status: "new", score: 36 },
  { candidateIndex: 343, status: "new", score: 35 },
  { candidateIndex: 344, status: "new", score: 34 },
  { candidateIndex: 345, status: "new", score: 33 },
  { candidateIndex: 346, status: "new", score: 32 },
  { candidateIndex: 347, status: "new", score: 31 },
  { candidateIndex: 348, status: "new", score: 30 },
  { candidateIndex: 349, status: "new", score: 30 },

  // Poor fit (<30): Clear mismatches the AI correctly buried at the bottom
  { candidateIndex: 350, status: "new", score: 29 },
  { candidateIndex: 351, status: "new", score: 27 },
  { candidateIndex: 352, status: "new", score: 25 },
  { candidateIndex: 353, status: "new", score: 24 },
  { candidateIndex: 354, status: "new", score: 22 },
  { candidateIndex: 355, status: "new", score: 21 },
  { candidateIndex: 356, status: "new", score: 20 },
  { candidateIndex: 357, status: "new", score: 19 },
  { candidateIndex: 358, status: "new", score: 18 },
  { candidateIndex: 359, status: "new", score: 17 },
  { candidateIndex: 360, status: "new", score: 29 },
  { candidateIndex: 361, status: "new", score: 26 },
  { candidateIndex: 362, status: "new", score: 23 },
  { candidateIndex: 363, status: "new", score: 21 },
  { candidateIndex: 364, status: "new", score: 19 },
  { candidateIndex: 365, status: "new", score: 17 },
  { candidateIndex: 366, status: "new", score: 16 },
  { candidateIndex: 367, status: "new", score: 15 },
  { candidateIndex: 368, status: "new", score: 14 },
  { candidateIndex: 369, status: "new", score: 13 },
  { candidateIndex: 370, status: "new", score: 28 },
  { candidateIndex: 371, status: "new", score: 25 },
  { candidateIndex: 372, status: "new", score: 22 },
  { candidateIndex: 373, status: "new", score: 20 },
  { candidateIndex: 374, status: "new", score: 18 },
  { candidateIndex: 375, status: "new", score: 16 },
  { candidateIndex: 376, status: "new", score: 15 },
  { candidateIndex: 377, status: "new", score: 14 },
  { candidateIndex: 378, status: "new", score: 13 },
  { candidateIndex: 379, status: "new", score: 11 },

  // Second-week overflow: realistic follow-up volume after the post keeps circulating
  // A few have already been pulled into screening, most remain ranked in the pile,
  // and several obvious mismatches have already been bulk-triaged out.
  {
    candidateIndex: 400,
    status: "screening",
    score: 84,
    notes:
      "Strong B2B SaaS portfolio with polished workflow redesigns. Recruiter screen completed; portfolio walkthrough pending.",
  },
  {
    candidateIndex: 401,
    status: "screening",
    score: 82,
    notes:
      "Excellent dashboard and admin-tool work. Good design-system evidence and solid collaboration examples.",
  },
  {
    candidateIndex: 402,
    status: "screening",
    score: 78,
    notes:
      "Strong research cadence and accessibility instincts. Validating depth of data-dense interface work.",
  },
  {
    candidateIndex: 403,
    status: "screening",
    score: 76,
    notes:
      "Former product analyst turned designer with clear problem framing. Worth a closer portfolio review.",
  },
  {
    candidateIndex: 404,
    status: "new",
    score: 74,
    notes:
      "Good mid-level product designer with 4 B2B case studies. AI surfaced as worth a manual screen if shortlist needs backup options.",
  },
  {
    candidateIndex: 405,
    status: "new",
    score: 72,
    notes:
      "Strong visual craft and solid Figma systems work, but less evidence of end-to-end discovery ownership.",
  },
  { candidateIndex: 406, status: "new", score: 69 },
  { candidateIndex: 407, status: "new", score: 66 },
  { candidateIndex: 408, status: "new", score: 63 },
  { candidateIndex: 409, status: "new", score: 61 },
  { candidateIndex: 410, status: "new", score: 48 },
  { candidateIndex: 411, status: "new", score: 44 },
  { candidateIndex: 412, status: "new", score: 39 },
  { candidateIndex: 413, status: "new", score: 31 },

  // Already rejected — quick triaging confirmed AI scores (26 candidates)
  {
    candidateIndex: 380,
    status: "rejected",
    score: 44,
    notes:
      "Portfolio is exclusively print and brand identity — no product or digital UX work.",
  },
  {
    candidateIndex: 381,
    status: "rejected",
    score: 38,
    notes:
      "Motion designer applying for product design role — skills mismatch.",
  },
  {
    candidateIndex: 382,
    status: "rejected",
    score: 29,
    notes:
      "No portfolio link provided and no UX work described in application.",
  },
  {
    candidateIndex: 383,
    status: "rejected",
    score: 35,
    notes:
      "Social media and content design background with no product design case studies.",
  },
  {
    candidateIndex: 384,
    status: "rejected",
    score: 47,
    notes:
      "Illustrator and 2D animation background — no UX or product design experience.",
  },
  {
    candidateIndex: 385,
    status: "rejected",
    score: 22,
    notes:
      "No design tools experience listed. Application letter suggests confusion with a marketing role.",
  },
  {
    candidateIndex: 386,
    status: "rejected",
    score: 41,
    notes:
      "Interior design background. Applying to multiple unrelated roles simultaneously.",
  },
  {
    candidateIndex: 387,
    status: "rejected",
    score: 33,
    notes: "Fashion design graduate with no digital product or UX experience.",
  },
  {
    candidateIndex: 388,
    status: "rejected",
    score: 48,
    notes:
      "Junior designer with 6 months freelance only — well below 3-year requirement.",
  },
  {
    candidateIndex: 389,
    status: "rejected",
    score: 26,
    notes:
      "Portfolio shows Canva-created social media graphics only. No Figma or product design work.",
  },
  {
    candidateIndex: 390,
    status: "rejected",
    score: 39,
    notes:
      "Game UI designer with no B2B or SaaS product experience. Limited information architecture depth.",
  },
  {
    candidateIndex: 391,
    status: "rejected",
    score: 43,
    notes:
      "Graphic designer transitioning to UX — enrolled in bootcamp but no completed product design projects.",
  },
  {
    candidateIndex: 392,
    status: "rejected",
    score: 31,
    notes:
      "Marketing manager applying for design role — no design tool proficiency mentioned.",
  },
  {
    candidateIndex: 393,
    status: "rejected",
    score: 37,
    notes:
      "Portfolio shows only landing page and hero section design — no end-to-end product work.",
  },
  {
    candidateIndex: 394,
    status: "rejected",
    score: 45,
    notes:
      "Photo editor and retoucher by background. No UX process, research, or digital product case studies.",
  },
  {
    candidateIndex: 395,
    status: "rejected",
    score: 28,
    notes:
      "Salary expectation significantly outside budget. Role requires EU remote eligibility; candidate based outside EU.",
  },
  {
    candidateIndex: 396,
    status: "rejected",
    score: 42,
    notes:
      "Applied for multiple design and development roles simultaneously — generic application with no tailoring.",
  },
  {
    candidateIndex: 397,
    status: "rejected",
    score: 36,
    notes:
      "UX researcher background without design execution skills — role requires end-to-end design delivery.",
  },
  {
    candidateIndex: 398,
    status: "rejected",
    score: 30,
    notes:
      "Industrial product design background — physical products only, no digital UI/UX experience.",
  },
  {
    candidateIndex: 399,
    status: "rejected",
    score: 24,
    notes:
      "Broken portfolio link. No GitHub, Behance, or Dribbble provided. Unable to evaluate design work.",
  },
  {
    candidateIndex: 414,
    status: "rejected",
    score: 46,
    notes:
      "Strong marketing site and brand work, but no evidence of product workflow design or usability testing.",
  },
  {
    candidateIndex: 415,
    status: "rejected",
    score: 43,
    notes:
      "UI-heavy portfolio with polished shots but little explanation of problem framing, iteration, or collaboration.",
  },
  {
    candidateIndex: 416,
    status: "rejected",
    score: 38,
    notes:
      "Service designer background with workshops only; no shipped digital product interfaces shown.",
  },
  {
    candidateIndex: 417,
    status: "rejected",
    score: 34,
    notes:
      "Mostly ecommerce banner and lifecycle email design. Limited product systems or UX depth.",
  },
  {
    candidateIndex: 418,
    status: "rejected",
    score: 29,
    notes:
      "Candidate is outside the EU remote hiring zone and noted no overlap with CET working hours.",
  },
  {
    candidateIndex: 419,
    status: "rejected",
    score: 22,
    notes:
      "Application is incomplete: no portfolio password supplied and answers are one-line placeholders.",
  },
];

// Job 2: DevOps Engineer — healthy pipeline for a contract position
const JOB_2_APPS: ApplicationAssignment[] = [
  {
    candidateIndex: 5,
    status: "hired",
    score: 94,
    notes:
      "Strong container orchestration and observability setup. Contract signed.",
  },
  {
    candidateIndex: 6,
    status: "offer",
    score: 90,
    notes: "Excellent platform reliability background. Offer sent.",
  },
  {
    candidateIndex: 7,
    status: "interview",
    score: 85,
    notes: "Deep CI/CD experience. Final technical interview scheduled.",
  },
  {
    candidateIndex: 8,
    status: "interview",
    score: 83,
    notes: "Strong automation mindset and incident response examples.",
  },
  {
    candidateIndex: 9,
    status: "screening",
    score: 79,
    notes: "Good cloud fundamentals. Validating production ownership scope.",
  },
  {
    candidateIndex: 10,
    status: "screening",
    score: 76,
    notes: "Relevant Docker and IaC stack. Recruiter follow-up pending.",
  },
  {
    candidateIndex: 26,
    status: "new",
    score: 72,
    notes: "Promising profile. Awaiting first availability window.",
  },
  { candidateIndex: 27, status: "new", score: 70 },
  { candidateIndex: 28, status: "new", score: 67 },
  {
    candidateIndex: 29,
    status: "rejected",
    score: 45,
    notes:
      "Skillset weighted toward support operations, limited platform engineering depth.",
  },
  {
    candidateIndex: 13,
    status: "rejected",
    score: 40,
    notes:
      "Primary experience with legacy on-prem tooling; limited cloud-native track record.",
  },
];

// Job 3: Technical Writer — consistent pipeline quality
const JOB_3_APPS: ApplicationAssignment[] = [
  {
    candidateIndex: 12,
    status: "offer",
    score: 90,
    notes:
      "Clear, structured writing samples and strong docs-as-code workflow.",
  },
  {
    candidateIndex: 14,
    status: "interview",
    score: 86,
    notes: "Great API documentation examples and editorial discipline.",
  },
  {
    candidateIndex: 16,
    status: "interview",
    score: 83,
    notes:
      "Strong technical depth and clean information architecture approach.",
  },
  {
    candidateIndex: 18,
    status: "screening",
    score: 78,
    notes: "Good writing quality; validating long-form technical ownership.",
  },
  {
    candidateIndex: 20,
    status: "screening",
    score: 75,
    notes: "Strong communication style. Intro call booked.",
  },
  { candidateIndex: 22, status: "new", score: 72 },
  { candidateIndex: 24, status: "new", score: 69 },
  { candidateIndex: 26, status: "new", score: 66 },
  {
    candidateIndex: 28,
    status: "rejected",
    score: 49,
    notes: "Writing portfolio is mostly social and campaign content.",
  },
  {
    candidateIndex: 29,
    status: "rejected",
    score: 43,
    notes: "Limited experience with developer-focused documentation.",
  },
];

// Job 4: Frontend Engineering Intern — active early-career funnel
const JOB_4_APPS: ApplicationAssignment[] = [
  {
    candidateIndex: 0,
    status: "interview",
    score: 88,
    notes:
      "Impressive internship project quality and thoughtful code reviews in GitHub profile.",
  },
  {
    candidateIndex: 2,
    status: "interview",
    score: 84,
    notes:
      "Strong fundamentals in Vue and Tailwind. Team fit interview scheduled.",
  },
  {
    candidateIndex: 4,
    status: "screening",
    score: 79,
    notes: "Good learning velocity and clean component architecture examples.",
  },
  {
    candidateIndex: 6,
    status: "screening",
    score: 76,
    notes: "Strong front-end fundamentals; evaluating SSR understanding.",
  },
  {
    candidateIndex: 11,
    status: "screening",
    score: 74,
    notes: "Promising portfolio with clear UX thinking for early-career level.",
  },
  { candidateIndex: 15, status: "new", score: 71 },
  { candidateIndex: 17, status: "new", score: 69 },
  { candidateIndex: 19, status: "new", score: 67 },
  { candidateIndex: 21, status: "new", score: 65 },
  {
    candidateIndex: 23,
    status: "rejected",
    score: 46,
    notes:
      "Limited JavaScript fundamentals demonstrated in practical assessment.",
  },
];

const ALL_JOB_APPLICATIONS = [
  JOB_0_APPS,
  JOB_1_APPS,
  JOB_2_APPS,
  JOB_3_APPS,
  JOB_4_APPS,
];

/**
 * The pipeline defaults to "Highest score", so seed only the records a demo
 * visitor can meaningfully inspect at the top of every job/status combination.
 */
const JOB_APPLICATIONS = ALL_JOB_APPLICATIONS.map((applications) =>
  selectTopApplicationsPerStatus(
    applications,
    DEMO_APPLICATIONS_PER_STATUS,
  ),
);

const DEMO_CANDIDATE_INDICES = [
  ...new Set(
    JOB_APPLICATIONS.flatMap((applications) =>
      applications.map((application) => application.candidateIndex),
    ),
  ),
].sort((left, right) => left - right);

const DEMO_APPLICATION_KEYS = new Set(
  JOB_APPLICATIONS.flatMap((applications, jobIndex) =>
    applications.map(
      (application) => `${jobIndex}-${application.candidateIndex}`,
    ),
  ),
);

// ─────────────────────────────────────────────
// AI Scoring — Criteria definitions per job
// ─────────────────────────────────────────────

type CriterionCategory =
  | "technical"
  | "experience"
  | "soft_skills"
  | "education"
  | "culture"
  | "custom";

interface ScoringCriterionSeed {
  key: string;
  name: string;
  description: string;
  category: CriterionCategory;
  maxScore: number;
  weight: number;
  displayOrder: number;
}

// Job 0: Senior Full-Stack Engineer — technical rubric
const JOB_0_CRITERIA: ScoringCriterionSeed[] = [
  {
    key: "core_tech_stack",
    name: "Core Tech Stack Match",
    description:
      "How well the candidate's technical skills match TypeScript, Vue/Nuxt, and PostgreSQL — the primary technologies required for this role.",
    category: "technical",
    maxScore: 10,
    weight: 70,
    displayOrder: 0,
  },
  {
    key: "system_design",
    name: "System Design & Architecture",
    description:
      "Evidence of system design experience including multi-tenant architecture, scalability thinking, and architectural decision-making in production systems.",
    category: "technical",
    maxScore: 10,
    weight: 55,
    displayOrder: 1,
  },
  {
    key: "engineering_practices",
    name: "Engineering Practices",
    description:
      "Testing discipline, CI/CD experience, code review culture, documentation habits, and software development lifecycle maturity.",
    category: "technical",
    maxScore: 10,
    weight: 40,
    displayOrder: 2,
  },
  {
    key: "relevant_experience",
    name: "Relevant Experience",
    description:
      "Years and depth of experience shipping production web applications, ideally in B2B SaaS, internal tools, or workflow-heavy products.",
    category: "experience",
    maxScore: 10,
    weight: 50,
    displayOrder: 3,
  },
  {
    key: "leadership_collab",
    name: "Leadership & Collaboration",
    description:
      "Evidence of mentoring, tech leadership, cross-team collaboration, and clear communication in cross-functional settings.",
    category: "soft_skills",
    maxScore: 10,
    weight: 30,
    displayOrder: 4,
  },
];

// Job 1: Product Designer — design-specific rubric
const JOB_1_CRITERIA: ScoringCriterionSeed[] = [
  {
    key: "portfolio_quality",
    name: "Portfolio Quality & Impact",
    description:
      "Depth and quality of design portfolio, demonstrating end-to-end problem-solving, measurable business outcomes, and polished deliverables.",
    category: "experience",
    maxScore: 10,
    weight: 70,
    displayOrder: 0,
  },
  {
    key: "design_process",
    name: "Design Process & Research",
    description:
      "Evidence of structured design thinking: user research methods, discovery, ideation, prototyping, usability testing, and iteration based on data.",
    category: "soft_skills",
    maxScore: 10,
    weight: 55,
    displayOrder: 1,
  },
  {
    key: "ux_visual_craft",
    name: "UX & Visual Craft",
    description:
      "Quality of information architecture, interaction design, visual hierarchy, and attention to accessibility and design system consistency.",
    category: "technical",
    maxScore: 10,
    weight: 50,
    displayOrder: 2,
  },
  {
    key: "cross_functional",
    name: "Cross-Functional Collaboration",
    description:
      "Ability to partner effectively with engineering, product, and stakeholders. Evidence of clear design handoff and communication practices.",
    category: "soft_skills",
    maxScore: 10,
    weight: 40,
    displayOrder: 3,
  },
  {
    key: "domain_knowledge",
    name: "B2B SaaS & Product Thinking",
    description:
      "Relevant experience designing data-rich interfaces, workflow tools, or B2B SaaS products. Understanding of business context and user needs.",
    category: "experience",
    maxScore: 10,
    weight: 35,
    displayOrder: 4,
  },
];

// Job 2: DevOps Engineer — infrastructure rubric
const JOB_2_CRITERIA: ScoringCriterionSeed[] = [
  {
    key: "infrastructure",
    name: "Infrastructure & Cloud Expertise",
    description:
      "Depth of experience with container orchestration, cloud platforms, Linux operations, and infrastructure automation (IaC).",
    category: "technical",
    maxScore: 10,
    weight: 65,
    displayOrder: 0,
  },
  {
    key: "cicd_automation",
    name: "CI/CD & Automation",
    description:
      "Hands-on experience building and maintaining CI/CD pipelines, deployment automation, and release workflows at scale.",
    category: "technical",
    maxScore: 10,
    weight: 55,
    displayOrder: 1,
  },
  {
    key: "observability",
    name: "Observability & Incident Response",
    description:
      "Experience setting up monitoring, alerting, dashboards, runbooks, and structured incident response practices.",
    category: "technical",
    maxScore: 10,
    weight: 45,
    displayOrder: 2,
  },
  {
    key: "security_compliance",
    name: "Security & Compliance",
    description:
      "Understanding of TLS, secrets management, network security, backup/restore practices, and compliance-sensitive workloads.",
    category: "technical",
    maxScore: 10,
    weight: 40,
    displayOrder: 3,
  },
  {
    key: "relevant_experience",
    name: "Relevant Experience",
    description:
      "Years and depth of DevOps or platform engineering experience, ideally supporting SaaS products or self-hosted enterprise deployments.",
    category: "experience",
    maxScore: 10,
    weight: 45,
    displayOrder: 4,
  },
];

const JOB_CRITERIA = [JOB_0_CRITERIA, JOB_1_CRITERIA, JOB_2_CRITERIA];

// ─────────────────────────────────────────────
// AI Scoring — Per-application criterion scores
// Each entry scores one application across all criteria for its job.
// ─────────────────────────────────────────────

interface CriterionScoreSeed {
  criterionKey: string;
  maxScore: number;
  applicantScore: number;
  confidence: number;
  evidence: string;
  strengths: string[];
  gaps: string[];
}

interface ApplicationScoringSeed {
  jobIndex: number;
  candidateIndex: number;
  compositeScore: number;
  scores: CriterionScoreSeed[];
  summary: string;
}

const AI_SCORING_DATA: ApplicationScoringSeed[] = [
  // ──────────────────────────────────────────
  // Job 0: Senior Full-Stack Engineer
  // ──────────────────────────────────────────

  // Emma Schmidt (hired, score: 96)
  {
    jobIndex: 0,
    candidateIndex: 0,
    compositeScore: 96,
    summary:
      "Exceptional candidate with deep full-stack expertise across TypeScript, Vue/Nuxt, and PostgreSQL. Demonstrates strong system design thinking with production multi-tenant architecture experience. Clear leadership trajectory and outstanding engineering practices. One of the strongest technical profiles evaluated for this role.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 10,
        confidence: 95,
        evidence:
          "Resume shows 6+ years of daily TypeScript usage across frontend (Vue 3, Nuxt 3) and backend (Node.js, Express). Built and maintained PostgreSQL databases with complex query optimization. Authored internal TypeScript utility libraries used across 3 product teams.",
        strengths: [
          "Expert-level TypeScript with both frontend and backend depth",
          "Production Nuxt 3 experience including SSR and hybrid rendering",
          "Advanced PostgreSQL skills including partitioning and query plan analysis",
        ],
        gaps: [],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 9,
        confidence: 92,
        evidence:
          "Led architecture of a multi-tenant SaaS platform serving 200+ organizations. Designed event-driven workflows with PostgreSQL LISTEN/NOTIFY and Redis pub/sub. Resume explicitly mentions ownership of database schema evolution across 15+ migrations.",
        strengths: [
          "Hands-on multi-tenant architecture experience at scale",
          "Event-driven design patterns with real-world production validation",
          "Strong database modeling and migration management discipline",
        ],
        gaps: [
          "No explicit mention of distributed systems or microservices decomposition",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 10,
        confidence: 93,
        evidence:
          "Resume highlights 95%+ test coverage targets on core modules, GitHub Actions CI/CD pipelines with automated canary deployments, and structured code review process mentoring 4 junior engineers.",
        strengths: [
          "Automated testing champion with measurable coverage targets",
          "CI/CD pipeline design with progressive rollout strategies",
          "Active code review mentor fostering team quality standards",
        ],
        gaps: [],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "7 years of production web application development. Last 4 years at B2B SaaS companies building workflow-heavy internal tools. Previous role involved building a recruitment-adjacent HR platform, directly relevant to Reqcore's domain.",
        strengths: [
          "7 years of progressive web development experience",
          "B2B SaaS background with workflow-heavy product experience",
          "Direct HR/recruitment domain experience from previous role",
        ],
        gaps: ["No open-source project maintainership mentioned"],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 9,
        confidence: 88,
        evidence:
          'Mentored 4 junior engineers over 2 years with structured growth plans. Led cross-functional feature squads with product managers and designers. Resume notes "drove technical decision-making in architecture reviews across 3 teams."',
        strengths: [
          "Structured mentoring with documented growth outcomes",
          "Cross-functional squad leadership with product and design",
          "Technical decision-making influence across multiple teams",
        ],
        gaps: ["No formal engineering management or people leadership title"],
      },
    ],
  },

  // Liam Müller (offer, score: 92)
  {
    jobIndex: 0,
    candidateIndex: 1,
    compositeScore: 92,
    summary:
      "Very strong senior engineer with excellent systems thinking and pragmatic technical decision-making. Deep PostgreSQL optimization knowledge and solid full-stack delivery track record. Minor gap in frontend framework depth but compensated by outstanding backend architecture skills.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          "Resume shows 5 years of TypeScript backend development with Node.js and extensive PostgreSQL expertise. Vue experience limited to 1.5 years but includes Nuxt 2 → 3 migration. Strong database layer with custom ORM abstractions.",
        strengths: [
          "Deep TypeScript backend expertise with type-safe API design",
          "Strong PostgreSQL skills including performance tuning and indexing strategies",
          "Hands-on Nuxt migration experience showing modern framework adoption",
        ],
        gaps: [
          "Vue/Nuxt experience (1.5 years) is less deep than backend skills",
        ],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 9,
        confidence: 93,
        evidence:
          "Architected a real-time collaboration platform handling 10K concurrent WebSocket connections. Designed caching strategies reducing P95 latency by 60%. Resume mentions leading database sharding evaluation for a growing multi-tenant product.",
        strengths: [
          "Real-time system design with proven scalability metrics",
          "Performance optimization with measurable latency improvements",
          "Database scaling strategy experience at multi-tenant level",
        ],
        gaps: [
          "No mention of infrastructure-as-code or deployment architecture ownership",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 8,
        confidence: 87,
        evidence:
          "Implemented integration testing framework that caught 40% more issues before production. Active code reviewer with documented review guidelines. CI pipeline work mentioned but limited detail on deployment automation.",
        strengths: [
          "Integration testing framework builder with measurable quality impact",
          "Code review culture contributor with written guidelines",
          "Quality-focused engineering mindset with data-driven approach",
        ],
        gaps: [
          "Limited detail on CI/CD pipeline design and deployment automation",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "6 years shipping production web applications. 3 years in B2B SaaS with multi-tenant data isolation requirements. Previous role at a project management tool company building complex workflow features.",
        strengths: [
          "6 years of production web development across multiple companies",
          "B2B SaaS experience with multi-tenant architecture challenges",
          "Workflow-heavy product background directly relevant to ATS domain",
        ],
        gaps: ["No direct HR/recruitment industry experience"],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          "Led a team of 3 on a critical platform migration project. Resume mentions regular cross-functional collaboration with product managers. Presented technical decisions to engineering leadership quarterly.",
        strengths: [
          "Project-level technical leadership with team coordination",
          "Regular cross-functional collaboration with product stakeholders",
          "Technical communication to leadership through structured presentations",
        ],
        gaps: [
          "No explicit mentoring or coaching of junior engineers mentioned",
        ],
      },
    ],
  },

  // Sofia Dubois (offer, score: 89)
  {
    jobIndex: 0,
    candidateIndex: 2,
    compositeScore: 89,
    summary:
      "Strong backend-leaning full-stack engineer with clean code discipline and excellent testing habits. Solid PostgreSQL and TypeScript skills with a thoughtful approach to API design. Frontend skills are developing and cover letter shows genuine motivation for the open-source mission.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 8,
        confidence: 88,
        evidence:
          "Resume shows 5 years of TypeScript with strong backend depth. Vue experience spans 2 years with component library contributions. PostgreSQL is a clear strength with query optimization and schema design examples.",
        strengths: [
          "Strong TypeScript proficiency across full stack",
          "2 years of Vue with component library contributions",
          "PostgreSQL schema design and query optimization experience",
        ],
        gaps: ["No production Nuxt/SSR experience mentioned"],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          "Designed RESTful API architecture for a multi-service e-commerce platform. Resume mentions database modeling for complex order workflows and event sourcing patterns.",
        strengths: [
          "API architecture design for complex business domains",
          "Event sourcing patterns for audit trail and state management",
          "Database modeling for workflow-heavy applications",
        ],
        gaps: [
          "No explicit multi-tenant architecture experience",
          "Limited evidence of scalability testing or capacity planning",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          'Resume highlights "test-driven development advocate" with unit, integration, and E2E test coverage. Authored team testing guidelines. Active open-source contributor with clean commit history and documentation.',
        strengths: [
          "Strong TDD advocate with comprehensive test coverage approach",
          "Open-source contributor demonstrating code quality standards",
          "Authored testing guidelines adopted by the engineering team",
        ],
        gaps: [],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          "5 years of production web development. Previous roles focused on e-commerce and fintech platforms. Cover letter specifically mentions motivation to work on open-source ATS software.",
        strengths: [
          "5 years of production web application experience",
          "Complex domain experience in e-commerce and fintech",
          "Genuine motivation for the open-source recruitment space",
        ],
        gaps: ["No direct B2B SaaS or HR/recruitment domain experience"],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          'Resume mentions "paired with designers on UX reviews" and "participated in architecture decision records." No formal leadership or mentoring roles listed.',
        strengths: [
          "Cross-functional collaboration with design team",
          "Participation in architecture decision processes",
        ],
        gaps: [
          "No formal mentoring or leadership responsibilities mentioned",
          "Limited evidence of driving technical decisions independently",
        ],
      },
    ],
  },

  // Noah van der Berg (interview, score: 86)
  {
    jobIndex: 0,
    candidateIndex: 3,
    compositeScore: 86,
    summary:
      "Solid senior engineer with strong multi-tenant SaaS background and practical TypeScript skills. Good breadth across the stack with particular strength in backend services and database design. Advancing to architecture round based on relevant experience profile.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          "Resume shows 4 years of TypeScript development. Built REST and GraphQL APIs with Node.js. Vue 3 experience at current role. PostgreSQL with row-level security for multi-tenant isolation.",
        strengths: [
          "TypeScript across both API and frontend layers",
          "PostgreSQL row-level security for multi-tenant data isolation",
          "Both REST and GraphQL API experience",
        ],
        gaps: [
          "No Nuxt framework experience mentioned",
          "Vue experience limited to current role (1 year)",
        ],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          "Designed tenant isolation strategy using PostgreSQL RLS policies. Resume mentions microservice decomposition for a payments platform and message queue architectures.",
        strengths: [
          "Multi-tenant isolation design with PostgreSQL RLS",
          "Microservice architecture experience in payments domain",
          "Message queue architecture for async processing",
        ],
        gaps: [
          "Limited detail on performance optimization or scalability metrics",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 7,
        confidence: 82,
        evidence:
          'Resume lists "automated test suites" and "Docker-based development environments." Mentions code review participation but limited detail on testing philosophy or CI/CD pipelines.',
        strengths: [
          "Automated testing with Docker-based dev environments",
          "Active code review participant",
        ],
        gaps: [
          "Limited detail on testing strategy and coverage approaches",
          "No specific CI/CD pipeline design experience mentioned",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 9,
        confidence: 89,
        evidence:
          "6 years of web development. Last 3 years exclusively in multi-tenant B2B SaaS environments. Previous experience at a fintech startup building compliance-heavy workflow features.",
        strengths: [
          "3 years of dedicated multi-tenant B2B SaaS experience",
          "Workflow-heavy product experience in compliance-sensitive domains",
          "6 years of progressive web development career",
        ],
        gaps: ["No direct HR/recruitment domain exposure"],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 7,
        confidence: 78,
        evidence:
          'Resume mentions "cross-team API design reviews" and "onboarded 2 new team members." No formal tech lead or mentoring role described.',
        strengths: [
          "Cross-team API design review participation",
          "New team member onboarding experience",
        ],
        gaps: [
          "No formal tech lead or mentoring responsibilities",
          "Limited evidence of driving strategic technical decisions",
        ],
      },
    ],
  },

  // Olivia Rossi (interview, score: 84)
  {
    jobIndex: 0,
    candidateIndex: 4,
    compositeScore: 84,
    summary:
      "Consistent full-stack engineer with solid frontend depth and growing backend capabilities. Clean coding style with good component architecture thinking. Needs more evidence of senior-level system design ownership but shows strong potential.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          "Resume shows 4 years of TypeScript with strong Vue 3 expertise. Built a component library used across 3 products. PostgreSQL experience through backend API development. No explicit Nuxt production usage.",
        strengths: [
          "Strong Vue 3 expertise with shared component library ownership",
          "4 years of TypeScript development across the stack",
          "PostgreSQL experience through API development",
        ],
        gaps: ["No production Nuxt or SSR framework experience"],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 7,
        confidence: 78,
        evidence:
          "Resume mentions contributing to architecture discussions and designing a notification service. Limited evidence of full system ownership or multi-tenant design experience.",
        strengths: [
          "Notification service design as an independent module",
          "Active contributor to architecture discussions",
        ],
        gaps: [
          "No multi-tenant architecture experience mentioned",
          "Limited evidence of end-to-end system design ownership",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          'Resume highlights Vitest and Playwright testing experience. Mentions "automated visual regression testing pipeline" and consistent code review participation.',
        strengths: [
          "Modern testing stack with Vitest and Playwright",
          "Visual regression testing pipeline implementation",
          "Consistent code review engagement",
        ],
        gaps: ["No mention of CI/CD pipeline design or deployment strategies"],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 7,
        confidence: 82,
        evidence:
          "4 years of production web development. Currently at a B2B analytics platform. Previous experience at a marketing automation startup.",
        strengths: [
          "B2B product experience at an analytics platform",
          "Startup environment adaptability and broad scope of work",
        ],
        gaps: [
          "4 years total may be light for a senior role",
          "No direct workflow-tool or HR domain experience",
        ],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 7,
        confidence: 76,
        evidence:
          'Resume mentions "design pairing sessions" and "sprint planning facilitation." Lead on component library project but no direct reports or mentoring described.',
        strengths: [
          "Cross-functional pairing sessions with designers",
          "Component library ownership showing initiative",
        ],
        gaps: [
          "No mentoring or coaching experience mentioned",
          "Sprint facilitation is not technical leadership depth",
        ],
      },
    ],
  },

  // James O'Brien (interview, score: 81)
  {
    jobIndex: 0,
    candidateIndex: 5,
    compositeScore: 81,
    summary:
      "Good full-stack generalist with broad technology exposure and positive collaboration signals. TypeScript skills are solid, but Vue/Nuxt experience is nascent. Backend strength compensates for frontend gaps. Worth exploring further in the technical interview.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          'Resume shows 4 years of TypeScript primarily on the backend with Express and Fastify. React experience noted but Vue is listed under "learning." PostgreSQL usage confirmed through API development.',
        strengths: [
          "Strong TypeScript backend skills with Express and Fastify",
          "PostgreSQL experience through production API work",
          "Active learner with Vue listed as current focus",
        ],
        gaps: [
          "No production Vue or Nuxt experience — currently learning",
          "Frontend framework experience is React-based, not Vue",
        ],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 7,
        confidence: 77,
        evidence:
          'Resume mentions "designed API gateway for microservice mesh" and "database schema for tenant-scoped billing system." Shows system thinking but limited detail on scale or complexity.',
        strengths: [
          "API gateway design for microservice architecture",
          "Tenant-scoped database schema design experience",
        ],
        gaps: [
          "Limited detail on system scale or performance metrics",
          "No end-to-end architecture ownership described",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 7,
        confidence: 79,
        evidence:
          "Resume lists Jest and Supertest for API testing. Mentions Docker Compose setups for local development. GitHub Actions experience but limited CI/CD design detail.",
        strengths: [
          "API testing discipline with Jest and Supertest",
          "Docker Compose for reproducible development environments",
        ],
        gaps: [
          "Limited CI/CD pipeline design detail",
          "No mention of E2E or integration testing frameworks",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 7,
        confidence: 81,
        evidence:
          "5 years of web development across 3 companies. Mix of B2B and B2C experience. No direct SaaS or HR domain background.",
        strengths: [
          "5 years of diverse production web development",
          "Multi-company experience showing adaptability",
        ],
        gaps: [
          "Mixed B2B/B2C without deep SaaS specialization",
          "No HR or recruitment domain background",
        ],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 7,
        confidence: 75,
        evidence:
          'Resume mentions "collaborated with product on feature scoping" and "documented API contracts for partner integrations." No formal leadership titles or mentoring.',
        strengths: [
          "Product collaboration on feature scoping",
          "API documentation for partner integrations",
        ],
        gaps: [
          "No formal leadership or mentoring experience",
          "Limited evidence of driving technical strategy",
        ],
      },
    ],
  },

  // Amara Okafor (screening, score: 78)
  {
    jobIndex: 0,
    candidateIndex: 6,
    compositeScore: 78,
    summary:
      "Promising candidate with relevant multi-tenant SaaS experience and a solid TypeScript foundation. Resume shows depth in backend services with growing frontend skills. Scheduling technical screen to validate architecture understanding.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 7,
        confidence: 76,
        evidence:
          'Resume lists TypeScript (3 years), Node.js backend development, and PostgreSQL. Vue mentioned as "used in current project" without depth indicators. No Nuxt experience.',
        strengths: [
          "3 years of TypeScript with backend focus",
          "PostgreSQL production usage confirmed",
        ],
        gaps: [
          "Vue experience appears shallow — current project only",
          "No Nuxt or SSR framework experience",
        ],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 7,
        confidence: 74,
        evidence:
          'Resume mentions "contributed to tenant isolation design" and "designed queue-based notification service." Shows system design exposure but in a contributing rather than leading capacity.',
        strengths: [
          "Multi-tenant design contribution experience",
          "Queue-based service design for notifications",
        ],
        gaps: [
          "Contributing rather than leading architecture decisions",
          "Limited scale or complexity indicators",
        ],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 7,
        confidence: 75,
        evidence:
          "Resume mentions automated testing and Docker development environments. Limited detail on testing strategy or CI/CD pipeline ownership.",
        strengths: [
          "Automated testing awareness",
          "Docker-based development workflow",
        ],
        gaps: [
          "Limited detail on testing depth and strategies",
          "No CI/CD pipeline ownership mentioned",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 8,
        confidence: 82,
        evidence:
          "4 years of web development. Current role at a multi-tenant SaaS company building B2B collaboration tools. Strong domain relevance for Reqcore.",
        strengths: [
          "Current multi-tenant SaaS experience directly relevant",
          "B2B collaboration tool background matches ATS workflow needs",
        ],
        gaps: ["4 years total experience is moderate for senior level"],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 6,
        confidence: 70,
        evidence:
          'Resume mentions "team standups" and "feature demos to stakeholders." No formal leadership, mentoring, or cross-functional project ownership described.',
        strengths: ["Stakeholder demo experience showing communication skills"],
        gaps: [
          "No mentoring or leadership experience described",
          "No cross-functional project ownership evidence",
        ],
      },
    ],
  },

  // Yuki Tanaka (screening, score: 75)
  {
    jobIndex: 0,
    candidateIndex: 7,
    compositeScore: 75,
    summary:
      "Solid TypeScript backend engineer with good fundamentals. Frontend experience is React-based with no Vue exposure. PostgreSQL skills are strong. Would benefit from validation of full-stack flexibility and willingness to adopt Vue/Nuxt stack.",
    scores: [
      {
        criterionKey: "core_tech_stack",
        maxScore: 10,
        applicantScore: 6,
        confidence: 74,
        evidence:
          "Resume shows strong TypeScript and Node.js backend (4 years). Frontend experience is React and Next.js — no Vue or Nuxt. PostgreSQL is well-demonstrated with query optimization examples.",
        strengths: [
          "Strong TypeScript backend skills (4 years)",
          "PostgreSQL expertise with query optimization examples",
          "Modern framework experience (React/Next.js) showing frontend capability",
        ],
        gaps: [
          "No Vue or Nuxt experience — entirely React-based frontend background",
          "Framework switch would require ramp-up time",
        ],
      },
      {
        criterionKey: "system_design",
        maxScore: 10,
        applicantScore: 7,
        confidence: 76,
        evidence:
          'Resume describes "designed REST API for a marketplace platform" and "database sharding evaluation for growing user base." Demonstrates system thinking at moderate scale.',
        strengths: [
          "API design for marketplace domain",
          "Database scaling evaluation experience",
        ],
        gaps: ["No multi-tenant architecture experience explicitly mentioned"],
      },
      {
        criterionKey: "engineering_practices",
        maxScore: 10,
        applicantScore: 7,
        confidence: 77,
        evidence:
          "Resume mentions Jest testing, GitHub Actions CI, and Docker containerization. Solid engineering habits but no standout practices described.",
        strengths: [
          "Solid testing with Jest and GitHub Actions CI",
          "Docker containerization for development and deployment",
        ],
        gaps: ["No advanced testing practices or quality leadership described"],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 7,
        confidence: 78,
        evidence:
          "5 years of web development. Marketplace and e-commerce product experience. No B2B SaaS or HR domain background.",
        strengths: [
          "5 years of production web development",
          "Complex domain experience in marketplace products",
        ],
        gaps: [
          "No B2B SaaS specialization",
          "No HR or recruitment domain exposure",
        ],
      },
      {
        criterionKey: "leadership_collab",
        maxScore: 10,
        applicantScore: 6,
        confidence: 72,
        evidence:
          'Resume mentions "participated in sprint retrospectives" and "code review feedback." No leadership titles or mentoring described.',
        strengths: ["Active code review participant"],
        gaps: [
          "No mentoring or leadership experience",
          "Limited cross-functional collaboration evidence",
        ],
      },
    ],
  },

  // ──────────────────────────────────────────
  // Job 1: Product Designer
  // ──────────────────────────────────────────

  // David Kim (offer, score: 91)
  {
    jobIndex: 1,
    candidateIndex: 14,
    compositeScore: 91,
    summary:
      "Outstanding product designer with exceptional portfolio depth and clear business impact metrics. Demonstrates sophisticated design process, strong systems thinking, and proven cross-functional leadership. Highly aligned with the role requirements for B2B workflow design.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 9,
        confidence: 94,
        evidence:
          "Portfolio showcases 6 end-to-end case studies with clear problem statements, research insights, design iterations, and measurable outcomes. One project demonstrated a 35% reduction in user onboarding time through redesigned information architecture.",
        strengths: [
          "End-to-end case studies with measurable business outcomes",
          "Clear design narrative from problem to solution with data",
          "High visual polish and consistent design system application",
        ],
        gaps: [
          "Most portfolio work is from a single company — limited diversity of contexts",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 9,
        confidence: 92,
        evidence:
          "Resume describes structured research methodology: user interviews, journey mapping, Jobs-to-be-Done framework, rapid prototyping, and usability testing with 5+ users per cycle. Mentions running design sprints for cross-functional alignment.",
        strengths: [
          "Structured research methodology with JTBD framework",
          "Design sprint facilitation for cross-functional teams",
          "Regular usability testing integrated into delivery cadence",
        ],
        gaps: [
          "No quantitative research methods mentioned (A/B testing, analytics-driven design)",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          "Portfolio demonstrates strong information architecture for complex data tables, elegant interaction patterns, and coherent visual hierarchy. Resume mentions maintaining and extending a 200+ component design system in Figma.",
        strengths: [
          "Complex data table design with clear information hierarchy",
          "Design system ownership at scale (200+ components)",
          "Accessibility-conscious design with WCAG compliance mentioned",
        ],
        gaps: [],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 8,
        confidence: 87,
        evidence:
          'Resume notes "embedded in engineering squad for 2 years" and "design handoff documentation reduced implementation questions by 60%." Partners closely with PMs on roadmap prioritization.',
        strengths: [
          "Embedded squad model with close engineering partnership",
          "Design handoff process with 60% reduction in implementation questions",
          "Active roadmap participation with product managers",
        ],
        gaps: [
          "Limited evidence of stakeholder management with executives or customers directly",
        ],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          'Previous role designing a B2B project management tool with complex workflow states. Portfolio includes data dashboard and analytics interface design. Resume mentions "interest in recruitment technology" in career objectives.',
        strengths: [
          "B2B workflow tool design experience directly relevant",
          "Data-rich dashboard and analytics interface design",
          "Stated interest in recruitment technology domain",
        ],
        gaps: ["No direct HR or recruiting product experience"],
      },
    ],
  },

  // Elena Petrova (interview, score: 88)
  {
    jobIndex: 1,
    candidateIndex: 15,
    compositeScore: 88,
    summary:
      "Strong product designer with excellent design thinking and research skills. Portfolio shows impressive workshop facilitation and user empathy. Slightly less depth in visual craft compared to top candidates but compensated by outstanding product thinking.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 8,
        confidence: 89,
        evidence:
          "Portfolio features 4 case studies with strong problem framing and research-driven insights. Impact metrics included for 2 projects. Visual presentation is clean but not as polished as top-tier candidates.",
        strengths: [
          "Strong problem framing with research-backed insights",
          "Impact metrics tied to business outcomes in key projects",
          "Clear design rationale throughout case studies",
        ],
        gaps: [
          "Visual polish could be elevated in portfolio presentation",
          "Only 4 case studies — could show broader range",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "Resume describes running weekly user research sessions, affinity mapping workshops, and rapid prototype testing cycles. Mentions implementing a design ops process that reduced research-to-insight time by 40%.",
        strengths: [
          "Weekly user research cadence embedded in workflow",
          "Design ops process with measurable time reduction",
          "Workshop facilitation skills for team alignment",
        ],
        gaps: [],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 7,
        confidence: 84,
        evidence:
          "Portfolio shows solid UX foundations with good task flow design. Visual design is functional and clean but lacks the distinctive craft or design system depth seen in stronger portfolios.",
        strengths: [
          "Solid UX foundations with clear task flow design",
          "Functional and accessible visual design approach",
        ],
        gaps: [
          "Visual design lacks distinctive polish compared to top candidates",
          "No design system ownership or creation mentioned",
        ],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 9,
        confidence: 88,
        evidence:
          'Resume highlights "facilitated 12+ design workshops with engineering and product teams." Mentions structured design critique sessions and clear handoff documentation with Figma annotations.',
        strengths: [
          "Prolific workshop facilitator with engineering and product",
          "Structured design critique process leadership",
          "Detailed Figma annotation handoff workflow",
        ],
        gaps: [],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 8,
        confidence: 83,
        evidence:
          "Experience designing CRM and customer support tools — adjacent to HR/recruitment workflows. Resume mentions designing complex state management UIs with multi-step forms.",
        strengths: [
          "CRM tool design experience adjacent to ATS workflows",
          "Complex multi-step form and state management UI experience",
        ],
        gaps: ["No direct recruitment or HR product experience"],
      },
    ],
  },

  // Alexander Johansson (interview, score: 86)
  {
    jobIndex: 1,
    candidateIndex: 16,
    compositeScore: 86,
    summary:
      "Well-rounded designer with excellent visual craft and strong B2B SaaS experience. Case studies demonstrate clear impact metrics and thoughtful design thinking. Research methodology could be more structured but overall profile is very strong.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 8,
        confidence: 88,
        evidence:
          "Portfolio showcases 5 case studies with clear business impact statements. Strongest pieces are data visualization and table design work for an enterprise analytics product.",
        strengths: [
          "Impact-focused case studies with business metrics",
          "Strong data visualization and table design work",
          "Enterprise analytics product design experience",
        ],
        gaps: ["Some case studies lack depth in research methodology section"],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 7,
        confidence: 82,
        evidence:
          'Resume mentions user interviews and prototype testing but lacks detail on systematic research methodology. Design process is described as "iterative" without structured framework references.',
        strengths: [
          "User interview and prototype testing experience",
          "Iterative design approach with stakeholder feedback loops",
        ],
        gaps: [
          "No structured research framework mentioned (JTBD, design sprints)",
          "Limited evidence of quantitative research methods",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "Portfolio demonstrates exceptional visual hierarchy in complex data interfaces. Resume mentions building and maintaining a design system from scratch for a 50-person engineering team.",
        strengths: [
          "Exceptional visual hierarchy in data-dense interfaces",
          "Design system creation and maintenance from scratch",
          "Strong typographic and color system sensibility",
        ],
        gaps: [],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          'Resume notes "partnered with front-end engineers on component specs" and "presented design rationale to product leadership." Active in design review process.',
        strengths: [
          "Engineering partnership on component specifications",
          "Design rationale presentations to leadership",
          "Active design review process participation",
        ],
        gaps: ["No mention of running workshops or facilitation skills"],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          'Current role at a B2B enterprise analytics company designing data-rich interfaces. Previous experience at a marketplace platform. Resume mentions interest in "people-focused tooling."',
        strengths: [
          "B2B enterprise product design with data-rich interfaces",
          "Marketplace platform design experience (multi-sided)",
          "Expressed interest in people-focused tooling",
        ],
        gaps: ["No direct HR, ATS, or recruitment tool experience"],
      },
    ],
  },

  // Maria Costa (interview, score: 83)
  {
    jobIndex: 1,
    candidateIndex: 17,
    compositeScore: 83,
    summary:
      "Thoughtful designer with strong cross-functional collaboration skills and an interesting perspective on accessible design. Portfolio shows good breadth but could demonstrate more depth in individual case studies. Moving forward to design exercise to validate craft depth.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 7,
        confidence: 83,
        evidence:
          "Portfolio features 4 projects with clear problem statements. Impact data present for 1 project. Visual presentation is clean and professional but individual case studies could go deeper into design rationale.",
        strengths: [
          "Clean, professional portfolio presentation",
          "Clear problem statement framing in each project",
        ],
        gaps: [
          "Limited impact metrics across portfolio",
          "Case studies could demonstrate deeper design rationale",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          'Resume describes "accessibility-first design process" and "inclusive user research with diverse participant pools." Mentions WCAG audits as a regular practice and inclusive design workshops.',
        strengths: [
          "Accessibility-first design process is distinctive and valuable",
          "Inclusive research practices with diverse participants",
          "WCAG compliance as a regular practice",
        ],
        gaps: [
          "Traditional UX research depth (user interviews, analytics) less emphasized",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 7,
        confidence: 81,
        evidence:
          "Portfolio shows accessible, well-structured interfaces with strong information hierarchy. Color contrast and keyboard navigation considered. Visual design is functional but not as distinctive.",
        strengths: [
          "Strong accessibility implementation in every project",
          "Good information hierarchy and structure",
        ],
        gaps: [
          "Visual design is functional but lacks distinctiveness",
          "No design system ownership or creation mentioned",
        ],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          'Resume highlights "ran accessibility workshops for engineering and QA teams" and "established design-engineering pairing sessions." Strong collaboration evidence with non-design stakeholders.',
        strengths: [
          "Accessibility workshop facilitation for engineering teams",
          "Design-engineering pairing sessions initiative",
          "Strong non-design stakeholder communication",
        ],
        gaps: [],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 7,
        confidence: 79,
        evidence:
          "Experience designing healthcare and public sector tools — accessibility-focused domains. No direct B2B SaaS or workflow tool experience mentioned.",
        strengths: [
          "Healthcare and public sector design with high accessibility standards",
          "Experience with compliance-heavy design requirements",
        ],
        gaps: [
          "No B2B SaaS or workflow tool experience",
          "No recruitment or HR domain background",
        ],
      },
    ],
  },

  // Ryan Chen (screening, score: 79)
  {
    jobIndex: 1,
    candidateIndex: 18,
    compositeScore: 79,
    summary:
      "Promising designer with a compelling research approach and interesting transition from frontend engineering. Technical background adds depth to engineering collaboration. Moving to portfolio walkthrough to assess design craft and process maturity.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          "Portfolio is relatively new (transition from frontend engineering). 3 case studies show solid problem-solving but the design maturity is still developing. Technical implementation perspective is a unique strength.",
        strengths: [
          "Unique technical perspective from engineering background",
          "Strong problem-solving approach in case studies",
        ],
        gaps: [
          "Portfolio is newer with fewer case studies",
          "Design maturity still developing compared to experienced designers",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 7,
        confidence: 78,
        evidence:
          'Resume describes "data-informed design decisions" leveraging analytics background from engineering. User testing mentioned but research methodology less developed than pure design candidates.',
        strengths: [
          "Data-informed design approach leveraging analytics skills",
          "Ability to validate designs through code prototypes",
        ],
        gaps: [
          "Formal UX research methodology less developed",
          "No mention of user interview techniques or workshops",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 7,
        confidence: 76,
        evidence:
          "Portfolio shows clean, functional interfaces with good usability. Technical feasibility awareness in all designs. Visual craft is solid but room for growth in visual sophistication.",
        strengths: [
          "Designs are technically feasible — strong implementation awareness",
          "Clean, functional interfaces with good usability",
        ],
        gaps: ["Visual sophistication and design system depth could improve"],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 9,
        confidence: 88,
        evidence:
          'As a former frontend engineer, collaboration with engineering is a natural strength. Resume notes "bridge between design and engineering teams" and "mentored designers on technical constraints."',
        strengths: [
          "Natural engineering collaboration from technical background",
          "Bridges design-engineering communication gap effectively",
          "Mentors designers on technical feasibility constraints",
        ],
        gaps: [],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 6,
        confidence: 73,
        evidence:
          "Previous engineering role at a consumer app company. Design work focused on developer tools. Limited B2B SaaS or workflow product experience.",
        strengths: ["Developer tools design — technical product experience"],
        gaps: [
          "No B2B SaaS product design experience",
          "No workflow tool or HR domain exposure",
        ],
      },
    ],
  },

  // Laura Nguyen (screening, score: 76)
  {
    jobIndex: 1,
    candidateIndex: 19,
    compositeScore: 76,
    summary:
      "Designer with strong visual craft and emerging B2B experience. Portfolio shows good aesthetic sensibility but needs more evidence of structured design process and research depth. Reviewing B2B experience depth before scheduling portfolio walkthrough.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 7,
        confidence: 79,
        evidence:
          "Portfolio features visually polished work with strong attention to detail. 3 case studies primarily focused on visual redesign rather than end-to-end product design. Impact metrics are limited.",
        strengths: [
          "High visual polish and attention to detail",
          "Strong aesthetic sensibility across all projects",
        ],
        gaps: [
          "Case studies lean toward visual redesign over full product design",
          "Limited business impact metrics",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 6,
        confidence: 75,
        evidence:
          'Resume mentions "user feedback sessions" and "iterative design cycles" but lacks detail on structured research methodology or discovery practices.',
        strengths: ["User feedback integration into design cycles"],
        gaps: [
          "No structured research methodology described",
          "Limited evidence of discovery or problem framing practices",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          'Portfolio demonstrates strong visual design skills with excellent typography, color, and layout. Resume mentions "Figma component library contributions" and "design token system."',
        strengths: [
          "Excellent typography, color, and layout skills",
          "Design token system implementation experience",
          "Figma component library contributions",
        ],
        gaps: [],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 6,
        confidence: 73,
        evidence:
          'Resume mentions "worked with developers on implementation" but limited detail on structured handoff, workshops, or product collaboration.',
        strengths: ["Developer collaboration experience"],
        gaps: [
          "No structured handoff process described",
          "Limited product or stakeholder collaboration evidence",
        ],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 6,
        confidence: 72,
        evidence:
          "Experience split between consumer apps and a recent B2B SaaS role. B2B experience is 1 year. No workflow tool or HR domain background.",
        strengths: ["Recent transition to B2B SaaS shows career direction"],
        gaps: [
          "B2B SaaS experience is only 1 year",
          "No workflow tool or recruitment domain experience",
        ],
      },
    ],
  },

  // ──────────────────────────────────────────
  // Job 1: Product Designer — top 6 new AI-shortlisted applicants
  // ──────────────────────────────────────────

  // Charlotte Rousseau (new, score: 93) — AI top shortlist
  {
    jobIndex: 1,
    candidateIndex: 150,
    compositeScore: 93,
    summary:
      "Exceptional product designer with 6 years of B2B SaaS experience and an outstanding portfolio demonstrating end-to-end design ownership. Eight detailed case studies with measurable outcomes, design system leadership at scale, and deep Figma expertise. One of the strongest profiles reviewed for this role — highly recommended for immediate interview.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 10,
        confidence: 95,
        evidence:
          "Portfolio showcases 8 end-to-end case studies with clear problem statements, research documentation, and measurable business outcomes. Highlights include a 42% reduction in task completion time for a complex onboarding flow and a 28% increase in dashboard engagement after a data visualization redesign.",
        strengths: [
          "8 complete case studies with quantified business impact",
          "Clear design narrative from discovery to delivery in every project",
          "High visual polish with consistent application of design principles",
        ],
        gaps: [],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 9,
        confidence: 93,
        evidence:
          "Resume describes structured research methodology including user interviews, Jobs-to-be-Done mapping, journey mapping, and usability testing integrated into every sprint. Mentions running 12+ design sprints to align cross-functional teams on complex workflow decisions.",
        strengths: [
          "Structured JTBD-driven research methodology",
          "Design sprint facilitation across 12+ cross-functional alignment sessions",
          "Usability testing embedded in delivery cadence",
        ],
        gaps: [
          "Limited mention of quantitative research methods such as A/B testing",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 10,
        confidence: 94,
        evidence:
          "Portfolio demonstrates exceptional information architecture in complex multi-step workflow interfaces. Resume mentions owning a 300+ component Figma design system used across 4 product teams. Accessibility is a first-class concern in all portfolio work.",
        strengths: [
          "300+ component design system ownership across 4 product teams",
          "Complex multi-step workflow interface expertise",
          "WCAG 2.1 AA compliance as a baseline across all projects",
        ],
        gaps: [],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          'Resume highlights "embedded in engineering squads for 3 years" with a documented handoff process that reduced implementation questions by 70%. Active in roadmap planning with product leadership. Ran monthly design critiques for the broader product team.',
        strengths: [
          "3 years embedded in engineering squads with measurable handoff improvements",
          "Monthly design critique leadership for product team",
          "Active roadmap participation with product leadership",
        ],
        gaps: [
          "Limited direct customer-facing research mentioned beyond internal sessions",
        ],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "Previous role designing a B2B applicant tracking and interview scheduling platform — directly adjacent to Reqcore's domain. Deep experience with multi-step form flows, data tables, and candidate pipeline visualization.",
        strengths: [
          "Direct experience designing ATS-adjacent HR software",
          "Multi-step form and candidate pipeline UI expertise",
          "Data table and list management design at scale",
        ],
        gaps: ["No stated interest in transparent AI features specifically"],
      },
    ],
  },

  // Maya Johnson (new, score: 91) — AI shortlist
  {
    jobIndex: 1,
    candidateIndex: 180,
    compositeScore: 91,
    summary:
      "Outstanding product designer with a research-led process and outstanding portfolio of data-rich B2B SaaS interfaces. HR tool redesign in portfolio is directly relevant. Strong design systems background and quantified impact on key projects. Clear shortlist candidate.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 9,
        confidence: 92,
        evidence:
          "Portfolio features 6 case studies with strong problem framing and documented research insights. Headline project: a complete redesign of an HR onboarding tool that reduced time-to-complete by 35%. Visual quality is consistently high.",
        strengths: [
          "HR tool redesign directly relevant to Reqcore domain",
          "Measurable impact: 35% onboarding time reduction",
          "Consistent visual quality and design system application",
        ],
        gaps: ["One older case study lacks depth in research section"],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          "Resume describes a structured discovery-to-delivery process: stakeholder interviews, competitive benchmarking, user research sessions, low-fi prototyping, and iterative testing. Mentions implementing a design ops workflow that reduced design-to-handoff cycle by 45%.",
        strengths: [
          "Full discovery-to-delivery process with structured research",
          "Design ops implementation reducing handoff cycle by 45%",
          "Iterative prototype testing with real users",
        ],
        gaps: [],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "Strong information architecture across all portfolio pieces. Built and maintained a design system from scratch for a 40-person engineering team. Portfolio shows excellent data table, filter, and bulk-action UI patterns.",
        strengths: [
          "Design system built from scratch for 40-person eng team",
          "Data table and filter UI expertise",
          "Excellent visual hierarchy in complex interfaces",
        ],
        gaps: ["Some portfolio pieces lack interaction detail in prototypes"],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 8,
        confidence: 87,
        evidence:
          'Resume notes "partnered with 3 product managers on quarterly roadmap planning" and "reduced back-and-forth with engineering by implementing Figma auto-layout and token documentation." Regular presenter at company all-hands on design strategy.',
        strengths: [
          "Roadmap planning partnership with PMs",
          "Figma token documentation reducing engineering back-and-forth",
          "Company-level design strategy presentation experience",
        ],
        gaps: [
          "No specific workshop facilitation or design sprint experience mentioned",
        ],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 9,
        confidence: 89,
        evidence:
          "Direct experience at an HR SaaS company designing applicant management and interview coordination flows. Also has B2B analytics dashboard experience. Deep familiarity with the pain points of recruiters managing large candidate volumes.",
        strengths: [
          "HR SaaS product experience with direct ATS design relevance",
          "Recruiter workflow familiarity from user research",
          "Analytics dashboard and data visualization expertise",
        ],
        gaps: [],
      },
    ],
  },

  // Sakura Watanabe (new, score: 89) — AI shortlist
  {
    jobIndex: 1,
    candidateIndex: 210,
    compositeScore: 89,
    summary:
      "Strong B2B workflow designer with documented design sprint experience and an impressive record of measurable UX improvements. Portfolio includes complex state management UI for a project management tool and a well-articulated design process. Worth fast-tracking to portfolio review.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "Five case studies covering end-to-end product design. Standout piece: a project management tool redesign where the new information architecture reduced navigation errors by 40% and improved onboarding completion by 28%.",
        strengths: [
          "End-to-end project management tool redesign with clear impact metrics",
          "Complex state management UI demonstrated in portfolio",
          "Structured case study format showing clear design rationale",
        ],
        gaps: [
          "Portfolio could show more breadth across different product domains",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 9,
        confidence: 89,
        evidence:
          "Resume describes running design sprints for complex workflow redesigns, including a 5-day sprint with 12 stakeholders that produced a validated prototype in one week. Mentions weekly user research sessions embedded in the team rhythm.",
        strengths: [
          "Design sprint facilitation with 12+ stakeholders",
          "Weekly user research sessions embedded in team rhythm",
          "Validated prototyping cycle before engineering handoff",
        ],
        gaps: ["Limited quantitative research methods described"],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          "Portfolio shows clean, functional interfaces with excellent typographic hierarchy. Contributed to a design system with 200+ components. Accessibility-conscious design is evident across all projects.",
        strengths: [
          "200+ component design system contributions",
          "Strong typographic hierarchy and visual clarity",
          "Accessibility-conscious approach",
        ],
        gaps: [
          "Visual design could reach higher distinctiveness in some portfolio pieces",
        ],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          'Resume mentions "embedded in agile squad for 2 years" and "conducted bi-weekly design reviews with engineers and PMs." Described as a "design bridge" between technical and business stakeholders in a reference note.',
        strengths: [
          "2-year embedded squad experience",
          "Bi-weekly cross-functional design reviews",
          "Strong bridge role between technical and business teams",
        ],
        gaps: [],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          'Previous role at a B2B SaaS company building workflow management tools. Portfolio shows complex multi-step state machines and pipeline views. Cover letter mentions specific interest in recruitment tooling and "making hiring less chaotic."',
        strengths: [
          "B2B workflow management tool experience",
          "Complex pipeline and kanban-style interface design",
          "Genuine stated interest in recruitment technology",
        ],
        gaps: ["No direct HR or ATS product experience"],
      },
    ],
  },

  // Sneha Reddy (new, score: 88) — AI shortlist
  {
    jobIndex: 1,
    candidateIndex: 240,
    compositeScore: 88,
    summary:
      "Design system lead with strong cross-functional collaboration record and accessible-by-default design practice. Portfolio demonstrates Figma expertise at scale and a structured approach to design handoff. Slightly less domain depth but process and craft are excellent.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 8,
        confidence: 87,
        evidence:
          "Portfolio shows 5 case studies with strong visual execution and clear design system application. Impact metrics present in 3 projects. Standout work: a complete admin interface redesign that reduced support tickets by 32%.",
        strengths: [
          "Admin interface redesign with 32% support ticket reduction",
          "Consistent design system application across all portfolio work",
          "Clear before/after comparisons showing design decisions",
        ],
        gaps: ["Two case studies lack depth in user research methodology"],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          'Resume describes a "research-first" process with user interviews, card sorting, and tree testing for information architecture decisions. Mentions running quarterly UX reviews with stakeholders to validate product direction.',
        strengths: [
          "Information architecture validated with card sorting and tree testing",
          "Quarterly UX review cadence with stakeholders",
          "Research-first process applied consistently",
        ],
        gaps: [
          "No design sprint or workshop facilitation experience mentioned",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          'Design system lead for a 150-person SaaS company — created and maintained 400+ Figma components with full token architecture. Resume explicitly mentions "zero accessibility debt" as a team KPI.',
        strengths: [
          "400+ Figma component design system with full token architecture",
          '"Zero accessibility debt" as tracked team KPI',
          "Deep Figma auto-layout and variant expertise",
        ],
        gaps: [],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 9,
        confidence: 88,
        evidence:
          'Resume highlights running a biweekly "Design + Engineering" sync that reduced implementation rework by 55%. Presented design system adoption roadmap to C-suite. Onboarded 4 new designers onto system and handoff workflow.',
        strengths: [
          "Biweekly Design + Engineering sync with 55% rework reduction",
          "C-suite presentation of design system roadmap",
          "Designer onboarding and system adoption leadership",
        ],
        gaps: [],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          "B2B SaaS background in fintech and project management tools. No direct HR or recruitment product experience. Cover letter shows good understanding of B2B workflow complexity.",
        strengths: [
          "B2B SaaS fintech and project management tool experience",
          "Strong understanding of workflow complexity from cover letter",
        ],
        gaps: ["No direct HR or recruiting product domain experience"],
      },
    ],
  },

  // Valeria Rodríguez (new, score: 87) — AI shortlist
  {
    jobIndex: 1,
    candidateIndex: 260,
    compositeScore: 87,
    summary:
      "Product designer with a well-articulated research-led process and strong portfolio in recruitment-adjacent workflow tooling. Portfolio shows complex process management UI with clear problem framing. Design system contribution and cross-functional collaboration are both strong. Recommended for screening.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          "Portfolio features 5 case studies including an applicant management and status-tracking interface for a staffing agency — directly relevant to Reqcore's core workflow. Case studies are well-structured with clear research-to-delivery arcs.",
        strengths: [
          "Staffing agency applicant management interface directly domain-relevant",
          "Well-structured research-to-delivery case study format",
          "Status-tracking and pipeline UI expertise",
        ],
        gaps: ["Visual polish in some portfolio pieces could be elevated"],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 9,
        confidence: 88,
        evidence:
          'Resume describes a thorough discovery process: stakeholder interviews, shadowing sessions with recruiters to understand daily workflows, journey mapping, and rapid prototype iterations. Explicitly mentions "observational research" as a core method.',
        strengths: [
          "Recruiter shadowing sessions for workflow observation",
          "Rapid prototype iteration with stakeholder validation",
          "Journey mapping for complex multi-actor workflows",
        ],
        gaps: [],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          "Portfolio shows strong information architecture in list-heavy, filter-heavy interfaces. Design system contributor at current employer. Good attention to visual hierarchy and density control in data-rich views.",
        strengths: [
          "Strong information architecture in filter-heavy list interfaces",
          "Visual hierarchy expertise for data-dense layouts",
          "Design system contribution experience",
        ],
        gaps: [
          "Design system ownership rather than leadership — contributing role only",
        ],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          'Resume mentions "co-led product discovery workshops with PMs" and "coordinated design handoff across 3 engineering squads." Active participant in roadmap quarterly planning.',
        strengths: [
          "Co-led product discovery workshops with PMs",
          "Multi-squad design handoff coordination",
          "Roadmap quarterly planning involvement",
        ],
        gaps: [
          "No explicit design critique leadership or training of other designers",
        ],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          "Direct experience designing for staffing agencies — includes applicant tracking lists, interview status flows, and bulk action interfaces. Deep empathy for recruiter pain points documented in research artifacts.",
        strengths: [
          "Direct staffing/recruitment domain experience",
          "Documented recruiter pain point research",
          "Bulk action and status management interface expertise",
        ],
        gaps: [],
      },
    ],
  },

  // Mathilde Hansen (new, score: 86) — AI shortlist
  {
    jobIndex: 1,
    candidateIndex: 300,
    compositeScore: 86,
    summary:
      "Information architecture and dashboard design specialist with strong B2B enterprise background. Documented design-engineering pairing improvements and a solid portfolio of data-rich interfaces. Slightly less research depth than top candidates but craft and domain alignment are strong.",
    scores: [
      {
        criterionKey: "portfolio_quality",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          "Portfolio includes 5 case studies weighted toward dashboard and analytics interfaces for B2B enterprise products. Impact metrics are present in 3 projects. Strongest piece shows a complex reporting dashboard redesign that reduced time-to-insight by 38%.",
        strengths: [
          "Dashboard and analytics interface specialization",
          "Reporting redesign with 38% time-to-insight reduction",
          "Enterprise product design experience",
        ],
        gaps: [
          "Limited diversity in product types — mostly analytics/dashboard work",
        ],
      },
      {
        criterionKey: "design_process",
        maxScore: 10,
        applicantScore: 7,
        confidence: 81,
        evidence:
          'Resume describes user interviews and prototype testing as standard practice. Process is somewhat less documented than top candidates — describes approach as "iterative" with less explicit methodology framing.',
        strengths: [
          "User interview and prototype testing experience",
          "Iterative approach with stakeholder feedback integration",
        ],
        gaps: [
          "No structured research framework explicitly mentioned",
          "Limited evidence of discovery workshops or facilitation",
        ],
      },
      {
        criterionKey: "ux_visual_craft",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          'Portfolio demonstrates exceptional skill in information hierarchy for dense data interfaces. Built a design system from scratch used by 30-person engineering team. Resume mentions "data visualization design" as a specialization.',
        strengths: [
          "Data visualization design specialization",
          "Design system built from scratch for 30-person team",
          "Exceptional information hierarchy in dense layouts",
        ],
        gaps: [],
      },
      {
        criterionKey: "cross_functional",
        maxScore: 10,
        applicantScore: 9,
        confidence: 88,
        evidence:
          'Resume highlights "established Design + Engineering pairing protocol that reduced implementation errors by 60%." Ran design critique sessions for engineering team. Presented design decisions to product leadership quarterly.',
        strengths: [
          "Design + Engineering pairing protocol with 60% error reduction",
          "Engineering team design critique sessions",
          "Quarterly design decision presentation to leadership",
        ],
        gaps: [],
      },
      {
        criterionKey: "domain_knowledge",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          'B2B enterprise analytics product background with deep familiarity with data-heavy list and table interfaces. Previous role at a project management SaaS with multi-step workflow design. Expressed interest in "people operations tooling" in cover letter.',
        strengths: [
          "B2B enterprise data product experience",
          "Multi-step workflow design for project management SaaS",
          "Expressed interest in people operations domain",
        ],
        gaps: ["No direct HR or recruitment product experience"],
      },
    ],
  },

  // ──────────────────────────────────────────
  // Job 2: DevOps Engineer
  // ──────────────────────────────────────────

  // James O'Brien (hired, score: 94)
  {
    jobIndex: 2,
    candidateIndex: 5,
    compositeScore: 94,
    summary:
      "Exceptional DevOps engineer with deep container orchestration expertise, outstanding CI/CD pipeline design, and strong security awareness. Demonstrates production ownership across hosted and self-hosted environments — precisely the profile needed for this role.",
    scores: [
      {
        criterionKey: "infrastructure",
        maxScore: 10,
        applicantScore: 10,
        confidence: 94,
        evidence:
          "Resume shows 6 years of infrastructure management. Expert Docker and Kubernetes experience with custom operator development. Managed AWS and Hetzner environments for multi-region SaaS deployments. Terraform IaC for all infrastructure.",
        strengths: [
          "Expert Kubernetes with custom operator development",
          "Multi-region cloud infrastructure across AWS and Hetzner",
          "Infrastructure-as-Code discipline with Terraform",
        ],
        gaps: [],
      },
      {
        criterionKey: "cicd_automation",
        maxScore: 10,
        applicantScore: 9,
        confidence: 93,
        evidence:
          'Built GitHub Actions pipelines with automated canary deployments, rollback triggers, and artifact management. Resume mentions "deployment frequency increased from weekly to 15+ per day" after pipeline improvements.',
        strengths: [
          "GitHub Actions pipeline expertise with canary deployments",
          "Measurable deployment frequency improvement (weekly to 15+/day)",
          "Automated rollback and artifact management",
        ],
        gaps: ["No multi-cloud CI/CD orchestration experience mentioned"],
      },
      {
        criterionKey: "observability",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          'Implemented Prometheus/Grafana monitoring stack with custom alerting rules. Resume describes "structured incident response process with 15-minute MTTD" and "published 20+ runbooks for common operational scenarios."',
        strengths: [
          "Full observability stack implementation (Prometheus/Grafana)",
          "15-minute MTTD with structured incident response",
          "Comprehensive runbook library (20+) for operational resilience",
        ],
        gaps: [
          "No distributed tracing experience mentioned (Jaeger, OpenTelemetry)",
        ],
      },
      {
        criterionKey: "security_compliance",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          'Resume highlights "secrets management with HashiCorp Vault," "TLS certificate automation with cert-manager," and "SOC 2 audit preparation." Strong security-first mindset throughout infrastructure work.',
        strengths: [
          "HashiCorp Vault for secrets management",
          "Automated TLS certificate management",
          "SOC 2 compliance preparation experience",
        ],
        gaps: ["No penetration testing or security audit leadership mentioned"],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 9,
        confidence: 92,
        evidence:
          '6 years of DevOps and platform engineering. Last 3 years supporting B2B SaaS products with both hosted and self-hosted deployment models. Resume mentions "documented self-hosted deployment guides for enterprise customers."',
        strengths: [
          "6 years of dedicated DevOps/platform engineering",
          "B2B SaaS with both hosted and self-hosted deployment support",
          "Enterprise self-hosted deployment documentation experience",
        ],
        gaps: [],
      },
    ],
  },

  // Amara Okafor (offer, score: 90)
  {
    jobIndex: 2,
    candidateIndex: 6,
    compositeScore: 90,
    summary:
      "Strong platform engineer with excellent reliability focus and deep Linux expertise. Brings robust CI/CD automation skills and a strong disaster recovery background. Minor gap in container orchestration beyond Docker Compose but compensated by outstanding operational discipline.",
    scores: [
      {
        criterionKey: "infrastructure",
        maxScore: 10,
        applicantScore: 8,
        confidence: 88,
        evidence:
          "Resume shows 5 years of Linux system administration and Docker expertise. Managed bare-metal and cloud infrastructure on AWS and Hetzner. Docker Compose for service orchestration — no production Kubernetes.",
        strengths: [
          "Deep Linux system administration expertise (5 years)",
          "Multi-cloud experience across AWS and Hetzner",
          "Docker expertise with production deployment experience",
        ],
        gaps: [
          "No production Kubernetes experience — Docker Compose only",
          "Limited container orchestration at scale",
        ],
      },
      {
        criterionKey: "cicd_automation",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          'Built GitLab CI pipelines with automated testing, staging deployments, and production promotion. Resume mentions "zero-downtime deployment strategy using blue-green deployments" with measured rollback times.',
        strengths: [
          "GitLab CI pipeline expertise with full automation",
          "Blue-green deployment strategy for zero-downtime releases",
          "Measurable rollback procedures with tested recovery times",
        ],
        gaps: [],
      },
      {
        criterionKey: "observability",
        maxScore: 10,
        applicantScore: 8,
        confidence: 86,
        evidence:
          'Implemented ELK stack for log aggregation and Grafana dashboards for infrastructure metrics. Resume mentions "on-call rotation with structured escalation procedures." Limited detail on alerting sophistication.',
        strengths: [
          "ELK stack implementation for centralized logging",
          "Grafana dashboards for infrastructure monitoring",
          "On-call rotation with structured escalation",
        ],
        gaps: [
          "Limited detail on alerting rule sophistication",
          "No mention of SLO/SLA-based monitoring",
        ],
      },
      {
        criterionKey: "security_compliance",
        maxScore: 10,
        applicantScore: 9,
        confidence: 89,
        evidence:
          'Resume highlights "automated security scanning in CI pipeline," "network segmentation with firewall rules," and "encrypted backup procedures with tested restore processes."',
        strengths: [
          "CI-integrated security scanning automation",
          "Network segmentation and firewall management",
          "Encrypted backup with tested restore procedures",
        ],
        gaps: [],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 9,
        confidence: 90,
        evidence:
          "5 years of DevOps experience. Current role supporting a B2B SaaS platform with 500+ organizations. Strong disaster recovery and data protection focus.",
        strengths: [
          "5 years of dedicated DevOps experience",
          "B2B SaaS support at scale (500+ organizations)",
          "Strong disaster recovery and data protection discipline",
        ],
        gaps: ["No self-hosted deployment documentation experience"],
      },
    ],
  },

  // Yuki Tanaka (interview, score: 85)
  {
    jobIndex: 2,
    candidateIndex: 7,
    compositeScore: 85,
    summary:
      "Well-rounded DevOps engineer with strong CI/CD expertise and good cloud fundamentals. Deep GitHub Actions experience aligns well with the team's tooling. Kubernetes experience is theoretical rather than production-depth. Scheduling final technical interview.",
    scores: [
      {
        criterionKey: "infrastructure",
        maxScore: 10,
        applicantScore: 7,
        confidence: 82,
        evidence:
          'Resume shows Docker and cloud infrastructure management on AWS. Kubernetes listed under "proficient" but production experience limited to staging environments. Good Linux fundamentals.',
        strengths: [
          "Docker production experience on AWS",
          "Linux system administration fundamentals",
          "Kubernetes knowledge (staging environment level)",
        ],
        gaps: [
          "Kubernetes experience limited to staging — not production",
          "Single cloud provider experience (AWS only)",
        ],
      },
      {
        criterionKey: "cicd_automation",
        maxScore: 10,
        applicantScore: 9,
        confidence: 91,
        evidence:
          'Built complex GitHub Actions workflows with matrix builds, reusable workflows, and automated release tagging. Resume mentions "reduced CI pipeline time by 65% through caching and parallelization strategies."',
        strengths: [
          "Advanced GitHub Actions with reusable workflows",
          "65% CI pipeline time reduction through optimization",
          "Matrix builds and parallelization expertise",
        ],
        gaps: [],
      },
      {
        criterionKey: "observability",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          'Resume lists CloudWatch and custom dashboards. Mentions "pager rotation" and "post-incident reviews" but limited detail on monitoring architecture or alerting sophistication.',
        strengths: [
          "CloudWatch monitoring and custom dashboards",
          "Post-incident review process participation",
        ],
        gaps: [
          "No full observability stack implementation mentioned",
          "Limited alerting sophistication detail",
        ],
      },
      {
        criterionKey: "security_compliance",
        maxScore: 10,
        applicantScore: 7,
        confidence: 79,
        evidence:
          'Resume mentions "TLS configuration" and "environment variable management for secrets." Basic security awareness but limited depth in compliance or advanced security practices.',
        strengths: [
          "TLS configuration and certificate management",
          "Secure environment variable handling",
        ],
        gaps: [
          "No compliance framework experience (SOC 2, GDPR)",
          "No advanced secrets management tools mentioned",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 8,
        confidence: 84,
        evidence:
          "4 years of DevOps experience. Previous role at a SaaS startup with rapid deployment cycles. Strong automation mindset and good documentation habits.",
        strengths: [
          "SaaS startup DevOps experience with rapid deployment cycles",
          "Strong automation mindset and documentation habits",
        ],
        gaps: [
          "4 years total experience is moderate for the scope of this role",
        ],
      },
    ],
  },

  // Lucas Andersson (interview, score: 83)
  {
    jobIndex: 2,
    candidateIndex: 8,
    compositeScore: 83,
    summary:
      "Solid DevOps engineer with strong automation mindset and good incident response practices. Brings practical experience across Docker and CI/CD. Cloud expertise could be deeper but compensated by excellent troubleshooting skills and operational discipline.",
    scores: [
      {
        criterionKey: "infrastructure",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          'Resume shows Docker Compose production deployments and DigitalOcean cloud management. Some AWS experience. Limited IaC depth — mentions "shell scripts for provisioning" rather than Terraform.',
        strengths: [
          "Docker Compose production deployment experience",
          "Multi-cloud exposure (DigitalOcean and AWS)",
          "Practical troubleshooting and debugging skills",
        ],
        gaps: [
          "No IaC tools (Terraform, Pulumi) — relies on shell scripts",
          "No container orchestration beyond Docker Compose",
        ],
      },
      {
        criterionKey: "cicd_automation",
        maxScore: 10,
        applicantScore: 8,
        confidence: 85,
        evidence:
          'Built GitLab CI pipelines with automated testing and deployment. Resume mentions "deployment automation scripts with rollback capability" and "staging environment auto-provisioning."',
        strengths: [
          "GitLab CI pipeline automation",
          "Deployment scripts with rollback capability",
          "Staging environment auto-provisioning",
        ],
        gaps: [
          "No advanced deployment strategies mentioned (canary, blue-green)",
        ],
      },
      {
        criterionKey: "observability",
        maxScore: 10,
        applicantScore: 8,
        confidence: 83,
        evidence:
          'Resume describes "custom alerting with PagerDuty integration" and "structured log analysis for root cause determination." Mentions incident retrospectives as a team practice.',
        strengths: [
          "PagerDuty alerting integration",
          "Structured log analysis for root cause investigations",
          "Incident retrospective facilitation",
        ],
        gaps: ["No full monitoring stack implementation described"],
      },
      {
        criterionKey: "security_compliance",
        maxScore: 10,
        applicantScore: 7,
        confidence: 77,
        evidence:
          'Resume mentions "SSL certificate management" and "firewall configuration." Basic security practices but no compliance framework or advanced security tooling experience.',
        strengths: [
          "SSL certificate management",
          "Firewall configuration and network security basics",
        ],
        gaps: [
          "No compliance framework experience",
          "No secrets management tooling mentioned",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 8,
        confidence: 82,
        evidence:
          "4 years of DevOps experience across 2 companies. Current role supporting a SaaS product with Docker-based deployments. Good documentation and knowledge-sharing habits.",
        strengths: [
          "Multi-company DevOps experience",
          "SaaS product support with Docker deployments",
          "Strong documentation and knowledge-sharing culture",
        ],
        gaps: ["No enterprise self-hosted support experience"],
      },
    ],
  },

  // Priya Sharma (screening, score: 79)
  {
    jobIndex: 2,
    candidateIndex: 9,
    compositeScore: 79,
    summary:
      "Good cloud fundamentals with practical Docker and CI/CD experience. Shows solid operational awareness and a systematic approach to infrastructure management. Validating production ownership scope before moving to interviews.",
    scores: [
      {
        criterionKey: "infrastructure",
        maxScore: 10,
        applicantScore: 7,
        confidence: 78,
        evidence:
          "Resume shows AWS cloud management (EC2, RDS, S3) and Docker container deployments. Linux administration mentioned. No IaC or container orchestration beyond basic Docker.",
        strengths: [
          "AWS cloud management across core services",
          "Docker container deployment experience",
          "Linux system administration",
        ],
        gaps: [
          "No IaC experience",
          "No container orchestration (Kubernetes, Swarm)",
        ],
      },
      {
        criterionKey: "cicd_automation",
        maxScore: 10,
        applicantScore: 7,
        confidence: 79,
        evidence:
          'Resume mentions "GitHub Actions for automated testing and deployment" and "deployment scripts for staging and production environments."',
        strengths: [
          "GitHub Actions CI/CD experience",
          "Automated testing and deployment scripts",
        ],
        gaps: [
          "No advanced deployment strategies or pipeline optimization mentioned",
        ],
      },
      {
        criterionKey: "observability",
        maxScore: 10,
        applicantScore: 6,
        confidence: 74,
        evidence:
          'Resume mentions "CloudWatch monitoring" and "log review during incidents." Limited evidence of proactive monitoring or alerting system design.',
        strengths: [
          "CloudWatch monitoring familiarity",
          "Incident log review experience",
        ],
        gaps: [
          "No proactive monitoring or alerting system design",
          "No structured incident response process described",
        ],
      },
      {
        criterionKey: "security_compliance",
        maxScore: 10,
        applicantScore: 7,
        confidence: 76,
        evidence:
          'Resume notes "security group configuration" and "IAM role management in AWS." Basic cloud security but no advanced practices or compliance experience.',
        strengths: [
          "AWS security group and IAM management",
          "Cloud security basics",
        ],
        gaps: [
          "No compliance framework experience",
          "No advanced security tooling",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 7,
        confidence: 80,
        evidence:
          "3 years of DevOps experience in a growing startup environment. Broad operational responsibilities including database management and infrastructure monitoring.",
        strengths: [
          "Startup DevOps with broad operational ownership",
          "Database management alongside infrastructure work",
        ],
        gaps: [
          "3 years is relatively early career for this scope",
          "No enterprise or self-hosted deployment experience",
        ],
      },
    ],
  },

  // Mateo García (screening, score: 76)
  {
    jobIndex: 2,
    candidateIndex: 10,
    compositeScore: 76,
    summary:
      "Relevant Docker and IaC experience with a good automation mindset. Resume shows potential but depth of operational experience needs validation. Recruiter follow-up pending to assess production readiness.",
    scores: [
      {
        criterionKey: "infrastructure",
        maxScore: 10,
        applicantScore: 7,
        confidence: 77,
        evidence:
          'Resume lists Docker, Hetzner cloud, and "experimenting with Terraform." Linux server management as part of current role. Infrastructure exposure is practical but not production-depth.',
        strengths: [
          "Docker and Hetzner cloud experience",
          "Linux server management",
          "Terraform learning initiative shows growth mindset",
        ],
        gaps: [
          "Terraform is experimental rather than production usage",
          "No container orchestration experience",
        ],
      },
      {
        criterionKey: "cicd_automation",
        maxScore: 10,
        applicantScore: 7,
        confidence: 78,
        evidence:
          'Resume mentions "GitHub Actions for build and deploy" and "Bash automation scripts for deployment." Basic CI/CD pipeline operation.',
        strengths: [
          "GitHub Actions for build and deployment",
          "Bash automation scripting",
        ],
        gaps: [
          "Basic pipeline operation — no advanced features described",
          "No pipeline optimization or complex workflow experience",
        ],
      },
      {
        criterionKey: "observability",
        maxScore: 10,
        applicantScore: 6,
        confidence: 72,
        evidence:
          'Resume mentions "server monitoring with Netdata." Limited detail on alerting, incident response, or operational runbooks.',
        strengths: ["Basic server monitoring with Netdata"],
        gaps: [
          "No structured alerting or incident response",
          "No runbook or operational documentation mentioned",
        ],
      },
      {
        criterionKey: "security_compliance",
        maxScore: 10,
        applicantScore: 6,
        confidence: 73,
        evidence:
          'Resume mentions "firewall setup" and "SSH key management." Basic security fundamentals without depth in compliance or advanced security practices.',
        strengths: ["Firewall and SSH key management basics"],
        gaps: [
          "No compliance or advanced security experience",
          "No secrets management tooling",
        ],
      },
      {
        criterionKey: "relevant_experience",
        maxScore: 10,
        applicantScore: 7,
        confidence: 76,
        evidence:
          "3 years of DevOps-adjacent work transitioning from system administration. Current role combines sys admin and DevOps responsibilities.",
        strengths: [
          "System administration foundation transitioning to DevOps",
          "3 years of progressive infrastructure experience",
        ],
        gaps: [
          "Still transitioning from sys admin — DevOps depth developing",
          "No SaaS product support experience",
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────
// Interview definitions — realistic multi-stage loops
// ─────────────────────────────────────────────

interface InterviewSeed {
  jobIndex: number;
  candidateIndex: number;
  title: string;
  type: "phone" | "video" | "in_person" | "panel" | "technical" | "take_home";
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  /** Days from seed date. Positive = future, negative = past. */
  daysOffset: number;
  hour: number;
  minute?: number;
  duration: number;
  location: string | null;
  notes: string | null;
  interviewers: string[];
  candidateResponse: "pending" | "accepted" | "declined" | "tentative";
  timezone: string;
}

const INTERVIEWS_DATA: InterviewSeed[] = [
  // ──────────────────────────────────────────
  // Job 0: Senior Full-Stack Engineer
  // ──────────────────────────────────────────

  // Emma Schmidt (hired) — full 3-round loop, all completed
  {
    jobIndex: 0,
    candidateIndex: 0,
    title: "Initial Phone Screen",
    type: "phone",
    status: "completed",
    daysOffset: -18,
    hour: 10,
    duration: 30,
    location: null,
    notes:
      "Strong communication skills. Clear motivation and relevant experience. Advancing to technical round.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },
  {
    jobIndex: 0,
    candidateIndex: 0,
    title: "Technical Interview — System Design & Coding",
    type: "technical",
    status: "completed",
    daysOffset: -12,
    hour: 14,
    duration: 90,
    location: "Google Meet",
    notes:
      "Exceptional system design approach. Solved the distributed caching problem elegantly. Strong TypeScript patterns and testing discipline.",
    interviewers: ["Marcus Reiter", "Sarah Chen"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },
  {
    jobIndex: 0,
    candidateIndex: 0,
    title: "Final Panel — Culture & Leadership",
    type: "panel",
    status: "completed",
    daysOffset: -7,
    hour: 11,
    duration: 60,
    location: "Reqcore HQ, Friedrichstraße 123, Berlin",
    notes:
      "Unanimous strong hire from the panel. Great leadership examples and clear alignment with team values. Offer approved.",
    interviewers: ["Thomas Berger", "Sarah Chen", "Lisa Hoffmann"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },

  // Liam Müller (offer) — 3 rounds completed, offer pending
  {
    jobIndex: 0,
    candidateIndex: 1,
    title: "Recruiter Screen",
    type: "phone",
    status: "completed",
    daysOffset: -16,
    hour: 9,
    minute: 30,
    duration: 30,
    location: null,
    notes:
      "Well-prepared candidate. Salary expectations within band. Moving forward.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },
  {
    jobIndex: 0,
    candidateIndex: 1,
    title: "Technical Deep-Dive — Full-Stack Architecture",
    type: "technical",
    status: "completed",
    daysOffset: -10,
    hour: 15,
    duration: 90,
    location: "Google Meet",
    notes:
      "Excellent systems thinking. Strong PostgreSQL optimization knowledge. Good tradeoff analysis on caching strategies.",
    interviewers: ["Marcus Reiter", "Daniel Krause"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },
  {
    jobIndex: 0,
    candidateIndex: 1,
    title: "Hiring Manager Interview",
    type: "video",
    status: "completed",
    daysOffset: -5,
    hour: 13,
    duration: 45,
    location: "Google Meet",
    notes:
      "Great cultural fit. Proactive mindset and excellent collaboration examples. Preparing offer package.",
    interviewers: ["Sarah Chen"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },

  // Sofia Dubois (offer) — 2 rounds completed
  {
    jobIndex: 0,
    candidateIndex: 2,
    title: "Introductory Call",
    type: "phone",
    status: "completed",
    daysOffset: -14,
    hour: 11,
    duration: 30,
    location: null,
    notes:
      "Strong backend focus with solid frontend skills. Motivated by the open-source mission.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "accepted",
    timezone: "Europe/Paris",
  },
  {
    jobIndex: 0,
    candidateIndex: 2,
    title: "Technical Assessment — Live Coding",
    type: "technical",
    status: "completed",
    daysOffset: -8,
    hour: 14,
    minute: 30,
    duration: 75,
    location: "Google Meet",
    notes:
      "Clean code structure and strong testing habits. Handled edge cases well during the API design exercise.",
    interviewers: ["Marcus Reiter"],
    candidateResponse: "accepted",
    timezone: "Europe/Paris",
  },

  // Noah van der Berg (interview) — 1 completed, 1 upcoming
  {
    jobIndex: 0,
    candidateIndex: 3,
    title: "Recruiter Phone Screen",
    type: "phone",
    status: "completed",
    daysOffset: -6,
    hour: 10,
    duration: 30,
    location: null,
    notes:
      "Good technical background. Previous multi-tenant SaaS experience. Proceeding to technical round.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "accepted",
    timezone: "Europe/Amsterdam",
  },
  {
    jobIndex: 0,
    candidateIndex: 3,
    title: "Technical Interview — Architecture & Problem Solving",
    type: "technical",
    status: "scheduled",
    daysOffset: 3,
    hour: 14,
    duration: 90,
    location: "Google Meet",
    notes:
      "Focus on system design, database modeling, and real-time collaboration patterns.",
    interviewers: ["Marcus Reiter", "Sarah Chen"],
    candidateResponse: "accepted",
    timezone: "Europe/Amsterdam",
  },

  // Olivia Rossi (interview) — 1 upcoming
  {
    jobIndex: 0,
    candidateIndex: 4,
    title: "Initial Video Screen",
    type: "video",
    status: "scheduled",
    daysOffset: 2,
    hour: 11,
    duration: 45,
    location: "Google Meet",
    notes:
      "Review portfolio projects and discuss full-stack experience with Vue/Nuxt.",
    interviewers: ["Sarah Chen"],
    candidateResponse: "accepted",
    timezone: "Europe/Rome",
  },

  // James O\'Brien (interview) — 1 upcoming, pending response
  {
    jobIndex: 0,
    candidateIndex: 5,
    title: "Phone Screen",
    type: "phone",
    status: "scheduled",
    daysOffset: 5,
    hour: 15,
    duration: 30,
    location: null,
    notes: "Discuss background, role expectations, and availability.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "pending",
    timezone: "Europe/London",
  },

  // ──────────────────────────────────────────
  // Job 1: Product Designer
  // ──────────────────────────────────────────

  // David Kim (offer) — 2 rounds completed
  {
    jobIndex: 1,
    candidateIndex: 14,
    title: "Portfolio Review & Design Discussion",
    type: "video",
    status: "completed",
    daysOffset: -15,
    hour: 10,
    duration: 60,
    location: "Google Meet",
    notes:
      "Exceptional portfolio depth. Clear articulation of design decisions and business impact. Strong systems thinking.",
    interviewers: ["Julia Engel"],
    candidateResponse: "accepted",
    timezone: "Asia/Seoul",
  },
  {
    jobIndex: 1,
    candidateIndex: 14,
    title: "Design Challenge Debrief & Team Fit",
    type: "panel",
    status: "completed",
    daysOffset: -8,
    hour: 9,
    duration: 75,
    location: "Google Meet",
    notes:
      "Design challenge solution was thoughtful and user-centered. Excellent collaboration style during critique. Strong hire recommendation.",
    interviewers: ["Julia Engel", "Lisa Hoffmann", "Thomas Berger"],
    candidateResponse: "accepted",
    timezone: "Asia/Seoul",
  },

  // Elena Petrova (interview) — 1 upcoming
  {
    jobIndex: 1,
    candidateIndex: 15,
    title: "Portfolio Walkthrough & Design Process",
    type: "video",
    status: "scheduled",
    daysOffset: 4,
    hour: 13,
    duration: 60,
    location: "Google Meet",
    notes:
      "Review 2-3 case studies. Assess design thinking, research methods, and handoff practices.",
    interviewers: ["Julia Engel"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },

  // Alexander Johansson (interview) — 1 upcoming, tentative response
  {
    jobIndex: 1,
    candidateIndex: 16,
    title: "Introductory Design Interview",
    type: "video",
    status: "scheduled",
    daysOffset: 6,
    hour: 10,
    minute: 30,
    duration: 45,
    location: "Google Meet",
    notes:
      "Discuss portfolio highlights, design process, and interest in B2B SaaS products.",
    interviewers: ["Julia Engel", "Lisa Hoffmann"],
    candidateResponse: "tentative",
    timezone: "Europe/Stockholm",
  },

  // Maria Costa (interview) — 1 completed, 1 upcoming
  {
    jobIndex: 1,
    candidateIndex: 17,
    title: "Initial Screening Call",
    type: "phone",
    status: "completed",
    daysOffset: -5,
    hour: 14,
    duration: 30,
    location: null,
    notes:
      "Strong cross-functional collaboration background. Interesting perspective on accessible design.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "accepted",
    timezone: "Europe/Lisbon",
  },
  {
    jobIndex: 1,
    candidateIndex: 17,
    title: "Design Exercise Review & Discussion",
    type: "video",
    status: "scheduled",
    daysOffset: 7,
    hour: 11,
    duration: 90,
    location: "Google Meet",
    notes:
      "Review take-home design exercise. Assess problem framing, research approach, and visual execution.",
    interviewers: ["Julia Engel", "Lisa Hoffmann"],
    candidateResponse: "accepted",
    timezone: "Europe/Lisbon",
  },

  // ──────────────────────────────────────────
  // Job 2: DevOps Engineer
  // ──────────────────────────────────────────

  // James O\'Brien (hired) — 2 rounds completed
  {
    jobIndex: 2,
    candidateIndex: 5,
    title: "Technical Screen — Infrastructure & CI/CD",
    type: "technical",
    status: "completed",
    daysOffset: -20,
    hour: 14,
    duration: 60,
    location: "Google Meet",
    notes:
      "Deep Docker expertise and strong GitHub Actions experience. Excellent incident response examples.",
    interviewers: ["Daniel Krause"],
    candidateResponse: "accepted",
    timezone: "Europe/London",
  },
  {
    jobIndex: 2,
    candidateIndex: 5,
    title: "System Design — Deployment Architecture",
    type: "technical",
    status: "completed",
    daysOffset: -14,
    hour: 11,
    duration: 90,
    location: "Google Meet",
    notes:
      "Outstanding architecture proposal for multi-region deployment with automated failover. Strong security awareness. Contract approved.",
    interviewers: ["Daniel Krause", "Thomas Berger"],
    candidateResponse: "accepted",
    timezone: "Europe/London",
  },

  // Amara Okafor (offer) — 2 rounds completed
  {
    jobIndex: 2,
    candidateIndex: 6,
    title: "Introductory Technical Call",
    type: "video",
    status: "completed",
    daysOffset: -12,
    hour: 13,
    duration: 45,
    location: "Google Meet",
    notes:
      "Strong platform engineering background. Good experience with Terraform and observability tooling.",
    interviewers: ["Daniel Krause"],
    candidateResponse: "accepted",
    timezone: "Africa/Lagos",
  },
  {
    jobIndex: 2,
    candidateIndex: 6,
    title: "Hands-On Technical Challenge Review",
    type: "technical",
    status: "completed",
    daysOffset: -6,
    hour: 15,
    duration: 75,
    location: "Google Meet",
    notes:
      "Well-structured solution to the Dockerized deployment exercise. Clean IaC approach. Offer being prepared.",
    interviewers: ["Daniel Krause", "Marcus Reiter"],
    candidateResponse: "accepted",
    timezone: "Africa/Lagos",
  },

  // Yuki Tanaka (interview) — 1 upcoming
  {
    jobIndex: 2,
    candidateIndex: 7,
    title: "Technical Assessment — Container Orchestration",
    type: "technical",
    status: "scheduled",
    daysOffset: 3,
    hour: 9,
    duration: 60,
    location: "Google Meet",
    notes:
      "Focus on Docker best practices, CI pipeline design, and monitoring strategies.",
    interviewers: ["Daniel Krause"],
    candidateResponse: "accepted",
    timezone: "Asia/Tokyo",
  },

  // Lucas Andersson (interview) — 1 completed, 1 upcoming
  {
    jobIndex: 2,
    candidateIndex: 8,
    title: "Initial Phone Screen",
    type: "phone",
    status: "completed",
    daysOffset: -4,
    hour: 10,
    duration: 30,
    location: null,
    notes:
      "Good automation mindset. Relevant experience with GitHub Actions and Postgres ops. Moving to technical round.",
    interviewers: ["Anna Weiss"],
    candidateResponse: "accepted",
    timezone: "Europe/Stockholm",
  },
  {
    jobIndex: 2,
    candidateIndex: 8,
    title: "Technical Deep-Dive — Infrastructure as Code",
    type: "technical",
    status: "scheduled",
    daysOffset: 8,
    hour: 14,
    duration: 75,
    location: "Google Meet",
    notes:
      "Practical exercise: design a CI/CD pipeline for a multi-service deployment with rollback support.",
    interviewers: ["Daniel Krause", "Thomas Berger"],
    candidateResponse: "pending",
    timezone: "Europe/Stockholm",
  },

  // ──────────────────────────────────────────
  // Job 3: Technical Writer
  // ──────────────────────────────────────────

  // Felix Weber (offer) — 2 rounds completed
  {
    jobIndex: 3,
    candidateIndex: 12,
    title: "Writing Sample Review & Discussion",
    type: "video",
    status: "completed",
    daysOffset: -11,
    hour: 10,
    duration: 45,
    location: "Google Meet",
    notes:
      "Excellent technical writing samples. Clear information architecture and reader-first approach.",
    interviewers: ["Lisa Hoffmann"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },
  {
    jobIndex: 3,
    candidateIndex: 12,
    title: "Editorial Discussion & Team Integration",
    type: "video",
    status: "completed",
    daysOffset: -4,
    hour: 14,
    duration: 60,
    location: "Google Meet",
    notes:
      "Strong docs-as-code experience and excellent editorial judgment. Great fit for the team. Offer recommended.",
    interviewers: ["Lisa Hoffmann", "Sarah Chen"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },

  // David Kim (interview) — 1 upcoming
  {
    jobIndex: 3,
    candidateIndex: 14,
    title: "Technical Writing Assessment Review",
    type: "video",
    status: "scheduled",
    daysOffset: 5,
    hour: 10,
    duration: 60,
    location: "Google Meet",
    notes:
      "Review submitted API documentation sample. Discuss approach to developer docs and information architecture.",
    interviewers: ["Lisa Hoffmann"],
    candidateResponse: "accepted",
    timezone: "Asia/Seoul",
  },

  // Alexander Johansson (interview) — 1 cancelled + rescheduled
  {
    jobIndex: 3,
    candidateIndex: 16,
    title: "Introductory Call",
    type: "phone",
    status: "cancelled",
    daysOffset: -3,
    hour: 15,
    duration: 30,
    location: null,
    notes:
      "Candidate requested reschedule due to conflict. Rebooked for next week.",
    interviewers: ["Lisa Hoffmann"],
    candidateResponse: "declined",
    timezone: "Europe/Stockholm",
  },
  {
    jobIndex: 3,
    candidateIndex: 16,
    title: "Introductory Call (Rescheduled)",
    type: "video",
    status: "scheduled",
    daysOffset: 6,
    hour: 13,
    duration: 30,
    location: "Google Meet",
    notes:
      "Rescheduled from last week. Discuss writing background and interest in the role.",
    interviewers: ["Lisa Hoffmann"],
    candidateResponse: "accepted",
    timezone: "Europe/Stockholm",
  },

  // ──────────────────────────────────────────
  // Job 4: Frontend Engineering Intern
  // ──────────────────────────────────────────

  // Emma Schmidt (interview) — 1 completed, 1 upcoming
  {
    jobIndex: 4,
    candidateIndex: 0,
    title: "Intro Call — Internship Overview",
    type: "video",
    status: "completed",
    daysOffset: -5,
    hour: 14,
    duration: 30,
    location: "Google Meet",
    notes:
      "Very enthusiastic and well-prepared. Impressive personal projects using Vue and Tailwind. Strong learning velocity.",
    interviewers: ["Sarah Chen"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },
  {
    jobIndex: 4,
    candidateIndex: 0,
    title: "Technical Screen — Frontend Fundamentals",
    type: "technical",
    status: "scheduled",
    daysOffset: 4,
    hour: 10,
    duration: 60,
    location: "Google Meet",
    notes:
      "Assess HTML/CSS/JS fundamentals, component thinking, and basic Vue.js understanding.",
    interviewers: ["Marcus Reiter"],
    candidateResponse: "accepted",
    timezone: "Europe/Berlin",
  },

  // Sofia Dubois (interview) — 1 upcoming
  {
    jobIndex: 4,
    candidateIndex: 2,
    title: "Internship Interview — Skills & Motivation",
    type: "video",
    status: "scheduled",
    daysOffset: 2,
    hour: 16,
    duration: 45,
    location: "Google Meet",
    notes:
      "Discuss academic projects, frontend experience, and career goals in software engineering.",
    interviewers: ["Sarah Chen", "Marcus Reiter"],
    candidateResponse: "accepted",
    timezone: "Europe/Paris",
  },
];

// Sample responses for questions
function generateResponses(
  jobIndex: number,
  candidateIndex: number,
): Record<string, string | string[] | number | boolean> {
  const candidate = CANDIDATES_DATA[candidateIndex];
  if (!candidate) {
    return {};
  }

  if (jobIndex === 0) {
    const years = [5, 6, 7, 8, 5, 6];
    const frameworks = ["Vue", "React", "Svelte", "Vue", "React", "Vue"];
    const starts = [
      "Immediately",
      "2 weeks",
      "1 month",
      "2 weeks",
      "1 month",
      "2-3 months",
    ];
    const problems = [
      "Migrated a monolithic REST API to a GraphQL federation with zero downtime across 12 microservices.",
      "Built a real-time collaboration engine using CRDTs that supports 500+ concurrent users editing the same document.",
      "Redesigned our database schema to support multi-tenancy, reducing query latency by 60% and storage costs by 40%.",
      "Implemented an automated canary deployment pipeline that reduced production incidents by 75%.",
      "Built a custom state management solution for a complex form wizard with 20+ conditional steps and offline support.",
      "Created a type-safe API client generator from OpenAPI specs that eliminated an entire class of runtime errors.",
    ];
    const i = candidateIndex % years.length;
    const year = getArrayItemOrThrow(years, i, "TypeScript years response");
    const framework = getArrayItemOrThrow(frameworks, i, "framework response");
    const problem = getArrayItemOrThrow(problems, i, "problem response");
    const start = getArrayItemOrThrow(starts, i, "start date response");
    return {
      "Years of TypeScript experience": year,
      "Preferred frontend framework": framework,
      "Describe a challenging technical problem you solved recently": problem,
      "Link to your GitHub profile or portfolio": `https://github.com/${candidate.firstName.toLowerCase()}${candidate.lastName.toLowerCase().replace(/['\s]/g, "")}`,
      "When can you start?": start,
    };
  }
  if (jobIndex === 1) {
    const tools = ["Figma", "Figma", "Sketch", "Figma"];
    const processes = [
      "I start with stakeholder interviews to understand goals, then user research (interviews + analytics). I create low-fi wireframes in FigJam, iterate with the team, then move to high-fidelity in Figma with a component library.",
      "My process: Research → Competitive analysis → User flows → Wireframes → Prototypes → User testing → Iteration. I always validate with real users before implementation.",
      "I follow a double diamond approach: Discover (research), Define (insights), Develop (ideation), Deliver (testing). I document everything in a design spec for handoff.",
      "I believe in rapid prototyping. Quick sketches → Figma prototypes → guerrilla testing → iteration. Speed of learning beats perfection.",
    ];
    const i = candidateIndex % tools.length;
    const tool = getArrayItemOrThrow(tools, i, "design tool response");
    const process = getArrayItemOrThrow(
      processes,
      i,
      "design process response",
    );
    return {
      "Link to your portfolio": `https://dribbble.com/${candidate.firstName.toLowerCase()}${candidate.lastName.toLowerCase().charAt(0)}`,
      "Years of product design experience": 3 + (candidateIndex % 5),
      "Primary design tool": tool,
      "Walk us through your design process for a recent project": process,
      "I have experience with design systems": candidateIndex % 2 === 0,
    };
  }
  if (jobIndex === 2) {
    const platforms = [
      ["AWS", "Hetzner"],
      ["GCP", "AWS", "Azure"],
      ["AWS", "DigitalOcean"],
      ["Hetzner", "DigitalOcean"],
      ["AWS", "GCP"],
      ["Azure"],
    ];
    const ciPlatforms = [
      "GitHub Actions",
      "GitLab CI",
      "GitHub Actions",
      "Jenkins",
      "GitHub Actions",
      "CircleCI",
    ];
    const dockerYears = [3, 4, 5, 6, 3, 7];
    const i = candidateIndex % platforms.length;
    const platformList = getArrayItemOrThrow(
      platforms,
      i,
      "cloud platform response",
    );
    const ciPlatform = getArrayItemOrThrow(
      ciPlatforms,
      i,
      "CI/CD platform response",
    );
    const dockerYear = getArrayItemOrThrow(
      dockerYears,
      i,
      "docker years response",
    );
    return {
      "Which cloud platforms have you worked with?": platformList,
      "Years of Docker experience": dockerYear,
      "Preferred CI/CD platform": ciPlatform,
    };
  }
  if (jobIndex === 3) {
    const documentation = [
      ["API documentation", "User guides", "Release notes"],
      ["Deployment guides", "Tutorials"],
      ["API documentation", "Deployment guides"],
      ["User guides", "Tutorials", "Release notes"],
    ];
    const i = candidateIndex % documentation.length;
    return {
      "Link to a technical writing sample": `https://docs.example.com/${candidate.firstName.toLowerCase()}-${candidate.lastName.toLowerCase().replace(/['\s]/g, "-")}`,
      "Years of technical writing experience": 2 + (candidateIndex % 5),
      "Which documentation have you owned?": getArrayItemOrThrow(
        documentation,
        i,
        "documentation ownership response",
      ),
      "I have worked in a docs-as-code workflow": candidateIndex % 3 !== 0,
    };
  }
  if (jobIndex === 4) {
    const technologies = [
      ["HTML/CSS", "JavaScript", "TypeScript", "Vue"],
      ["HTML/CSS", "JavaScript", "React"],
      ["HTML/CSS", "JavaScript", "Vue"],
      ["HTML/CSS", "JavaScript", "TypeScript"],
    ];
    const i = candidateIndex % technologies.length;
    return {
      "Are you currently enrolled in a degree program?": "Yes",
      "Can you work on-site in Berlin for this internship?":
        candidateIndex % 2 === 0
          ? "Yes — on-site in Berlin"
          : "Yes — I can relocate",
      "Which frontend technologies have you used in projects?":
        getArrayItemOrThrow(technologies, i, "frontend technologies response"),
      "Link to a GitHub profile or frontend project": `https://github.com/${candidate.firstName.toLowerCase()}${candidate.lastName.toLowerCase().replace(/['\s]/g, "")}`,
    };
  }
  return {};
}

// ─────────────────────────────────────────────
// Source Tracking — Tracking links & attribution
// ─────────────────────────────────────────────

type SourceChannel =
  | "linkedin"
  | "indeed"
  | "glassdoor"
  | "ziprecruiter"
  | "monster"
  | "handshake"
  | "angellist"
  | "wellfound"
  | "dice"
  | "stackoverflow"
  | "weworkremotely"
  | "remoteok"
  | "builtin"
  | "hired"
  | "lever"
  | "greenhouse_board"
  | "google_jobs"
  | "facebook"
  | "twitter"
  | "instagram"
  | "tiktok"
  | "reddit"
  | "referral"
  | "career_site"
  | "email"
  | "event"
  | "agency"
  | "direct"
  | "other"
  | "custom";

interface TrackingLinkSeed {
  /** null = org-wide link, number = job index */
  jobIndex: number | null;
  channel: SourceChannel;
  name: string;
  code: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  clickCount: number;
  applicationCount: number;
  isActive: boolean;
  daysAgoCreated: number;
}

const TRACKING_LINKS_DATA: TrackingLinkSeed[] = [
  // ── Job 0: Senior Full-Stack Engineer ──
  {
    jobIndex: 0,
    channel: "linkedin",
    name: "LinkedIn – Senior Engineer Spring 2026",
    code: "lnk-se01",
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    utmContent: "sponsored-post",
    clickCount: 284,
    applicationCount: 4,
    isActive: true,
    daysAgoCreated: 25,
  },
  {
    jobIndex: 0,
    channel: "indeed",
    name: "Indeed – Full-Stack Engineer Listing",
    code: "ind-se02",
    utmSource: "indeed",
    utmMedium: "job_board",
    utmCampaign: "fullstack-q1-2026",
    clickCount: 196,
    applicationCount: 3,
    isActive: true,
    daysAgoCreated: 22,
  },
  {
    jobIndex: 0,
    channel: "stackoverflow",
    name: "Stack Overflow Jobs – TypeScript Senior",
    code: "so-se003",
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    utmCampaign: "typescript-senior-2026",
    clickCount: 112,
    applicationCount: 2,
    isActive: true,
    daysAgoCreated: 20,
  },
  {
    jobIndex: 0,
    channel: "referral",
    name: "Employee Referral – Engineering Team",
    code: "ref-se04",
    utmSource: "referral",
    utmMedium: "internal",
    utmCampaign: "eng-referral-bonus",
    clickCount: 18,
    applicationCount: 2,
    isActive: true,
    daysAgoCreated: 24,
  },

  // ── Job 1: Product Designer ──
  {
    jobIndex: 1,
    channel: "linkedin",
    name: "LinkedIn – Product Designer EU",
    code: "lnk-pd05",
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    clickCount: 341,
    applicationCount: 4,
    isActive: true,
    daysAgoCreated: 23,
  },
  {
    jobIndex: 1,
    channel: "other",
    name: "Dribbble – Designer Position Board",
    code: "drb-pd06",
    utmSource: "dribbble",
    utmMedium: "job_board",
    utmCampaign: "designer-spring-2026",
    clickCount: 89,
    applicationCount: 2,
    isActive: true,
    daysAgoCreated: 21,
  },
  {
    jobIndex: 1,
    channel: "twitter",
    name: "Twitter/X – Design Hiring Thread",
    code: "tw-pd007",
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    utmContent: "thread-v2",
    clickCount: 156,
    applicationCount: 2,
    isActive: true,
    daysAgoCreated: 18,
  },

  // ── Job 2: DevOps Engineer ──
  {
    jobIndex: 2,
    channel: "linkedin",
    name: "LinkedIn – DevOps Contract Remote",
    code: "lnk-do08",
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "devops-contract-worldwide",
    clickCount: 203,
    applicationCount: 3,
    isActive: true,
    daysAgoCreated: 20,
  },
  {
    jobIndex: 2,
    channel: "weworkremotely",
    name: "WeWorkRemotely – DevOps Listing",
    code: "wwr-do09",
    utmSource: "weworkremotely",
    utmMedium: "job_board",
    utmCampaign: "devops-remote-2026",
    clickCount: 134,
    applicationCount: 3,
    isActive: true,
    daysAgoCreated: 19,
  },
  {
    jobIndex: 2,
    channel: "reddit",
    name: "Reddit r/devops – Hiring Post",
    code: "rdt-do10",
    utmSource: "reddit",
    utmMedium: "social",
    utmCampaign: "r-devops-hiring",
    utmContent: "march-post",
    clickCount: 78,
    applicationCount: 1,
    isActive: false, // expired campaign
    daysAgoCreated: 28,
  },

  // ── Job 3: Technical Writer ──
  {
    jobIndex: 3,
    channel: "email",
    name: "Newsletter – Tech Writer Part-Time",
    code: "eml-tw11",
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "writer-newsletter-mar-2026",
    clickCount: 67,
    applicationCount: 3,
    isActive: true,
    daysAgoCreated: 17,
  },
  {
    jobIndex: 3,
    channel: "career_site",
    name: "Careers Page – Technical Writer",
    code: "web-tw12",
    utmSource: "career_site",
    utmMedium: "organic",
    utmCampaign: "careers-page",
    clickCount: 43,
    applicationCount: 3,
    isActive: true,
    daysAgoCreated: 16,
  },

  // ── Job 4: Frontend Intern ──
  {
    jobIndex: 4,
    channel: "handshake",
    name: "Handshake – Frontend Intern Berlin",
    code: "hs-fi013",
    utmSource: "handshake",
    utmMedium: "job_board",
    utmCampaign: "intern-summer-2026",
    clickCount: 227,
    applicationCount: 5,
    isActive: true,
    daysAgoCreated: 15,
  },
  {
    jobIndex: 4,
    channel: "event",
    name: "TU Berlin Career Fair – Booth QR",
    code: "evt-fi14",
    utmSource: "tu_berlin_fair",
    utmMedium: "event",
    utmCampaign: "career-fair-spring-2026",
    clickCount: 52,
    applicationCount: 2,
    isActive: true,
    daysAgoCreated: 12,
  },

  // ── Org-wide links (no specific job) ──
  {
    jobIndex: null,
    channel: "linkedin",
    name: "LinkedIn Company Page – All Roles",
    code: "lnk-org1",
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "company-page-hiring",
    clickCount: 512,
    applicationCount: 2,
    isActive: true,
    daysAgoCreated: 30,
  },
  {
    jobIndex: null,
    channel: "google_jobs",
    name: "Google Jobs – Aggregated Listings",
    code: "ggl-org2",
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    clickCount: 389,
    applicationCount: 3,
    isActive: true,
    daysAgoCreated: 29,
  },
  {
    jobIndex: null,
    channel: "agency",
    name: "TechTalent Agency – Q1 Pipeline",
    code: "agt-org3",
    utmSource: "techtalent_agency",
    utmMedium: "agency",
    utmCampaign: "techtalent-q1-2026",
    clickCount: 34,
    applicationCount: 1,
    isActive: true,
    daysAgoCreated: 26,
  },
  {
    jobIndex: null,
    channel: "facebook",
    name: "Facebook – Berlin Tech Jobs Group",
    code: "fb-org04",
    utmSource: "facebook",
    utmMedium: "social",
    utmCampaign: "berlin-tech-group",
    clickCount: 145,
    applicationCount: 0,
    isActive: false, // ended campaign
    daysAgoCreated: 27,
  },
  {
    jobIndex: null,
    channel: "glassdoor",
    name: "Glassdoor – Company Profile",
    code: "gd-org05",
    utmSource: "glassdoor",
    utmMedium: "job_board",
    utmCampaign: "glassdoor-profile-2026",
    clickCount: 198,
    applicationCount: 1,
    isActive: true,
    daysAgoCreated: 28,
  },
];

/**
 * Source attribution assignments for applications.
 * Maps each application (by jobIndex-candidateIndex) to its source.
 * Applications not listed here will get 'direct' as default.
 */
interface ApplicationSourceSeed {
  jobIndex: number;
  candidateIndex: number;
  channel: SourceChannel;
  /** Index into TRACKING_LINKS_DATA if this came via a tracking link, or null */
  trackingLinkIndex: number | null;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrerDomain?: string;
}

const APPLICATION_SOURCES_DATA: ApplicationSourceSeed[] = [
  // ── Job 0: Senior Full-Stack Engineer (14 applications) ──
  // Via LinkedIn tracking link
  {
    jobIndex: 0,
    candidateIndex: 0,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    utmContent: "sponsored-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 1,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    utmContent: "sponsored-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 3,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  // Via Indeed tracking link
  {
    jobIndex: 0,
    candidateIndex: 2,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    utmCampaign: "fullstack-q1-2026",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 4,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    utmCampaign: "fullstack-q1-2026",
    referrerDomain: "indeed.com",
  },
  // Via Stack Overflow tracking link
  {
    jobIndex: 0,
    candidateIndex: 5,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    utmCampaign: "typescript-senior-2026",
    referrerDomain: "stackoverflow.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 8,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    referrerDomain: "stackoverflow.com",
  },
  // Via employee referral link
  {
    jobIndex: 0,
    candidateIndex: 6,
    channel: "referral",
    trackingLinkIndex: 3,
    utmSource: "referral",
    utmMedium: "internal",
    utmCampaign: "eng-referral-bonus",
  },
  {
    jobIndex: 0,
    candidateIndex: 7,
    channel: "referral",
    trackingLinkIndex: 3,
    utmSource: "referral",
    utmMedium: "internal",
    utmCampaign: "eng-referral-bonus",
  },
  // Organic / UTM-only (no tracking link)
  {
    jobIndex: 0,
    candidateIndex: 9,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 10,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 11,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 0,
    candidateIndex: 12,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 13,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    referrerDomain: "indeed.com",
  },

  // ── Job 0: 120 additional applicants — attributed sources (~40%) ──
  // LinkedIn (tracking link 0) — highest volume channel
  {
    jobIndex: 0,
    candidateIndex: 30,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 40,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    utmContent: "sponsored-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 50,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 60,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 70,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    utmContent: "sponsored-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 80,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 90,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 110,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    utmContent: "sponsored-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 41,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 44,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 71,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 91,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 111,
    channel: "linkedin",
    trackingLinkIndex: 0,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "senior-engineer-spring-2026",
    referrerDomain: "linkedin.com",
  },
  // Indeed (tracking link 1)
  {
    jobIndex: 0,
    candidateIndex: 31,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    utmCampaign: "fullstack-q1-2026",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 51,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    utmCampaign: "fullstack-q1-2026",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 61,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 81,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    utmCampaign: "fullstack-q1-2026",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 113,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 120,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    referrerDomain: "indeed.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 128,
    channel: "indeed",
    trackingLinkIndex: 1,
    utmSource: "indeed",
    utmMedium: "job_board",
    referrerDomain: "indeed.com",
  },
  // Stack Overflow (tracking link 2)
  {
    jobIndex: 0,
    candidateIndex: 34,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    utmCampaign: "typescript-senior-2026",
    referrerDomain: "stackoverflow.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 53,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    referrerDomain: "stackoverflow.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 74,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    utmCampaign: "typescript-senior-2026",
    referrerDomain: "stackoverflow.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 84,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    referrerDomain: "stackoverflow.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 99,
    channel: "stackoverflow",
    trackingLinkIndex: 2,
    utmSource: "stackoverflow",
    utmMedium: "job_board",
    referrerDomain: "stackoverflow.com",
  },
  // Referral (tracking link 3)
  {
    jobIndex: 0,
    candidateIndex: 58,
    channel: "referral",
    trackingLinkIndex: 3,
    utmSource: "referral",
    utmMedium: "internal",
    utmCampaign: "eng-referral-bonus",
  },
  {
    jobIndex: 0,
    candidateIndex: 79,
    channel: "referral",
    trackingLinkIndex: 3,
    utmSource: "referral",
    utmMedium: "internal",
    utmCampaign: "eng-referral-bonus",
  },
  {
    jobIndex: 0,
    candidateIndex: 93,
    channel: "referral",
    trackingLinkIndex: 3,
    utmSource: "referral",
    utmMedium: "internal",
    utmCampaign: "eng-referral-bonus",
  },
  // Google Jobs (tracking link 15)
  {
    jobIndex: 0,
    candidateIndex: 32,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 42,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 64,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 72,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 92,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 107,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  // Career site (direct from reqcore.com/careers)
  {
    jobIndex: 0,
    candidateIndex: 36,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 46,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 55,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 76,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 0,
    candidateIndex: 94,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  // Direct (typed URL / bookmarked)
  {
    jobIndex: 0,
    candidateIndex: 33,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 0,
    candidateIndex: 43,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 0,
    candidateIndex: 63,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 0,
    candidateIndex: 83,
    channel: "direct",
    trackingLinkIndex: null,
  },

  // ── Job 1: Product Designer (12 applications) ──
  // Via LinkedIn tracking link
  {
    jobIndex: 1,
    candidateIndex: 14,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 15,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 16,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  // Via Dribbble tracking link (custom channel since dribbble isn't in enum)
  {
    jobIndex: 1,
    candidateIndex: 17,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    utmCampaign: "designer-spring-2026",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 18,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  // Via Twitter tracking link
  {
    jobIndex: 1,
    candidateIndex: 19,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 20,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  // Organic / no tracking link
  {
    jobIndex: 1,
    candidateIndex: 21,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 22,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 23,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 24,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 25,
    channel: "agency",
    trackingLinkIndex: 16,
    utmSource: "techtalent_agency",
    utmMedium: "agency",
    utmCampaign: "techtalent-q1-2026",
  },

  // ── Job 1: Product Designer — 250 additional applicants source attribution (~36% attributed) ──
  // LinkedIn (tracking link 4) — dominant channel for designer roles
  {
    jobIndex: 1,
    candidateIndex: 150,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 180,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 210,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 240,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 260,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 300,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 151,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 181,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 211,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 241,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 261,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 301,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 152,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 182,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 212,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 242,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 330,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 340,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 350,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 360,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 380,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  // Dribbble (tracking link 5)
  {
    jobIndex: 1,
    candidateIndex: 153,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    utmCampaign: "designer-spring-2026",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 183,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 213,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    utmCampaign: "designer-spring-2026",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 243,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 263,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 303,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    utmCampaign: "designer-spring-2026",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 331,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 355,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 381,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  // Twitter (tracking link 6)
  {
    jobIndex: 1,
    candidateIndex: 154,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 184,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 214,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    utmContent: "thread-v2",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 244,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 264,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 304,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 335,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 370,
    channel: "twitter",
    trackingLinkIndex: 6,
    utmSource: "twitter",
    utmMedium: "social",
    utmCampaign: "design-hiring-thread",
    referrerDomain: "x.com",
  },
  // Google Jobs org-wide (tracking link 15)
  {
    jobIndex: 1,
    candidateIndex: 155,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 185,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 215,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 245,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 265,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 305,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 320,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 345,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 375,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    referrerDomain: "google.com",
  },
  // Career site (organic, no tracking link)
  {
    jobIndex: 1,
    candidateIndex: 156,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 186,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 216,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 246,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 266,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 306,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 336,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 365,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 390,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  // Direct (typed URL or bookmarked)
  {
    jobIndex: 1,
    candidateIndex: 157,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 187,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 217,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 247,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 267,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 307,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 337,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 361,
    channel: "direct",
    trackingLinkIndex: null,
  },
  // Glassdoor (org-wide link 18)
  {
    jobIndex: 1,
    candidateIndex: 158,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    utmCampaign: "glassdoor-profile-2026",
    referrerDomain: "glassdoor.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 188,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    referrerDomain: "glassdoor.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 218,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    referrerDomain: "glassdoor.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 248,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    utmCampaign: "glassdoor-profile-2026",
    referrerDomain: "glassdoor.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 385,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    referrerDomain: "glassdoor.com",
  },
  // Additional second-week Product Designer volume
  {
    jobIndex: 1,
    candidateIndex: 400,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    utmContent: "carousel-post",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 401,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    utmCampaign: "designer-spring-2026",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 402,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 403,
    channel: "linkedin",
    trackingLinkIndex: 4,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "product-designer-eu-2026",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 404,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 405,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 1,
    candidateIndex: 414,
    channel: "other",
    trackingLinkIndex: 5,
    utmSource: "dribbble",
    utmMedium: "job_board",
    referrerDomain: "dribbble.com",
  },
  {
    jobIndex: 1,
    candidateIndex: 418,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    utmCampaign: "glassdoor-profile-2026",
    referrerDomain: "glassdoor.com",
  },

  // ── Job 2: DevOps Engineer (11 applications) ──
  // Via LinkedIn tracking link
  {
    jobIndex: 2,
    candidateIndex: 5,
    channel: "linkedin",
    trackingLinkIndex: 7,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "devops-contract-worldwide",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 2,
    candidateIndex: 6,
    channel: "linkedin",
    trackingLinkIndex: 7,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "devops-contract-worldwide",
    referrerDomain: "linkedin.com",
  },
  // Via WeWorkRemotely tracking link
  {
    jobIndex: 2,
    candidateIndex: 7,
    channel: "weworkremotely",
    trackingLinkIndex: 8,
    utmSource: "weworkremotely",
    utmMedium: "job_board",
    utmCampaign: "devops-remote-2026",
    referrerDomain: "weworkremotely.com",
  },
  {
    jobIndex: 2,
    candidateIndex: 8,
    channel: "weworkremotely",
    trackingLinkIndex: 8,
    utmSource: "weworkremotely",
    utmMedium: "job_board",
    referrerDomain: "weworkremotely.com",
  },
  {
    jobIndex: 2,
    candidateIndex: 9,
    channel: "weworkremotely",
    trackingLinkIndex: 8,
    utmSource: "weworkremotely",
    utmMedium: "job_board",
    referrerDomain: "weworkremotely.com",
  },
  // Via Reddit tracking link (inactive link — still attributed)
  {
    jobIndex: 2,
    candidateIndex: 10,
    channel: "reddit",
    trackingLinkIndex: 9,
    utmSource: "reddit",
    utmMedium: "social",
    utmCampaign: "r-devops-hiring",
    utmContent: "march-post",
    referrerDomain: "reddit.com",
  },
  // Organic / no tracking link
  {
    jobIndex: 2,
    candidateIndex: 26,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 2,
    candidateIndex: 27,
    channel: "glassdoor",
    trackingLinkIndex: 18,
    utmSource: "glassdoor",
    utmMedium: "job_board",
    utmCampaign: "glassdoor-profile-2026",
    referrerDomain: "glassdoor.com",
  },
  {
    jobIndex: 2,
    candidateIndex: 28,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 2,
    candidateIndex: 29,
    channel: "linkedin",
    trackingLinkIndex: 7,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "devops-contract-worldwide",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 2,
    candidateIndex: 13,
    channel: "indeed",
    trackingLinkIndex: null,
    utmSource: "indeed",
    utmMedium: "job_board",
    referrerDomain: "indeed.com",
  },

  // ── Job 3: Technical Writer (10 applications) ──
  // Via email newsletter tracking link
  {
    jobIndex: 3,
    candidateIndex: 12,
    channel: "email",
    trackingLinkIndex: 10,
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "writer-newsletter-mar-2026",
  },
  {
    jobIndex: 3,
    candidateIndex: 14,
    channel: "email",
    trackingLinkIndex: 10,
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "writer-newsletter-mar-2026",
  },
  {
    jobIndex: 3,
    candidateIndex: 16,
    channel: "email",
    trackingLinkIndex: 10,
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "writer-newsletter-mar-2026",
  },
  // Via careers page tracking link
  {
    jobIndex: 3,
    candidateIndex: 18,
    channel: "career_site",
    trackingLinkIndex: 11,
    utmSource: "career_site",
    utmMedium: "organic",
    utmCampaign: "careers-page",
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 3,
    candidateIndex: 20,
    channel: "career_site",
    trackingLinkIndex: 11,
    utmSource: "career_site",
    utmMedium: "organic",
    referrerDomain: "reqcore.com",
  },
  // Organic / no tracking link
  {
    jobIndex: 3,
    candidateIndex: 22,
    channel: "linkedin",
    trackingLinkIndex: 14,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "company-page-hiring",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 3,
    candidateIndex: 24,
    channel: "google_jobs",
    trackingLinkIndex: 15,
    utmSource: "google_jobs",
    utmMedium: "aggregator",
    utmCampaign: "google-jobs-auto",
    referrerDomain: "google.com",
  },
  {
    jobIndex: 3,
    candidateIndex: 26,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 3,
    candidateIndex: 28,
    channel: "referral",
    trackingLinkIndex: null,
    utmSource: "referral",
    utmMedium: "internal",
  },
  {
    jobIndex: 3,
    candidateIndex: 29,
    channel: "career_site",
    trackingLinkIndex: 11,
    utmSource: "career_site",
    utmMedium: "organic",
    referrerDomain: "reqcore.com",
  },

  // ── Job 4: Frontend Engineering Intern (10 applications) ──
  // Via Handshake tracking link
  {
    jobIndex: 4,
    candidateIndex: 0,
    channel: "handshake",
    trackingLinkIndex: 12,
    utmSource: "handshake",
    utmMedium: "job_board",
    utmCampaign: "intern-summer-2026",
    referrerDomain: "handshake.com",
  },
  {
    jobIndex: 4,
    candidateIndex: 2,
    channel: "handshake",
    trackingLinkIndex: 12,
    utmSource: "handshake",
    utmMedium: "job_board",
    utmCampaign: "intern-summer-2026",
    referrerDomain: "handshake.com",
  },
  {
    jobIndex: 4,
    candidateIndex: 4,
    channel: "handshake",
    trackingLinkIndex: 12,
    utmSource: "handshake",
    utmMedium: "job_board",
    referrerDomain: "handshake.com",
  },
  {
    jobIndex: 4,
    candidateIndex: 6,
    channel: "handshake",
    trackingLinkIndex: 12,
    utmSource: "handshake",
    utmMedium: "job_board",
    referrerDomain: "handshake.com",
  },
  // Via career fair event tracking link
  {
    jobIndex: 4,
    candidateIndex: 11,
    channel: "event",
    trackingLinkIndex: 13,
    utmSource: "tu_berlin_fair",
    utmMedium: "event",
    utmCampaign: "career-fair-spring-2026",
  },
  {
    jobIndex: 4,
    candidateIndex: 15,
    channel: "event",
    trackingLinkIndex: 13,
    utmSource: "tu_berlin_fair",
    utmMedium: "event",
    utmCampaign: "career-fair-spring-2026",
  },
  // Organic / no tracking link
  {
    jobIndex: 4,
    candidateIndex: 17,
    channel: "career_site",
    trackingLinkIndex: null,
    referrerDomain: "reqcore.com",
  },
  {
    jobIndex: 4,
    candidateIndex: 19,
    channel: "linkedin",
    trackingLinkIndex: 14,
    utmSource: "linkedin",
    utmMedium: "social",
    utmCampaign: "company-page-hiring",
    referrerDomain: "linkedin.com",
  },
  {
    jobIndex: 4,
    candidateIndex: 21,
    channel: "direct",
    trackingLinkIndex: null,
  },
  {
    jobIndex: 4,
    candidateIndex: 23,
    channel: "handshake",
    trackingLinkIndex: 12,
    utmSource: "handshake",
    utmMedium: "job_board",
    referrerDomain: "handshake.com",
  },
];

// ─────────────────────────────────────────────
// Candidate inbox conversations
// Every pipeline status represented in a job has at least one conversation,
// including the job's highest-scoring candidate. Only one conversation per job
// has outbound messages so the Free demo account stays within its five-thread
// cap; the remaining examples are candidate-originated follow-ups.
// ─────────────────────────────────────────────

interface CandidateInboxMessageSeed {
  direction: "inbound" | "outbound";
  subject: string;
  bodyText: string;
  daysAgo: number;
  hour: number;
  minute?: number;
}

interface CandidateInboxConversationSeed {
  jobIndex: number;
  candidateIndex: number;
  unreadCount: number;
  messages: CandidateInboxMessageSeed[];
}

function candidateFollowUp(
  jobIndex: number,
  candidateIndex: number,
  subject: string,
  bodyText: string,
  daysAgo: number,
  hour: number,
  minute: number = 0,
): CandidateInboxConversationSeed {
  return {
    jobIndex,
    candidateIndex,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject,
        bodyText,
        daysAgo,
        hour,
        minute,
      },
    ],
  };
}

const CANDIDATE_INBOX_DATA: CandidateInboxConversationSeed[] = [
  // Senior Full-Stack Engineer
  {
    jobIndex: 0,
    candidateIndex: 3,
    unreadCount: 1,
    messages: [
      {
        direction: "outbound",
        subject: "Final interview for Senior Full-Stack Engineer",
        bodyText:
          "Hi Noah,\n\nWe enjoyed reviewing your take-home exercise and would like to invite you to a final panel interview. Would Thursday afternoon or Friday morning work better for you?\n\nBest,\nDemo Recruiter",
        daysAgo: 3,
        hour: 10,
      },
      {
        direction: "inbound",
        subject: "Re: Final interview for Senior Full-Stack Engineer",
        bodyText:
          "Hi,\n\nGreat news, thank you! Friday at 10:00 CET works well for me. Could you let me know whether the panel will focus more on system design or team leadership?\n\nBest,\nNoah",
        daysAgo: 2,
        hour: 8,
        minute: 35,
      },
    ],
  },
  {
    jobIndex: 0,
    candidateIndex: 8,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "Additional details for my Full-Stack application",
        bodyText:
          "Hi Reqcore team,\n\nI wanted to add a recent project that was not yet on my CV. I led a Nuxt migration for a customer portal and documented the PostgreSQL performance work in my GitHub portfolio. Happy to walk through the trade-offs if useful.\n\nRegards,\nLucas",
        daysAgo: 1,
        hour: 16,
        minute: 20,
      },
    ],
  },
  {
    jobIndex: 0,
    candidateIndex: 0,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "Onboarding documents and start date",
        bodyText:
          "Hi,\n\nI have signed the remaining onboarding documents and confirmed my availability to start next Monday. Please let me know if there is anything else I should prepare before my first day. I am really looking forward to joining the engineering team.\n\nBest,\nEmma",
        daysAgo: 1,
        hour: 9,
        minute: 15,
      },
    ],
  },
  candidateFollowUp(
    0,
    1,
    "Questions about the Full-Stack Engineer offer",
    "Hi,\n\nThank you again for the offer. Before I sign, could we clarify the relocation support and equity portion of the package? I am available for a quick call tomorrow afternoon.\n\nBest,\nLiam",
    4,
    16,
    10,
  ),
  candidateFollowUp(
    0,
    6,
    "Availability for an initial engineering call",
    "Hi Reqcore team,\n\nI am available for a screening call on Tuesday or Thursday morning. I also wanted to confirm that I already have authorization to work in Germany and would not require sponsorship.\n\nBest,\nAmara",
    6,
    11,
    20,
  ),
  candidateFollowUp(
    0,
    70,
    "Additional architecture example",
    "Hello Reqcore team,\n\nI added a short architecture note to my application describing how I split a growing TypeScript service into independently deployable modules. It includes the PostgreSQL migration plan and the trade-offs we considered.\n\nRegards,\nArjun",
    2,
    13,
    15,
  ),
  candidateFollowUp(
    0,
    126,
    "Re: Senior Full-Stack Engineer application update",
    "Hi,\n\nThank you for reviewing my application. I understand that the role requires deeper backend ownership. I appreciate the feedback and would be interested in future frontend-focused engineering positions.\n\nBest,\nSonia",
    9,
    14,
    5,
  ),

  // Product Designer
  {
    jobIndex: 1,
    candidateIndex: 15,
    unreadCount: 0,
    messages: [
      {
        direction: "outbound",
        subject: "Portfolio walkthrough — Product Designer",
        bodyText:
          "Hi Elena,\n\nYour case studies stood out to the team. We would love to schedule a 45-minute portfolio walkthrough next week, with a little extra time to discuss your research process. Are you available Tuesday or Wednesday afternoon?\n\nBest,\nDemo Recruiter",
        daysAgo: 8,
        hour: 11,
        minute: 15,
      },
      {
        direction: "inbound",
        subject: "Re: Portfolio walkthrough — Product Designer",
        bodyText:
          "Hi,\n\nTuesday at 14:00 CET would be perfect. I will present the workflow redesign from my portfolio and can also share the accessibility testing that did not fit into the published case study.\n\nLooking forward to it,\nElena",
        daysAgo: 7,
        hour: 9,
        minute: 5,
      },
    ],
  },
  {
    jobIndex: 1,
    candidateIndex: 17,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "Updated prototype for my Product Designer application",
        bodyText:
          "Hello,\n\nI have updated the interactive prototype from my application after another round of usability testing. The new version includes the empty states and keyboard flows we discussed in my screening call. I would be glad to send over the research notes as well.\n\nThanks,\nMaria",
        daysAgo: 4,
        hour: 13,
        minute: 40,
      },
    ],
  },
  {
    jobIndex: 1,
    candidateIndex: 150,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "Additional Product Designer case study",
        bodyText:
          "Hello Reqcore team,\n\nI have added a new case study to my portfolio that may be especially relevant to this role. It covers how I simplified a permissions-heavy B2B workflow, evolved the design system, and measured the impact after launch. I would be happy to walk the team through the decisions behind it.\n\nBest,\nCharlotte",
        daysAgo: 2,
        hour: 15,
        minute: 30,
      },
    ],
  },
  candidateFollowUp(
    1,
    14,
    "Product Designer offer questions",
    "Hi,\n\nI am delighted to receive the offer. Could you confirm the expected start date and whether the team meets in person for planning sessions? The remote setup otherwise looks ideal.\n\nBest,\nDavid",
    6,
    10,
    40,
  ),
  candidateFollowUp(
    1,
    400,
    "Portfolio walkthrough availability",
    "Hello,\n\nI can join a portfolio walkthrough on Wednesday after 13:00 CET or Friday morning. I would like to focus on the research and validation work behind my recent enterprise workflow redesign.\n\nThanks,\nNora",
    5,
    15,
    25,
  ),
  candidateFollowUp(
    1,
    388,
    "Re: Product Designer application update",
    "Hi,\n\nThank you for reviewing my portfolio. I understand that the role needs more experience than my current freelance background demonstrates, and I appreciate the team taking the time to consider me.\n\nBest,\nMichal",
    10,
    9,
    50,
  ),

  // DevOps Engineer
  {
    jobIndex: 2,
    candidateIndex: 7,
    unreadCount: 0,
    messages: [
      {
        direction: "outbound",
        subject: "Technical interview availability — DevOps Engineer",
        bodyText:
          "Hi Yuki,\n\nWe would like to move you to the final technical interview. The conversation will cover deployment reliability, incident response, and a practical infrastructure design scenario. Which times work for you this week?\n\nBest,\nDemo Recruiter",
        daysAgo: 10,
        hour: 9,
      },
      {
        direction: "inbound",
        subject: "Re: Technical interview availability — DevOps Engineer",
        bodyText:
          "Hi,\n\nThank you for the update. Wednesday at 14:00 UTC works best. I can also prepare a short overview of the incident review process I introduced for my current platform team.\n\nBest regards,\nYuki",
        daysAgo: 9,
        hour: 7,
        minute: 45,
      },
    ],
  },
  {
    jobIndex: 2,
    candidateIndex: 9,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "On-call experience clarification",
        bodyText:
          "Hi,\n\nA quick follow-up to my DevOps application: I have been part of a six-person on-call rotation for the last two years and served as incident commander for three production incidents. I noticed that responsibility was not very clear on my CV.\n\nRegards,\nPriya",
        daysAgo: 5,
        hour: 17,
        minute: 10,
      },
    ],
  },
  {
    jobIndex: 2,
    candidateIndex: 5,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "Contract signed — DevOps Engineer",
        bodyText:
          "Hi,\n\nI have signed the contract and completed the security questionnaire. I can start the infrastructure review during my first week and will bring an outline for the deployment and observability audit we discussed.\n\nLooking forward to working together,\nJames",
        daysAgo: 3,
        hour: 12,
        minute: 10,
      },
    ],
  },
  candidateFollowUp(
    2,
    6,
    "DevOps Engineer contract details",
    "Hi,\n\nThank you for sending the contract terms. The scope looks good to me. Could we confirm the proposed start date and how often the contractor joins the primary on-call rotation?\n\nBest,\nAmara",
    6,
    13,
    35,
  ),
  candidateFollowUp(
    2,
    26,
    "Additional certification for my DevOps application",
    "Hello Reqcore team,\n\nI recently completed my Kubernetes administrator certification and added the credential to my application. I also included a short write-up about a backup restoration exercise I led last quarter.\n\nRegards,\nMarcus",
    2,
    17,
    5,
  ),
  candidateFollowUp(
    2,
    29,
    "Re: DevOps Engineer application update",
    "Hi,\n\nThank you for the update and for considering my application. I understand that the role needs deeper platform ownership. I would be interested in future support engineering or junior SRE opportunities.\n\nBest,\nZara",
    12,
    8,
    30,
  ),

  // Technical Writer (Part-Time)
  {
    jobIndex: 3,
    candidateIndex: 12,
    unreadCount: 0,
    messages: [
      {
        direction: "outbound",
        subject: "Reqcore Technical Writer offer",
        bodyText:
          "Hi Felix,\n\nWe are delighted to offer you the part-time Technical Writer role. I have sent the full terms separately. Could we arrange a short call to discuss your preferred weekly schedule and starting date?\n\nBest,\nDemo Recruiter",
        daysAgo: 6,
        hour: 14,
      },
      {
        direction: "inbound",
        subject: "Re: Reqcore Technical Writer offer",
        bodyText:
          "Hi,\n\nThank you — I am excited about the offer. Tuesday morning would be ideal for a call. My preference is to spread the hours across three days, and I could start on the first Monday next month.\n\nBest,\nFelix",
        daysAgo: 5,
        hour: 8,
        minute: 25,
      },
      {
        direction: "outbound",
        subject: "Re: Reqcore Technical Writer offer",
        bodyText:
          "Hi Felix,\n\nThat schedule works well for us. I have booked a call for Tuesday at 09:30 CET and included the proposed onboarding plan. We can confirm the exact three-day split together then.\n\nBest,\nDemo Recruiter",
        daysAgo: 4,
        hour: 10,
        minute: 5,
      },
    ],
  },
  {
    jobIndex: 3,
    candidateIndex: 14,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "API documentation sample",
        bodyText:
          "Hello,\n\nI have added an API migration guide to my writing samples. It shows how I structure breaking-change notices, before-and-after examples, and troubleshooting steps for developers. I hope it gives the team a useful view of my docs-as-code approach.\n\nKind regards,\nDavid",
        daysAgo: 11,
        hour: 12,
        minute: 50,
      },
    ],
  },
  candidateFollowUp(
    3,
    18,
    "Technical Writer screening availability",
    "Hi,\n\nI am available for an introductory call on Monday or Wednesday afternoon. I can also share a longer administrator guide that shows how I organize documentation for several user roles.\n\nBest,\nRyan",
    7,
    16,
    15,
  ),
  candidateFollowUp(
    3,
    22,
    "New troubleshooting guide sample",
    "Hello Reqcore team,\n\nI have added a troubleshooting guide to my application samples. It includes diagnostic decision trees, expected command output, and separate recovery paths for hosted and self-managed installations.\n\nRegards,\nTom",
    3,
    11,
    45,
  ),
  candidateFollowUp(
    3,
    28,
    "Re: Technical Writer application update",
    "Hi,\n\nThank you for the candid feedback. I understand that my current portfolio is weighted toward campaign writing, and I am working on more developer-focused samples. Please keep me in mind for future content roles.\n\nBest,\nKevin",
    14,
    10,
    20,
  ),

  // Frontend Engineering Intern
  {
    jobIndex: 4,
    candidateIndex: 2,
    unreadCount: 0,
    messages: [
      {
        direction: "outbound",
        subject: "Team interview — Frontend Engineering Intern",
        bodyText:
          "Hi Sofia,\n\nWe enjoyed your first conversation and would like you to meet two frontend engineers for a 45-minute team interview. Would Monday at 15:00 CET work for you?\n\nBest,\nDemo Recruiter",
        daysAgo: 13,
        hour: 10,
        minute: 30,
      },
      {
        direction: "inbound",
        subject: "Re: Team interview — Frontend Engineering Intern",
        bodyText:
          "Hi,\n\nMonday at 15:00 CET works for me, thank you. Should I prepare for a live coding exercise, or will the discussion focus on the projects from my application?\n\nBest,\nSofia",
        daysAgo: 12,
        hour: 18,
        minute: 5,
      },
    ],
  },
  {
    jobIndex: 4,
    candidateIndex: 11,
    unreadCount: 2,
    messages: [
      {
        direction: "inbound",
        subject: "Internship interview scheduling",
        bodyText:
          "Hi Reqcore team,\n\nThank you for moving my application forward. I am in exams until Thursday, but I am available any time on Friday or next Monday afternoon.\n\nBest,\nAisha",
        daysAgo: 2,
        hour: 19,
        minute: 10,
      },
      {
        direction: "inbound",
        subject: "Re: Internship interview scheduling",
        bodyText:
          "One quick addition: I can come to the Berlin office for the interview if that is easier for the team.\n\nThanks,\nAisha",
        daysAgo: 1,
        hour: 7,
        minute: 50,
      },
    ],
  },
  {
    jobIndex: 4,
    candidateIndex: 0,
    unreadCount: 1,
    messages: [
      {
        direction: "inbound",
        subject: "Frontend internship project update",
        bodyText:
          "Hi Reqcore team,\n\nI wanted to share a small update before the next interview: I added keyboard navigation and component tests to the Vue project from my application. I also wrote a short note explaining the accessibility choices and what I would improve with more time.\n\nBest,\nEmma",
        daysAgo: 3,
        hour: 18,
        minute: 45,
      },
    ],
  },
  candidateFollowUp(
    4,
    15,
    "Frontend internship application follow-up",
    "Hi Reqcore team,\n\nI wanted to confirm that my application came through correctly. I have also added the GitHub repository for my latest Vue project, including a short README about the component architecture.\n\nBest,\nElena",
    4,
    12,
    5,
  ),
  candidateFollowUp(
    4,
    23,
    "Re: Frontend internship application update",
    "Hello,\n\nThank you for reviewing my application. I appreciate the note about strengthening my JavaScript fundamentals and will focus on that in my next project. I hope I can apply again in the future.\n\nRegards,\nSarah",
    8,
    9,
    35,
  ),
];

// ─────────────────────────────────────────────
// Main Seed Function
// ─────────────────────────────────────────────

async function seed() {
  console.log("🌱 Seeding Reqcore demo data...\n");

  const demoInboxData = CANDIDATE_INBOX_DATA.filter((conversation) =>
    DEMO_APPLICATION_KEYS.has(
      `${conversation.jobIndex}-${conversation.candidateIndex}`,
    ),
  );
  const demoApplicationSources = APPLICATION_SOURCES_DATA.filter((source) =>
    DEMO_APPLICATION_KEYS.has(`${source.jobIndex}-${source.candidateIndex}`),
  );
  const demoInterviews = INTERVIEWS_DATA.filter((interview) =>
    DEMO_APPLICATION_KEYS.has(
      `${interview.jobIndex}-${interview.candidateIndex}`,
    ),
  );

  // ─────────────────────────────────────────────
  // Clean up legacy applirank.com seed data
  // ─────────────────────────────────────────────
  const [legacyOrgResult, legacyUserResult] = await Promise.all([
    db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, LEGACY_ORG_SLUG))
      .limit(1),
    db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, LEGACY_DEMO_EMAIL))
      .limit(1),
  ]);
  const [legacyOrg] = legacyOrgResult;
  const [legacyUser] = legacyUserResult;
  if (legacyOrg || legacyUser) {
    console.log("🧹 Removing legacy applirank.com demo data...");

    if (legacyOrg) {
      // All child tables (jobs, candidates, applications, members, etc.) have
      // onDelete: 'cascade' so deleting the org removes everything beneath it.
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, legacyOrg.id));
      console.log(`   ✅ Deleted legacy org: ${LEGACY_ORG_SLUG}`);
    }

    if (legacyUser) {
      // sessions and accounts also cascade from the user row
      await db.delete(schema.user).where(eq(schema.user.id, legacyUser.id));
      console.log(`   ✅ Deleted legacy user: ${LEGACY_DEMO_EMAIL}`);
    }
  }

  // ─────────────────────────────────────────────
  // Upsert demo user (handles email rename scenarios)
  // ─────────────────────────────────────────────
  const [existingDemoUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, DEMO_EMAIL))
    .limit(1);

  const hashedPassword = await hashPassword(DEMO_PASSWORD);
  let userId: string;

  if (existingDemoUser) {
    userId = existingDemoUser.id;
    // Ensure password is up to date in case it changed
    await db
      .update(schema.account)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(schema.account.userId, userId));
    console.log(`✅ Demo user already exists: ${DEMO_EMAIL}`);
  } else {
    userId = id();
    await db.insert(schema.user).values({
      id: userId,
      name: "Demo Recruiter",
      email: DEMO_EMAIL,
      emailVerified: true,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    });
    await db.insert(schema.account).values({
      id: id(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: hashedPassword,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    });
    console.log(`✅ Created demo user: ${DEMO_EMAIL}`);
  }

  // ─────────────────────────────────────────────
  // Upsert demo org (handles partial migration)
  // ─────────────────────────────────────────────
  const [existingOrg] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, DEMO_ORG_SLUG))
    .limit(1);

  if (existingOrg) {
    // Org exists — ensure the demo user is a member, then stop
    const [existingMember] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(1);

    if (!existingMember) {
      await db.insert(schema.member).values({
        id: id(),
        userId,
        organizationId: existingOrg.id,
        role: "owner",
        createdAt: daysAgo(30),
      });
      console.log("✅ Linked demo user to existing org as owner");
    }

    await disableDemoEmailNotifications(userId, existingOrg.id);

    console.log("⚠️  Demo organization already exists. Skipping full seed.");
    console.log(
      "   To re-seed all data, delete the organization first or reset the database.",
    );
    await client.end();
    return;
  }

  // 2. Create organization (fresh seed path)
  const orgId = id();

  await db.insert(schema.organization).values({
    id: orgId,
    name: DEMO_ORG_NAME,
    slug: DEMO_ORG_SLUG,
    createdAt: daysAgo(30),
  });

  // Add user as owner
  await db.insert(schema.member).values({
    id: id(),
    userId,
    organizationId: orgId,
    role: "owner",
    createdAt: daysAgo(30),
  });

  await disableDemoEmailNotifications(userId, orgId);

  console.log(`✅ Created organization: ${DEMO_ORG_NAME}`);

  // 3. Create jobs
  const jobIds: string[] = [];

  for (const jobData of JOBS_DATA) {
    const jobId = id();
    jobIds.push(jobId);
    const slug = generateSlug(jobData.title, jobId);
    const createdDaysAgo = 20 + Math.floor(Math.random() * 10);

    await db.insert(schema.job).values({
      id: jobId,
      organizationId: orgId,
      title: jobData.title,
      slug,
      description: jobData.description,
      location: jobData.location,
      type: jobData.type,
      status: jobData.status,
      createdAt: daysAgo(createdDaysAgo),
      updatedAt: daysAgo(Math.floor(createdDaysAgo / 2)),
    });
  }

  console.log(`✅ Created ${JOBS_DATA.length} jobs`);

  // 4. Create candidates
  const candidateIds: Array<string | undefined> = [];

  for (const candidateIndex of DEMO_CANDIDATE_INDICES) {
    const candidateData = CANDIDATES_DATA[candidateIndex];
    if (!candidateData) {
      throw new Error(
        `Missing candidate fixture at selected index ${candidateIndex}`,
      );
    }

    const candidateId = id();
    candidateIds[candidateIndex] = candidateId;
    const createdDaysAgo = 5 + Math.floor(Math.random() * 20);

    await db.insert(schema.candidate).values({
      id: candidateId,
      organizationId: orgId,
      firstName: candidateData.firstName,
      lastName: candidateData.lastName,
      email: candidateData.email,
      phone: candidateData.phone,
      createdAt: daysAgo(createdDaysAgo),
      updatedAt: daysAgo(Math.floor(createdDaysAgo / 2)),
    });
  }

  console.log(`✅ Created ${DEMO_CANDIDATE_INDICES.length} candidates`);

  // 5. Create custom questions and automation rules for every demo job
  if (
    DEMO_JOB_QUESTIONS.length !== JOBS_DATA.length ||
    DEMO_AUTOMATION_RULES.length !== JOBS_DATA.length
  ) {
    throw new Error("Every demo job must have questions and automation rules");
  }

  const questionIdsByJob: Map<
    number,
    {
      questionId: string;
      label: string;
      type: (typeof DEMO_JOB_QUESTIONS)[number][number]["type"];
    }[]
  > = new Map();

  for (let jobIndex = 0; jobIndex < DEMO_JOB_QUESTIONS.length; jobIndex++) {
    const questions = DEMO_JOB_QUESTIONS[jobIndex];
    const jobId = jobIds[jobIndex];
    if (!questions || !jobId) {
      throw new Error(
        `Invalid seed configuration for questions at job index ${jobIndex}`,
      );
    }

    const questionIds: {
      questionId: string;
      label: string;
      type: (typeof DEMO_JOB_QUESTIONS)[number][number]["type"];
    }[] = [];

    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      if (!q) {
        continue;
      }

      const questionId = id();
      questionIds.push({ questionId, label: q.label, type: q.type });

      await db.insert(schema.jobQuestion).values({
        id: questionId,
        organizationId: orgId,
        jobId,
        type: q.type,
        label: q.label,
        required: q.required,
        options: q.options ?? null,
        displayOrder: qi,
        createdAt: daysAgo(18),
        updatedAt: daysAgo(18),
      });
    }

    questionIdsByJob.set(jobIndex, questionIds);
  }

  console.log(`✅ Created custom questions for ${DEMO_JOB_QUESTIONS.length} jobs`);

  let totalAutomationRules = 0;

  for (let jobIndex = 0; jobIndex < DEMO_AUTOMATION_RULES.length; jobIndex++) {
    const rules = DEMO_AUTOMATION_RULES[jobIndex];
    const jobId = jobIds[jobIndex];
    const questions = questionIdsByJob.get(jobIndex);
    if (!rules || !jobId || !questions) {
      throw new Error(
        `Invalid automation seed configuration at job index ${jobIndex}`,
      );
    }

    const questionsByLabel = new Map(questions.map((q) => [q.label, q]));

    for (let displayOrder = 0; displayOrder < rules.length; displayOrder++) {
      const rule = rules[displayOrder];
      if (!rule) continue;

      const conditions = rule.conditions.map((condition) => {
        const question = questionsByLabel.get(condition.questionLabel);
        if (!question) {
          throw new Error(
            `Automation rule "${rule.name}" references missing question "${condition.questionLabel}"`,
          );
        }
        if (question.type !== condition.questionType) {
          throw new Error(
            `Automation rule "${rule.name}" expects "${condition.questionLabel}" to be ${condition.questionType}, got ${question.type}`,
          );
        }

        return {
          questionId: question.questionId,
          operator: condition.operator,
          ...(condition.value !== undefined ? { value: condition.value } : {}),
        };
      });

      await db.insert(schema.applicationRule).values({
        id: id(),
        organizationId: orgId,
        jobId,
        name: rule.name,
        matchType: rule.matchType,
        action: rule.action,
        enabled: rule.enabled,
        conditions,
        displayOrder,
        createdAt: daysAgo(17),
        updatedAt: daysAgo(17),
      });
      totalAutomationRules++;
    }
  }

  console.log(
    `✅ Created ${totalAutomationRules} automation rules across ${JOBS_DATA.length} jobs`,
  );

  // 6. Create applications with status distribution
  let totalApps = 0;
  const applicationMap = new Map<string, string>(); // key: "jobIndex-candidateIndex" → applicationId

  for (let jobIndex = 0; jobIndex < JOB_APPLICATIONS.length; jobIndex++) {
    const apps = JOB_APPLICATIONS[jobIndex];
    const jobId = jobIds[jobIndex];
    if (!apps || !jobId) {
      throw new Error(
        `Invalid seed configuration for applications at job index ${jobIndex}`,
      );
    }

    for (const app of apps) {
      const candidateId = candidateIds[app.candidateIndex];
      if (!candidateId) {
        throw new Error(
          `Missing candidate ID for candidate index ${app.candidateIndex}`,
        );
      }

      const applicationId = id();
      applicationMap.set(`${jobIndex}-${app.candidateIndex}`, applicationId);
      const createdDaysAgo = 1 + Math.floor(Math.random() * 15);

      await db.insert(schema.application).values({
        id: applicationId,
        organizationId: orgId,
        candidateId,
        jobId,
        status: app.status,
        score: app.score ?? null,
        notes: app.notes ?? null,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: daysAgo(
          Math.max(0, createdDaysAgo - Math.floor(Math.random() * 5)),
        ),
      });

      // Create question responses for jobs that have questions
      const jobQuestions = questionIdsByJob.get(jobIndex);
      if (jobQuestions && app.status !== "rejected") {
        const responses = generateResponses(jobIndex, app.candidateIndex);

        for (const q of jobQuestions) {
          const responseValue = responses[q.label];
          if (responseValue !== undefined) {
            await db.insert(schema.questionResponse).values({
              id: id(),
              organizationId: orgId,
              applicationId,
              questionId: q.questionId,
              value: responseValue,
              createdAt: daysAgo(createdDaysAgo),
            });
          }
        }
      }

      totalApps++;
    }
  }

  console.log(
    `✅ Created ${totalApps} applications with pipeline distribution`,
  );

  // 6b. Create candidate inbox conversations and messages
  let totalCandidateMessages = 0;

  for (let jobIndex = 0; jobIndex < JOBS_DATA.length; jobIndex++) {
    const conversationCount = demoInboxData.filter(
      (item) => item.jobIndex === jobIndex,
    ).length;
    if (conversationCount < 2) {
      throw new Error(
        `Demo job ${jobIndex} must have at least two candidate inbox conversations`,
      );
    }

    const jobApplications = JOB_APPLICATIONS[jobIndex];
    if (!jobApplications) {
      throw new Error(`Missing demo applications for job ${jobIndex}`);
    }
    const applicationStatuses = new Set(
      jobApplications.map((application) => application.status),
    );
    for (const status of applicationStatuses) {
      const hasInboxConversation = jobApplications.some(
        (application) =>
          application.status === status &&
          demoInboxData.some(
            (item) =>
              item.jobIndex === jobIndex &&
              item.candidateIndex === application.candidateIndex,
          ),
      );
      if (!hasInboxConversation) {
        throw new Error(
          `Demo job ${jobIndex} must have an inbox conversation for status ${status}`,
        );
      }
    }

    const highestScore = Math.max(
      ...jobApplications.map((application) => application.score ?? -Infinity),
    );
    const highestScoringCandidates = jobApplications.filter(
      (application) => application.score === highestScore,
    );
    for (const application of highestScoringCandidates) {
      const hasInboxConversation = demoInboxData.some(
        (item) =>
          item.jobIndex === jobIndex &&
          item.candidateIndex === application.candidateIndex,
      );
      if (!hasInboxConversation) {
        throw new Error(
          `Highest-scoring candidate ${application.candidateIndex} for demo job ${jobIndex} must have an inbox conversation`,
        );
      }
    }
  }

  for (const conversationData of demoInboxData) {
    const applicationId = applicationMap.get(
      `${conversationData.jobIndex}-${conversationData.candidateIndex}`,
    );
    const candidateData = CANDIDATES_DATA[conversationData.candidateIndex];

    if (!applicationId || !candidateData) {
      throw new Error(
        `Invalid candidate inbox seed for job ${conversationData.jobIndex}, candidate ${conversationData.candidateIndex}`,
      );
    }
    if (conversationData.messages.length === 0) {
      throw new Error(
        `Candidate inbox seed has no messages for job ${conversationData.jobIndex}, candidate ${conversationData.candidateIndex}`,
      );
    }
    const inboundMessageCount = conversationData.messages.filter(
      (message) => message.direction === "inbound",
    ).length;
    if (conversationData.unreadCount > inboundMessageCount) {
      throw new Error(
        `Candidate inbox unread count exceeds inbound messages for job ${conversationData.jobIndex}, candidate ${conversationData.candidateIndex}`,
      );
    }

    const conversationId = id();
    const messageDates = conversationData.messages.map((message) =>
      dateWithOffset(-message.daysAgo, message.hour, message.minute ?? 0),
    );
    const firstMessageAt = messageDates[0];
    const lastMessageAt = messageDates.at(-1);

    if (!firstMessageAt || !lastMessageAt) {
      throw new Error("Candidate inbox message dates could not be generated");
    }

    await db.insert(schema.candidateConversation).values({
      id: conversationId,
      organizationId: orgId,
      applicationId,
      replyToken: id().replaceAll("-", ""),
      unreadCount: conversationData.unreadCount,
      lastMessageAt,
      createdAt: firstMessageAt,
      updatedAt: lastMessageAt,
    });

    for (
      let messageIndex = 0;
      messageIndex < conversationData.messages.length;
      messageIndex++
    ) {
      const message = conversationData.messages[messageIndex];
      const messageAt = messageDates[messageIndex];
      if (!message || !messageAt) continue;

      const outbound = message.direction === "outbound";
      await db.insert(schema.candidateMessage).values({
        id: id(),
        organizationId: orgId,
        conversationId,
        direction: message.direction,
        status: "delivered",
        fromEmail: outbound ? DEMO_EMAIL : candidateData.email,
        toEmail: outbound ? candidateData.email : DEMO_EMAIL,
        subject: message.subject,
        bodyText: message.bodyText,
        sentById: outbound ? userId : null,
        providerStatusAt: messageAt,
        sentAt: messageAt,
        deliveredAt: messageAt,
        createdAt: messageAt,
        updatedAt: messageAt,
      });
      totalCandidateMessages++;
    }
  }

  console.log(
    `✅ Created ${totalCandidateMessages} candidate inbox messages across ${demoInboxData.length} conversations`,
  );

  // 6c. Create tracking links and application source attribution
  const trackingLinkIds: string[] = [];
  const selectedApplicationsPerTrackingLink = new Map<number, number>();

  for (const source of demoApplicationSources) {
    if (source.trackingLinkIndex === null) continue;
    selectedApplicationsPerTrackingLink.set(
      source.trackingLinkIndex,
      (selectedApplicationsPerTrackingLink.get(source.trackingLinkIndex) ?? 0) +
        1,
    );
  }

  for (let linkIndex = 0; linkIndex < TRACKING_LINKS_DATA.length; linkIndex++) {
    const link = TRACKING_LINKS_DATA[linkIndex];
    if (!link) continue;
    const trackingLinkId = id();
    trackingLinkIds.push(trackingLinkId);

    await db.insert(schema.trackingLink).values({
      id: trackingLinkId,
      organizationId: orgId,
      jobId: link.jobIndex !== null ? (jobIds[link.jobIndex] ?? null) : null,
      channel: link.channel,
      name: link.name,
      code: link.code,
      utmSource: link.utmSource ?? null,
      utmMedium: link.utmMedium ?? null,
      utmCampaign: link.utmCampaign ?? null,
      utmTerm: link.utmTerm ?? null,
      utmContent: link.utmContent ?? null,
      clickCount: link.clickCount,
      applicationCount: selectedApplicationsPerTrackingLink.get(linkIndex) ?? 0,
      isActive: link.isActive,
      createdById: userId,
      createdAt: daysAgo(link.daysAgoCreated),
      updatedAt: daysAgo(
        Math.max(0, link.daysAgoCreated - Math.floor(Math.random() * 5)),
      ),
    });
  }

  console.log(
    `✅ Created ${trackingLinkIds.length} tracking links across ${new Set(TRACKING_LINKS_DATA.map((l) => l.channel)).size} channels`,
  );

  // Create application source records for attributed applications
  let totalSources = 0;

  for (const src of demoApplicationSources) {
    const applicationId = applicationMap.get(
      `${src.jobIndex}-${src.candidateIndex}`,
    );
    if (!applicationId) {
      console.warn(
        `⚠️  Skipping source attribution — no application found for job ${src.jobIndex}, candidate ${src.candidateIndex}`,
      );
      continue;
    }

    const trackingLinkId =
      src.trackingLinkIndex !== null
        ? (trackingLinkIds[src.trackingLinkIndex] ?? null)
        : null;

    await db.insert(schema.applicationSource).values({
      id: id(),
      organizationId: orgId,
      applicationId,
      channel: src.channel,
      trackingLinkId,
      utmSource: src.utmSource ?? null,
      utmMedium: src.utmMedium ?? null,
      utmCampaign: src.utmCampaign ?? null,
      utmTerm: src.utmTerm ?? null,
      utmContent: src.utmContent ?? null,
      referrerDomain: src.referrerDomain ?? null,
      createdAt: daysAgo(1 + Math.floor(Math.random() * 15)),
    });
    totalSources++;
  }

  // Compute source distribution for logging
  const channelCounts: Record<string, number> = {};
  for (const src of demoApplicationSources) {
    channelCounts[src.channel] = (channelCounts[src.channel] || 0) + 1;
  }
  const trackedCount = demoApplicationSources.filter(
    (s) => s.trackingLinkIndex !== null,
  ).length;

  console.log(
    `✅ Created ${totalSources} application source records (${trackedCount} via tracking links)`,
  );
  console.log(
    `   📊 Source channels: ${Object.entries(channelCounts)
      .map(([ch, n]) => `${ch}: ${n}`)
      .join(", ")}`,
  );

  // 7. Create AI scoring criteria and scores for first 3 jobs
  let totalCriteria = 0;
  let totalScores = 0;
  let totalRuns = 0;

  for (let jobIndex = 0; jobIndex < JOB_CRITERIA.length; jobIndex++) {
    const criteria = JOB_CRITERIA[jobIndex];
    const jobId = jobIds[jobIndex];
    if (!criteria || !jobId) continue;

    // Insert scoring criteria for this job
    for (const criterion of criteria) {
      await db.insert(schema.scoringCriterion).values({
        id: id(),
        organizationId: orgId,
        jobId,
        key: criterion.key,
        name: criterion.name,
        description: criterion.description,
        category: criterion.category,
        maxScore: criterion.maxScore,
        weight: criterion.weight,
        displayOrder: criterion.displayOrder,
        createdAt: daysAgo(18),
        updatedAt: daysAgo(18),
      });
      totalCriteria++;
    }
  }

  console.log(
    `✅ Created ${totalCriteria} scoring criteria across ${JOB_CRITERIA.length} jobs`,
  );

  // Insert criterion scores and analysis runs for scored applications
  for (const appScoring of AI_SCORING_DATA) {
    const applicationId = applicationMap.get(
      `${appScoring.jobIndex}-${appScoring.candidateIndex}`,
    );
    if (!applicationId) {
      console.warn(
        `⚠️  Skipping AI scores — no application for job ${appScoring.jobIndex}, candidate ${appScoring.candidateIndex}`,
      );
      continue;
    }

    const criteria = JOB_CRITERIA[appScoring.jobIndex];
    if (!criteria) continue;

    // Insert each criterion score
    for (const score of appScoring.scores) {
      await db.insert(schema.criterionScore).values({
        id: id(),
        organizationId: orgId,
        applicationId,
        criterionKey: score.criterionKey,
        maxScore: score.maxScore,
        applicantScore: score.applicantScore,
        confidence: score.confidence,
        evidence: score.evidence,
        strengths: score.strengths,
        gaps: score.gaps,
        createdAt: daysAgo(10 + Math.floor(Math.random() * 5)),
      });
      totalScores++;
    }

    // Insert analysis run audit record
    const promptTokens = 1200 + Math.floor(Math.random() * 800);
    const completionTokens = 600 + Math.floor(Math.random() * 400);

    await db.insert(schema.analysisRun).values({
      id: id(),
      organizationId: orgId,
      applicationId,
      status: "completed",
      provider: "openai",
      model: "gpt-4o-mini",
      criteriaSnapshot: criteria.map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        category: c.category,
        maxScore: c.maxScore,
        weight: c.weight,
      })),
      compositeScore: appScoring.compositeScore,
      promptTokens,
      completionTokens,
      rawResponse: {
        evaluations: appScoring.scores.map((s) => ({
          criterionKey: s.criterionKey,
          maxScore: s.maxScore,
          applicantScore: s.applicantScore,
          confidence: s.confidence,
          evidence: s.evidence,
          strengths: s.strengths,
          gaps: s.gaps,
        })),
        summary: appScoring.summary,
      },
      scoredById: userId,
      createdAt: daysAgo(10 + Math.floor(Math.random() * 5)),
    });
    totalRuns++;
  }

  console.log(
    `✅ Created ${totalScores} criterion scores and ${totalRuns} analysis runs`,
  );

  // Insert AI config with pricing so the dashboard shows costs
  const INPUT_PRICE_PER_1M = "0.1500"; // GPT-4o-mini input
  const OUTPUT_PRICE_PER_1M = "0.6000"; // GPT-4o-mini output

  const encryptionSecret =
    process.env.BETTER_AUTH_SECRET ?? "demo-secret-change-me";
  const demoApiKey = encrypt("sk-demo-placeholder-key", encryptionSecret);

  await db.insert(schema.aiConfig).values({
    id: id(),
    organizationId: orgId,
    provider: "openai",
    model: "gpt-4o-mini",
    apiKeyEncrypted: demoApiKey,
    inputPricePer1m: INPUT_PRICE_PER_1M,
    outputPricePer1m: OUTPUT_PRICE_PER_1M,
    maxTokens: 4096,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
  });

  // Compute and log total demo cost
  const allRuns = await db
    .select({
      promptTokens: schema.analysisRun.promptTokens,
      completionTokens: schema.analysisRun.completionTokens,
    })
    .from(schema.analysisRun)
    .where(eq(schema.analysisRun.organizationId, orgId));

  let totalPrompt = 0;
  let totalCompletion = 0;
  for (const r of allRuns) {
    totalPrompt += r.promptTokens ?? 0;
    totalCompletion += r.completionTokens ?? 0;
  }
  const totalCost =
    (totalPrompt / 1_000_000) * Number(INPUT_PRICE_PER_1M) +
    (totalCompletion / 1_000_000) * Number(OUTPUT_PRICE_PER_1M);

  console.log(
    `✅ Created AI config with pricing (input: $${INPUT_PRICE_PER_1M}/1M, output: $${OUTPUT_PRICE_PER_1M}/1M)`,
  );
  console.log(
    `   📊 Total demo cost: $${totalCost.toFixed(4)} (${totalPrompt} prompt + ${totalCompletion} completion tokens)`,
  );

  // Enable autoScoreOnApply on the Senior Full-Stack Engineer job to showcase the feature
  const firstJobId = jobIds[0];
  if (firstJobId) {
    await db
      .update(schema.job)
      .set({ autoScoreOnApply: true })
      .where(eq(schema.job.id, firstJobId));
    console.log(`✅ Enabled auto-score on apply for: ${JOBS_DATA[0]?.title}`);
  }

  // 8. Create interviews
  let totalInterviews = 0;
  const interviewIds: string[] = []; // track IDs for activity log

  for (const iv of demoInterviews) {
    const applicationId = applicationMap.get(
      `${iv.jobIndex}-${iv.candidateIndex}`,
    );
    if (!applicationId) {
      console.warn(
        `⚠️  Skipping interview "${iv.title}" — no application found for job ${iv.jobIndex}, candidate ${iv.candidateIndex}`,
      );
      interviewIds.push(""); // placeholder to keep index alignment
      continue;
    }

    const scheduledAt = dateWithOffset(iv.daysOffset, iv.hour, iv.minute ?? 0);
    const responded = iv.candidateResponse !== "pending";

    const interviewId = id();
    interviewIds.push(interviewId);

    await db.insert(schema.interview).values({
      id: interviewId,
      organizationId: orgId,
      applicationId,
      title: iv.title,
      type: iv.type,
      status: iv.status,
      scheduledAt,
      duration: iv.duration,
      location: iv.location,
      notes: iv.notes,
      interviewers: iv.interviewers,
      createdById: userId,
      candidateResponse: iv.candidateResponse,
      candidateRespondedAt: responded
        ? daysAgo(Math.abs(iv.daysOffset) + 2)
        : null,
      invitationSentAt: responded ? daysAgo(Math.abs(iv.daysOffset) + 3) : null,
      timezone: iv.timezone,
      createdAt: daysAgo(Math.abs(iv.daysOffset) + 4),
      updatedAt: daysAgo(Math.abs(iv.daysOffset) + 1),
    });

    totalInterviews++;
  }

  console.log(`✅ Created ${totalInterviews} interviews across the pipeline`);

  // 9. Create activity log entries so the Timeline page is populated
  let totalActivities = 0;

  // --- Job creation activities ---
  for (let i = 0; i < JOBS_DATA.length; i++) {
    const jobData = JOBS_DATA[i];
    const jobId = jobIds[i];
    if (!jobData || !jobId) continue;

    await db.insert(schema.activityLog).values({
      id: id(),
      organizationId: orgId,
      actorId: userId,
      action: "created",
      resourceType: "job",
      resourceId: jobId,
      metadata: { title: jobData.title },
      createdAt: daysAgo(20 + Math.floor(Math.random() * 10)),
    });
    totalActivities++;
  }

  // --- Candidate creation activities ---
  for (let i = 0; i < CANDIDATES_DATA.length; i++) {
    const c = CANDIDATES_DATA[i];
    const cId = candidateIds[i];
    if (!c || !cId) continue;

    await db.insert(schema.activityLog).values({
      id: id(),
      organizationId: orgId,
      actorId: userId,
      action: "created",
      resourceType: "candidate",
      resourceId: cId,
      metadata: { name: `${c.firstName} ${c.lastName}` },
      createdAt: daysAgo(5 + Math.floor(Math.random() * 20)),
    });
    totalActivities++;
  }

  // --- Application creation + status change activities ---
  // Maps each application's final status to a realistic sequence of transitions
  const STATUS_PIPELINE: Record<AppStatus, AppStatus[]> = {
    new: [],
    screening: ["screening"],
    interview: ["screening", "interview"],
    offer: ["screening", "interview", "offer"],
    hired: ["screening", "interview", "offer", "hired"],
    rejected: ["rejected"], // rejected can happen at any stage
  };

  for (let jobIndex = 0; jobIndex < JOB_APPLICATIONS.length; jobIndex++) {
    const apps = JOB_APPLICATIONS[jobIndex];
    const jobId = jobIds[jobIndex];
    if (!apps || !jobId) continue;

    for (const app of apps) {
      const candidateId = candidateIds[app.candidateIndex];
      const appId = applicationMap.get(`${jobIndex}-${app.candidateIndex}`);
      if (!candidateId || !appId) continue;

      // Application created activity
      const appCreatedDays = 1 + Math.floor(Math.random() * 15);
      await db.insert(schema.activityLog).values({
        id: id(),
        organizationId: orgId,
        actorId: userId,
        action: "created",
        resourceType: "application",
        resourceId: appId,
        metadata: { candidateId, jobId },
        createdAt: daysAgo(appCreatedDays),
      });
      totalActivities++;

      // Status change activities along the pipeline
      const transitions = STATUS_PIPELINE[app.status] ?? [];
      let previousStatus: AppStatus = "new";
      for (let t = 0; t < transitions.length; t++) {
        const toStatus = transitions[t]!;
        const transitionDays = Math.max(0, appCreatedDays - (t + 1) * 2);
        await db.insert(schema.activityLog).values({
          id: id(),
          organizationId: orgId,
          actorId: userId,
          action: "status_changed",
          resourceType: "application",
          resourceId: appId,
          metadata: { from: previousStatus, to: toStatus },
          createdAt: daysAgo(transitionDays),
        });
        totalActivities++;
        previousStatus = toStatus;
      }

      // Scored activity for applications with a score
      if (app.score) {
        await db.insert(schema.activityLog).values({
          id: id(),
          organizationId: orgId,
          actorId: userId,
          action: "scored",
          resourceType: "application",
          resourceId: appId,
          metadata: {
            compositeScore: app.score,
            model: "gpt-4o-mini",
            criterionCount: 5,
          },
          createdAt: daysAgo(Math.max(0, appCreatedDays - 1)),
        });
        totalActivities++;
      }
    }
  }

  // --- Interview creation activities ---
  for (let i = 0; i < demoInterviews.length; i++) {
    const iv = demoInterviews[i];
    const interviewId = interviewIds[i];
    if (!iv || !interviewId) continue;

    const appId = applicationMap.get(`${iv.jobIndex}-${iv.candidateIndex}`);
    if (!appId) continue;

    const scheduledAt = dateWithOffset(iv.daysOffset, iv.hour, iv.minute ?? 0);
    const interviewCreatedDays = Math.abs(iv.daysOffset) + 4;

    await db.insert(schema.activityLog).values({
      id: id(),
      organizationId: orgId,
      actorId: userId,
      action: "created",
      resourceType: "interview",
      resourceId: interviewId,
      metadata: {
        applicationId: appId,
        title: iv.title,
        scheduledAt: scheduledAt.toISOString(),
      },
      createdAt: daysAgo(interviewCreatedDays),
    });
    totalActivities++;
  }

  console.log(
    `✅ Created ${totalActivities} activity log entries for timeline`,
  );

  // Summary
  const statusCounts: Record<string, number> = {};
  for (const apps of JOB_APPLICATIONS) {
    for (const app of apps) {
      statusCounts[app.status] = (statusCounts[app.status] || 0) + 1;
    }
  }

  console.log(`\n📊 Pipeline distribution:`);
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`   ${status}: ${count}`);
  }

  console.log(`\n🎉 Seed complete!`);
  console.log(`\n   Sign in with:`);
  console.log(`   Email:    ${DEMO_EMAIL}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
  console.log(`\n   Then select "${DEMO_ORG_NAME}" as your organization.`);

  await client.end();
}

// ─────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  client.end().then(() => process.exit(1));
});
