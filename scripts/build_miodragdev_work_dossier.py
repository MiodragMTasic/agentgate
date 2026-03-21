#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import textwrap
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path("/Users/miodrag/MiodragDev")
REPO_ROOT = Path("/Users/miodrag/MiodragDev/agentgate")
OUTPUT_DIR = REPO_ROOT / "output" / "pdf"
OUTPUT_PDF = OUTPUT_DIR / "miodragdev-work-dossier.pdf"
OUTPUT_MD = OUTPUT_DIR / "miodragdev-work-dossier.md"

ACTIVE_PROJECTS = [
    "EST-CO",
    "GCCRM",
    "LoLPerformance",
    "Wanderlust",
    "agentgate",
    "command-center",
    "hackathon",
    "miodragdev-portal",
]

SUPPORTING_PROJECTS = [
    {
        "name": "Expansion to South Korea",
        "role": "Go-to-market research pack with onboarding, lead judgment, and outreach playbooks.",
    },
    {
        "name": "ESTCO-CATALOGUE",
        "role": "Offline catalogue companion that reinforces the EST-CO commerce work.",
    },
    {
        "name": "Teaching CC CLI & using LLMs Powerfully",
        "role": "Teaching and process research that informs the AI-heavy tooling projects.",
    },
    {
        "name": "businesscard",
        "role": "Small brand surface work that rounds out the client-facing portfolio.",
    },
]

PROJECT_OVERRIDES = {
    "EST-CO": {
        "display_name": "EST-CO",
        "category": "Commerce Surface",
        "editorial_frame": "Wholesale storefront and catalogue delivery surface for a distribution business.",
        "why_it_matters": "Shows product-minded commerce work, merchandising structure, and customer-facing polish.",
    },
    "GCCRM": {
        "display_name": "NorthVault CRM",
        "category": "Internal Operations",
        "editorial_frame": "Internal CRM for GetClouds with live data workflows, rep assignment, and digest delivery.",
        "why_it_matters": "Demonstrates high-trust operational software with real workflow pressure and release discipline.",
    },
    "LoLPerformance": {
        "display_name": "LoLPerformance",
        "category": "Analytics Product",
        "editorial_frame": "League of Legends analytics site with older full-stack architecture and publishing concerns.",
        "why_it_matters": "Provides a useful contrast: a more mature, quieter system beside newer active builds.",
    },
    "Wanderlust": {
        "display_name": "Wanderlust",
        "category": "Consumer Travel Product",
        "editorial_frame": "Travel planning product spanning web, mobile packaging, localization, and release workflows.",
        "why_it_matters": "One of the richest proof points in the tree for design, QA, release, and multi-surface product work.",
    },
    "agentgate": {
        "display_name": "AgentGate",
        "category": "AI Infrastructure",
        "editorial_frame": "Trust-boundary middleware for tool-using agents, with policies, approvals, budgets, and adapters.",
        "why_it_matters": "Represents the most explicit systems-thinking work in the tree: governance for agentic software.",
    },
    "command-center": {
        "display_name": "Command Center",
        "category": "Ops Dashboard",
        "editorial_frame": "Operator-facing dashboard and admin console work with AI- and workflow-oriented endpoints.",
        "why_it_matters": "Shows dashboard composition, operational interfaces, and product thinking for internal control surfaces.",
    },
    "hackathon": {
        "display_name": "RentEZ",
        "category": "Hackathon Prototype",
        "editorial_frame": "Landlord-tenant review platform built as a fast full-stack prototype with auth and uploads.",
        "why_it_matters": "Useful evidence of speed, scope compression, and product packaging under hackathon-like constraints.",
    },
    "miodragdev-portal": {
        "display_name": "MiodragDev Portal",
        "category": "Client Systems",
        "editorial_frame": "Multi-client retainer, request, and invoicing platform with operational runbooks and test surfaces.",
        "why_it_matters": "Anchors the portfolio in real client operations, admin workflows, and sustained product stewardship.",
    },
}


@dataclass
class ProjectRecord:
    slug: str
    path: Path
    display_name: str
    category: str
    editorial_frame: str
    why_it_matters: str
    package_name: str | None
    package_description: str | None
    readme_title: str | None
    readme_summary: str | None
    stack: list[str]
    branch: str | None
    dirty_count: int
    tracked_changes: int
    untracked_changes: int
    commits_24h: int
    commits_7d: int
    latest_commit_hash: str | None
    latest_commit_date: str | None
    latest_commit_subject: str | None
    notable_docs: list[str]
    doc_count: int
    status_label: str
    score: int

    def current_situation(self) -> str:
        parts: list[str] = [self.editorial_frame]
        if self.dirty_count > 0:
            parts.append(
                f"The working tree is currently active with {self.dirty_count} visible status entries"
                f" ({self.tracked_changes} tracked, {self.untracked_changes} untracked)."
            )
        else:
            parts.append("The working tree is currently clean, which suggests a quieter or more settled posture.")

        if self.commits_24h > 0:
            parts.append(f"Git history shows {self.commits_24h} commits in the last 24 hours.")
        elif self.commits_7d > 0:
            parts.append(f"There is no 24-hour commit burst, but {self.commits_7d} commits landed over the last seven days.")
        else:
            parts.append("No recent commit activity surfaced in the last seven days.")

        if self.latest_commit_subject:
            parts.append(
                f"The latest recorded commit is {self.latest_commit_hash} on {self.latest_commit_date}:"
                f' "{self.latest_commit_subject}".'
            )

        return " ".join(parts)

    def source_summary(self) -> str:
        generic_phrases = (
            "bootstrapped with create react app",
            "this template provides a minimal setup",
            "currently, two official plugins are available",
        )
        title = (self.readme_title or "").lower()
        summary = (self.readme_summary or "").lower()
        if any(phrase in summary for phrase in generic_phrases) or title in {
            "getting started with create react app",
            "react + typescript + vite",
        }:
            return "The top-level README is still scaffold-grade, so the dossier leans more heavily on repo shape, notable docs, and git posture than on the opening prose."
        if self.readme_summary:
            return self.readme_summary
        if self.package_description:
            return self.package_description
        return "This project needs stronger top-level prose, so the dossier relies more heavily on repository structure and git state."


def run_command(args: list[str], cwd: Path) -> str:
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        return {}


def markdown_title_and_summary(readme_path: Path) -> tuple[str | None, str | None]:
    if not readme_path.exists():
        return None, None

    text = readme_path.read_text(encoding="utf8", errors="ignore")
    title = None
    for line in text.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break

    paragraphs: list[str] = []
    current: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        if line.startswith("#") or line.startswith("```") or line.startswith("!"):
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        if line.startswith("[!") or line.startswith("[["):
            continue
        current.append(line)
    if current:
        paragraphs.append(" ".join(current))

    summary = None
    for paragraph in paragraphs:
        cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", paragraph)
        cleaned = cleaned.replace("**", "").replace("__", "").strip()
        if len(cleaned) < 45:
            continue
        if cleaned.lower().startswith("currently, two official plugins"):
            continue
        summary = cleaned
        break

    return title, summary


def ignored_markdown(path: Path) -> bool:
    blocked_parts = {
        ".git",
        "node_modules",
        ".claude",
        ".gemini",
        ".codex",
        "vendor",
        "bundle",
        "__pycache__",
    }
    return any(part in blocked_parts for part in path.parts)


def infer_stack(package_json: dict) -> list[str]:
    deps = {
        **package_json.get("dependencies", {}),
        **package_json.get("devDependencies", {}),
    }

    def has(name: str) -> bool:
        return name in deps

    stack: list[str] = []
    if has("next"):
        stack.append("Next.js")
    if has("vite"):
        stack.append("Vite")
    if has("react") or has("react-dom"):
        stack.append("React")
    if has("typescript") or has("@types/node"):
        stack.append("TypeScript")
    if has("@supabase/supabase-js") or has("@supabase/ssr"):
        stack.append("Supabase")
    if has("firebase") or has("firebase-admin"):
        stack.append("Firebase")
    if has("tailwindcss") or has("@tailwindcss/postcss"):
        stack.append("Tailwind")
    if has("express"):
        stack.append("Express")
    if has("mongodb"):
        stack.append("MongoDB")
    if has("@capacitor/core"):
        stack.append("Capacitor")
    if has("resend"):
        stack.append("Resend")
    if has("@anthropic-ai/sdk"):
        stack.append("Anthropic SDK")
    if has("openai"):
        stack.append("OpenAI SDK")
    if has("turbo"):
        stack.append("Turbo")
    if has("playwright-core") or has("@playwright/test"):
        stack.append("Playwright")
    if has("eslint-config-next") and "Next.js" not in stack:
        stack.append("Next.js")

    deduped: list[str] = []
    for item in stack:
        if item not in deduped:
            deduped.append(item)
    return deduped


def status_counts(repo_path: Path) -> tuple[int, int, int]:
    output = run_command(["git", "status", "--short"], repo_path)
    if not output:
        return 0, 0, 0

    tracked = 0
    untracked = 0
    for line in output.splitlines():
        code = line[:2]
        if code == "??":
            untracked += 1
        else:
            tracked += 1
    return tracked + untracked, tracked, untracked


def commit_counts(repo_path: Path) -> tuple[int, int]:
    commits_24h = run_command(
        ["git", "log", "--since=24 hours ago", "--oneline"],
        repo_path,
    )
    commits_7d = run_command(
        ["git", "log", "--since=7 days ago", "--oneline"],
        repo_path,
    )
    return (
        len([line for line in commits_24h.splitlines() if line.strip()]),
        len([line for line in commits_7d.splitlines() if line.strip()]),
    )


def latest_commit(repo_path: Path) -> tuple[str | None, str | None, str | None]:
    output = run_command(
        ["git", "log", "-1", "--date=short", "--pretty=format:%h%x1f%ad%x1f%s"],
        repo_path,
    )
    if not output:
        return None, None, None
    commit_hash, commit_date, subject = output.split("\x1f", 2)
    return commit_hash, commit_date, subject


def find_notable_docs(project_path: Path) -> list[str]:
    markdown_files = [
        path
        for path in project_path.rglob("*.md")
        if not ignored_markdown(path)
    ]
    priority_terms = (
        "readme",
        "release",
        "audit",
        "security",
        "spec",
        "plan",
        "handoff",
        "report",
        "migration",
    )

    def doc_score(path: Path) -> tuple[int, int, str]:
        relative = path.relative_to(project_path).as_posix().lower()
        score = 0
        for index, term in enumerate(priority_terms):
            if term in relative:
                score += 20 - index
        if relative.count("/") == 0:
            score += 10
        return (-score, len(relative), relative)

    return [path.relative_to(project_path).as_posix() for path in sorted(markdown_files, key=doc_score)[:6]]


def status_label(dirty_count: int, commits_24h: int, doc_count: int) -> tuple[str, int]:
    score = dirty_count + (commits_24h * 4) + min(doc_count, 8)
    if dirty_count >= 20 or commits_24h >= 10:
        return "Hot", score
    if dirty_count > 0 or commits_24h > 0:
        return "Active", score
    if doc_count >= 4:
        return "Steady", score
    return "Quiet", score


def gather_project(slug: str) -> ProjectRecord:
    path = ROOT / slug
    package_json = read_json(path / "package.json")
    readme_title, readme_summary = markdown_title_and_summary(path / "README.md")
    branch = run_command(["git", "branch", "--show-current"], path) or None
    dirty_count, tracked_changes, untracked_changes = status_counts(path)
    commits_24h, commits_7d = commit_counts(path)
    latest_hash, latest_date, latest_subject = latest_commit(path)
    notable_docs = find_notable_docs(path)
    doc_count = len(
        [
            item
            for item in path.rglob("*.md")
            if not ignored_markdown(item)
        ]
    )
    label, score = status_label(dirty_count, commits_24h, doc_count)

    override = PROJECT_OVERRIDES[slug]
    return ProjectRecord(
        slug=slug,
        path=path,
        display_name=override["display_name"],
        category=override["category"],
        editorial_frame=override["editorial_frame"],
        why_it_matters=override["why_it_matters"],
        package_name=package_json.get("name"),
        package_description=package_json.get("description"),
        readme_title=readme_title,
        readme_summary=readme_summary,
        stack=infer_stack(package_json),
        branch=branch,
        dirty_count=dirty_count,
        tracked_changes=tracked_changes,
        untracked_changes=untracked_changes,
        commits_24h=commits_24h,
        commits_7d=commits_7d,
        latest_commit_hash=latest_hash,
        latest_commit_date=latest_date,
        latest_commit_subject=latest_subject,
        notable_docs=notable_docs,
        doc_count=doc_count,
        status_label=label,
        score=score,
    )


def cross_project_themes(projects: Iterable[ProjectRecord]) -> list[str]:
    stack_counter: Counter[str] = Counter()
    active_count = 0
    docs_rich = 0
    ai_or_ops = 0

    for project in projects:
        stack_counter.update(project.stack)
        if project.status_label in {"Hot", "Active"}:
            active_count += 1
        if project.doc_count >= 6:
            docs_rich += 1
        if project.category in {"AI Infrastructure", "Internal Operations", "Ops Dashboard", "Client Systems"}:
            ai_or_ops += 1

    common_stack = ", ".join(stack for stack, _ in stack_counter.most_common(5))
    return [
        f"Operational software is the dominant through-line. {ai_or_ops} of the active repositories are internal tools, infrastructure, or client operations surfaces rather than pure marketing sites.",
        f"Documentation density is a real differentiator here. {docs_rich} repositories carry enough docs to signal release discipline, audit thinking, or onboarding intent.",
        f"The busiest stack vocabulary across the tree is {common_stack}, which suggests a coherent bias toward modern TypeScript product work instead of disconnected experiments.",
        f"{active_count} repositories show clear near-term motion through working-tree changes or 24-hour commit activity, while the quieter repos act as useful historical anchors.",
    ]


def build_markdown(projects: list[ProjectRecord]) -> str:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    hottest = max(projects, key=lambda project: project.score)
    active = sum(1 for project in projects if project.status_label in {"Hot", "Active"})
    clean = sum(1 for project in projects if project.dirty_count == 0)
    lines = [
        "# The MiodragDev Portfolio Dispatch",
        "",
        f"_Generated from live workspace metadata on {timestamp}_",
        "",
        "## Executive Summary",
        "",
        f"- Active git-backed projects covered: {len(projects)}",
        f"- Projects showing immediate motion: {active}",
        f"- Clean working trees: {clean}",
        f"- Front-page lead: {hottest.display_name} ({hottest.status_label})",
        "",
        "## Cross-Project Themes",
        "",
    ]
    for theme in cross_project_themes(projects):
        lines.append(f"- {theme}")
    lines.extend(["", "## Project Briefings", ""])

    for project in projects:
        lines.extend(
            [
                f"### {project.display_name}",
                "",
                f"- Category: {project.category}",
                f"- Path: `{project.path}`",
                f"- Status: {project.status_label}",
                f"- Branch: `{project.branch or 'n/a'}`",
                f"- Stack: {', '.join(project.stack) if project.stack else 'Not obvious from package metadata'}",
                f"- Latest commit: {project.latest_commit_hash or 'n/a'} on {project.latest_commit_date or 'n/a'}",
                f"- Source framing: {project.source_summary()}",
                f"- Current situation: {project.current_situation()}",
                f"- Why it matters: {project.why_it_matters}",
                f"- Notable docs: {', '.join(project.notable_docs) if project.notable_docs else 'None surfaced'}",
                "",
            ]
        )

    lines.extend(["## Supporting Research Appendix", ""])
    for support in SUPPORTING_PROJECTS:
        lines.append(f"- **{support['name']}**: {support['role']}")

    return "\n".join(lines) + "\n"


def styles():
    base = getSampleStyleSheet()
    return {
        "masthead": ParagraphStyle(
            "Masthead",
            parent=base["Title"],
            fontName="Times-Bold",
            fontSize=28,
            leading=30,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#111111"),
            spaceAfter=10,
        ),
        "deck": ParagraphStyle(
            "Deck",
            parent=base["BodyText"],
            fontName="Times-Italic",
            fontSize=11,
            leading=14,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#444444"),
            spaceAfter=10,
        ),
        "kicker": ParagraphStyle(
            "Kicker",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#7A1E12"),
            spaceAfter=4,
        ),
        "section": ParagraphStyle(
            "Section",
            parent=base["Heading1"],
            fontName="Times-Bold",
            fontSize=19,
            leading=22,
            textColor=colors.HexColor("#111111"),
            spaceAfter=10,
        ),
        "subhead": ParagraphStyle(
            "Subhead",
            parent=base["Heading2"],
            fontName="Times-Bold",
            fontSize=13,
            leading=16,
            textColor=colors.HexColor("#111111"),
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Times-Roman",
            fontSize=10.5,
            leading=14,
            textColor=colors.HexColor("#1A1A1A"),
            spaceAfter=8,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.2,
            leading=10,
            textColor=colors.HexColor("#444444"),
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName="Times-Roman",
            fontSize=10.3,
            leading=13,
            leftIndent=8,
            textColor=colors.HexColor("#1A1A1A"),
        ),
    }


def stat_table(project: ProjectRecord, style_map: dict[str, ParagraphStyle]) -> Table:
    try:
        display_path = project.path.relative_to(ROOT).as_posix()
    except ValueError:
        display_path = project.path.as_posix()

    rows = [
        [
            Paragraph("<b>Path</b>", style_map["small"]),
            Paragraph(display_path, style_map["small"]),
            Paragraph("<b>Status</b>", style_map["small"]),
            Paragraph(project.status_label, style_map["small"]),
        ],
        [
            Paragraph("<b>Branch</b>", style_map["small"]),
            Paragraph(project.branch or "n/a", style_map["small"]),
            Paragraph("<b>24h Commits</b>", style_map["small"]),
            Paragraph(str(project.commits_24h), style_map["small"]),
        ],
        [
            Paragraph("<b>Working Tree</b>", style_map["small"]),
            Paragraph(str(project.dirty_count), style_map["small"]),
            Paragraph("<b>Docs Count</b>", style_map["small"]),
            Paragraph(str(project.doc_count), style_map["small"]),
        ],
        [
            Paragraph("<b>Latest Commit</b>", style_map["small"]),
            Paragraph(
                f"{project.latest_commit_hash or 'n/a'} - {project.latest_commit_date or 'n/a'}",
                style_map["small"],
            ),
            Paragraph("<b>Stack</b>", style_map["small"]),
            Paragraph(", ".join(project.stack) or "not obvious", style_map["small"]),
        ],
    ]

    table = Table(rows, colWidths=[1.0 * inch, 2.1 * inch, 1.0 * inch, 2.2 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2ECE3")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#B9AA92")),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBBEAA")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def summary_table(
    hottest: ProjectRecord,
    project_count: int,
    active_count: int,
    clean_count: int,
    docs_rich: int,
    style_map: dict[str, ParagraphStyle],
) -> Table:
    rows = [
        [
            Paragraph("<b>Projects covered</b>", style_map["small"]),
            Paragraph(str(project_count), style_map["small"]),
            Paragraph("<b>Projects in motion</b>", style_map["small"]),
            Paragraph(str(active_count), style_map["small"]),
        ],
        [
            Paragraph("<b>Clean working trees</b>", style_map["small"]),
            Paragraph(str(clean_count), style_map["small"]),
            Paragraph("<b>Docs-rich repos</b>", style_map["small"]),
            Paragraph(str(docs_rich), style_map["small"]),
        ],
        [
            Paragraph("<b>Front-page lead</b>", style_map["small"]),
            Paragraph(hottest.display_name, style_map["small"]),
            Paragraph("<b>Lead posture</b>", style_map["small"]),
            Paragraph(hottest.status_label, style_map["small"]),
        ],
    ]
    table = Table(rows, colWidths=[1.2 * inch, 1.6 * inch, 1.2 * inch, 2.1 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2ECE3")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#B9AA92")),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBBEAA")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def bullet_list(items: list[str], style_map: dict[str, ParagraphStyle]) -> ListFlowable:
    return ListFlowable(
        [ListItem(Paragraph(item, style_map["bullet"])) for item in items],
        bulletType="bullet",
        start="-",
        leftPadding=14,
    )


def draw_page(canvas, doc) -> None:
    width, height = LETTER
    canvas.saveState()
    canvas.setTitle("The MiodragDev Portfolio Dispatch")
    canvas.setAuthor("OpenAI Codex")
    canvas.setSubject("Portfolio dossier generated from the live MiodragDev workspace")
    canvas.setFont("Times-Roman", 9)
    canvas.setFillColor(colors.HexColor("#222222"))
    canvas.drawString(doc.leftMargin, height - 0.42 * inch, "The MiodragDev Dispatch")
    canvas.drawRightString(
        width - doc.rightMargin,
        height - 0.42 * inch,
        datetime.now().strftime("%A, %B %d, %Y"),
    )
    canvas.setStrokeColor(colors.HexColor("#2C2C2C"))
    canvas.setLineWidth(0.7)
    canvas.line(doc.leftMargin, height - 0.48 * inch, width - doc.rightMargin, height - 0.48 * inch)

    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(
        doc.leftMargin,
        0.4 * inch,
        "Editorial portfolio dossier generated from workspace docs, package metadata, and live git state.",
    )
    canvas.drawRightString(width - doc.rightMargin, 0.4 * inch, f"Page {canvas.getPageNumber()}")
    canvas.line(doc.leftMargin, 0.53 * inch, width - doc.rightMargin, 0.53 * inch)
    canvas.restoreState()


def build_pdf(projects: list[ProjectRecord], markdown_text: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_MD.write_text(markdown_text, encoding="utf8")

    style_map = styles()
    doc = BaseDocTemplate(
        OUTPUT_PDF.as_posix(),
        pagesize=LETTER,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.85 * inch,
        bottomMargin=0.75 * inch,
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="portfolio", frames=[frame], onPage=draw_page)])

    hottest = max(projects, key=lambda project: project.score)
    active_count = sum(1 for project in projects if project.status_label in {"Hot", "Active"})
    clean_count = sum(1 for project in projects if project.dirty_count == 0)
    docs_rich = sum(1 for project in projects if project.doc_count >= 6)
    story = [
        Paragraph("The MiodragDev Portfolio Dispatch", style_map["masthead"]),
        Paragraph(
            '"A newspaper-style survey of the active work tree, grounded in the actual repositories instead of a retrospective memory dump."',
            style_map["deck"],
        ),
        Spacer(1, 0.08 * inch),
        Paragraph("EDITION NOTE", style_map["kicker"]),
        Paragraph(
            "This dossier reads the active MiodragDev repositories as a living body of work. It highlights what each project is for, what its current posture looks like, and what patterns repeat across the full tree.",
            style_map["body"],
        ),
        summary_table(
            hottest,
            len(projects),
            active_count,
            clean_count,
            docs_rich,
            style_map,
        ),
        Spacer(1, 0.18 * inch),
        bullet_list(
            [
                f"{len(projects)} active git-backed repositories are covered in the main body.",
                f"{active_count} repositories show immediate motion through dirty working trees or fresh commits.",
                f"{clean_count} repositories are currently clean and act as stable anchors in the portfolio.",
                f"{hottest.display_name} is the front-page lead because its present signal density is highest in the tree.",
            ],
            style_map,
        ),
        PageBreak(),
        Paragraph("Workspace Overview", style_map["section"]),
        Paragraph(
            "The portfolio leans heavily toward operational software rather than isolated landing pages. Internal tools, client systems, governance layers, and multi-surface applications dominate the mix. Even where a README is thin, the surrounding git motion, docs, and dependency graph still show a consistent product-and-systems bias.",
            style_map["body"],
        ),
        Paragraph("Cross-project patterns", style_map["subhead"]),
        bullet_list(cross_project_themes(projects), style_map),
        Spacer(1, 0.18 * inch),
        Paragraph("Supporting research satellites", style_map["subhead"]),
        bullet_list(
            [f"{item['name']}: {item['role']}" for item in SUPPORTING_PROJECTS],
            style_map,
        ),
        PageBreak(),
    ]

    for project in projects:
        story.extend(
            [
                Paragraph(project.category.upper(), style_map["kicker"]),
                Paragraph(project.display_name, style_map["section"]),
                Paragraph(project.editorial_frame, style_map["deck"]),
                stat_table(project, style_map),
                Spacer(1, 0.15 * inch),
                Paragraph("What the source material says", style_map["subhead"]),
                Paragraph(project.source_summary(), style_map["body"]),
                Paragraph("Current situation", style_map["subhead"]),
                Paragraph(project.current_situation(), style_map["body"]),
                Paragraph("Why this project matters in the portfolio", style_map["subhead"]),
                Paragraph(project.why_it_matters, style_map["body"]),
                Paragraph("Notable signals and artifacts", style_map["subhead"]),
                bullet_list(
                    [
                        (
                            "README posture: top-level prose is still scaffold-grade."
                            if project.source_summary().startswith("The top-level README is still scaffold-grade")
                            else f"Readme title: {project.readme_title or 'No strong readme title surfaced.'}"
                        ),
                        f"Notable docs: {', '.join(project.notable_docs) if project.notable_docs else 'No high-signal docs surfaced near the root.'}",
                        f"Git posture: {project.status_label.lower()} with {project.dirty_count} current status entries and {project.commits_7d} commits in the last seven days.",
                        f"Stack fingerprint: {', '.join(project.stack) if project.stack else 'Could not infer a strong stack fingerprint from package metadata.'}",
                    ],
                    style_map,
                ),
            ]
        )
        if project != projects[-1]:
            story.append(PageBreak())

    doc.build(story)


def main() -> None:
    projects = [gather_project(slug) for slug in ACTIVE_PROJECTS]
    markdown_text = build_markdown(projects)
    build_pdf(projects, markdown_text)
    print(f"Wrote {OUTPUT_PDF}")
    print(f"Wrote {OUTPUT_MD}")


if __name__ == "__main__":
    main()
