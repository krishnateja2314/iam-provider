"""Regenerate the evaluation figures and the summary CSV from raw result files.

Usage (from the repository root):
    python evaluation/scripts/make_figures.py evaluation/results/2026-11-16

Inputs: <dir>/e1-baseline-revocation.jsonl (from baseline-revocation.mjs) and the committed
evidence logs under docs/evidence/2026-11-14/ (latency.log). Outputs go to <dir>/figures/ and
<dir>/summary.csv. Requires matplotlib.
"""
import csv
import json
import statistics
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "evaluation" / "results" / "2026-11-16"
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)

# Reference palette (validated categorical slots 1-2) and text/grid tokens.
SOLUTION, BASELINE, MUTED = "#2a78d6", "#eb6834", "#8a8984"
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#ffffff"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": INK2,
    "xtick.color": INK2, "ytick.color": INK2, "axes.titlesize": 11, "axes.titleweight": "bold",
    "axes.titlecolor": INK, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8, "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE, "axes.axisbelow": True, "savefig.dpi": 200, "savefig.bbox": "tight",
})


def load_jsonl(path):
    rows = []
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line.startswith("{"):
            rows.append(json.loads(line))
    return rows


e1 = load_jsonl(OUT / "e1-baseline-revocation.jsonl")
trials = [r for r in e1 if r.get("experiment") == "E1" and "operation" in r]
cost = next(r for r in e1 if r.get("experiment") == "E1-cost")
ops = ["provider-logout", "admin-logout-all", "agent-client-disabled", "password-reset"]
labels = {"provider-logout": "Provider logout", "admin-logout-all": "Admin logout-all",
          "agent-client-disabled": "AG01 client disabled", "password-reset": "Password reset\n(control)"}

summary = []
for op in ops:
    r = [t for t in trials if t["operation"] == op]
    summary.append({
        "operation": op, "trials": len(r),
        "valid_before_all": all(t["before"]["baseline"] and t["before"]["solution"] == 200 for t in r),
        "baseline_first_request_accepted": sum(t["first"]["baseline"] for t in r),
        "solution_first_request_401": sum(t["first"]["solution"] == 401 for t in r),
        "solution_first_request_ms_median": statistics.median(t["first"]["solutionMs"] for t in r),
        "baseline_accepted_requests_after": sum(t["baselineAccepted"] for t in r),
        "solution_accepted_requests_after": sum(t["solutionAccepted"] for t in r),
        "polls_total": sum(t["polls"] for t in r),
        "baseline_window_s_median": statistics.median(t["baselineWindowS"] for t in r),
        "solution_window_s_median": statistics.median(t["solutionWindowS"] for t in r),
    })
with open(OUT / "summary.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(summary[0].keys()))
    w.writeheader()
    w.writerows(summary)

# Figure 1: first request with the old token after the operation, baseline vs solution.
fig, ax = plt.subplots(figsize=(7.2, 3.4))
x = range(len(ops))
bw = 0.36
b = [s["baseline_first_request_accepted"] for s in summary]
s_ = [s["trials"] - s["solution_first_request_401"] for s in summary]
bars_b = ax.bar([i - bw / 2 - 0.01 for i in x], b, bw, color=BASELINE, label="Baseline B0: JWT-only")
bars_s = ax.bar([i + bw / 2 + 0.01 for i in x], s_, bw, color=SOLUTION, label="Solution: JWT + uncached introspection")
for bars in (bars_b, bars_s):
    for rect in bars:
        h = rect.get_height()
        ax.annotate(f"{h:.0f} of 5", (rect.get_x() + rect.get_width() / 2, h), xytext=(0, 3),
                    textcoords="offset points", ha="center", fontsize=9, color=INK)
ax.set_xticks(list(x), [labels[o] for o in ops])
ax.set_ylim(0, 6)
ax.set_yticks(range(0, 6))
ax.set_ylabel("Trials in which the old token" + chr(10) + "was ACCEPTED on the first request")
ax.set_title("E1: first request after the operation (5 trials each)", loc="left")
ax.grid(axis="x", visible=False)
ax.legend(frameon=False, loc="upper center", ncol=2, bbox_to_anchor=(0.5, -0.2))
fig.savefig(FIG / "e1-revoked-token-acceptance.png")
plt.close(fig)

# Figure 2: how long the baseline keeps accepting a disabled agent's token (per trial).
agent = [t for t in trials if t["operation"] == "agent-client-disabled"]
fig, ax = plt.subplots(figsize=(7.2, 2.6))
names = [f"Trial {t['trial']}" for t in agent]
ax.barh(names, [t["baselineWindowS"] for t in agent], color=BASELINE, height=0.5, label="Baseline B0")
for i, t in enumerate(agent):
    ax.annotate(f"{t['baselineWindowS']:.1f} s", (t["baselineWindowS"], i), xytext=(4, 0), textcoords="offset points",
                va="center", fontsize=9, color=INK)
ms = sorted(t["first"]["solutionMs"] for t in agent)
ax.text(0, -0.16, f"Solution: 0 s in every trial (401 on the first request, {ms[0]}-{ms[-1]} ms after the disable call)",
        transform=ax.transAxes, fontsize=9, color=SOLUTION, va="top")
ax.set_xlim(0, 70)
ax.invert_yaxis()
ax.set_xlabel("Seconds the baseline kept accepting the old token (token lifetime 60 s)", labelpad=18)
ax.set_title("E1: exposure window of baseline B0 after the AG01 agent is disabled", loc="left")
ax.grid(axis="y", visible=False)
fig.savefig(FIG / "e1-agent-exposure-window.png")
plt.close(fig)

# Figure 3: latency cost of the check (p50 and p95), from docs/evidence/2026-11-14/latency.log + E1 cost.
lat = load_jsonl(ROOT / "docs" / "evidence" / "2026-11-14" / "latency.log")
summ = next(r for r in lat if r.get("summary"))
series = [("Local JWT verify\n(baseline B0)", cost["p50"], cost["p95"]),
          ("GET /health\n(no auth)", summ["health"]["p50"], summ["health"]["p95"]),
          ("Introspection call\nalone", summ["introspect"]["p50"], summ["introspect"]["p95"]),
          ("Full agent request\n(solution)", summ["agent-list"]["p50"], summ["agent-list"]["p95"])]
fig, ax = plt.subplots(figsize=(7.2, 3.2))
xs = range(len(series))
p50 = ax.bar([i - bw / 2 - 0.01 for i in xs], [s[1] for s in series], bw, color=SOLUTION, label="p50")
p95 = ax.bar([i + bw / 2 + 0.01 for i in xs], [s[2] for s in series], bw, color="#9ec3ee", label="p95")
for bars in (p50, p95):
    for rect in bars:
        h = rect.get_height()
        ax.annotate(f"{h:.2f}", (rect.get_x() + rect.get_width() / 2, h), xytext=(0, 3),
                    textcoords="offset points", ha="center", fontsize=8.5, color=INK)
ax.set_xticks(list(xs), [s[0] for s in series])
ax.set_ylabel("Milliseconds")
ax.set_ylim(0, 18)
ax.set_title("Cost of the check: median of 3 runs x 200 requests (in-container)", loc="left")
ax.grid(axis="x", visible=False)
ax.legend(frameon=False, loc="upper left")
fig.savefig(FIG / "latency-cost.png")
plt.close(fig)

# Figure 4: verification over revisions (two panels, one measure each; no dual axis).
revs = ["W2\n0d232ec", "W4 start\n953a0aa", "W4\n42d8a43", "W5\nfde2efd", "Final\ne13f019"]
passed = [159, 160, 197, 227, 253]
failed = [0, 1, 0, 0, 0]
killed = [0, 0, 7, 11, 15]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.4, 2.9))
a1.bar(revs, passed, color=SOLUTION, width=0.6)
a1.bar(revs, failed, bottom=passed, color=BASELINE, width=0.6)
for i, v in enumerate(passed):
    a1.annotate(str(v) + (" +1 fail" if failed[i] else ""), (i, v + failed[i]), xytext=(0, 3), textcoords="offset points",
                ha="center", fontsize=8.5, color=INK)
a1.set_title("Tests passed (real DB + live Keycloak)", loc="left")
a1.set_ylim(0, 290)
a1.grid(axis="x", visible=False)
a1.tick_params(axis="x", labelsize=7.5)
a2.bar(revs, killed, color=SOLUTION, width=0.6)
for i, v in enumerate(killed):
    a2.annotate(f"{v}/{v}" if v else "none", (i, v), xytext=(0, 3), textcoords="offset points", ha="center", fontsize=8.5, color=INK)
a2.set_title("Injected security bugs caught", loc="left")
a2.set_ylim(0, 18)
a2.grid(axis="x", visible=False)
a2.tick_params(axis="x", labelsize=7.5)
fig.tight_layout()
fig.savefig(FIG / "verification-over-revisions.png")
plt.close(fig)

# Figure 5: final suite by test file.
suite = [("t05-t08-authorization", 59, 0), ("t03-t04-t09-token-validation", 41, 0), ("api (integration)", 31, 0),
         ("service-principal (AG01)", 23, 7), ("delegation (AG02)", 22, 4), ("session-lifecycle", 15, 6),
         ("startup-config", 12, 0), ("tenant-sso", 7, 3), ("provisioning-privacy", 9, 0),
         ("t01-t02-identity-membership", 8, 0), ("t10-audit", 6, 0)]
fig, ax = plt.subplots(figsize=(7.2, 3.6))
names = [s[0] for s in suite]
ax.barh(names, [s[1] for s in suite], color=SOLUTION, height=0.62, label="Fixture / real PostgreSQL")
ax.barh(names, [s[2] for s in suite], left=[s[1] for s in suite], color="#9ec3ee", height=0.62, label="Live Keycloak")
for i, s in enumerate(suite):
    ax.annotate(str(s[1] + s[2]), (s[1] + s[2], i), xytext=(4, 0), textcoords="offset points", va="center", fontsize=8.5, color=INK)
ax.invert_yaxis()
ax.set_xlim(0, 68)
ax.set_title("Final suite: 253 passed, 0 failed, 0 skipped (clean clone of e13f019)", loc="left")
ax.grid(axis="y", visible=False)
ax.legend(frameon=False, loc="lower right")
fig.savefig(FIG / "final-suite-by-file.png")
plt.close(fig)

print(json.dumps(summary, indent=1))
print("figures:", sorted(p.name for p in FIG.iterdir()))
