import os
import re
import subprocess
import json

ROOT = '/tmp/claude-0/-home-user-comcave-discord-bot/f3da5f0b-4bd1-5476-b10a-448457897982/scratchpad/ihk/ihk_pruefungen'

CATEGORIES = [
    'Systemintegration',
    'Anwendungsentwicklung',
    'WISO',
    'Kernqualifikationen (gemeinsam)',
    'IT-Systemkaufmann (alt)',
    'Informatikkaufmann/-frau (alt)',
    'IT-Systemelektroniker (alt)',
    'Referenz/Sonstiges',
]

def classify_folder(rel_path: str):
    top = rel_path.split(os.sep)[0].lower()
    if top.startswith('fisi'):
        return 'Systemintegration'
    if top.startswith('fae'):
        return 'Anwendungsentwicklung'
    if top.startswith('ihk alt'):
        return 'IT-Systemkaufmann (alt)'
    return None

def classify_filename(name: str):
    low = name.lower()
    if 'prufungskatalog' in low or 'pruefungskatalog' in low or low.startswith('katalog'):
        return 'Referenz/Sonstiges'
    if 'itsyskfm' in low or 'it-systemkauf' in low or 'itsk' in low:
        return 'IT-Systemkaufmann (alt)'
    if 'infk' in low or 'informatikkauf' in low:
        return 'Informatikkaufmann/-frau (alt)'
    if re.search(r'(^|[\s\-_])se([\s\-_.]|$)', name, re.IGNORECASE) and '2021' in low:
        return 'IT-Systemelektroniker (alt)'
    if 'fisi' in low or 'fisy' in low or 'systemintegration' in low:
        return 'Systemintegration'
    if ('fiae' in low or 'fae' in low or 'anwendungsentwicklung' in low
            or 'algorithmen' in low or 'softwareprodukt' in low):
        return 'Anwendungsentwicklung'
    if 'wiso' in low or 'wirtschaft' in low or 'sozialkunde' in low:
        return 'WISO'
    if re.search(r'(^|[\s\-_])kq([\s\-_.]|$)', name, re.IGNORECASE) or 'kernqualifikation' in low:
        return 'Kernqualifikationen (gemeinsam)'
    return None

def classify_text(text: str):
    low = text.lower()
    if 'itsyskfm' in low or 'it-systemkaufmann' in low or 'it systemkaufmann' in low:
        return 'IT-Systemkaufmann (alt)'
    if 'informatikkauffrau' in low or 'informatikkaufmann' in low:
        return 'Informatikkaufmann/-frau (alt)'
    if 'it-systemelektroniker' in low or 'it systemelektroniker' in low:
        return 'IT-Systemelektroniker (alt)'
    if 'systemintegration' in low:
        return 'Systemintegration'
    if 'anwendungsentwicklung' in low or 'algorithmen' in low or 'softwareprodukt' in low:
        return 'Anwendungsentwicklung'
    if 'wirtschafts- und sozialkunde' in low or 'wirtschafts und sozialkunde' in low or 'sozialkunde' in low:
        return 'WISO'
    if 'kernqualifikation' in low:
        return 'Kernqualifikationen (gemeinsam)'
    if 'it-berufe' in low and re.search(r'120[1-5]\s*[–-]\s*120[1-5]', low):
        return 'Kernqualifikationen (gemeinsam)'
    return None

def extract_text(path: str, page: int) -> str:
    try:
        result = subprocess.run(
            ['pdftotext', '-f', str(page), '-l', str(page), '-q', path, '-'],
            capture_output=True, timeout=15, text=True, errors='replace',
        )
        return result.stdout or ''
    except Exception:
        return ''

def is_ao2020(rel_path: str) -> bool:
    top = rel_path.split(os.sep)[0].lower()
    if top.startswith('fisi 1999') or top.startswith('fae 1999') or top.startswith('ihk alt'):
        return False
    return True

results = {c: [] for c in CATEGORIES}
ao2020_counts = {c: 0 for c in CATEGORIES}
old_counts = {c: 0 for c in CATEGORIES}
unresolved = []
pdftotext_used = 0

for dirpath, dirnames, filenames in os.walk(ROOT):
    for fname in filenames:
        if fname.startswith('._'):
            continue
        if not fname.lower().endswith('.pdf'):
            continue
        full = os.path.join(dirpath, fname)
        rel = os.path.relpath(full, ROOT)

        cat = classify_folder(rel)
        if cat is None:
            cat = classify_filename(fname)
        if cat is None:
            text = extract_text(full, 1)
            pdftotext_used += 1
            cat = classify_text(text)
            if cat is None:
                text2 = extract_text(full, 2)
                if text2.strip():
                    cat = classify_text(text2)

        if cat is None:
            unresolved.append(rel)
        else:
            results[cat].append(rel)
            if is_ao2020(rel):
                ao2020_counts[cat] += 1
            else:
                old_counts[cat] += 1

total_assigned = sum(len(v) for v in results.values())

print(f'PDFs, deren Text gelesen wurde: {pdftotext_used}')
print('=== Finale Fachblock-Verteilung ===')
for c in CATEGORIES:
    print(f'{c}: {len(results[c])} Dateien  (AO2020/aktuell: {ao2020_counts[c]}, alt: {old_counts[c]})')
print(f'Gesamt zugeordnet: {total_assigned}')
print(f'Weiterhin unklar: {len(unresolved)}')
print()
print('=== Unklare Dateien ===')
for u in unresolved:
    print(u)

out_path = '/tmp/claude-0/-home-user-comcave-discord-bot/f3da5f0b-4bd1-5476-b10a-448457897982/scratchpad/classification.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        'results': results,
        'unresolved': unresolved,
        'ao2020_counts': ao2020_counts,
        'old_counts': old_counts,
    }, f, ensure_ascii=False, indent=2)
print(f'\nGeschrieben nach {out_path}')
