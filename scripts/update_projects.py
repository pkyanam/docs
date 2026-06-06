#!/usr/bin/env python3
"""
update_projects.py — pull live data from the github api and rewrite the
auto-generated blocks on the site.

writes two regions, each delimited by mdx comment markers:

  * projects/index.mdx   {/* AUTOREPOS:START ... */} ... {/* AUTOREPOS:END */}
  * stats.mdx            {/* STATS:START ... */}     ... {/* STATS:END */}

no third-party dependencies — stdlib only. set GITHUB_TOKEN in the env to
raise the api rate limit (the workflow passes the built-in token).

run: python3 scripts/update_projects.py
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

USER = "pkyanam"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# repos that already have dedicated pages or are infra/noise — keep them out of
# the "latest from github" feed so it surfaces fresh work instead.
EXCLUDE = {
    "trifecta", "brainbase", "graphbrain", "arduroomba",
    "claude-ps5-mcp", "gba-next", "codex-ios",
    "gh-contributions-macos-menu-bar",
    "docs", "mintlify-docs", "pkyanam", "proj",
}

FEED_COUNT = 6

# homepages on these (dead) hosts are ignored so the feed never links to them.
DEAD_HOSTS = ("agentmeld.com",)

# minimal language -> colored-dot emoji, falls back to a neutral dot.
LANG_DOT = {
    "TypeScript": "🟦", "JavaScript": "🟨", "Python": "🟦", "Swift": "🟧",
    "C++": "🟪", "C": "⬜", "Rust": "🟧", "HTML": "🟧", "Shell": "🟩",
    "Go": "🟦", "Java": "🟫", "Ruby": "🟥", "Makefile": "⬛",
}


def api(path):
    url = f"https://api.github.com{path}"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "preetham-site-updater")
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_repos():
    repos, page = [], 1
    while True:
        batch = api(f"/users/{USER}/repos?per_page=100&page={page}&sort=pushed")
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return repos


def rel_time(iso):
    then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    days = (datetime.now(timezone.utc) - then).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 30:
        return f"{days}d ago"
    if days < 365:
        return f"{days // 30}mo ago"
    return f"{days // 365}y ago"


def esc(text):
    if not text:
        return ""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("{", "&#123;")
        .replace("}", "&#125;")
    )


def repo_card(r):
    name = esc(r["name"])
    desc = esc(r.get("description") or "no description yet")
    lang = r.get("language") or "—"
    dot = LANG_DOT.get(lang, "⬜")
    stars = r.get("stargazers_count", 0)
    pushed = rel_time(r["pushed_at"])
    home = (r.get("homepage") or "").strip()
    if any(host in home for host in DEAD_HOSTS):
        home = ""
    live = (
        f'\n      <span><a href="{esc(home)}">live ↗</a></span>'
        if home
        else ""
    )
    return f"""  <a className="pk-card" href="{esc(r['html_url'])}">
    <div className="pk-card-top">
      <p className="pk-card-title">{name}</p>
      <span className="pk-arrow">→</span>
    </div>
    <p className="pk-card-desc">{desc}</p>
    <div className="pk-card-meta">
      <span>{dot} {esc(lang)}</span>
      <span>★ {stars}</span>
      <span>pushed {pushed}</span>{live}
    </div>
  </a>"""


def build_autorepos(repos):
    feed = [
        r for r in repos
        if not r.get("fork") and r["name"] not in EXCLUDE
    ]
    feed.sort(key=lambda r: r["pushed_at"], reverse=True)
    cards = "\n".join(repo_card(r) for r in feed[:FEED_COUNT])
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return (
        '<div className="pk-grid">\n'
        + cards
        + "\n</div>\n\n"
        + f'<p className="pk-hero-sub">last refreshed {stamp} · '
        + f'showing {min(FEED_COUNT, len(feed))} of {len(feed)} non-fork repos</p>'
    )


def build_stats(repos, profile):
    own = [r for r in repos if not r.get("fork")]
    total_stars = sum(r.get("stargazers_count", 0) for r in own)
    langs = {}
    for r in own:
        lang = r.get("language")
        if lang:
            langs[lang] = langs.get(lang, 0) + 1
    top_lang = max(langs, key=langs.get) if langs else "—"
    cells = [
        (str(profile.get("public_repos", len(repos))), "public repos"),
        (str(total_stars), "total stars"),
        (str(profile.get("followers", 0)), "followers"),
        (top_lang.lower(), "top language"),
    ]
    inner = "\n".join(
        f'  <div className="pk-stat">\n'
        f'    <div className="pk-stat-num">{esc(num)}</div>\n'
        f'    <div className="pk-stat-label">{esc(label)}</div>\n'
        f"  </div>"
        for num, label in cells
    )
    return '<div className="pk-stat-grid">\n' + inner + "\n</div>"


def replace_region(path, start_marker, end_marker, new_body):
    full = os.path.join(ROOT, path)
    with open(full, "r", encoding="utf-8") as f:
        content = f.read()
    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker),
        re.DOTALL,
    )
    replacement = f"{start_marker}\n{new_body}\n{end_marker}"
    if not pattern.search(content):
        print(f"!! markers not found in {path}", file=sys.stderr)
        return False
    updated = pattern.sub(lambda _m: replacement, content)
    if updated != content:
        with open(full, "w", encoding="utf-8") as f:
            f.write(updated)
        print(f"++ updated {path}")
        return True
    print(f"== no change in {path}")
    return False


def main():
    profile = api(f"/users/{USER}")
    repos = fetch_repos()
    print(f"fetched {len(repos)} repos")

    replace_region(
        "projects/index.mdx",
        "{/* AUTOREPOS:START — generated by scripts/update_projects.py, do not edit by hand */}",
        "{/* AUTOREPOS:END */}",
        build_autorepos(repos),
    )
    replace_region(
        "stats.mdx",
        "{/* STATS:START — generated by scripts/update_projects.py, do not edit by hand */}",
        "{/* STATS:END */}",
        build_stats(repos, profile),
    )


if __name__ == "__main__":
    main()
