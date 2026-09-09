import os

dashboard_dir = "/Users/rashadrahimov/Documents/leaddrive-v2/src/app/(dashboard)"

# All tokens that follow a bare "border" (not a color class)
bare_tokens = [
    "rounded", "bg-", "overflow", "shadow", "divide",
    "max-", "px-", "p-", "text-", "$",
]

zinc = "border-zinc-200 dark:border-zinc-700"

replacements = [
    # hover pseudo-class first (needs dark:hover: variant)
    ('hover:border-border',     'hover:border-zinc-300 dark:hover:border-zinc-600'),
    # opacity variants before plain
    ('border-border/60',  'border-zinc-200/60 dark:border-zinc-700/60'),
    ('border-border/50',  'border-zinc-200/50 dark:border-zinc-700/50'),
    ('border-border/40',  'border-zinc-200/40 dark:border-zinc-700/40'),
    ('border-border/30',  'border-zinc-200/30 dark:border-zinc-700/30'),
    # plain border-border
    ('border-border',  zinc),
]

# Bare border patterns — add zinc after, for BOTH start-of-string and mid-string
# Start-of-string: preceded by " or ` or (
# Mid-string: preceded by a space
for token in bare_tokens:
    if token == "$":
        # border at end of class string (before closing quote)
        replacements.append((f' border"',  f' border {zinc}"'))
        replacements.append((f" border'",  f" border {zinc}'"))
        replacements.append((f' border`',  f' border {zinc}`'))
    else:
        # mid-string (space before border)
        replacements.append((f' border {token}', f' border {zinc} {token}'))
        # start-of-string after double-quote
        replacements.append((f'"border {token}', f'"border {zinc} {token}'))
        # start-of-string after single-quote
        replacements.append((f"'border {token}", f"'border {zinc} {token}"))
        # start-of-string after backtick
        replacements.append((f'`border {token}', f'`border {zinc} {token}'))
        # start-of-string after open-paren (for cn("border ..."))
        replacements.append((f'(border {token}', f'(border {zinc} {token}'))

changed = []
for root, _dirs, files in os.walk(dashboard_dir):
    for fname in sorted(files):
        if not fname.endswith('.tsx'):
            continue
        path = os.path.join(root, fname)
        with open(path) as f:
            content = f.read()
        original = content
        for old, new in replacements:
            content = content.replace(old, new)
        if content != original:
            with open(path, 'w') as f:
                f.write(content)
            rel = path.replace(dashboard_dir + '/', '')
            changed.append(rel)

print(f"Updated {len(changed)} files:")
for p in changed:
    print(f"  {p}")
